import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  verifyCenterAdminPassword,
  createAdminSession,
  revokeAdminSession,
  isAdminSessionActiveForCenter,
  isCenterAdminConfigured,
} from '../middleware/auth.js';

const router = Router();

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

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  res.cookie('admin_session', createAdminSession(req.center.id), cookieOptions);

  res.json({ authenticated: true, protectionEnabled: true, center: req.center.slug });
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

  res.json({
    authenticated: await isAdminSessionActiveForCenter(
      req.cookies?.admin_session,
      req.center.id
    ),
    protectionEnabled: true,
    center: req.center.slug,
  });
});

export default router;
