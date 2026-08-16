import { Router } from 'express';
import { isTwilioWebhookConfigured, isValidTwilioSignature } from '../services/twilioService.js';
import { recordInboundMessage } from '../services/messagingService.js';

/**
 * Twilio inbound SMS webhook.
 *
 * POST /webhooks/sms — configured in the Twilio console as the phone
 * number's "A message comes in" webhook. Twilio posts
 * application/x-www-form-urlencoded (parsed by the urlencoded branch in
 * app.js's body-parser dispatcher, matched on TWILIO_SMS_WEBHOOK_PATH).
 * Every request must carry a valid X-Twilio-Signature header (HMAC-SHA1 of
 * the exact webhook URL plus the sorted POST params, keyed with
 * TWILIO_AUTH_TOKEN) — this is a public, unauthenticated URL otherwise.
 */

const router = Router();

router.post('/webhooks/sms', async (req, res) => {
  if (!isTwilioWebhookConfigured()) {
    return res
      .status(503)
      .json({ error: 'Twilio webhook is not configured (TWILIO_AUTH_TOKEN is unset)' });
  }
  if (!isValidTwilioSignature(req)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const from = req.body?.From;
  const body = req.body?.Body;
  if (typeof from === 'string' && from.trim()) {
    try {
      await recordInboundMessage(req.center.id, {
        from_phone: from,
        body: typeof body === 'string' && body.trim() ? body.trim() : '[empty message]',
        received_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Twilio inbound processing error:', err?.message || err);
    }
  }

  // Empty TwiML: acknowledge without sending an auto-reply.
  res.set('Content-Type', 'text/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

export default router;
