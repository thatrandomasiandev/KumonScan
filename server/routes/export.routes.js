import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { zipSync, strToU8 } from 'fflate';
import db, { all } from '../db.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import { csvEscape } from '../services/reportService.js';

/**
 * Full data export: one CSV per table, zipped. This is the "you can leave
 * with everything, anytime" endpoint — a complete dump, not a filtered
 * report. Tables are discovered at request time so checkouts without the
 * optional tables (messages, caregivers, bookings, …) export cleanly.
 */
const router = Router();

/**
 * Allowlist of exportable tables, in export order. Never interpolate a table
 * name from user input; only names on this list reach SQL. Internal delivery
 * state (sms_queue, revoked_admin_tokens) and webhook secrets
 * (webhook_subscriptions) are deliberately excluded.
 */
export const EXPORT_TABLES = [
  'students',
  'sessions',
  'staff',
  'staff_sessions',
  'messages',
  'caregivers',
  'bookings',
  'resources',
  'resource_usage',
];

// SELECT * over every table is the most expensive query in the app; keep it
// unspammable without blocking a legitimate owner re-downloading after a hiccup.
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many export requests. Please try again in 15 minutes.' },
});

async function existingExportTables() {
  const rows = await all(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY(?::text[])`,
    [EXPORT_TABLES]
  );
  const present = new Set(rows.map((r) => r.table_name));
  return EXPORT_TABLES.filter((name) => present.has(name));
}

async function tableColumns(table) {
  const rows = await all(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ?
     ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

function csvValue(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return csvEscape(value);
}

/** Header row even for empty tables, so every CSV is self-describing. */
export function tableToCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvValue(row[column])).join(','));
  }
  return lines.join('\n') + '\n';
}

router.get('/export/full', requireAdmin, requireRole('manager'), exportLimiter, async (req, res) => {
  try {
    const tables = await existingExportTables();
    const generatedAt = new Date().toISOString();
    const files = {};
    const manifestTables = [];

    for (const table of tables) {
      const columns = await tableColumns(table);
      // Every exportable table is center-scoped; filter explicitly so a
      // forgotten WHERE would never dump another center's rows into the zip.
      const rows = await db
        .prepare(`SELECT * FROM ${table} WHERE center_id = ? ORDER BY 1`)
        .all(req.center.id);
      files[`${table}.csv`] = strToU8(tableToCsv(columns, rows));
      manifestTables.push({ name: table, rows: rows.length });
    }

    files['manifest.json'] = strToU8(
      JSON.stringify(
        {
          generated_at: generatedAt,
          center_slug: req.center.slug,
          source: 'KumonScan /api/export/full',
          format: 'One CSV per table; header row always present.',
          tables: manifestTables,
        },
        null,
        2
      )
    );

    const zipped = zipSync(files, { level: 6 });
    const filename = `kumonscan-export-${generatedAt.slice(0, 10)}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(zipped));
  } catch (err) {
    console.error('Full export error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
