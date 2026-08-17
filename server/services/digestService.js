import db, { sqlNow } from '../db.js';
import { getDateInTimezone, getTodayInTimezone } from '../timeService.js';
import { allowanceForSubjects } from '../sessionRules.js';
import { formatFullName } from '../utils/names.js';

/**
 * Weekly parent digests.
 *
 * Attendance data (visits, minutes, overtime) is always available. Two seams
 * cover work owned by other agents:
 *
 * 1. Curriculum progress (agent-curriculum). `fetchProgressSummary` reads
 *    worksheet_completions and student_progress (server/services/curriculumService.js)
 *    if they exist and returns null (never throws) if they don't.
 *
 * 2. Delivery channel (agents 1/8). `resolveDeliveryChannel` dynamically
 *    imports messagingService.js / whatsappService.js if present. With neither
 *    installed, digests are generated, logged server-side, and their
 *    digest_log rows stay 'pending': delivery is blocked on a channel existing.
 */

/** A 'pending' row younger than this is treated as in-flight and not reclaimed. */
const PENDING_STALE_MINUTES = 10;

let schemaPromise = null;

export async function ensureDigestSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS digest_log (
          id SERIAL PRIMARY KEY,
          student_id INTEGER NOT NULL REFERENCES students(id),
          center_id INTEGER NOT NULL REFERENCES centers(id),
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          channel TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          sent_at TEXT,
          created_at TEXT NOT NULL
        )
      `);
      await db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_digest_log_no_dupe
          ON digest_log(student_id, period_start, period_end)
      `);
      await db.exec(
        `CREATE INDEX IF NOT EXISTS idx_digest_log_center_id ON digest_log(center_id)`
      );
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

function assertYmd(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
}

function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/**
 * Most recently completed Monday-to-Sunday week for a given center-local date.
 * Stable for every day of the current week, so a cron fire and a manual
 * trigger in the same week always compute the same period (and the unique
 * index collapses them to one digest_log row).
 */
export function weeklyPeriod(todayYmd = getTodayInTimezone()) {
  assertYmd(todayYmd, 'date');
  const [y, m, d] = todayYmd.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const periodEnd = shiftYmd(todayYmd, -daysSinceMonday - 1); // last Sunday
  return { period_start: shiftYmd(periodEnd, -6), period_end: periodEnd };
}

async function curriculumTablesExist() {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('student_progress', 'worksheet_completions')`
    )
    .get();
  return Number(row?.count) === 2;
}

/**
 * Curriculum-tracking seam (see module docblock for the expected tables).
 * Returns null, never throws, when curriculum tracking is not installed or
 * its schema differs from the documented interface.
 *
 * Each worksheet_completions row is one graded page (see curriculumService.js
 * logCompletion), so counting rows in a date range gives pages completed in
 * that range — not a `pages` column to sum.
 */
export async function fetchProgressSummary(studentId, periodStart, periodEnd) {
  try {
    if (!(await curriculumTablesExist())) return null;

    const completions = await db
      .prepare(
        `SELECT wc.completed_at
         FROM worksheet_completions wc
         WHERE wc.student_id = ?`
      )
      .all(studentId);

    const pagesBetween = (start, end) =>
      completions.filter((row) => {
        const date = getDateInTimezone(row.completed_at);
        return date >= start && date <= end;
      }).length;

    const levels = (
      await db
        .prepare(
          `SELECT sp.subject, cl.level_code
           FROM student_progress sp
           JOIN curriculum_levels cl ON cl.id = sp.current_level_id
           WHERE sp.student_id = ?
           ORDER BY sp.subject ASC`
        )
        .all(studentId)
    ).map((row) => ({ subject: row.subject, level: row.level_code }));

    return {
      pages_completed: pagesBetween(periodStart, periodEnd),
      previous_pages: pagesBetween(shiftYmd(periodStart, -7), shiftYmd(periodEnd, -7)),
      levels,
    };
  } catch (err) {
    console.warn('[digest] progress summary unavailable, omitting:', err?.message || err);
    return null;
  }
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function composeDigestText(studentName, periodStart, periodEnd, attendance, progress) {
  const parts = [];

  if (attendance.visits === 0) {
    parts.push(
      `KumonScan weekly digest for ${studentName} (${periodStart} to ${periodEnd}): no visits this week.`
    );
  } else {
    parts.push(
      `KumonScan weekly digest for ${studentName} (${periodStart} to ${periodEnd}): ` +
        `${plural(attendance.visits, 'visit')}, ${Math.round(attendance.total_minutes)} minutes at the center, ` +
        `${plural(attendance.overtime_count, 'session')} over the time allowance.`
    );
  }

  if (progress) {
    const pace =
      progress.pages_completed === progress.previous_pages
        ? `steady with last week`
        : progress.pages_completed > progress.previous_pages
          ? `up from ${progress.previous_pages} last week`
          : `down from ${progress.previous_pages} last week`;
    parts.push(`Worksheets: ${plural(progress.pages_completed, 'page')} completed (${pace}).`);
    if (progress.levels.length > 0) {
      const levelList = progress.levels
        .map((entry) => `${entry.subject} ${entry.level}`)
        .join(', ');
      parts.push(`Current levels: ${levelList}.`);
    }
  }

  return parts.join(' ');
}

/**
 * Pure summary builder: reads attendance (and curriculum data when installed)
 * and returns text plus structured data. Never touches the send path.
 */
export async function buildDigestContent(studentId, periodStart, periodEnd) {
  assertYmd(periodStart, 'period_start');
  assertYmd(periodEnd, 'period_end');

  const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) {
    throw new Error(`Student ${studentId} not found`);
  }

  const sessions = (
    await db
      .prepare(
        `SELECT check_in_time, duration_minutes, subjects, allowance_minutes
         FROM sessions
         WHERE student_id = ? AND check_out_time IS NOT NULL`
      )
      .all(studentId)
  ).filter((session) => {
    const date = getDateInTimezone(session.check_in_time);
    return date >= periodStart && date <= periodEnd;
  });

  const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const attendance = {
    visits: sessions.length,
    total_minutes: Math.round(totalMinutes * 10) / 10,
    overtime_count: sessions.filter((s) => {
      const allowance = s.allowance_minutes ?? allowanceForSubjects(s.subjects || 'both');
      return (s.duration_minutes || 0) > allowance;
    }).length,
  };

  const progress = await fetchProgressSummary(studentId, periodStart, periodEnd);
  const studentName = formatFullName(student);

  return {
    student_id: student.id,
    student_name: studentName,
    period_start: periodStart,
    period_end: periodEnd,
    attendance,
    progress,
    text: composeDigestText(studentName, periodStart, periodEnd, attendance, progress),
  };
}

/** Variable specifier so bundlers don't fail resolving optional modules. */
async function tryImport(fileName) {
  const specifier = `./${fileName}`;
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

/**
 * Delivery seam (agents 1/8). Duck-types the in-flight service interfaces:
 *   whatsappService.sendWhatsAppTemplate(to, templateName, params)
 *   messagingService.sendOutboundMessage(centerId, { student_id, body })
 * Returns { channel: 'none', send: null } when no channel is installed.
 */
export async function resolveDeliveryChannel(student) {
  const whatsappTo = student.parent_whatsapp || null;
  if (whatsappTo) {
    const whatsapp = await tryImport('whatsappService.js');
    if (
      typeof whatsapp?.sendWhatsAppTemplate === 'function' &&
      (typeof whatsapp.isWhatsAppConfigured !== 'function' || whatsapp.isWhatsAppConfigured())
    ) {
      return {
        channel: 'whatsapp',
        send: (content) => whatsapp.sendWhatsAppTemplate(whatsappTo, 'weekly_digest', [content.text]),
      };
    }
  }

  if (student.parent_phone) {
    const messaging = await tryImport('messagingService.js');
    if (typeof messaging?.sendOutboundMessage === 'function') {
      return {
        channel: 'sms',
        send: (content) =>
          messaging.sendOutboundMessage(student.center_id ?? null, {
            student_id: student.id,
            body: content.text,
          }),
      };
    }
  }

  return { channel: 'none', send: null };
}

/**
 * Claim the digest_log row for (student, period). Exactly one caller wins:
 * - fresh insert (ON CONFLICT DO NOTHING resolves the race atomically), or
 * - atomic reclaim of a 'failed' / 'skipped_no_contact' / stale-'pending' row.
 * Returns null when another run already sent or currently owns this period.
 */
async function claimDigestRow(studentId, centerId, periodStart, periodEnd, nowIso) {
  const inserted = await db
    .prepare(
      `INSERT INTO digest_log (student_id, center_id, period_start, period_end, channel, status, created_at)
       VALUES (?, ?, ?, ?, 'none', 'pending', ?)
       ON CONFLICT (student_id, period_start, period_end) DO NOTHING
       RETURNING id`
    )
    .run(studentId, centerId, periodStart, periodEnd, nowIso);
  if (inserted.lastInsertRowid != null) {
    return { id: inserted.lastInsertRowid };
  }

  const staleCutoff = new Date(Date.now() - PENDING_STALE_MINUTES * 60_000).toISOString();
  const reclaimed = await db
    .prepare(
      `UPDATE digest_log
       SET status = 'pending', created_at = ?
       WHERE student_id = ? AND period_start = ? AND period_end = ?
         AND (status IN ('failed', 'skipped_no_contact')
              OR (status = 'pending' AND created_at < ?))
       RETURNING id`
    )
    .run(nowIso, studentId, periodStart, periodEnd, staleCutoff);
  const reclaimedId = reclaimed.rows?.[0]?.id;
  return reclaimedId != null ? { id: Number(reclaimedId) } : null;
}

/**
 * Generate and (when a channel exists) deliver one student's digest.
 * Outcomes: 'sent' | 'pending_no_channel' | 'skipped_no_contact'
 *         | 'skipped_duplicate' | 'failed'. Never throws for delivery errors.
 */
export async function sendDigestForStudent(
  student,
  periodStart,
  periodEnd,
  { resolveChannel = resolveDeliveryChannel } = {}
) {
  await ensureDigestSchema();

  const claimed = await claimDigestRow(student.id, student.center_id, periodStart, periodEnd, sqlNow());
  if (!claimed) {
    const existing = await db
      .prepare(
        `SELECT status FROM digest_log
         WHERE student_id = ? AND period_start = ? AND period_end = ?`
      )
      .get(student.id, periodStart, periodEnd);
    return {
      student_id: student.id,
      outcome: 'skipped_duplicate',
      existing_status: existing?.status ?? 'unknown',
    };
  }

  if (!student.parent_phone && !student.parent_whatsapp) {
    await db
      .prepare(`UPDATE digest_log SET channel = 'none', status = 'skipped_no_contact' WHERE id = ?`)
      .run(claimed.id);
    return { student_id: student.id, outcome: 'skipped_no_contact' };
  }

  const content = await buildDigestContent(student.id, periodStart, periodEnd);
  const { channel, send } = await resolveChannel(student);

  if (!send) {
    // Delivery blocked: no notification channel installed yet. The row stays
    // 'pending' and becomes reclaimable once a channel lands.
    console.info(`[digest] no delivery channel installed; generated for student ${student.id}: ${content.text}`);
    await db.prepare(`UPDATE digest_log SET channel = 'none' WHERE id = ?`).run(claimed.id);
    return { student_id: student.id, outcome: 'pending_no_channel', text: content.text };
  }

  try {
    await send(content);
    await db
      .prepare(`UPDATE digest_log SET channel = ?, status = 'sent', sent_at = ? WHERE id = ?`)
      .run(channel, sqlNow(), claimed.id);
    return { student_id: student.id, outcome: 'sent', channel };
  } catch (err) {
    console.error(`[digest] send failed for student ${student.id} via ${channel}:`, err?.message || err);
    await db
      .prepare(`UPDATE digest_log SET channel = ?, status = 'failed' WHERE id = ?`)
      .run(channel, claimed.id);
    return { student_id: student.id, outcome: 'failed', channel, error: err?.message || 'send failed' };
  }
}

/**
 * Digest run over active students (all, or a subset by id). Each student is
 * isolated in its own try/catch, so one failure never stops the batch.
 *
 * `centerId` scopes the run to one center's students — always pass it from
 * an admin-triggered send (req.center.id) so one center's staff can never
 * trigger or see digests for another center's families. Omit it only for
 * the CRON_SECRET-guarded scheduled run, which is one job covering every
 * center in a single pass.
 */
export async function runDigestBatch({
  centerId = null,
  periodStart,
  periodEnd,
  studentIds = null,
  resolveChannel,
} = {}) {
  await ensureDigestSchema();

  const period =
    periodStart && periodEnd
      ? { period_start: periodStart, period_end: periodEnd }
      : weeklyPeriod();
  assertYmd(period.period_start, 'period_start');
  assertYmd(period.period_end, 'period_end');

  let students = centerId != null
    ? await db
        .prepare('SELECT * FROM students WHERE active = 1 AND center_id = ? ORDER BY id ASC')
        .all(centerId)
    : await db.prepare('SELECT * FROM students WHERE active = 1 ORDER BY id ASC').all();
  if (studentIds) {
    const wanted = new Set(studentIds.map(Number));
    students = students.filter((s) => wanted.has(s.id));
  }

  const results = [];
  for (const student of students) {
    try {
      results.push(
        await sendDigestForStudent(student, period.period_start, period.period_end, {
          resolveChannel,
        })
      );
    } catch (err) {
      console.error(`[digest] unexpected failure for student ${student.id}:`, err);
      results.push({
        student_id: student.id,
        outcome: 'failed',
        error: err?.message || 'unexpected failure',
      });
    }
  }

  const counts = {
    sent: 0,
    pending_no_channel: 0,
    skipped_no_contact: 0,
    skipped_duplicate: 0,
    failed: 0,
  };
  for (const result of results) {
    counts[result.outcome] = (counts[result.outcome] || 0) + 1;
  }

  return { ...period, total: results.length, counts, results };
}

/**
 * Recent digest history for staff, newest first, optionally one student.
 * `centerId` scopes to one center — always pass req.center.id so one
 * center's staff can never see another center's digest history.
 */
export async function listDigestLog({ centerId = null, studentId = null, limit = 100 } = {}) {
  await ensureDigestSchema();

  const conditions = [];
  const params = [];
  if (centerId != null) {
    conditions.push('dl.center_id = ?');
    params.push(centerId);
  }
  if (studentId != null) {
    conditions.push('dl.student_id = ?');
    params.push(studentId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const rows = await db
    .prepare(
      `SELECT dl.id, dl.student_id, dl.period_start, dl.period_end,
              dl.channel, dl.status, dl.sent_at, dl.created_at,
              st.first_name, st.last_name
       FROM digest_log dl
       JOIN students st ON st.id = dl.student_id
       ${where}
       ORDER BY dl.created_at DESC, dl.id DESC
       LIMIT ?`
    )
    .all(...params);

  return rows.map((row) => ({
    id: row.id,
    student_id: row.student_id,
    student_name: formatFullName(row),
    period_start: row.period_start,
    period_end: row.period_end,
    channel: row.channel,
    status: row.status,
    sent_at: row.sent_at,
    created_at: row.created_at,
  }));
}
