import { getCenterBySlug, getDefaultCenter } from '../services/centerService.js';
import { runWithCenter } from '../requestContext.js';

/**
 * Tenancy resolution. Exactly one of these runs before every center-scoped
 * route and attaches `req.center` (the full centers row). This is defensive
 * layering only: every SQL query downstream still filters by center_id
 * explicitly — a route must never rely on the middleware alone.
 */

function attachCenter(req, center, next) {
  req.center = center;
  req.centerId = center.id;
  // AsyncLocalStorage carries the center's timezone to deep call sites
  // (timeService) without touching every function signature.
  runWithCenter(center, next);
}

/** /api/c/:centerSlug/... — 404s cleanly for unknown or deactivated slugs. */
export async function resolveCenterFromSlug(req, res, next) {
  try {
    const center = await getCenterBySlug(req.params.centerSlug);
    if (!center) {
      return res.status(404).json({ error: 'Unknown center' });
    }
    attachCenter(req, center, next);
  } catch (err) {
    next(err);
  }
}

/**
 * Legacy unslugged /api/... — resolves to the original center so existing
 * bookmarked URLs, the gateway phone, and configured webhook endpoints keep
 * working unchanged after the migration.
 */
export async function resolveDefaultCenter(req, res, next) {
  try {
    const center = await getDefaultCenter();
    if (!center) {
      return res.status(503).json({ error: 'No center is provisioned' });
    }
    attachCenter(req, center, next);
  } catch (err) {
    next(err);
  }
}
