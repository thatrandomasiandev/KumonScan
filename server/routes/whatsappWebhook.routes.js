import crypto from 'crypto';
import { Router } from 'express';
import {
  applyWhatsAppDeliveryStatus,
  recordInboundWhatsAppMessage,
} from '../services/whatsappService.js';

/**
 * Meta (WhatsApp Cloud API) webhook endpoints.
 *
 * GET  /api/webhooks/whatsapp — subscription handshake: echo hub.challenge
 *      when hub.verify_token matches WHATSAPP_VERIFY_TOKEN.
 * POST /api/webhooks/whatsapp — inbound messages and delivery-status
 *      updates. This is a public, unauthenticated URL; every POST must carry
 *      a valid X-Hub-Signature-256 (HMAC-SHA256 of the raw body keyed with
 *      WHATSAPP_APP_SECRET). The raw bytes are captured by the JSON parser's
 *      verify hook in app.js — the re-serialized parsed body is not
 *      byte-identical, so it cannot be used for verification.
 */

const router = Router();

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

function isValidSignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const header = req.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  if (!Buffer.isBuffer(req.rawBody)) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return timingSafeEqualString(header, expected);
}

router.get('/webhooks/whatsapp', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return res.status(503).json({
      error: 'WhatsApp webhook is not configured (WHATSAPP_VERIFY_TOKEN is unset)',
    });
  }

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && typeof challenge === 'string' && timingSafeEqualString(token, verifyToken)) {
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.status(403).json({ error: 'Webhook verification failed' });
});

/** Text messages store their text; other types (image, audio, sticker, …)
 *  store a placeholder so nothing inbound is silently dropped. */
function extractBody(message) {
  if (message?.type === 'text' && typeof message.text?.body === 'string') {
    return message.text.body.trim();
  }
  return `[unsupported ${message?.type || 'unknown'} message]`;
}

router.post('/webhooks/whatsapp', async (req, res) => {
  if (!process.env.WHATSAPP_APP_SECRET) {
    return res.status(503).json({
      error: 'WhatsApp webhook is not configured (WHATSAPP_APP_SECRET is unset)',
    });
  }
  if (!isValidSignature(req)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // After the signature check, always acknowledge with 200: Meta retries
  // non-2xx responses, and a poison payload must not redeliver forever.
  // Per-item failures are logged and skipped instead.
  let received = 0;
  let statuses = 0;
  try {
    for (const entry of req.body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};

        for (const message of value.messages ?? []) {
          try {
            const result = await recordInboundWhatsAppMessage(req.center.id, {
              from_phone: message?.from,
              body: extractBody(message),
              wa_message_id: message?.id ?? null,
            });
            if (!result.duplicate) received++;
          } catch (err) {
            console.error('WhatsApp inbound processing error:', err?.message || err);
          }
        }

        for (const status of value.statuses ?? []) {
          try {
            const result = await applyWhatsAppDeliveryStatus(req.center.id, {
              wa_message_id: status?.id,
              status: status?.status,
            });
            if (result.updated) statuses++;
          } catch (err) {
            console.error('WhatsApp status processing error:', err?.message || err);
          }
        }
      }
    }
  } catch (err) {
    console.error('WhatsApp webhook error:', err?.message || err);
  }

  res.json({ received, statuses });
});

export default router;
