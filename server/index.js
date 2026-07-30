import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.js';
import { closeStaleOpenSessions } from './sessionHygiene.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

// Railway / reverse proxies: needed for express-rate-limit + secure cookies.
app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());

app.use('/api', apiRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else if (isProd) {
  console.warn(
    `client/dist not found at ${clientDist} — API only. Run: npm run build --prefix client`
  );
}

app.listen(PORT, '0.0.0.0', () => {
  const closed = closeStaleOpenSessions();
  if (closed > 0) {
    console.log(`Closed ${closed} stale open session(s) from prior days / duplicates`);
  }
  console.log(`KumonScan server running on http://0.0.0.0:${PORT}`);
});
