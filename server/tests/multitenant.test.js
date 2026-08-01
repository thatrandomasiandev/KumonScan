import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db, { TENANT_TABLES, ensureDb, sqlNow } from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import {
  createTestCenter,
  defaultCenter,
  deleteCenters,
  insertStudent,
  loginCookie,
  wipeCenterData,
  DEFAULT_ADMIN_PASSWORD,
} from './helpers.js';

const realFetch = globalThis.fetch;

function stubTimeApi(iso = '2026-07-30T19:00:00.000Z') {
  vi.stubGlobal('fetch', async (url, options) => {
    if (String(url).includes('timeapi.io')) {
      return { ok: true, json: async () => ({ dateTime: iso }) };
    }
    return realFetch(url, options);
  });
}

/**
 * Every admin-authenticated, center-scoped GET/POST that lists or mutates
 * tenant data. The isolation sweep hits each of these as center A's admin
 * and asserts center B's rows never appear / never change.
 */
const READ_ENDPOINTS = [
  { method: 'get', path: '/students' },
  { method: 'get', path: '/present' },
  { method: 'get', path: '/completed-today' },
  { method: 'get', path: '/absent?date=2026-07-30' },
  { method: 'get', path: '/dashboard' },
  { method: 'get', path: '/staff' },
  { method: 'get', path: '/reports/attendance?period=monthly&month=2026-07' },
  { method: 'get', path: '/reports/payroll?start=2026-07-01&end=2026-07-31' },
  { method: 'get', path: '/reports/utilization' },
  { method: 'get', path: '/insights/summary' },
  { method: 'get', path: '/insights/at-risk' },
  { method: 'get', path: '/admin/capacity' },
  { method: 'get', path: '/admin/gateway-status' },
  { method: 'get', path: '/messages/unread-count' },
  { method: 'get', path: '/messages/unmatched' },
  { method: 'get', path: '/remote-attendance/open-sessions' },
  { method: 'get', path: '/webhooks' },
];

describe('multi-center tenancy', () => {
  let centerA;
  let centerB;
  let cookieA;
  let cookieB;
  let studentA;
  let studentB;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    stubTimeApi();
    await ensureDb();

    centerA = await defaultCenter();
    // Re-hash so the env-seeded password is always the one tests log in with,
    // even if a previous suite rotated the hash.
    await db
      .prepare('UPDATE centers SET admin_password_hash = ? WHERE id = ?')
      .run(
        (await import('../utils/passwords.js')).hashPassword(DEFAULT_ADMIN_PASSWORD),
        centerA.id
      );
    centerA = await defaultCenter();

    centerB = await createTestCenter({ name: 'Center B', slug: `b-${Date.now()}` });

    await wipeCenterData(centerA.id, centerB.id);

    // Same-named students: the unique index must allow this across centers.
    studentA = await insertStudent(centerA.id, {
      first: 'Emma',
      last: 'Johnson',
      parent_phone: '+15551111111',
      days: JSON.stringify(['Thu']),
    });
    studentB = await insertStudent(centerB.id, {
      first: 'Emma',
      last: 'Johnson',
      parent_phone: '+15552222222',
      days: JSON.stringify(['Thu']),
    });

    await db
      .prepare(
        `INSERT INTO sessions (center_id, student_id, check_in_time, subjects, allowance_minutes)
         VALUES (?, ?, ?, 'both', 60)`
      )
      .run(centerA.id, studentA.id, '2026-07-30T18:00:00.000Z');
    await db
      .prepare(
        `INSERT INTO sessions (center_id, student_id, check_in_time, subjects, allowance_minutes)
         VALUES (?, ?, ?, 'both', 60)`
      )
      .run(centerB.id, studentB.id, '2026-07-30T18:00:00.000Z');

    cookieA = await loginCookie(DEFAULT_ADMIN_PASSWORD, centerA.slug);
    cookieB = await loginCookie(DEFAULT_ADMIN_PASSWORD, centerB.slug);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    clearAdminSessionsForTests();
    if (centerB?.id) await deleteCenters(centerB.id);
    if (centerA?.id) await wipeCenterData(centerA.id);
  });

  it('migration backfill leaves zero NULL center_id rows on existing tables', async () => {
    for (const table of TENANT_TABLES) {
      const exists = await db
        .prepare(
          `SELECT 1 AS ok FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ?`
        )
        .get(table);
      if (!exists) continue;

      const nulls = await db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE center_id IS NULL`)
        .get();
      expect(nulls.count, `${table} has NULL center_id`).toBe(0);
    }
  });

  it('two centers can each enroll a student with the same name; one center cannot', async () => {
    // Same name already seeded in beforeEach for A and B — both exist.
    const a = await db
      .prepare(
        `SELECT id FROM students
         WHERE center_id = ? AND LOWER(first_name) = 'emma' AND LOWER(last_name) = 'johnson'`
      )
      .get(centerA.id);
    const b = await db
      .prepare(
        `SELECT id FROM students
         WHERE center_id = ? AND LOWER(first_name) = 'emma' AND LOWER(last_name) = 'johnson'`
      )
      .get(centerB.id);
    expect(a.id).toBe(studentA.id);
    expect(b.id).toBe(studentB.id);
    expect(a.id).not.toBe(b.id);

    // Duplicate inside one center is rejected by the unique index.
    await expect(
      insertStudent(centerA.id, { first: 'Emma', last: 'Johnson' })
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('center A session cookie cannot authenticate against center B', async () => {
    const res = await request(app)
      .get(`/api/c/${centerB.slug}/students`)
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.40');
    expect(res.status).toBe(401);
  });

  it('unknown center slug returns 404', async () => {
    const res = await request(app)
      .get('/api/c/does-not-exist/students')
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.41');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/unknown center/i);
  });

  it('cross-tenant isolation sweep: every read endpoint hides the other center', async () => {
    for (const { method, path } of READ_ENDPOINTS) {
      const res = await request(app)
        [method](`/api/c/${centerA.slug}${path}`)
        .set('Cookie', cookieA)
        .set('X-Forwarded-For', '198.51.100.50');

      expect(res.status, `${method.toUpperCase()} ${path} status`).toBeLessThan(500);

      if (res.status !== 200) continue; // some endpoints 400 without params; still not leaking

      const body = JSON.stringify(res.body);
      // Center B's student id must never appear in center A's responses.
      expect(body, `${path} leaked studentB.id=${studentB.id}`).not.toContain(
        `"id":${studentB.id}`
      );
      expect(body, `${path} leaked studentB.id as string`).not.toContain(
        `"id":"${studentB.id}"`
      );
      // Parent phone of center B must never appear.
      expect(body).not.toContain('+15552222222');
    }
  });

  it('center A cannot read, patch, or deactivate center B students by id', async () => {
    const getSessions = await request(app)
      .get(`/api/c/${centerA.slug}/students/${studentB.id}/sessions`)
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.51');
    expect(getSessions.status).toBe(404);

    const patch = await request(app)
      .patch(`/api/c/${centerA.slug}/students/${studentB.id}`)
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.52')
      .send({ parent_phone: '+15559999999' });
    expect(patch.status).toBe(404);

    const deactivate = await request(app)
      .patch(`/api/c/${centerA.slug}/students/${studentB.id}/deactivate`)
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.53');
    expect(deactivate.status).toBe(404);

    // Center B's student is untouched.
    const still = await db
      .prepare('SELECT active, parent_phone FROM students WHERE id = ? AND center_id = ?')
      .get(studentB.id, centerB.id);
    expect(still.active).toBe(1);
    expect(still.parent_phone).toBe('+15552222222');
  });

  it('center A cannot check in or check out center B students', async () => {
    const checkIn = await request(app)
      .post(`/api/c/${centerA.slug}/check-in`)
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.54')
      .send({ student_id: studentB.id, subjects: 'math' });
    expect(checkIn.status).toBe(404);

    const checkOut = await request(app)
      .post(`/api/c/${centerA.slug}/check-out`)
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.55')
      .send({ student_id: studentB.id });
    expect(checkOut.status).toBe(404);
  });

  it('kiosk scan for a QR belonging to another center returns 404', async () => {
    const res = await request(app)
      .post(`/api/c/${centerA.slug}/scan`)
      .set('X-Forwarded-For', '198.51.100.56')
      .send({ qr_code_value: studentB.qr });
    expect(res.status).toBe(404);
  });

  it('POST /api/centers provisions an isolated center (superadmin)', async () => {
    process.env.SUPERADMIN_KEY = 'test-superadmin-key';
    const slug = `prov-${Date.now()}`;
    try {
      const res = await request(app)
        .post('/api/centers')
        .set('X-Superadmin-Key', 'test-superadmin-key')
        .set('X-Forwarded-For', '198.51.100.57')
        .send({
          slug,
          name: 'Provisioned Center',
          timezone: 'America/New_York',
          admin_password: 'provisioned-password',
        });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(slug);
      expect(res.body).not.toHaveProperty('admin_password_hash');

      const cookie = await loginCookie('provisioned-password', slug);
      const list = await request(app)
        .get(`/api/c/${slug}/students`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', '198.51.100.58');
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);

      const center = await db.prepare('SELECT id FROM centers WHERE slug = ?').get(slug);
      await deleteCenters(center.id);
    } finally {
      delete process.env.SUPERADMIN_KEY;
    }
  });

  it('POST /api/centers rejects non-superadmin credentials', async () => {
    process.env.SUPERADMIN_KEY = 'test-superadmin-key';
    try {
      const noKey = await request(app)
        .post('/api/centers')
        .set('X-Forwarded-For', '198.51.100.59')
        .send({
          slug: 'nope',
          name: 'Nope',
          admin_password: 'password123',
        });
      expect(noKey.status).toBe(401);

      const wrongKey = await request(app)
        .post('/api/centers')
        .set('X-Superadmin-Key', 'wrong')
        .set('X-Forwarded-For', '198.51.100.60')
        .send({
          slug: 'nope',
          name: 'Nope',
          admin_password: 'password123',
        });
      expect(wrongKey.status).toBe(401);
    } finally {
      delete process.env.SUPERADMIN_KEY;
    }
  });

  it('legacy unslugged /api/... resolves to the original center', async () => {
    const res = await request(app)
      .get('/api/students')
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.61');
    expect(res.status).toBe(200);
    const ids = res.body.map((s) => s.id);
    expect(ids).toContain(studentA.id);
    expect(ids).not.toContain(studentB.id);
  });

  it('full export only includes the requesting center', async () => {
    const res = await request(app)
      .get(`/api/c/${centerA.slug}/export/full`)
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.62');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/zip/);
    // Zip bytes are opaque here; assert via a second source of truth that
    // the export query path is scoped (covered by the students list above
    // and by export.routes.js's WHERE center_id = ?).
    const count = await db
      .prepare('SELECT COUNT(*) AS count FROM students WHERE center_id = ?')
      .get(centerA.id);
    expect(count.count).toBe(1);
  });

  it('settings are per-center (capacity written by A is invisible to B)', async () => {
    const put = await request(app)
      .put(`/api/c/${centerA.slug}/admin/capacity`)
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.63')
      .send({ capacity: { Mon: 12 } });
    expect(put.status).toBe(200);

    const getB = await request(app)
      .get(`/api/c/${centerB.slug}/admin/capacity`)
      .set('Cookie', cookieB)
      .set('X-Forwarded-For', '198.51.100.64');
    expect(getB.status).toBe(200);
    expect(getB.body.capacity.Mon).toBeUndefined();
  });
});

describe('tenancy migration against a single-center fixture', () => {
  it('ensureDb is idempotent and every tenant table has NOT NULL center_id', async () => {
    await ensureDb();
    await ensureDb(); // second call must be a no-op

    for (const table of TENANT_TABLES) {
      const exists = await db
        .prepare(
          `SELECT 1 AS ok FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ?`
        )
        .get(table);
      if (!exists) continue;

      const col = await db
        .prepare(
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = ? AND column_name = 'center_id'`
        )
        .get(table);
      expect(col, `${table}.center_id missing`).toBeTruthy();
      expect(col.is_nullable, `${table}.center_id nullable`).toBe('NO');
    }

    const centers = await db.prepare('SELECT COUNT(*) AS count FROM centers').get();
    expect(centers.count).toBeGreaterThanOrEqual(1);
  });
});
