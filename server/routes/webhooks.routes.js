import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  WEBHOOK_EVENT_TYPES,
  createSubscription,
  deleteSubscription,
  listSubscriptions,
} from '../services/webhookService.js';

/**
 * Outbound webhook subscription management (see services/webhookService.js
 * for the delivery contract). Distinct from the inbound receivers at
 * /webhooks/zoom and /gateway/inbound, which are mounted by other routers.
 */
const router = Router();

router.get('/webhooks', requireAdmin, async (req, res) => {
  try {
    res.json({
      subscriptions: await listSubscriptions(req.center.id),
      event_types: WEBHOOK_EVENT_TYPES,
    });
  } catch (err) {
    console.error('Webhook list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/webhooks', requireAdmin, async (req, res) => {
  try {
    const subscription = await createSubscription(req.center.id, {
      url: req.body?.url,
      event_types: req.body?.event_types,
    });
    // The secret appears here and nowhere else; it is not retrievable later.
    res.status(201).json({
      ...subscription,
      secret_notice:
        'Store this secret now — it is shown once and cannot be retrieved again.',
    });
  } catch (err) {
    if (err?.code === 'INVALID_SUBSCRIPTION') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Webhook create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/webhooks/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Subscription id must be a positive integer' });
  }

  try {
    const deleted = await deleteSubscription(req.center.id, id);
    if (!deleted) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Webhook delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
