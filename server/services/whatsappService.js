import db, { sqlNow } from '../db.js';
import { getCenterTimezone } from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import { ensureMessagingTables, normalizePhoneE164 } from './messagingService.js';

/**
 * WhatsApp notification channel via the Meta Cloud API.
 *
 * WhatsApp business-initiated messages must use pre-approved templates; the
 * API rejects free-form text outside a 24-hour customer-service window. Two
 * templates are assumed: `checked_in` and `checked_out`, each with two body
 * parameters ({{1}} student name, {{2}} local time) and wording matching the
 * SMS texts in smsQueueService.buildMessage. The templates themselves live in
 * Meta Business Manager and must be submitted for approval before this
 * channel goes live; until then sends fail soft with a 'template not found'
 * API error and the message row is marked 'failed'.
 *
 * WhatsApp rows reuse agent-1-messaging's `messages` table (channel =
 * 'whatsapp') so the staff thread view shows both channels in one inbox.
 * Unlike SMS there is no gateway queue: sends go straight to the Cloud API.
 */

export const WHATSAPP_TEMPLATES = {
  checked_in: 'checked_in',
  checked_out: 'checked_out',
};

const TEMPLATE_LANGUAGE = 'en_US';
const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

/**
 * True once outbound sending is configured. Webhook config is checked
 * separately (isWhatsAppWebhookConfigured): a center can receive before its
 * access token is provisioned, and vice versa.
 */
export function isWhatsAppConfigured() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

/** True once the inbound webhook can verify handshakes and signatures. */
export function isWhatsAppWebhookConfigured() {
  return Boolean(
    process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET
  );
}

let schemaPromise = null;

/**
 * WhatsApp rides on the messages table owned by messagingService; this only
 * adds the columns that distinguish channels. `channel` defaults to 'sms' so
 * every pre-existing row keeps its meaning. `wa_message_id` stores Meta's
 * message id (wamid) so delivery-status webhooks can find their row.
 */
export async function ensureWhatsAppSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureMessagingTables();
      await db.exec(
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'sms'`
      );
      await db.exec(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id TEXT`);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

/**
 * Send one pre-approved template message. Never throws: returns
 * `{ sent, wa_message_id }` on success, `{ sent: false, reason, error? }`
 * otherwise. With WhatsApp unconfigured this short-circuits before any
 * network call.
 */
export async function sendWhatsAppTemplate(to, templateName, params = []) {
  if (!isWhatsAppConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: TEMPLATE_LANGUAGE },
      ...(params.length > 0 && {
        components: [
          {
            type: 'body',
            parameters: params.map((value) => ({ type: 'text', text: String(value) })),
          },
        ],
      }),
    },
  };

  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body?.error?.message || `HTTP ${res.status}`;
      console.error(`WhatsApp send failed (${templateName}): ${detail}`);
      return { sent: false, reason: 'api_error', error: detail };
    }

    return { sent: true, wa_message_id: body?.messages?.[0]?.id ?? null };
  } catch (err) {
    console.error(`WhatsApp send failed (${templateName}):`, err?.message || err);
    return { sent: false, reason: 'network_error', error: err?.message || String(err) };
  }
}

function formatLocalTime(iso) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: getCenterTimezone(),
  }).format(new Date(iso));
}

/**
 * Local rendering of the template body for the thread view. Mirrors the SMS
 * wording in smsQueueService.buildMessage (kept separate to avoid a circular
 * import; the authoritative template text lives in Meta Business Manager).
 */
function renderTemplateBody(action, name, time) {
  if (action === 'checked_out') {
    return `${name} has finished at Kumon and is ready for pickup (${time}).`;
  }
  return `${name} checked in at Kumon at ${time}.`;
}

/**
 * Check-in/check-out notification over WhatsApp. Same never-throws contract
 * as smsQueueService.enqueueNotification: a WhatsApp failure must not fail
 * the attendance request. The message row is inserted before the API call so
 * a failed send is still visible ('failed') in the thread view.
 */
export async function sendAttendanceWhatsApp(session, student, action, iso) {
  try {
    await ensureWhatsAppSchema();

    const rawTo = typeof student?.parent_whatsapp === 'string' ? student.parent_whatsapp.trim() : '';
    const to = normalizePhoneE164(rawTo) || rawTo;
    if (!to) {
      console.warn(`WhatsApp: no parent_whatsapp for student ${student?.id}, skipping ${action}`);
      return { enqueued: false, channel: 'whatsapp', reason: 'no_parent_whatsapp' };
    }

    const templateName = WHATSAPP_TEMPLATES[action] || WHATSAPP_TEMPLATES.checked_in;
    const name = formatFullName(student);
    const time = formatLocalTime(iso);

    const inserted = await db
      .prepare(
        `INSERT INTO messages (center_id, student_id, direction, body, channel, status, created_at)
         VALUES (?, ?, 'outbound', ?, 'whatsapp', 'pending', ?)`
      )
      .run(student.center_id, student.id, renderTemplateBody(action, name, time), sqlNow());
    const messageId = inserted.lastInsertRowid;

    const result = await sendWhatsAppTemplate(to, templateName, [name, time]);

    await db
      .prepare(`UPDATE messages SET status = ?, wa_message_id = ? WHERE id = ? AND center_id = ?`)
      .run(
        result.sent ? 'sent' : 'failed',
        result.wa_message_id ?? null,
        messageId,
        student.center_id
      );

    return {
      enqueued: result.sent,
      channel: 'whatsapp',
      ...(result.sent ? {} : { reason: result.reason }),
    };
  } catch (err) {
    console.error('WhatsApp attendance notification failed:', err?.message || err);
    return { enqueued: false, channel: 'whatsapp', reason: 'error' };
  }
}

/**
 * Match an inbound WhatsApp sender to a student: parent_whatsapp first, then
 * parent_phone (parents commonly use one number for both). Both sides are
 * normalized in JS because stored phones keep whatever format staff typed.
 * Siblings sharing a number attach to the first active match (lowest id),
 * same rule as messagingService.findStudentByParentPhone.
 */
async function findStudentByWhatsAppPhone(centerId, normalizedPhone) {
  if (!normalizedPhone) return null;
  const candidates = await db
    .prepare(
      `SELECT id, parent_phone, parent_whatsapp, active FROM students
       WHERE center_id = ?
         AND ((parent_whatsapp IS NOT NULL AND parent_whatsapp <> '')
          OR (parent_phone IS NOT NULL AND parent_phone <> ''))
       ORDER BY active DESC, id ASC`
    )
    .all(centerId);
  return (
    candidates.find((s) => normalizePhoneE164(s.parent_whatsapp) === normalizedPhone) ||
    candidates.find((s) => normalizePhoneE164(s.parent_phone) === normalizedPhone) ||
    null
  );
}

/**
 * Store one inbound WhatsApp message. Always inserts a row, matched or not
 * (unmatched rows surface in the same triage list as unmatched SMS). Meta
 * redelivers webhooks until acknowledged, so redeliveries are deduplicated
 * on wa_message_id.
 */
export async function recordInboundWhatsAppMessage(
  centerId,
  { from_phone, body, wa_message_id = null }
) {
  await ensureWhatsAppSchema();

  if (wa_message_id) {
    const existing = await db
      .prepare(
        `SELECT id FROM messages
         WHERE center_id = ? AND wa_message_id = ? AND direction = 'inbound'`
      )
      .get(centerId, wa_message_id);
    if (existing) {
      return { id: existing.id, duplicate: true };
    }
  }

  const normalizedPhone = normalizePhoneE164(from_phone);
  const student = await findStudentByWhatsAppPhone(centerId, normalizedPhone);

  const result = await db
    .prepare(
      `INSERT INTO messages (center_id, student_id, direction, body, from_phone, channel, status, wa_message_id, created_at)
       VALUES (?, ?, 'inbound', ?, ?, 'whatsapp', 'sent', ?, ?)`
    )
    .run(
      centerId,
      student?.id ?? null,
      body,
      normalizedPhone || String(from_phone).trim(),
      wa_message_id,
      sqlNow()
    );

  return {
    id: result.lastInsertRowid,
    student_id: student?.id ?? null,
    matched: Boolean(student),
    duplicate: false,
  };
}

/** Statuses Meta reports that map onto the messages.status column. */
const DELIVERY_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

/**
 * Apply one delivery-status update from the webhook to its outbound row.
 * Unknown statuses and unknown wamids are ignored (Meta also reports
 * conversation/pricing events this codebase does not track).
 */
export async function applyWhatsAppDeliveryStatus(centerId, { wa_message_id, status }) {
  if (!wa_message_id || !DELIVERY_STATUSES.has(status)) {
    return { updated: false };
  }
  await ensureWhatsAppSchema();
  const result = await db
    .prepare(
      `UPDATE messages SET status = ?
       WHERE center_id = ? AND wa_message_id = ?
         AND direction = 'outbound' AND channel = 'whatsapp'`
    )
    .run(status, centerId, wa_message_id);
  return { updated: result.changes > 0 };
}
