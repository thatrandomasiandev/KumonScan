import { neon } from '@neondatabase/serverless';

/**
 * Lead capture for the marketing site.
 *
 * POST /api/lead  { name, center_name, email, center_size }
 * Writes one row to the `leads` table in the Neon database (DATABASE_URL).
 * Runs as a Vercel Node serverless function in production and is mounted
 * as Connect middleware by vite.config.js in local dev, so it only relies
 * on the plain Node req/res surface.
 */

const CENTER_SIZES = new Set(['under-50', '50-150', '150-300', 'over-300']);
const MAX_FIELD_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let schemaReady = null;

function ensureSchema(sql) {
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        center_name TEXT NOT NULL,
        email TEXT NOT NULL,
        center_size TEXT,
        source TEXT NOT NULL DEFAULT 'marketing-site',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function readJsonBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function cleanField(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_FIELD_LENGTH);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Invalid request body' });
  }

  // Honeypot: real users never fill the hidden "website" field.
  if (cleanField(body.website)) {
    return sendJson(res, 200, { ok: true });
  }

  const name = cleanField(body.name);
  const centerName = cleanField(body.center_name);
  const email = cleanField(body.email);
  const centerSize = cleanField(body.center_size);

  if (!name) return sendJson(res, 400, { error: 'Your name is required.' });
  if (!centerName) return sendJson(res, 400, { error: 'Center name is required.' });
  if (!EMAIL_PATTERN.test(email)) {
    return sendJson(res, 400, { error: 'A valid email address is required.' });
  }
  if (centerSize && !CENTER_SIZES.has(centerSize)) {
    return sendJson(res, 400, { error: 'Unknown center size.' });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Lead capture is not configured: DATABASE_URL is unset');
    return sendJson(res, 503, {
      error: 'Lead capture is temporarily unavailable. Please try again later.',
    });
  }

  try {
    const sql = neon(databaseUrl);
    await ensureSchema(sql);
    const rows = await sql`
      INSERT INTO leads (name, center_name, email, center_size)
      VALUES (${name}, ${centerName}, ${email}, ${centerSize || null})
      RETURNING id
    `;
    return sendJson(res, 201, { ok: true, id: rows[0].id });
  } catch (err) {
    console.error('Lead insert failed:', err);
    return sendJson(res, 500, {
      error: 'Something went wrong on our end. Please try again in a minute.',
    });
  }
}
