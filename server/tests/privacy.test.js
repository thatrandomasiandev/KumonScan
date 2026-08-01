import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

// Guard: never let this suite touch the primary database. main's env-setup.js
// predates the TEST_DATABASE_URL remap, so enforce it here before any query
// runs (db.js reads the connection string lazily at first query).
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  throw new Error(
    'TEST_DATABASE_URL is required to run privacy tests (Neon test-suite branch). ' +
      'Refusing to run against DATABASE_URL directly.'
  );
}

import app from '../app.js';
import db, { all, get } from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { ensurePrivacySchema, recordAuditEvent } from '../services/auditLogService.js';
import { purgeExpiredData, setRetentionPolicy } from '../services/retentionService.js';

const STAFF_IP = '198.51.100.30';

// The login limiter allows 10 requests/minute per IP; with one login per test
// a single IP would trip it. Each login gets its own address.
let loginIpCounter = 0;
function nextLoginIp() {
  loginIpCounter += 1;
  return `198.51.${100 + Math.floor(loginIpCounter / 200)}.${loginIpCounter % 200}`;
}

// The Neon serverless driver also uses fetch, so the stub must pass
// everything except timeapi.io through to the real implementation.
const realFetch = globalThis.fetch.bind(globalThis);

function stubTimeApi(iso = '2026-07-30T19:00:00.000Z') {
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
    .set('X-Forwarded-For', nextLoginIp())
    .send({ password: 'test-admin-password' });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

async function insertStudent({ first, last, subjects = 'both' } = {}) {
  const qr = `KUMON-${uuidv4().slice(0, 8).toUpperCase()}`;
  const result = await db
    .prepare(
      `INSERT INTO students (first_name, last_name, qr_code_value, active, enrolled_subjects)
       VALUES (?, ?, ?, 1, ?)`
    )
    .run(first, last, qr, subjects);
  return { id: result.lastInsertRowid, qr };
}

async function insertClosedSession(studentId, checkInIso, checkOutIso) {
  const result = await db
    .prepare(
      `INSERT INTO sessions (student_id, check_in_time, check_out_time, duration_minutes)
       VALUES (?, ?, ?, 30)`
    )
    .run(studentId, checkInIso, checkOutIso);
  return result.lastInsertRowid;
}

async function auditRows(filters = {}) {
  const where = [];
  const params = [];
  for (const [column, value] of Object.entries(filters)) {
    where.push(`${column} = ?`);
    params.push(value);
  }
  return all(
    `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`,
    params
  );
}

/**
 * The shared test branch carries schema from other in-flight branches. The
 * multi-center branch adds sessions.center_id NOT NULL (FK to centers) but,
 * unlike students.center_id, without a DEFAULT — which breaks every insert
 * from main-based code. Mirror the students default (center 1) when that
 * drift is present; a default changes nothing for code that sets center_id
 * explicitly.
 */
async function accommodateSharedSchemaDrift() {
  const centerIdCol = await get(
    `SELECT is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'center_id'`
  );
  if (!centerIdCol || centerIdCol.is_nullable !== 'NO' || centerIdCol.column_default) return;

  await db.exec(`
    INSERT INTO centers (id, slug, name, created_at)
    VALUES (1, 'default', 'Default Center', '2026-01-01T00:00:00.000Z')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.exec(`ALTER TABLE sessions ALTER COLUMN center_id SET DEFAULT 1`);
}

/** Tables from any branch that reference students, children-first cleanup. */
async function deleteAllStudentData() {
  const referencing = (
    await all(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'student_id'`
    )
  ).map((r) => r.table_name);

  for (const table of referencing) {
    await db.exec(`DELETE FROM ${table}`);
  }
  await db.exec('DELETE FROM students');
}

describe('privacy & data handling', () => {
  let cookie;

  beforeAll(async () => {
    await ensurePrivacySchema();
    await accommodateSharedSchemaDrift();
  });

  beforeEach(async () => {
    clearAdminSessionsForTests();
    await db.exec('DELETE FROM audit_log');
    await db.exec('DELETE FROM retention_policy');
    await deleteAllStudentData();
    stubTimeApi('2026-07-30T19:00:00.000Z');
    cookie = await loginCookie();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAdminSessionsForTests();
  });

  describe('retention default (no policy configured)', () => {
    it('purgeExpiredData deletes nothing no matter how old the data is', async () => {
      const { id } = await insertStudent({ first: 'Ancient', last: 'Record' });
      await insertClosedSession(id, '2019-01-01T10:00:00.000Z', '2019-01-01T10:30:00.000Z');
      await recordAuditEvent({
        actorType: 'system',
        actorId: 'kiosk',
        action: 'create',
        entityType: 'session',
        entityId: '1',
        occurredAt: '2019-01-01T10:00:00.000Z',
      });

      const result = await purgeExpiredData();

      expect(result.policies_applied).toBe(0);
      expect(result.deleted).toEqual({});
      expect((await all('SELECT id FROM sessions')).length).toBe(1);
      expect((await auditRows()).length).toBe(1);
    });

    it('POST /api/admin/privacy/purge-expired refuses to run without a policy', async () => {
      const { id } = await insertStudent({ first: 'Old', last: 'Session' });
      await insertClosedSession(id, '2019-01-01T10:00:00.000Z', '2019-01-01T10:30:00.000Z');

      const res = await request(app)
        .post('/api/admin/privacy/purge-expired')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no retention policy/i);
      expect((await all('SELECT id FROM sessions')).length).toBe(1);
    });
  });

  describe('retention with an explicit policy', () => {
    it('setting a policy requires confirm: true', async () => {
      const res = await request(app)
        .put('/api/admin/privacy/retention')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP)
        .send({ table: 'sessions', retain_days: 30 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/confirm/i);
    });

    it('purges only records older than the window, and logs the purge', async () => {
      const { id } = await insertStudent({ first: 'Windowed', last: 'Purge' });
      await insertClosedSession(id, '2020-01-01T10:00:00.000Z', '2020-01-01T10:30:00.000Z');
      await insertClosedSession(id, '2026-07-29T10:00:00.000Z', '2026-07-29T10:30:00.000Z');

      await setRetentionPolicy('sessions', 30);
      const result = await purgeExpiredData({
        nowMs: new Date('2026-07-30T00:00:00.000Z').getTime(),
      });

      expect(result.policies_applied).toBe(1);
      expect(result.deleted.sessions).toBe(1);

      const remaining = await all('SELECT check_in_time FROM sessions');
      expect(remaining.length).toBe(1);
      expect(remaining[0].check_in_time).toBe('2026-07-29T10:00:00.000Z');

      const purgeLog = await auditRows({ actor_id: 'retention', action: 'delete' });
      expect(purgeLog.length).toBe(1);
      expect(purgeLog[0].entity_type).toBe('sessions');
    });

    it('never deletes open sessions regardless of age', async () => {
      const { id } = await insertStudent({ first: 'Still', last: 'Here' });
      await db
        .prepare(`INSERT INTO sessions (student_id, check_in_time) VALUES (?, ?)`)
        .run(id, '2020-01-01T10:00:00.000Z');

      await setRetentionPolicy('sessions', 30);
      const result = await purgeExpiredData();

      expect(result.deleted.sessions).toBe(0);
      expect((await all('SELECT id FROM sessions')).length).toBe(1);
    });
  });

  describe('audit trail on write endpoints', () => {
    it('captures staff student create/update with actor and timestamp', async () => {
      const create = await request(app)
        .post('/api/students')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP)
        .send({ first_name: 'Audit', last_name: 'Trail' });
      expect(create.status).toBe(201);

      const patch = await request(app)
        .patch(`/api/students/${create.body.id}`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP)
        .send({ enrolled_subjects: 'math' });
      expect(patch.status).toBe(200);

      // res.on('finish') fires after the response is sent; give the async
      // audit insert a moment to land.
      await vi.waitFor(
        async () => {
          const rows = await auditRows({ entity_type: 'student' });
          expect(rows.length).toBe(2);
        },
        { timeout: 5000 }
      );

      const rows = await auditRows({ entity_type: 'student' });
      expect(rows[0]).toMatchObject({
        actor_type: 'staff',
        actor_id: 'admin',
        action: 'create',
        entity_id: String(create.body.id),
      });
      expect(rows[1]).toMatchObject({
        actor_type: 'staff',
        action: 'update',
        entity_id: String(create.body.id),
      });
      expect(rows[0].occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('captures session writes from check-in/check-out', async () => {
      const { id } = await insertStudent({ first: 'Session', last: 'Writes' });

      const checkIn = await request(app)
        .post('/api/check-in')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP)
        .send({ student_id: id, subjects: 'math' });
      expect(checkIn.status).toBe(201);

      stubTimeApi('2026-07-30T19:30:00.000Z');
      const checkOut = await request(app)
        .post('/api/check-out')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP)
        .send({ student_id: id });
      expect(checkOut.status).toBe(200);

      await vi.waitFor(
        async () => {
          const rows = await auditRows({ entity_type: 'session' });
          expect(rows.length).toBe(2);
        },
        { timeout: 5000 }
      );

      const rows = await auditRows({ entity_type: 'session' });
      expect(rows.map((r) => r.action)).toEqual(['create', 'update']);
      expect(rows[0].entity_id).toBe(String(checkIn.body.session.id));
    });

    it('attributes kiosk registration to a system actor', async () => {
      const res = await request(app)
        .post('/api/register')
        .set('X-Forwarded-For', '203.0.113.77')
        .send({ first_name: 'Kiosk', last_name: 'Signup' });
      expect(res.status).toBe(201);

      await vi.waitFor(
        async () => {
          const rows = await auditRows({ action: 'create' });
          expect(rows.length).toBe(1);
        },
        { timeout: 5000 }
      );

      const [row] = await auditRows({ action: 'create' });
      expect(row.actor_type).toBe('system');
      expect(row.actor_id).toBe('kiosk');
      expect(row.entity_id).toBe(String(res.body.student_id));
    });

    it('GET /api/admin/audit-log filters by entity and requires auth', async () => {
      const { id } = await insertStudent({ first: 'Query', last: 'Me' });
      await recordAuditEvent({
        actorType: 'staff',
        actorId: 'admin',
        action: 'update',
        entityType: 'student',
        entityId: id,
      });
      await recordAuditEvent({
        actorType: 'system',
        actorId: 'kiosk',
        action: 'create',
        entityType: 'session',
        entityId: '999',
      });

      const unauthed = await request(app)
        .get('/api/admin/audit-log')
        .set('X-Forwarded-For', STAFF_IP);
      expect(unauthed.status).toBe(401);

      const res = await request(app)
        .get(`/api/admin/audit-log?entity_type=student&entity_id=${id}`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.entries[0]).toMatchObject({
        entity_type: 'student',
        entity_id: String(id),
        action: 'update',
      });
    });
  });

  describe('per-student export', () => {
    it('includes data from every table that references the student', async () => {
      const { id } = await insertStudent({ first: 'Export', last: 'Target' });
      await insertClosedSession(id, '2026-07-01T10:00:00.000Z', '2026-07-01T10:30:00.000Z');

      const referencingTables = (
        await all(
          `SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'student_id'`
        )
      ).map((r) => r.table_name);
      expect(referencingTables).toContain('sessions');

      const res = await request(app)
        .get(`/api/admin/privacy/export-student-data/${id}`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP);

      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(id);
      // Dynamic discipline: the export must cover every referencing table
      // that exists in this checkout, whatever set that happens to be.
      for (const table of referencingTables) {
        expect(res.body.tables).toHaveProperty(table);
      }
      expect(res.body.tables.sessions.length).toBe(1);
      expect(res.body.tables.sessions[0].student_id).toBe(id);

      const exportLog = await auditRows({ action: 'export' });
      expect(exportLog.length).toBe(1);
      expect(exportLog[0]).toMatchObject({
        actor_type: 'staff',
        entity_type: 'student',
        entity_id: String(id),
      });
    });
  });

  describe('hard delete (purge)', () => {
    it('requires the re-typed full name and deletes nothing on mismatch', async () => {
      const { id } = await insertStudent({ first: 'Keep', last: 'Safe' });

      const res = await request(app)
        .delete(`/api/admin/students/${id}/purge`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP)
        .send({ confirm_name: 'Wrong Name' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/confirm_name/i);
      expect(await get('SELECT id FROM students WHERE id = ?', [id])).toBeTruthy();
      expect((await auditRows({ action: 'delete' })).length).toBe(0);
    });

    it('deletes the student and all referencing rows, logging before execution', async () => {
      const { id } = await insertStudent({ first: 'Gone', last: 'Forever' });
      await insertClosedSession(id, '2026-07-01T10:00:00.000Z', '2026-07-01T10:30:00.000Z');

      const res = await request(app)
        .delete(`/api/admin/students/${id}/purge`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP)
        .send({ confirm_name: 'gone forever' }); // case-insensitive match

      expect(res.status).toBe(200);
      expect(res.body.deleted.students).toBe(1);
      expect(res.body.deleted.sessions).toBe(1);

      expect(await get('SELECT id FROM students WHERE id = ?', [id])).toBeUndefined();
      expect(
        await get('SELECT id FROM sessions WHERE student_id = ?', [id])
      ).toBeUndefined();

      // The deletion survives in the trail even though the data is gone.
      const deleteLog = await auditRows({ action: 'delete', entity_type: 'student' });
      expect(deleteLog.length).toBe(1);
      expect(deleteLog[0].entity_id).toBe(String(id));
    });
  });

  describe('contact consent flag', () => {
    it('defaults to 0, toggles via the consent endpoint, and is audited', async () => {
      const { id } = await insertStudent({ first: 'Consent', last: 'Flag' });

      const before = await get(
        'SELECT contact_consent_on_file FROM students WHERE id = ?',
        [id]
      );
      expect(before.contact_consent_on_file).toBe(0);

      const res = await request(app)
        .patch(`/api/admin/students/${id}/consent`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', STAFF_IP)
        .send({ contact_consent_on_file: true });

      expect(res.status).toBe(200);
      const after = await get(
        'SELECT contact_consent_on_file FROM students WHERE id = ?',
        [id]
      );
      expect(after.contact_consent_on_file).toBe(1);

      const rows = await auditRows({ action: 'update', entity_type: 'student' });
      expect(rows.length).toBe(1);
      expect(rows[0].entity_id).toBe(String(id));
    });
  });
});
