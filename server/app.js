import './loadEnv.js';
import express, { Router } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/index.js';
import centersRoutes from './routes/centers.routes.js';
import { resolveCenterFromSlug, resolveDefaultCenter } from './middleware/center.js';
import { createCorsOptions } from './corsConfig.js';
import { ensureDb } from './db.js';
import { expressErrorHandler } from './services/errorReportingService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The same API surface is mounted twice: slugged for explicit tenancy and
// unslugged for the pre-multi-tenant center (see middleware/center.js).
const WHATSAPP_WEBHOOK_PATH = /^\/api(?:\/c\/[^/]+)?\/webhooks\/whatsapp$/;
const ROSTER_IMPORT_PATH = /^\/api(?:\/c\/[^/]+)?\/admin\/roster-import$/;
const TWILIO_SMS_WEBHOOK_PATH = /^\/api(?:\/c\/[^/]+)?\/webhooks\/sms$/;

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  // Railway / reverse proxies: needed for express-rate-limit + secure cookies.
  app.set('trust proxy', 1);

  app.use(cors(createCorsOptions()));

  // Meta signs webhook payloads over the exact raw bytes; keep them for
  // X-Hub-Signature-256 verification (routes/whatsappWebhook.routes.js).
  const captureRawBody = (req, _res, buf) => {
    if (WHATSAPP_WEBHOOK_PATH.test(req.path)) req.rawBody = buf;
  };

  // Roster upload is the only large payload; everything else stays small.
  // Twilio posts application/x-www-form-urlencoded, not JSON.
  const jsonSmall = express.json({ limit: '256kb', verify: captureRawBody });
  const jsonLarge = express.json({ limit: '8mb' });
  const urlencodedSmall = express.urlencoded({ extended: false, limit: '256kb' });
  app.use((req, res, next) => {
    if (TWILIO_SMS_WEBHOOK_PATH.test(req.path)) return urlencodedSmall(req, res, next);
    return ROSTER_IMPORT_PATH.test(req.path)
      ? jsonLarge(req, res, next)
      : jsonSmall(req, res, next);
  });

  app.use(cookieParser());

  app.use(async (req, res, next) => {
    try {
      await ensureDb();
      next();
    } catch (e) {
      next(e);
    }
  });

  // Platform-level provisioning (superadmin), outside any center scope.
  app.use('/api/centers', centersRoutes);

  // Explicit tenancy: /api/c/:centerSlug/... (404s on unknown slugs).
  const slugScoped = Router({ mergeParams: true });
  slugScoped.use(resolveCenterFromSlug);
  slugScoped.use(apiRoutes);
  app.use('/api/c/:centerSlug', slugScoped);

  // Legacy unslugged paths resolve to the original center so existing
  // bookmarked URLs, the gateway phone, and configured webhooks keep working.
  // Vercel Cron also lands here (/api/cron/digests): the digest cron handler
  // ignores req.center and processes every center's students in one pass, so
  // which center this middleware resolves is irrelevant to it.
  const defaultScoped = Router();
  defaultScoped.use(resolveDefaultCenter);
  defaultScoped.use(apiRoutes);
  app.use('/api', defaultScoped);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  if (!process.env.VERCEL && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/health') return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else if (isProd && !process.env.VERCEL) {
    console.warn(
      `client/dist not found at ${clientDist} — API only. Run: npm run build --prefix client`
    );
  }

  // Last: capture anything routes let escape, so no error dies in a closed terminal.
  app.use(expressErrorHandler);

  return app;
}

const app = createApp();
export default app;
