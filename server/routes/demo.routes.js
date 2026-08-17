import { Router } from 'express';
import { DemoSeedRefused, resetAndSeedDemo } from '../scripts/seed-demo-data.js';
import { requireAdmin } from '../middleware/auth.js';

/**
 * Demo-deployment-only routes. Mounted through routes/index.js so req.center
 * is resolved before requireAdmin runs. Every handler 404s unless
 * DEMO_MODE=true, so the endpoints stay inert on any deployment that is not
 * the dedicated demo instance.
 */
const router = Router();

function demoModeEnabled() {
  return process.env.DEMO_MODE === 'true';
}

function requireDemoMode(req, res, next) {
  if (!demoModeEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

/** Vercel Cron invokes cron paths with Authorization: Bearer <CRON_SECRET>. */
function isCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

async function runReset(res) {
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

/**
 * Wipe and re-seed the demo database. GET is what Vercel Cron sends (bearer
 * secret). POST is the mid-demo manual reset, gated by requireAdmin.
 */
async function handleCronReset(req, res) {
  if (!isCronRequest(req)) {
    return res.status(401).json({ error: 'Demo reset requires the cron secret or an admin session' });
  }
  return runReset(res);
}

async function handleAdminReset(_req, res) {
  return runReset(res);
}

router.get('/demo/reset', requireDemoMode, handleCronReset);
router.post('/demo/reset', requireDemoMode, requireAdmin, handleAdminReset);

export default router;
