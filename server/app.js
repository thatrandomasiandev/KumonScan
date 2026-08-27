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
const ROSTER_IMPORT_PATH = /^\/api(?:\/c\/[^/]+)?\/admin\/roster-import$/;

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  // Railway / reverse proxies: needed for express-rate-limit + secure cookies.
  app.set('trust proxy', 1);

  app.use(cors(createCorsOptions()));

  // Roster upload is the only large payload; everything else stays small.
  // Also accept text/plain: some browsers default string fetch bodies to
  // text/plain;charset=UTF-8 when Content-Type is missing, which left
  // req.body empty and made /check-in return "student_id is required".
  const jsonSmall = express.json({
    limit: '256kb',
    type: ['application/json', 'text/plain'],
  });
  const jsonLarge = express.json({
    limit: '8mb',
    type: ['application/json', 'text/plain'],
  });
  app.use((req, res, next) => {
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
  // bookmarked URLs and configured outbound webhooks keep working.
  // Vercel Cron lands here (/api/demo/reset): that handler 404s unless
  // DEMO_MODE=true, so which center this middleware resolves is irrelevant.
  const defaultScoped = Router();
  defaultScoped.use(resolveDefaultCenter);
  defaultScoped.use(apiRoutes);
  app.use('/api', defaultScoped);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Serve the built SPA only in production. In local `npm run dev`, Express is
  // API-only on :3001; Vite on :5173 owns the UI. Serving client/dist here in
  // development made :3001 look like a second (stale) frontend.
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  if (isProd && !process.env.VERCEL && fs.existsSync(clientDist)) {
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
