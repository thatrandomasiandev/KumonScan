import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import db, { sqlNow } from '../db.js';
import {
  verifyCenterAdminPassword,
  createAdminSession,
  createStaffSession,
  revokeAdminSession,
  isAdminSessionActiveForCenter,
  isCenterAdminConfigured,
  parseAdminSession,
  requireAdmin,
} from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../utils/passwords.js';
import { formatFullName } from '../utils/names.js';

const router = Router();
const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function serializeStaffIdentity(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: formatFullName(row),
    email: row.email,
    permission_role: row.permission_role,
    must_change_password: Boolean(row.must_change_password),
  };
}

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a minute.' },
});

function authNotConfiguredInProduction(req, res) {
  if (isCenterAdminConfigured(req.center) || process.env.NODE_ENV !== 'production') return false;
  res.status(503).json({
    error: 'Admin authentication is not configured for this center',
  });
  return true;
}

router.post('/auth/login', loginLimiter, (req, res) => {
  const { password } = req.body;

  if (authNotConfiguredInProduction(req, res)) return;

  if (!isCenterAdminConfigured(req.center)) {
    return res.json({ authenticated: true, protectionEnabled: false });
  }

  if (!verifyCenterAdminPassword(req.center, password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  res.cookie('admin_session', createAdminSession(req.center.id), ADMIN_COOKIE_OPTIONS);

  res.json({ authenticated: true, protectionEnabled: true, center: req.center.slug });
});

/** Individual staff login — email + password, additive to the shared center password above. */
router.post('/auth/staff-login', loginLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;

  if (!email || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const staff = await db
    .prepare(
      `SELECT * FROM staff WHERE center_id = ? AND LOWER(email) = ? AND active = 1`
    )
    .get(req.center.id, email);

  if (!staff?.password_hash || !verifyPassword(password, staff.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.cookie(
    'admin_session',
    createStaffSession(req.center.id, staff.id, staff.permission_role),
    ADMIN_COOKIE_OPTIONS
  );
  await db.prepare('UPDATE staff SET last_login_at = ? WHERE id = ?').run(sqlNow(), staff.id);

  res.json({
    authenticated: true,
    protectionEnabled: true,
    center: req.center.slug,
    staff: serializeStaffIdentity(staff),
  });
});

/**
 * Sets a new password for the logged-in staff member. A forced first-time
 * change (must_change_password) trusts the temp password already verified
 * at staff-login; a voluntary change re-proves the current password.
 */
router.post('/auth/staff-change-password', requireAdmin, async (req, res) => {
  const parsed = parseAdminSession(req.cookies?.admin_session);
  if (!parsed?.staffId) {
    return res.status(400).json({ error: 'This action requires a staff login' });
  }

  const { current_password, new_password } = req.body;
  if (typeof new_password !== 'string' || new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const staff = await db
    .prepare('SELECT * FROM staff WHERE id = ? AND center_id = ?')
    .get(parsed.staffId, req.center.id);
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });

  if (!staff.must_change_password) {
    if (typeof current_password !== 'string' || !verifyPassword(current_password, staff.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  await db
    .prepare(
      `UPDATE staff SET password_hash = ?, must_change_password = 0 WHERE id = ? AND center_id = ?`
    )
    .run(hashPassword(new_password), staff.id, req.center.id);

  res.json({ ok: true });
});

router.post('/auth/logout', async (req, res) => {
  await revokeAdminSession(req.cookies?.admin_session);
  res.clearCookie('admin_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  res.json({ authenticated: false });
});

router.get('/auth/status', async (req, res) => {
  if (authNotConfiguredInProduction(req, res)) return;

  if (!isCenterAdminConfigured(req.center)) {
    return res.json({ authenticated: true, protectionEnabled: false });
  }

  const token = req.cookies?.admin_session;
  const authenticated = await isAdminSessionActiveForCenter(token, req.center.id);
  if (!authenticated) {
    return res.json({ authenticated: false, protectionEnabled: true, center: req.center.slug });
  }

  const parsed = parseAdminSession(token);
  let staff = null;
  if (parsed?.staffId) {
    const row = await db
      .prepare('SELECT * FROM staff WHERE id = ? AND center_id = ?')
      .get(parsed.staffId, req.center.id);
    staff = serializeStaffIdentity(row);
  }

  res.json({ authenticated: true, protectionEnabled: true, center: req.center.slug, staff });
});

export default router;
