import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireSuperadmin } from '../middleware/auth.js';
import { createCenter, serializeCenter } from '../services/centerService.js';

/**
 * Center provisioning. Mounted at /api/centers, outside any center scope:
 * these routes belong to the platform operator (SUPERADMIN_KEY), never to a
 * center admin.
 */
const router = Router();

const provisionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many provisioning requests. Please try again in a minute.' },
});

router.post('/', provisionLimiter, requireSuperadmin, async (req, res) => {
  try {
    const center = await createCenter({
      slug: req.body?.slug,
      name: req.body?.name,
      timezone: req.body?.timezone,
      admin_password: req.body?.admin_password,
    });
    res.status(201).json(serializeCenter(center));
  } catch (err) {
    if (err?.code === 'INVALID_CENTER') {
      return res.status(400).json({ error: err.message });
    }
    if (err?.code === 'CENTER_SLUG_TAKEN') {
      return res.status(409).json({ error: err.message });
    }
    console.error('Center provisioning error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
