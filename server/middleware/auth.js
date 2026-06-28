import crypto from 'crypto';

function getSessionToken() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return crypto.createHash('sha256').update(`kumon-admin:${password}`).digest('hex');
}

export function isAdminPasswordConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function verifyAdminPassword(password) {
  return isAdminPasswordConfigured() && password === process.env.ADMIN_PASSWORD;
}

export function getAdminSessionToken() {
  return getSessionToken();
}

export function requireAdmin(req, res, next) {
  if (!isAdminPasswordConfigured()) {
    console.warn('ADMIN_PASSWORD is not set — admin routes are unprotected');
    return next();
  }

  const token = getSessionToken();
  if (req.cookies?.admin_session === token) {
    return next();
  }

  return res.status(401).json({ error: 'Admin authentication required' });
}
