import crypto from 'crypto';
import db, { sqlNow } from '../db.js';

/**
 * Outbound webhooks: KumonScan POSTs real-time events to URLs the center owner
 * configures (Admin → Data portability). Not to be confused with the inbound
 * receivers under /webhooks/zoom and /gateway/inbound, which accept traffic
 * from Zoom and the SMS gateway phone.
 *
 * Delivery contract (best-effort notification, NOT guaranteed delivery):
 * - Each matching subscription gets one POST with a 3-second timeout and
 *   exactly one retry on failure, then the attempt is logged and dropped.
 *   There is no persistent queue and no redelivery; consumers that need a
 *   complete record should pull /api/export/full instead.
 * - `emit()` never rejects, so a dead or slow endpoint cannot fail or delay
 *   the check-in/check-out that triggered it. Call sites invoke it without
 *   awaiting the result.
 * - Payloads are signed: X-Webhook-Signature is `sha256=` + HMAC-SHA256(body)
 *   keyed with the subscription's secret. The secret is generated server-side
 *   and returned exactly once, on creation.
 *
 * Serverless caveat: on Vercel the function may freeze after the HTTP response
 * is sent, so an in-flight delivery can be delayed until the next invocation
 * or lost. Acceptable for a notification mechanism; documented, not hidden.
 */

export const WEBHOOK_EVENT_TYPES = [
  'student.registered',
  'student.checked_in',
  'student.checked_out',
];

export const WEBHOOK_TIMEOUT_MS = 3_000;

/** Initial attempt + exactly one retry. */
export const WEBHOOK_MAX_ATTEMPTS = 2;

let tablesPromise = null;

/**
 * The subscriptions table lives here (not db.js) so this workstream stays
 * inside its own files, mirroring messagingService.ensureMessagingTables.
 */
export async function ensureWebhookTables() {
  if (!tablesPromise) {
    tablesPromise = (async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS webhook_subscriptions (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          url TEXT NOT NULL,
          event_types TEXT NOT NULL,
          secret TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        )
      `);
      await db.exec(
        `CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_center_id
           ON webhook_subscriptions(center_id)`
      );
    })().catch((err) => {
      tablesPromise = null;
      throw err;
    });
  }
  await tablesPromise;
}

export function signWebhookPayload(secret, rawBody) {
  return `sha256=${crypto
    .createHmac('sha256', String(secret))
    .update(rawBody, 'utf8')
    .digest('hex')}`;
}

/** Constant-time comparison so consumers can copy this verification verbatim. */
export function verifyWebhookSignature(secret, rawBody, signature) {
  const expected = Buffer.from(signWebhookPayload(secret, rawBody), 'utf8');
  const provided = Buffer.from(String(signature ?? ''), 'utf8');
  return (
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected)
  );
}

function webhookError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function validateSubscriptionInput({ url, event_types }) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return 'url must be a valid absolute URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'url must use http or https';
  }

  if (!Array.isArray(event_types) || event_types.length === 0) {
    return `event_types must be a non-empty array of: ${WEBHOOK_EVENT_TYPES.join(', ')}`;
  }
  const unknown = event_types.filter((t) => !WEBHOOK_EVENT_TYPES.includes(t));
  if (unknown.length > 0) {
    return `Unknown event types: ${unknown.join(', ')}. Supported: ${WEBHOOK_EVENT_TYPES.join(', ')}`;
  }
  return null;
}

function parseEventTypes(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeSubscription(row, { includeSecret = false } = {}) {
  const out = {
    id: row.id,
    url: row.url,
    event_types: parseEventTypes(row.event_types),
    active: Boolean(row.active),
    created_at: row.created_at,
  };
  if (includeSecret) out.secret = row.secret;
  return out;
}

/**
 * Creates a subscription and returns it WITH the generated secret. This is
 * the only time the secret leaves the server; list responses omit it.
 */
export async function createSubscription(centerId, { url, event_types }) {
  const validationError = validateSubscriptionInput({ url, event_types });
  if (validationError) throw webhookError('INVALID_SUBSCRIPTION', validationError);

  await ensureWebhookTables();
  const secret = crypto.randomBytes(32).toString('hex');
  const deduped = [...new Set(event_types)];

  const result = await db
    .prepare(
      `INSERT INTO webhook_subscriptions (center_id, url, event_types, secret, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(centerId, String(url), JSON.stringify(deduped), secret, sqlNow());

  const row = await db
    .prepare('SELECT * FROM webhook_subscriptions WHERE id = ? AND center_id = ?')
    .get(result.lastInsertRowid, centerId);

  return serializeSubscription(row, { includeSecret: true });
}

export async function listSubscriptions(centerId) {
  await ensureWebhookTables();
  const rows = await db
    .prepare('SELECT * FROM webhook_subscriptions WHERE center_id = ? ORDER BY id ASC')
    .all(centerId);
  return rows.map((row) => serializeSubscription(row));
}

/** Returns true when a row was deleted, false when the id did not exist. */
export async function deleteSubscription(centerId, id) {
  await ensureWebhookTables();
  const result = await db
    .prepare('DELETE FROM webhook_subscriptions WHERE id = ? AND center_id = ? RETURNING id')
    .run(id, centerId);
  return result.rows.length > 0;
}

async function attemptDelivery(subscription, eventType, rawBody) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': eventType,
        'X-Webhook-Signature': signWebhookPayload(subscription.secret, rawBody),
      },
      body: rawBody,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`endpoint returned ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function deliverWithRetry(subscription, eventType, rawBody) {
  let lastError;
  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
    try {
      await attemptDelivery(subscription, eventType, rawBody);
      return true;
    } catch (err) {
      lastError = err;
    }
  }
  console.warn(
    `Webhook delivery failed after ${WEBHOOK_MAX_ATTEMPTS} attempts ` +
      `(subscription ${subscription.id}, ${eventType}): ${lastError?.message || lastError}`
  );
  return false;
}

/**
 * Fan out `eventType` to every active subscription of ONE center — a
 * subscriber configured at center A never receives center B's events. Never
 * rejects: call sites fire it without awaiting so a hung endpoint cannot
 * slow down the triggering request. The returned summary exists for tests
 * and diagnostics only.
 */
export async function emit(centerId, eventType, data) {
  try {
    await ensureWebhookTables();
    const rows = await db
      .prepare('SELECT * FROM webhook_subscriptions WHERE center_id = ? AND active = 1')
      .all(centerId);
    const matching = rows.filter((row) => parseEventTypes(row.event_types).includes(eventType));
    if (matching.length === 0) {
      return { matched: 0, delivered: 0, failed: 0 };
    }

    const rawBody = JSON.stringify({
      event: eventType,
      occurred_at: new Date().toISOString(),
      data,
    });

    const outcomes = await Promise.all(
      matching.map((subscription) => deliverWithRetry(subscription, eventType, rawBody))
    );
    const delivered = outcomes.filter(Boolean).length;
    return { matched: matching.length, delivered, failed: matching.length - delivered };
  } catch (err) {
    console.error(`Webhook emit failed (${eventType}):`, err?.message || err);
    return { matched: 0, delivered: 0, failed: 0, error: err?.message || String(err) };
  }
}
