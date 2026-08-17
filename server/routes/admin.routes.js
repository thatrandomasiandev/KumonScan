import { Router } from 'express';
import db from '../db.js';
import { normalizeScheduleDaysInput, parseScheduleDays } from '../timeService.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import { importRosterFromContent } from '../rosterImport.js';
import { buildRosterTemplateCsv, buildRosterTemplateXlsx } from '../services/reportService.js';
import {
  getWeekdayCapacity,
  CAPACITY_SETTING_KEY,
  WEEKDAYS,
} from '../services/capacityService.js';
import { GATEWAY_LAST_SEEN_KEY } from './gateway.routes.js';
import { isTwilioConfigured } from '../services/twilioService.js';
import { logger } from '../services/loggingService.js';

const router = Router();

router.post('/admin/roster-import', requireAdmin, requireRole('manager'), async (req, res) => {
  const filename = typeof req.body?.filename === 'string' ? req.body.filename : 'roster-upload';
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  const format = req.body?.format === 'xlsx' ? 'xlsx' : 'text';
  const mode = req.body?.mode === 'replace' ? 'replace' : 'merge';

  if (!content.trim()) {
    return res.status(400).json({ error: 'Roster file content is required' });
  }

  if (content.length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: 'Roster file is too large (max 8MB)' });
  }

  if (mode === 'replace' && req.body?.confirm_replace !== true) {
    return res.status(400).json({
      error: 'Replacing the entire roster requires confirm_replace: true',
    });
  }

  try {
    const result = await importRosterFromContent(content, req.center.id, { mode, format });
    const { summary, totalProcessed, delimiterLabel, sourceColumns } = result;
    const anomalies = summary.skipped.length + summary.errored.length;

    res.json({
      ok: true,
      filename,
      mode,
      delimiter: delimiterLabel,
      rows_processed: totalProcessed,
      created: summary.created,
      updated: summary.updated,
      deactivated: summary.deactivated,
      skipped: summary.skipped.length,
      errored: summary.errored.length,
      skipped_rows: summary.skipped,
      errored_rows: summary.errored,
      source_columns: sourceColumns,
      has_anomalies: anomalies > 0,
    });
  } catch (err) {
    logger.warn({ err, route: 'POST /api/admin/roster-import', filename }, 'roster import rejected');
    res.status(400).json({ error: err.message || 'Roster import failed' });
  }
});

/** Sample roster files documenting the accepted import columns. */
router.get('/admin/roster-template.csv', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kumonscan-roster-template.csv"');
  res.send(buildRosterTemplateCsv());
});

router.get('/admin/roster-template.xlsx', requireAdmin, async (req, res) => {
  const buffer = await buildRosterTemplateXlsx();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="kumonscan-roster-template.xlsx"');
  res.send(buffer);
});

/**
 * Bulk-set schedule days for active students.
 * body: { days: string[], scope: 'missing' | 'all_active' }
 * Kumon CRM exports often omit days; this fills schedules so absences work.
 */
router.post('/admin/schedule-bulk', requireAdmin, async (req, res) => {
  const days = normalizeScheduleDaysInput(req.body?.days);
  if (!days.length) {
    return res.status(400).json({
      error: 'days is required (e.g. Mon, Wed, Fri)',
    });
  }

  const scope = req.body?.scope === 'all_active' ? 'all_active' : 'missing';
  const payload = JSON.stringify(days);

  const active = await db
    .prepare('SELECT id, schedule_days FROM students WHERE center_id = ? AND active = 1')
    .all(req.center.id);

  const targetIds = active
    .filter((student) => {
      if (scope === 'all_active') return true;
      return parseScheduleDays(student.schedule_days).length === 0;
    })
    .map((student) => student.id);

  // One set-based statement: inherently atomic, no per-row loop to fail partway.
  if (targetIds.length > 0) {
    await db
      .prepare(
        'UPDATE students SET schedule_days = ? WHERE center_id = ? AND id = ANY(?::int[])'
      )
      .run(payload, req.center.id, targetIds);
  }

  res.json({
    ok: true,
    scope,
    days,
    updated: targetIds.length,
    active_total: active.length,
  });
});

/** Per-weekday capacity limits, stored as JSON in the settings table. */
router.get('/admin/capacity', requireAdmin, async (req, res) => {
  res.json({ capacity: await getWeekdayCapacity(req.center.id), weekdays: WEEKDAYS });
});

router.put('/admin/capacity', requireAdmin, requireRole('manager'), async (req, res) => {
  const input = req.body?.capacity;
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ error: 'capacity object is required' });
  }

  const clean = {};
  for (const day of WEEKDAYS) {
    const value = input[day];
    if (value == null || value === '') continue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      return res.status(400).json({ error: `${day} capacity must be a non-negative integer` });
    }
    clean[day] = n;
  }

  await db
    .prepare(
      `INSERT INTO settings (center_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (center_id, key) DO UPDATE SET value = EXCLUDED.value
       RETURNING key`
    )
    .run(req.center.id, CAPACITY_SETTING_KEY, JSON.stringify(clean));

  res.json({ ok: true, capacity: clean, weekdays: WEEKDAYS });
});

/**
 * Staff-facing SMS health: which sender is live (Twilio vs Android gateway
 * phone), when the phone last polled, and how deep the queue is.
 */
router.get('/admin/gateway-status', requireAdmin, async (req, res) => {
  const lastSeenRow = await db
    .prepare('SELECT value FROM settings WHERE center_id = ? AND key = ?')
    .get(req.center.id, GATEWAY_LAST_SEEN_KEY);

  const counts = await db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE status = 'sending') AS sending,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed,
         COUNT(*) FILTER (WHERE status = 'sent') AS sent
       FROM sms_queue WHERE center_id = ?`
    )
    .get(req.center.id);

  const lastSeenAt = lastSeenRow?.value || null;
  const secondsSinceSeen = lastSeenAt
    ? Math.max(0, Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 1000))
    : null;
  const twilioConfigured = isTwilioConfigured();
  const gatewayConfigured = Boolean(process.env.GATEWAY_API_KEY);

  res.json({
    configured: twilioConfigured || gatewayConfigured,
    twilio_configured: twilioConfigured,
    gateway_configured: gatewayConfigured,
    channel: twilioConfigured ? 'twilio' : gatewayConfigured ? 'gateway' : null,
    last_seen_at: lastSeenAt,
    seconds_since_seen: secondsSinceSeen,
    pending: Number(counts?.pending || 0),
    sending: Number(counts?.sending || 0),
    failed: Number(counts?.failed || 0),
    sent: Number(counts?.sent || 0),
  });
});

export default router;
