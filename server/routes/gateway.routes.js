import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import db, { sqlNow } from '../db.js';

export const GATEWAY_LAST_SEEN_KEY = 'gateway_last_seen';

const PENDING_BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;
/** Rows stuck in 'sending' (phone died mid-send) return to 'pending' after this. */
const SENDING_STALE_MINUTES = 5;

const router = Router();

const gatewayLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many gateway requests.' },
});

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
 * Machine auth for the dedicated Android phone: static bearer token, separate
 * from staff cookie auth. Fails closed when GATEWAY_API_KEY is unset.
 */
function requireGateway(req, res, next) {
  const configured = process.env.GATEWAY_API_KEY;
  if (!configured) {
    return res.status(503).json({ error: 'SMS gateway is not configured (GATEWAY_API_KEY is unset)' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqualString(token, configured)) {
    return res.status(401).json({ error: 'Invalid gateway credentials' });
  }

  next();
}

router.use(gatewayLimiter, requireGateway);

/**
 * Claim up to 20 pending messages. The claim is a single UPDATE ... RETURNING
 * statement (with a re-check of status in the outer WHERE), so two concurrent
 * poll cycles cannot both receive the same row.
 */
router.get('/pending', async (req, res) => {
  try {
    const staleCutoff = new Date(Date.now() - SENDING_STALE_MINUTES * 60_000).toISOString();
    await db
      .prepare(
        `UPDATE sms_queue SET status = 'pending', claimed_at = NULL
         WHERE center_id = ? AND status = 'sending'
           AND claimed_at IS NOT NULL AND claimed_at < ?`
      )
      .run(req.center.id, staleCutoff);

    const result = await db
      .prepare(
        `UPDATE sms_queue SET status = 'sending', claimed_at = ?
         WHERE id IN (
           SELECT id FROM sms_queue
           WHERE center_id = ? AND status = 'pending'
           ORDER BY id ASC
           LIMIT ${PENDING_BATCH_SIZE}
           FOR UPDATE SKIP LOCKED
         )
         AND center_id = ? AND status = 'pending'
         RETURNING id, parent_phone, message`
      )
      .run(sqlNow(), req.center.id, req.center.id);

    res.json({
      messages: result.rows.map((row) => ({
        id: row.id,
        parent_phone: row.parent_phone,
        message: row.message,
      })),
    });
  } catch (err) {
    console.error('Gateway pending error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Phone reports the SmsManager result. Failures retry until MAX_ATTEMPTS. */
router.post('/:id/ack', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid message id' });
    }
    if (typeof req.body?.success !== 'boolean') {
      return res.status(400).json({ error: 'success (boolean) is required' });
    }

    const success = req.body.success;
    const errorText =
      typeof req.body?.error === 'string' && req.body.error.trim()
        ? req.body.error.trim().slice(0, 500)
        : null;

    const result = await db
      .prepare(
        `UPDATE sms_queue SET
           attempts = attempts + 1,
           status = CASE
             WHEN ?::boolean THEN 'sent'
             WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed'
             ELSE 'pending'
           END,
           sent_at = CASE WHEN ?::boolean THEN ? ELSE sent_at END,
           last_error = CASE WHEN ?::boolean THEN NULL ELSE ? END,
           claimed_at = NULL
         WHERE id = ? AND center_id = ? AND status = 'sending'
         RETURNING id, status, attempts`
      )
      .run(success, success, sqlNow(), success, errorText, id, req.center.id);

    if (result.rows.length === 0) {
      const row = await db
        .prepare('SELECT id, status FROM sms_queue WHERE id = ? AND center_id = ?')
        .get(id, req.center.id);
      if (!row) return res.status(404).json({ error: 'Message not found' });
      // Already acked (or reclaimed); treat as a no-op so the phone can move on.
      return res.json({ ok: true, status: row.status, already_acked: true });
    }

    res.json({ ok: true, status: result.rows[0].status, attempts: result.rows[0].attempts });
  } catch (err) {
    console.error('Gateway ack error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/heartbeat', async (req, res) => {
  try {
    await db
      .prepare(
        `INSERT INTO settings (center_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT (center_id, key) DO UPDATE SET value = EXCLUDED.value
         RETURNING key`
      )
      .run(req.center.id, GATEWAY_LAST_SEEN_KEY, sqlNow());
    res.json({ ok: true });
  } catch (err) {
    console.error('Gateway heartbeat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
