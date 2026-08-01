import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.js';
import digestRoutes from './routes/digests.routes.js';
import { createCorsOptions } from './corsConfig.js';
import { ensureDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  // Railway / reverse proxies: needed for express-rate-limit + secure cookies.
  app.set('trust proxy', 1);

  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());

  app.use(async (req, res, next) => {
    try {
      await ensureDb();
      next();
    } catch (e) {
      next(e);
    }
  });

  app.use('/api', apiRoutes);
  app.use('/api', digestRoutes);

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

  return app;
}

const app = createApp();
export default app;
