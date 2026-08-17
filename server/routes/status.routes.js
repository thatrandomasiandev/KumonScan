import { Router } from 'express';
import db from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { recentErrorCount } from '../services/errorReportingService.js';
import { isTwilioConfigured } from '../services/twilioService.js';
import { GATEWAY_LAST_SEEN_KEY } from './gateway.routes.js';

/**
 * GET /api/status — staff-authenticated ops surface (center-scoped).
 *
 * Aggregates database reachability, SMS channel (Twilio or Android gateway)
 * plus queue depth, webhook subscription health, and 24h captured-error
 * count in one payload.
 * Every check runs through `runCheck`, which converts a thrown error into a
 * `down` result for that check alone.
 *
 * Check statuses: `ok`, `warn`, `down`, `not_configured`. Overall status is
 * the worst configured check (`not_configured` never degrades overall).
 */

const DB_CHECK_TIMEOUT_MS = 3000;
const GATEWAY_STALE_SECONDS = Number(process.env.GATEWAY_HEARTBEAT_STALE_SECONDS || 600);
const ERROR_WINDOW_HOURS = 24;
const WEBHOOK_WINDOW_HOURS = 24;
const WEBHOOK_WARN_FAILURE_RATE = 0.1;
const WEBHOOK_DOWN_FAILURE_RATE = 0.5;

const SEVERITY = { ok: 0, not_configured: 0, warn: 1, down: 2 };

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function tableExists(name) {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ?`
    )
    .get(name);
  return Boolean(row);
}

async function columnExists(table, column) {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`
    )
    .get(table, column);
  return Boolean(row);
}

export async function checkDatabase() {
  const started = Date.now();
  await withTimeout(db.prepare('SELECT 1 AS ok').get(), DB_CHECK_TIMEOUT_MS, 'database check');
  return {
    status: 'ok',
    detail: 'query round trip succeeded',
    latency_ms: Date.now() - started,
  };
}

async function readGatewayLastSeen(centerId) {
  if (!(await tableExists('settings'))) return null;
  const row = await db
    .prepare(`SELECT value FROM settings WHERE center_id = ? AND key = ?`)
    .get(centerId, GATEWAY_LAST_SEEN_KEY);
  return row?.value || null;
}

async function smsQueueCounts(centerId) {
  if (!(await tableExists('sms_queue'))) return null;
  const rows = await db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM sms_queue
       WHERE center_id = ? GROUP BY status`
    )
    .all(centerId);
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  return {
    pending: byStatus.pending ?? 0,
    failed: byStatus.failed ?? 0,
  };
}

export async function checkSmsGateway(centerId) {
  const queue = await smsQueueCounts(centerId);

  if (isTwilioConfigured()) {
    const pending = queue?.pending ?? 0;
    const failed = queue?.failed ?? 0;
    let status = 'ok';
    let detail = 'Twilio direct-send configured';
    if (failed > 0) {
      status = 'warn';
      detail = `Twilio configured; ${failed} failed message(s) in queue`;
    } else if (pending > 0) {
      status = 'warn';
      detail = `Twilio configured; ${pending} pending message(s) not yet sent`;
    }
    return {
      status,
      detail,
      channel: 'twilio',
      queue: queue || { pending: 0, failed: 0 },
    };
  }

  const lastSeen = await readGatewayLastSeen(centerId);
  if (!lastSeen) {
    return {
      status: 'not_configured',
      detail: 'no Twilio credentials and no gateway_last_seen heartbeat',
    };
  }

  const secondsAgo = Math.max(0, Math.round((Date.now() - new Date(lastSeen).getTime()) / 1000));
  const stale = !Number.isFinite(secondsAgo) || secondsAgo > GATEWAY_STALE_SECONDS;

  const result = {
    status: stale ? 'down' : 'ok',
    detail: stale
      ? `last heartbeat ${secondsAgo}s ago (stale after ${GATEWAY_STALE_SECONDS}s)`
      : `last heartbeat ${secondsAgo}s ago`,
    channel: 'gateway',
    last_seen: lastSeen,
    seconds_since_heartbeat: secondsAgo,
  };

  if (queue) {
    result.queue = queue;
    if (result.status === 'ok' && queue.failed > 0) {
      result.status = 'warn';
      result.detail += `; ${queue.failed} failed message(s) in queue`;
    }
  }

  return result;
}

export async function checkWebhooks(centerId) {
  if (!(await tableExists('webhook_subscriptions'))) {
    return {
      status: 'not_configured',
      detail: 'no webhook_subscriptions table (webhooks not set up)',
    };
  }

  const subs = await db
    .prepare(
      'SELECT COUNT(*) AS count FROM webhook_subscriptions WHERE center_id = ? AND active = 1'
    )
    .get(centerId);

  const deliveryTable = (await tableExists('webhook_deliveries'))
    ? 'webhook_deliveries'
    : (await tableExists('webhook_delivery_attempts'))
      ? 'webhook_delivery_attempts'
      : null;

  if (!deliveryTable) {
    return {
      status: 'ok',
      detail: `${subs?.count ?? 0} subscription(s); no delivery log table to rate`,
      subscriptions: subs?.count ?? 0,
    };
  }

  const timeColumn = (await columnExists(deliveryTable, 'attempted_at'))
    ? 'attempted_at'
    : (await columnExists(deliveryTable, 'created_at'))
      ? 'created_at'
      : null;
  const cutoff = new Date(Date.now() - WEBHOOK_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const hasCenter = await columnExists(deliveryTable, 'center_id');
  const clauses = [];
  const params = [];
  if (timeColumn) {
    clauses.push(`${timeColumn} >= ?`);
    params.push(cutoff);
  }
  if (hasCenter) {
    clauses.push('center_id = ?');
    params.push(centerId);
  }
  const windowClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const totals = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status IN ('failed', 'error')) AS failed
       FROM ${deliveryTable} ${windowClause}`
    )
    .get(...params);

  const total = Number(totals?.total ?? 0);
  const failed = Number(totals?.failed ?? 0);
  const failureRate = total > 0 ? failed / total : 0;

  let status = 'ok';
  if (total > 0 && failureRate >= WEBHOOK_DOWN_FAILURE_RATE) status = 'down';
  else if (total > 0 && failureRate >= WEBHOOK_WARN_FAILURE_RATE) status = 'warn';

  return {
    status,
    detail:
      total === 0
        ? `no deliveries in last ${WEBHOOK_WINDOW_HOURS}h`
        : `${failed}/${total} deliveries failed in last ${WEBHOOK_WINDOW_HOURS}h`,
    subscriptions: subs?.count ?? 0,
    deliveries_24h: total,
    failed_24h: failed,
  };
}

export async function checkErrors(centerId) {
  const count = await recentErrorCount({ hours: ERROR_WINDOW_HOURS, centerId });
  return {
    status: count > 0 ? 'warn' : 'ok',
    detail:
      count > 0
        ? `${count} captured error(s) in last ${ERROR_WINDOW_HOURS}h`
        : `no captured errors in last ${ERROR_WINDOW_HOURS}h`,
    count_24h: count,
  };
}

async function runCheck(fn) {
  try {
    return await fn();
  } catch (err) {
    return { status: 'down', detail: err?.message || 'check failed' };
  }
}

/**
 * Build the default check map bound to a center. Injectable for tests that
 * degrade one check without touching the others.
 */
export function defaultChecksFor(centerId) {
  return {
    database: () => checkDatabase(),
    sms_gateway: () => checkSmsGateway(centerId),
    webhooks: () => checkWebhooks(centerId),
    errors: () => checkErrors(centerId),
  };
}

/**
 * Run all checks concurrently, each isolated by `runCheck`.
 * `checkFns` is injectable so tests can degrade one check deterministically.
 */
export async function runStatusChecks(centerId, checkFns = defaultChecksFor(centerId)) {
  const entries = await Promise.all(
    Object.entries(checkFns).map(async ([name, fn]) => [name, await runCheck(fn)])
  );
  const checks = Object.fromEntries(entries);

  const overall = entries.reduce(
    (worst, [, result]) =>
      SEVERITY[result.status] > SEVERITY[worst] ? result.status : worst,
    'ok'
  );

  return {
    generated_at: new Date().toISOString(),
    overall,
    checks,
  };
}

const router = Router();

router.get('/status', requireAdmin, async (req, res) => {
  res.json(await runStatusChecks(req.center.id));
});

export default router;
