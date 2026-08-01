import crypto from 'crypto';
import db from '../db.js';
import { verifyPassword } from '../utils/passwords.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sessionSecret() {
  const secret =
    process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
  if (secret) return secret;
  // Production must not mint forgeable cookies. Tests and local dev may use a
  // fixed fallback; NODE_ENV=production without a secret fails closed.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ADMIN_SESSION_SECRET (or ADMIN_PASSWORD) is required in production'
    );
  }
  return 'dev-insecure';
}

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(len);
  const paddedB = Buffer.alloc(len);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  const contentsEqual = crypto.timingSafeEqual(paddedA, paddedB);
  return contentsEqual && bufA.length === bufB.length;
}

function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Admin credentials are per center: centers.admin_password_hash (scrypt).
 * A center without a hash has no admin protection configured, mirroring the
 * old unset-ADMIN_PASSWORD behavior but scoped to that center.
 */
export function isCenterAdminConfigured(center) {
  return Boolean(center?.admin_password_hash);
}

export function verifyCenterAdminPassword(center, password) {
  if (!isCenterAdminConfigured(center)) return false;
  return verifyPassword(String(password ?? ''), center.admin_password_hash);
}

/**
 * Stateless signed cookie token, bound to one center. Format:
 * `expiresAt.centerId.hmac`, signed over `admin:centerId:expiresAt`, so a
 * session cookie for center A can never authenticate against center B.
 */
export function createAdminSession(centerId) {
  const id = Number(centerId);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error('createAdminSession requires a valid center id');
  }
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${expiresAt}.${id}.${sign(`admin:${id}:${expiresAt}`)}`;
}

/** Signature + expiry check only. Returns { centerId, expiresAt } or null. */
export function parseAdminSession(token) {
  if (!token || typeof token !== 'string') return null;
  const [expiresAtRaw, centerIdRaw, sig] = token.split('.');
  const expiresAt = Number(expiresAtRaw);
  const centerId = Number(centerIdRaw);
  if (!Number.isFinite(expiresAt) || !Number.isInteger(centerId) || !sig) return null;
  if (Date.now() > expiresAt) return null;
  const expected = sign(`admin:${centerId}:${expiresAt}`);
  return timingSafeEqualString(sig, expected) ? { centerId, expiresAt } : null;
}

/**
 * Logout denylists the token hash until its natural expiry, so a replayed
 * cookie is rejected even though the token itself is stateless.
 */
export async function revokeAdminSession(token) {
  const parsed = parseAdminSession(token);
  if (!parsed) return;
  try {
    await db
      .prepare(
        `INSERT INTO revoked_admin_tokens (token_hash, expires_at) VALUES (?, ?)
         ON CONFLICT (token_hash) DO NOTHING
         RETURNING token_hash`
      )
      .run(tokenHash(token), parsed.expiresAt);
    await db
      .prepare('DELETE FROM revoked_admin_tokens WHERE expires_at < ?')
      .run(Date.now());
  } catch (err) {
    console.error('Failed to revoke admin session:', err?.message || err);
  }
}

async function isRevoked(token) {
  const row = await db
    .prepare('SELECT 1 AS revoked FROM revoked_admin_tokens WHERE token_hash = ?')
    .get(tokenHash(token));
  return Boolean(row);
}

/**
 * Full check used by routes: signature, expiry, center binding, and the
 * revocation denylist. The center check is the cross-tenant boundary — a
 * valid session for another center fails here.
 */
export async function isAdminSessionActiveForCenter(token, centerId) {
  const parsed = parseAdminSession(token);
  if (!parsed || parsed.centerId !== Number(centerId)) return false;
  return !(await isRevoked(token));
}

/** Test helper (no-op for signed cookies). */
export function clearAdminSessionsForTests() {}

export async function requireAdmin(req, res, next) {
  const center = req.center;
  if (!center) {
    // Route mounted without center resolution — a wiring bug, not a client error.
    console.error(`requireAdmin reached without req.center on ${req.method} ${req.originalUrl}`);
    return res.status(500).json({ error: 'Internal server error' });
  }

  if (!isCenterAdminConfigured(center)) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        error: 'Admin authentication is not configured for this center',
      });
    }
    console.warn(
      `Center "${center.slug}" has no admin password — admin routes are unprotected (non-production only)`
    );
    return next();
  }

  try {
    if (await isAdminSessionActiveForCenter(req.cookies?.admin_session, center.id)) {
      return next();
    }
  } catch (err) {
    console.error('Admin session check failed:', err?.message || err);
    return res.status(503).json({ error: 'Authentication check failed' });
  }

  return res.status(401).json({ error: 'Admin authentication required' });
}

/**
 * Platform operator auth for center provisioning. Deliberately a separate
 * credential (SUPERADMIN_KEY env var) from every center's admin password,
 * and it fails closed in every environment.
 */
export function requireSuperadmin(req, res, next) {
  const configured = process.env.SUPERADMIN_KEY;
  if (!configured) {
    return res.status(503).json({
      error: 'Superadmin is not configured (SUPERADMIN_KEY is unset)',
    });
  }

  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const provided = req.headers['x-superadmin-key'] || bearer;
  if (!provided || !timingSafeEqualString(provided, configured)) {
    return res.status(401).json({ error: 'Superadmin authentication required' });
  }

  next();
}
