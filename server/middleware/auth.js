import crypto from 'crypto';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'dev-insecure';
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

export function isAdminPasswordConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function verifyAdminPassword(password) {
  if (!isAdminPasswordConfigured()) return false;
  return timingSafeEqualString(password, process.env.ADMIN_PASSWORD);
}

/** Stateless signed cookie token (works across Vercel serverless instances). */
export function createAdminSession() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `admin:${expiresAt}`;
  return `${expiresAt}.${sign(payload)}`;
}

export function revokeAdminSession(_token) {
  // Stateless cookies cannot be revoked server-side without a denylist.
  // Logout clears the cookie on the client response instead.
}

export function isValidAdminSession(token) {
  if (!token || typeof token !== 'string') return false;
  const [expiresAtRaw, sig] = token.split('.');
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || !sig) return false;
  if (Date.now() > expiresAt) return false;
  const expected = sign(`admin:${expiresAt}`);
  return timingSafeEqualString(sig, expected);
}

/** Test helper (no-op for signed cookies). */
export function clearAdminSessionsForTests() {}

export function requireAdmin(req, res, next) {
  if (!isAdminPasswordConfigured()) {
    console.warn('ADMIN_PASSWORD is not set — admin routes are unprotected');
    return next();
  }

  if (isValidAdminSession(req.cookies?.admin_session)) {
    return next();
  }

  return res.status(401).json({ error: 'Admin authentication required' });
}
