import crypto from 'crypto';
import db, { sqlNow } from '../db.js';

/**
 * Direct-send SMS via the Twilio REST API — server-driven, no Android
 * gateway phone required. Mirrors whatsappService's shape (isConfigured
 * guard, never throws) but attaches to the existing sms_queue table instead
 * of a separate one: sms_queue stays the single ledger of every outbound SMS
 * regardless of which sender handled it. When TWILIO_* is unset, sms_queue
 * rows behave exactly as before this file existed (left 'pending' for the
 * Android gateway phone, or accumulate unsent).
 */

const API_BASE = 'https://api.twilio.com/2010-04-01';

export function isTwilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

/** Webhook signature verification only needs the auth token, not a from-number. */
export function isTwilioWebhookConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/** One raw send attempt. Never throws: returns {sent, message_sid} or {sent: false, reason, error?}. */
export async function sendTwilioSms(to, body) {
  if (!isTwilioConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const params = new URLSearchParams({
    To: to,
    From: process.env.TWILIO_FROM_NUMBER,
    Body: body,
  });

  try {
    const res = await fetch(`${API_BASE}/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const responseBody = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = responseBody?.message || `HTTP ${res.status}`;
      console.error(`Twilio send failed: ${detail}`);
      return { sent: false, reason: 'api_error', error: detail };
    }
    return { sent: true, message_sid: responseBody?.sid ?? null };
  } catch (err) {
    console.error('Twilio send failed:', err?.message || err);
    return { sent: false, reason: 'network_error', error: err?.message || String(err) };
  }
}

/**
 * Attempt to send a just-inserted sms_queue row immediately via Twilio and
 * reflect the result on that row, using the same pending -> sending -> (sent
 * | failed) claim the Android gateway's poll endpoint uses. Claiming first
 * (before the network call) means a concurrent gateway-phone poll can never
 * also pick up and double-send this row. A no-op when Twilio is unconfigured.
 * Never throws — a send failure must not block the caller's check-in or
 * message-send response.
 */
export async function attemptImmediateSend(centerId, queueRowId, parentPhone, message) {
  if (!isTwilioConfigured()) return;

  try {
    const claim = await db
      .prepare(
        `UPDATE sms_queue SET status = 'sending', claimed_at = ?
         WHERE id = ? AND center_id = ? AND status = 'pending'
         RETURNING id`
      )
      .run(sqlNow(), queueRowId, centerId);
    if (claim.rows.length === 0) return;

    const result = await sendTwilioSms(parentPhone, message);
    await db
      .prepare(
        `UPDATE sms_queue SET
           status = ?,
           attempts = attempts + 1,
           sent_at = ?,
           last_error = ?,
           claimed_at = NULL
         WHERE id = ? AND center_id = ?`
      )
      .run(
        result.sent ? 'sent' : 'failed',
        result.sent ? sqlNow() : null,
        result.sent ? null : result.error || result.reason || 'send_failed',
        queueRowId,
        centerId
      );
  } catch (err) {
    console.error('Twilio immediate-send failed:', err?.message || err);
    try {
      await db
        .prepare(
          `UPDATE sms_queue SET status = 'pending', claimed_at = NULL
           WHERE id = ? AND center_id = ? AND status = 'sending'`
        )
        .run(queueRowId, centerId);
    } catch (releaseErr) {
      console.error('Failed to release stuck sms_queue claim:', releaseErr?.message || releaseErr);
    }
  }
}

/**
 * Twilio's request-signing algorithm for form-encoded webhooks: HMAC-SHA1,
 * keyed with the auth token, over the exact webhook URL followed by every
 * POST param's key immediately concatenated with its value, sorted by key.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function computeTwilioSignature(url, params, authToken) {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(len);
  const paddedB = Buffer.alloc(len);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

/**
 * Validates X-Twilio-Signature against the exact URL this request arrived
 * on. `req.protocol` reflects X-Forwarded-Proto because app.js sets
 * `trust proxy`, so this is correct behind Vercel/Railway.
 */
export function isValidTwilioSignature(req) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const header = req.headers['x-twilio-signature'];
  if (!token || typeof header !== 'string') return false;

  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const expected = computeTwilioSignature(url, req.body || {}, token);
  return timingSafeEqualString(header, expected);
}
