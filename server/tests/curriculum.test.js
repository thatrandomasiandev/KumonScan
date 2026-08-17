import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { ensureCurriculumSchema } from '../services/curriculumService.js';

// The Neon serverless driver also goes through global fetch, so the stub must
// pass every non-timeapi request through to the real fetch.
const realFetch = globalThis.fetch;

function stubTimeApi(iso) {
  vi.stubGlobal('fetch', async (url, init) => {
    if (String(url).includes('timeapi.io')) {
      return { ok: true, json: async () => ({ dateTime: iso }) };
    }
    return realFetch(url, init);
  });
}

async function loginCookie() {
  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '198.51.100.30')
    .send({ password: 'test-admin-password' });
  if (res.status !== 200) {
    console.error('login failed:', res.status, res.text?.slice(0, 2000));
  }
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

// The shared Neon test branch may carry migrations from other agents'
// branches (e.g. a NOT NULL students.center_id from the multi-tenant work)
// that this branch's code does not know about. Detect and satisfy them so
// this suite passes against either schema.
let tenancyContext = null;

async function hasColumn(table, column) {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 AS ok FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`
      )
      .get(table, column)
  );
}

async function getTenancyContext() {
  if (tenancyContext) return tenancyContext;
  const studentsHaveCenter = await hasColumn('students', 'center_id');
  const sessionsHaveCenter = await hasColumn('sessions', 'center_id');
  let centerId = null;
  if (studentsHaveCenter || sessionsHaveCenter) {
    const center = await db.prepare('SELECT id FROM centers ORDER BY id ASC LIMIT 1').get();
    if (!center) {
      throw new Error(
        'Test DB has center_id columns but no centers row; run the tenancy suite first.'
      );
    }
    centerId = center.id;
  }
  tenancyContext = { studentsHaveCenter, sessionsHaveCenter, centerId };
  return tenancyContext;
}

async function insertStudent({ first, last }) {
  const { studentsHaveCenter, centerId } = await getTenancyContext();
  const result = studentsHaveCenter
    ? await db
        .prepare(
          `INSERT INTO students (center_id, first_name, last_name, active)
           VALUES (?, ?, ?, 1)`
        )
        .run(centerId, first, last)
    : await db
        .prepare(
          `INSERT INTO students (first_name, last_name, active)
           VALUES (?, ?, 1)`
        )
        .run(first, last);
  return { id: result.lastInsertRowid };
}

async function insertSession(studentId) {
  const { sessionsHaveCenter, centerId } = await getTenancyContext();
  const iso = new Date().toISOString();
  return sessionsHaveCenter
    ? db
        .prepare('INSERT INTO sessions (center_id, student_id, check_in_time) VALUES (?, ?, ?)')
        .run(centerId, studentId, iso)
    : db.prepare('INSERT INTO sessions (student_id, check_in_time) VALUES (?, ?)').run(studentId, iso);
}

async function cleanCurriculumTables() {
  await ensureCurriculumSchema();
  // Only the curriculum tables are wiped: they reference students, so leaving
  // rows behind would break other suites' DELETE FROM students. Students and
  // sessions are left to the suites that own them; every test here creates
  // fresh students and asserts only on those ids.
  await db.exec('DELETE FROM worksheet_completions');
  await db.exec('DELETE FROM student_progress');
}

describe('Curriculum progress API', () => {
  let cookie;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    stubTimeApi(new Date().toISOString());
    cookie = await loginCookie();
    await cleanCurriculumTables();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAdminSessionsForTests();
  });

  afterAll(async () => {
    await cleanCurriculumTables();
  });

  function logProgress(studentId, body) {
    return request(app)
      .post(`/api/students/${studentId}/progress`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30')
      .send(body);
  }

  function getProgress(studentId) {
    return request(app)
      .get(`/api/students/${studentId}/progress`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30');
  }

  it('seeds the real Kumon level sequences for both subjects', async () => {
    const res = await request(app)
      .get('/api/curriculum/levels?subject=math')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30');

    expect(res.status).toBe(200);
    const codes = res.body.levels.map((l) => l.level_code);
    expect(codes.slice(0, 6)).toEqual(['7A', '6A', '5A', '4A', '3A', '2A']);
    expect(codes.at(-1)).toBe('O');
    expect(codes).toHaveLength(21);

    const reading = await request(app)
      .get('/api/curriculum/levels?subject=reading')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30');
    const readingCodes = reading.body.levels.map((l) => l.level_code);
    expect(readingCodes).toContain('AI');
    expect(readingCodes).toContain('FII');
    expect(readingCodes.at(-1)).toBe('L');
    expect(readingCodes).toHaveLength(24);
  });

  it('logs completions, updates current_page, and keeps prior history', async () => {
    const { id } = await insertStudent({ first: 'Pace', last: 'Setter' });

    const first = await logProgress(id, {
      subject: 'math',
      level_code: 'B',
      page_number: 10,
      accuracy_pct: 95,
    });
    expect(first.status).toBe(201);
    expect(first.body.completion.level_code).toBe('B');

    const second = await logProgress(id, { subject: 'math', page_number: 11 });
    expect(second.status).toBe(201);

    const res = await getProgress(id);
    expect(res.status).toBe(200);
    const math = res.body.progress.find((p) => p.subject === 'math');
    expect(math.level_code).toBe('B');
    expect(math.current_page).toBe(11);
    expect(res.body.history).toHaveLength(2);
    const pages = res.body.history.map((h) => h.page_number).sort((a, b) => a - b);
    expect(pages).toEqual([10, 11]);
    expect(res.body.history.find((h) => h.page_number === 10).accuracy_pct).toBe(95);
  });

  it('never advances the level implicitly, only via explicit level_code', async () => {
    const { id } = await insertStudent({ first: 'Explicit', last: 'Advance' });

    await logProgress(id, { subject: 'math', level_code: 'B', page_number: 199 });
    await logProgress(id, { subject: 'math', page_number: 200 });
    // Wrapping back to page 1 without level_code must NOT be read as "next level".
    const wrapped = await logProgress(id, { subject: 'math', page_number: 1 });
    expect(wrapped.status).toBe(201);

    let res = await getProgress(id);
    let math = res.body.progress.find((p) => p.subject === 'math');
    expect(math.level_code).toBe('B');
    expect(math.current_page).toBe(1);

    const advanced = await logProgress(id, {
      subject: 'math',
      level_code: 'C',
      page_number: 1,
    });
    expect(advanced.status).toBe(201);

    res = await getProgress(id);
    math = res.body.progress.find((p) => p.subject === 'math');
    expect(math.level_code).toBe('C');
  });

  it('requires level_code on the first completion for a subject', async () => {
    const { id } = await insertStudent({ first: 'No', last: 'Level' });

    const res = await logProgress(id, { subject: 'reading', page_number: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/level_code/i);
  });

  it('rejects invalid input: bad subject, page out of range, unknown level, foreign session', async () => {
    const { id } = await insertStudent({ first: 'Bad', last: 'Input' });
    const other = await insertStudent({ first: 'Other', last: 'Kid' });

    expect((await logProgress(id, { subject: 'science', level_code: 'B', page_number: 1 })).status).toBe(400);
    expect((await logProgress(id, { subject: 'math', level_code: 'B', page_number: 0 })).status).toBe(400);
    expect((await logProgress(id, { subject: 'math', level_code: 'B', page_number: 201 })).status).toBe(400);
    expect((await logProgress(id, { subject: 'math', level_code: 'ZZ', page_number: 1 })).status).toBe(400);
    expect(
      (await logProgress(id, { subject: 'math', level_code: 'B', page_number: 1, accuracy_pct: 101 })).status
    ).toBe(400);

    const session = await insertSession(other.id);
    const res = await logProgress(id, {
      subject: 'math',
      level_code: 'B',
      page_number: 1,
      session_id: session.lastInsertRowid,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/session/i);
  });

  it('progress-pace reads 0 for a student with no completions in the window', async () => {
    const zero = await insertStudent({ first: 'Zero', last: 'Pages' });
    const active = await insertStudent({ first: 'Eight', last: 'Pages' });
    const stale = await insertStudent({ first: 'Stale', last: 'Pages' });

    for (let page = 1; page <= 8; page++) {
      const res = await logProgress(active.id, {
        subject: 'math',
        level_code: 'A',
        page_number: page,
      });
      expect(res.status).toBe(201);
    }

    // A completion outside the trailing window must not count either.
    await logProgress(stale.id, { subject: 'reading', level_code: 'AI', page_number: 3 });
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .prepare('UPDATE worksheet_completions SET completed_at = ? WHERE student_id = ?')
      .run(sixtyDaysAgo, stale.id);

    const res = await request(app)
      .get('/api/reports/progress-pace?weeks=4')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30');

    expect(res.status).toBe(200);
    expect(res.body.weeks).toBe(4);

    const zeroRow = res.body.students.find((s) => s.id === zero.id);
    expect(zeroRow.total_pages).toBe(0);
    expect(zeroRow.pages_per_week).toBe(0);

    const activeRow = res.body.students.find((s) => s.id === active.id);
    expect(activeRow.math_pages).toBe(8);
    expect(activeRow.pages_per_week).toBe(2);

    const staleRow = res.body.students.find((s) => s.id === stale.id);
    expect(staleRow.total_pages).toBe(0);
    expect(staleRow.pages_per_week).toBe(0);
  });

  it('requires staff auth on every curriculum route', async () => {
    const { id } = await insertStudent({ first: 'Locked', last: 'Down' });

    const unauthed = await Promise.all([
      request(app).get('/api/curriculum/levels'),
      request(app).get(`/api/students/${id}/progress`),
      request(app)
        .post(`/api/students/${id}/progress`)
        .send({ subject: 'math', level_code: 'B', page_number: 1 }),
      request(app).get('/api/reports/progress-pace'),
    ]);
    for (const res of unauthed) {
      expect(res.status).toBe(401);
    }
  });
});
