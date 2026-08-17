import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import {
  buildDigestContent,
  ensureDigestSchema,
  runDigestBatch,
  weeklyPeriod,
} from '../services/digestService.js';
import { ensureCurriculumSchema } from '../services/curriculumService.js';

const PERIOD = { start: '2026-07-20', end: '2026-07-26' };
const CRON_SECRET = 'test-cron-secret';

async function loginCookie() {
  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '198.51.100.30')
    .send({ password: 'test-admin-password' });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

/**
 * The shared test branch may carry the in-flight multitenancy schema
 * (NOT NULL center_id on students/sessions). Adapt inserts to whichever
 * schema is present so this suite passes before and after that work merges.
 */
let centerIdPromise = null;

async function centerIdIfRequired(table) {
  const column = await db
    .prepare(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ? AND column_name = 'center_id'`
    )
    .get(table);
  if (!column) return null;

  if (!centerIdPromise) {
    centerIdPromise = (async () => {
      const existing = await db.prepare(`SELECT id FROM centers WHERE slug = 'main'`).get();
      if (existing) return existing.id;
      const created = await db
        .prepare(
          `INSERT INTO centers (slug, name, created_at) VALUES ('main', 'KumonScan Center', ?)`
        )
        .run(new Date().toISOString());
      return created.lastInsertRowid;
    })();
  }
  return centerIdPromise;
}

async function insertStudent({ first, last, phone = null } = {}) {
  const centerId = await centerIdIfRequired('students');
  const columns = ['first_name', 'last_name', 'active', 'parent_phone'];
  const values = [first, last, 1, phone];
  if (centerId != null) {
    columns.push('center_id');
    values.push(centerId);
  }
  const result = await db
    .prepare(
      `INSERT INTO students (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`
    )
    .run(...values);
  return { id: result.lastInsertRowid };
}

async function insertCompletedSession(studentId, { checkIn, minutes, subjects = 'both' }) {
  const allowance = subjects === 'both' ? 60 : 30;
  const checkOut = new Date(new Date(checkIn).getTime() + minutes * 60_000).toISOString();
  const centerId = await centerIdIfRequired('sessions');
  const columns = [
    'student_id',
    'check_in_time',
    'check_out_time',
    'duration_minutes',
    'subjects',
    'allowance_minutes',
  ];
  const values = [studentId, checkIn, checkOut, minutes, subjects, allowance];
  if (centerId != null) {
    columns.push('center_id');
    values.push(centerId);
  }
  await db
    .prepare(
      `INSERT INTO sessions (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`
    )
    .run(...values);
}

async function digestRows(studentId) {
  return db
    .prepare(
      `SELECT * FROM digest_log WHERE student_id = ? ORDER BY id ASC`
    )
    .all(studentId);
}

describe('parent progress digests', () => {
  let cookie;

  beforeEach(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    await ensureDigestSchema();
    // CASCADE clears rows in any student-referencing tables other agents'
    // in-flight schema may have added to the shared test branch (this also
    // sweeps worksheet_completions/student_progress, which FK-reference
    // students; curriculum_levels is a shared global catalog and is never
    // truncated).
    await db.exec('TRUNCATE TABLE digest_log, sessions, students CASCADE');
    cookie = await loginCookie();
  });

  afterEach(async () => {
    delete process.env.CRON_SECRET;
  });

  it('weeklyPeriod returns the same completed Mon-Sun week for every day of the current week', () => {
    // 2026-07-27 is a Monday; the completed week before it is Jul 20-26.
    expect(weeklyPeriod('2026-07-27')).toEqual({ period_start: PERIOD.start, period_end: PERIOD.end });
    expect(weeklyPeriod('2026-07-31')).toEqual({ period_start: PERIOD.start, period_end: PERIOD.end });
    expect(weeklyPeriod('2026-08-02')).toEqual({ period_start: PERIOD.start, period_end: PERIOD.end });
  });

  it('buildDigestContent summarizes attendance and reports zero worksheets for a student with no curriculum activity', async () => {
    const { id } = await insertStudent({ first: 'Aiko', last: 'Tanaka', phone: '+12135550100' });
    await insertCompletedSession(id, { checkIn: '2026-07-21T20:00:00.000Z', minutes: 45 });
    await insertCompletedSession(id, { checkIn: '2026-07-23T20:00:00.000Z', minutes: 75 }); // overtime (>60)
    await insertCompletedSession(id, { checkIn: '2026-07-10T20:00:00.000Z', minutes: 50 }); // outside period

    const content = await buildDigestContent(id, PERIOD.start, PERIOD.end);

    expect(content.attendance).toEqual({ visits: 2, total_minutes: 120, overtime_count: 1 });
    // Curriculum tables exist in the full integration (agent-curriculum), so
    // this student's total absence of activity reports as zeros, not null.
    expect(content.progress).toEqual({ pages_completed: 0, previous_pages: 0, levels: [] });
    expect(content.text).toContain('2 visits');
    expect(content.text).toContain('120 minutes');
    expect(content.text).toContain('1 session over the time allowance');
    expect(content.text).toContain('Worksheets: 0 pages completed');
    expect(content.text).not.toContain('Current levels');
  });

  it('buildDigestContent includes pages, pace, and levels when curriculum tables exist', async () => {
    const { id } = await insertStudent({ first: 'Ben', last: 'Ruiz', phone: '+12135550101' });
    await insertCompletedSession(id, { checkIn: '2026-07-22T20:00:00.000Z', minutes: 30, subjects: 'math' });

    // Real schema (server/services/curriculumService.js): one row per graded
    // page, level looked up by id, not a `pages`/`current_level` shortcut.
    await ensureCurriculumSchema();
    const level = await db
      .prepare(`SELECT id FROM curriculum_levels WHERE subject = 'math' AND level_code = 'D'`)
      .get();
    const insertCompletion = db.prepare(
      `INSERT INTO worksheet_completions (student_id, level_id, page_number, completed_at)
       VALUES (?, ?, ?, ?)`
    );
    await insertCompletion.run(id, level.id, 44, '2026-07-21T20:00:00.000Z'); // in period
    await insertCompletion.run(id, level.id, 45, '2026-07-24T20:00:00.000Z'); // in period
    await insertCompletion.run(id, level.id, 43, '2026-07-15T20:00:00.000Z'); // previous week
    await db
      .prepare(
        `INSERT INTO student_progress (student_id, subject, current_level_id, current_page, updated_at)
         VALUES (?, 'math', ?, 45, ?)`
      )
      .run(id, level.id, '2026-07-24T20:00:00.000Z');

    const content = await buildDigestContent(id, PERIOD.start, PERIOD.end);

    expect(content.progress).toEqual({
      pages_completed: 2,
      previous_pages: 1,
      levels: [{ subject: 'math', level: 'D' }],
    });
    expect(content.text).toContain('2 pages completed');
    expect(content.text).toContain('up from 1 last week');
    expect(content.text).toContain('Current levels: math D');
  });

  it('cron then manual trigger for the same week produces exactly one digest_log row per student', async () => {
    const { id } = await insertStudent({ first: 'Cara', last: 'Ngo', phone: '+12135550102' });

    const cronRes = await request(app)
      .get('/api/cron/digests')
      .set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(cronRes.status).toBe(200);
    expect(cronRes.body.trigger).toBe('cron');
    // Whether the digest lands as 'sent' or 'pending_no_channel' depends on
    // which sibling channel modules are installed in the full integration;
    // either way it must claim the row and not skip it as a duplicate.
    expect(cronRes.body.total).toBe(1);
    expect(cronRes.body.counts.skipped_duplicate).toBe(0);

    const manualRes = await request(app)
      .post('/api/admin/digests/send-now')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30')
      .send({});
    expect(manualRes.status).toBe(200);
    expect(manualRes.body.counts.skipped_duplicate).toBe(1);

    const rows = await digestRows(id);
    expect(rows).toHaveLength(1);
  });

  it('the unique index rejects a second row for the same student and period at the database level', async () => {
    const { id } = await insertStudent({ first: 'Dev', last: 'Patel', phone: '+12135550103' });
    const centerId = await centerIdIfRequired('digest_log');
    const insert = db.prepare(
      `INSERT INTO digest_log (student_id, center_id, period_start, period_end, channel, status, created_at)
       VALUES (?, ?, ?, ?, 'none', 'pending', ?)`
    );
    await insert.run(id, centerId, PERIOD.start, PERIOD.end, new Date().toISOString());
    await expect(
      insert.run(id, centerId, PERIOD.start, PERIOD.end, new Date().toISOString())
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('a delivered digest is not re-sent when the batch runs again for the same period', async () => {
    const { id } = await insertStudent({ first: 'Eli', last: 'Sato', phone: '+12135550104' });
    let sends = 0;
    const resolveChannel = () => ({
      channel: 'sms',
      send: async () => {
        sends += 1;
      },
    });

    const first = await runDigestBatch({
      periodStart: PERIOD.start,
      periodEnd: PERIOD.end,
      resolveChannel,
    });
    expect(first.counts.sent).toBe(1);

    const second = await runDigestBatch({
      periodStart: PERIOD.start,
      periodEnd: PERIOD.end,
      resolveChannel,
    });
    expect(second.counts.skipped_duplicate).toBe(1);
    expect(second.counts.sent).toBe(0);
    expect(sends).toBe(1);

    const rows = await digestRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].sent_at).toBeTruthy();
  });

  it('one student failing to send does not stop the rest of the batch', async () => {
    const a = await insertStudent({ first: 'Fay', last: 'Adams', phone: '+12135550105' });
    const b = await insertStudent({ first: 'Gus', last: 'Brown', phone: '+12135550106' });
    const c = await insertStudent({ first: 'Hana', last: 'Choi', phone: '+12135550107' });

    const resolveChannel = (student) => ({
      channel: 'sms',
      send: async () => {
        if (student.id === b.id) throw new Error('carrier rejected');
      },
    });

    const summary = await runDigestBatch({
      periodStart: PERIOD.start,
      periodEnd: PERIOD.end,
      resolveChannel,
    });

    expect(summary.total).toBe(3);
    expect(summary.counts.sent).toBe(2);
    expect(summary.counts.failed).toBe(1);
    expect((await digestRows(a.id))[0].status).toBe('sent');
    expect((await digestRows(b.id))[0].status).toBe('failed');
    expect((await digestRows(c.id))[0].status).toBe('sent');
  });

  it('students without parent contact are logged as skipped_no_contact, not sent', async () => {
    const { id } = await insertStudent({ first: 'Ira', last: 'Klein', phone: null });

    const summary = await runDigestBatch({ periodStart: PERIOD.start, periodEnd: PERIOD.end });
    expect(summary.counts.skipped_no_contact).toBe(1);

    const rows = await digestRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('skipped_no_contact');
  });

  it('cron endpoint rejects bad or missing credentials', async () => {
    const wrong = await request(app)
      .get('/api/cron/digests')
      .set('Authorization', 'Bearer wrong-secret');
    expect(wrong.status).toBe(401);

    const missing = await request(app).get('/api/cron/digests');
    expect(missing.status).toBe(401);

    delete process.env.CRON_SECRET;
    const unconfigured = await request(app).get('/api/cron/digests');
    expect(unconfigured.status).toBe(503);
  });

  it('admin history endpoint filters by student', async () => {
    const a = await insertStudent({ first: 'Joy', last: 'Lin', phone: '+12135550108' });
    const b = await insertStudent({ first: 'Kai', last: 'Moss', phone: '+12135550109' });
    await runDigestBatch({ periodStart: PERIOD.start, periodEnd: PERIOD.end });

    const all = await request(app)
      .get('/api/admin/digests')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30');
    expect(all.status).toBe(200);
    expect(all.body.digests).toHaveLength(2);

    const filtered = await request(app)
      .get(`/api/admin/digests?student_id=${a.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30');
    expect(filtered.status).toBe(200);
    expect(filtered.body.digests).toHaveLength(1);
    expect(filtered.body.digests[0].student_id).toBe(a.id);
    expect(filtered.body.digests[0].student_name).toBe('Joy Lin');
    expect(filtered.body.digests.every((d) => d.student_id !== b.id)).toBe(true);
  });
});
