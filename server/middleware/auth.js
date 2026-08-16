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
 * This is the shared center password's session — always manager-equivalent
 * (it's the one credential every center has had since before per-staff
 * logins existed, and doubles as a recovery path if a staff account is
 * locked out).
 */
export function createAdminSession(centerId) {
  const id = Number(centerId);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error('createAdminSession requires a valid center id');
  }
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${expiresAt}.${id}.${sign(`admin:${id}:${expiresAt}`)}`;
}

/**
 * Per-staff signed cookie token. Format: `expiresAt.centerId.staffId.role.hmac`,
 * signed over `staff:centerId:staffId:role:expiresAt`. Issued by
 * POST /auth/staff-login; carries the individual's identity and permission
 * role so requireRole() can gate manager-only routes without a DB round trip.
 */
export function createStaffSession(centerId, staffId, role) {
  const cId = Number(centerId);
  const sId = Number(staffId);
  if (!Number.isInteger(cId) || cId < 1) {
    throw new Error('createStaffSession requires a valid center id');
  }
  if (!Number.isInteger(sId) || sId < 1) {
    throw new Error('createStaffSession requires a valid staff id');
  }
  const normalizedRole = role === 'manager' ? 'manager' : 'front_desk';
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const sig = sign(`staff:${cId}:${sId}:${normalizedRole}:${expiresAt}`);
  return `${expiresAt}.${cId}.${sId}.${normalizedRole}.${sig}`;
}

/**
 * Signature + expiry check only, for either token shape. Returns
 * { centerId, expiresAt, staffId, role } — staffId/role are null for a
 * shared-center-password session (the legacy 3-segment format).
 */
export function parseAdminSession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');

  if (parts.length === 3) {
    const [expiresAtRaw, centerIdRaw, sig] = parts;
    const expiresAt = Number(expiresAtRaw);
    const centerId = Number(centerIdRaw);
    if (!Number.isFinite(expiresAt) || !Number.isInteger(centerId) || !sig) return null;
    if (Date.now() > expiresAt) return null;
    const expected = sign(`admin:${centerId}:${expiresAt}`);
    return timingSafeEqualString(sig, expected)
      ? { centerId, expiresAt, staffId: null, role: null }
      : null;
  }

  if (parts.length === 5) {
    const [expiresAtRaw, centerIdRaw, staffIdRaw, role, sig] = parts;
    const expiresAt = Number(expiresAtRaw);
    const centerId = Number(centerIdRaw);
    const staffId = Number(staffIdRaw);
    if (
      !Number.isFinite(expiresAt) ||
      !Number.isInteger(centerId) ||
      !Number.isInteger(staffId) ||
      (role !== 'manager' && role !== 'front_desk') ||
      !sig
    ) {
      return null;
    }
    if (Date.now() > expiresAt) return null;
    const expected = sign(`staff:${centerId}:${staffId}:${role}:${expiresAt}`);
    return timingSafeEqualString(sig, expected) ? { centerId, expiresAt, staffId, role } : null;
  }

  return null;
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
 * Gates a route to managers only. Must run after requireAdmin on the same
 * route (it re-derives its own pass/fail rather than trusting req to carry
 * state, so route wiring order matters but nothing is shared between them).
 * A shared-center-password session is always manager-equivalent; a staff
 * session must carry role === 'manager'.
 */
export function requireRole(requiredRole) {
  return async (req, res, next) => {
    const center = req.center;
    if (!center) {
      console.error(`requireRole reached without req.center on ${req.method} ${req.originalUrl}`);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!isCenterAdminConfigured(center) && process.env.NODE_ENV !== 'production') {
      return next();
    }

    const token = req.cookies?.admin_session;
    let parsed;
    try {
      if (!(await isAdminSessionActiveForCenter(token, center.id))) {
        return res.status(401).json({ error: 'Admin authentication required' });
      }
      parsed = parseAdminSession(token);
    } catch (err) {
      console.error('Admin session check failed:', err?.message || err);
      return res.status(503).json({ error: 'Authentication check failed' });
    }

    if (!parsed?.staffId || parsed.role === 'manager') {
      return next();
    }
    if (parsed.role === requiredRole) {
      return next();
    }
    return res.status(403).json({ error: `This action requires the ${requiredRole} role` });
  };
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
