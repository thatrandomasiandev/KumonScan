import { Router } from 'express';
import { DemoSeedRefused, resetAndSeedDemo } from '../scripts/seed-demo-data.js';
import { isAdminPasswordConfigured, isValidAdminSession } from '../middleware/auth.js';

/**
 * Demo-deployment-only routes. app.js mounts this router only when
 * DEMO_MODE=true, and every handler re-checks the flag so the endpoints are
 * inert (404) on any deployment that is not the dedicated demo instance.
 */
const router = Router();

function demoModeEnabled() {
  return process.env.DEMO_MODE === 'true';
}

/** Vercel Cron invokes cron paths with Authorization: Bearer <CRON_SECRET>. */
function isCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

function isAdminRequest(req) {
  return isAdminPasswordConfigured() && isValidAdminSession(req.cookies?.admin_session);
}

/**
 * Wipe and re-seed the demo database. GET is what Vercel Cron sends; POST
 * supports manual resets (cron secret or a logged-in demo admin session).
 */
async function handleReset(req, res) {
  if (!demoModeEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!isCronRequest(req) && !isAdminRequest(req)) {
    return res.status(401).json({ error: 'Demo reset requires the cron secret or an admin session' });
  }

  try {
    const summary = await resetAndSeedDemo();
    res.json({ ok: true, ...summary });
  } catch (err) {
    if (err instanceof DemoSeedRefused) {
      console.error('Demo reset refused:', err.message);
      return res.status(409).json({ error: err.message });
    }
    console.error('Demo reset error:', err);
    res.status(500).json({ error: 'Demo reset failed' });
  }
}

router.get('/reset', handleReset);
router.post('/reset', handleReset);

export default router;
