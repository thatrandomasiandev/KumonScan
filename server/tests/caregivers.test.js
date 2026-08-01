import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db, { sqlNow } from '../db.js';
import {
  ensureCaregiverSchema,
  isPrimaryCaregiverViolation,
} from '../services/caregiverService.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  defaultCenter,
  insertStudent,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

const TEST_IP = '198.51.100.42';

/**
 * Stubs timeapi.io but passes every other request (Neon queries go over
 * fetch) through to the real implementation.
 */
function stubTimeApi(iso = '2026-07-30T19:00:00.000Z') {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (url, init) => {
    if (String(url).includes('timeapi.io')) {
      return {
        ok: true,
        json: async () => ({ dateTime: iso }),
      };
    }
    return realFetch(url, init);
  });
}

async function insertCaregiver(centerId, studentId, { name = 'Casey Caregiver', isPrimary = 0 } = {}) {
  const result = await db
    .prepare(
      `INSERT INTO caregivers (center_id, student_id, name, phone, relationship, is_primary, active, created_at)
       VALUES (?, ?, ?, NULL, 'parent', ?, 1, ?)`
    )
    .run(centerId, studentId, name, isPrimary, sqlNow());
  return result.lastInsertRowid;
}

async function checkInViaApi(cookie, studentId) {
  const res = await request(app)
    .post('/api/check-in')
    .set('Cookie', cookie)
    .set('X-Forwarded-For', TEST_IP)
    .send({ student_id: studentId, subjects: 'both' });
  expect(res.status).toBe(201);
  return res.body.session;
}

describe('caregivers & pickup authorization', () => {
  let cookie;
  let center;

  beforeAll(async () => {
    await ensureCaregiverSchema();
    center = await defaultCenter();
    cookie = await loginCookie(DEFAULT_ADMIN_PASSWORD);
  });

  beforeEach(async () => {
    await wipeCenterData(center.id);
    stubTimeApi('2026-07-30T19:00:00.000Z');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('DB partial unique index rejects a second active primary caregiver', async () => {
    const student = await insertStudent(center.id, { first: 'Pickup', last: 'Unique' });
    await insertCaregiver(center.id, student.id, { name: 'First Primary', isPrimary: 1 });

    let thrown;
    try {
      await insertCaregiver(center.id, student.id, { name: 'Second Primary', isPrimary: 1 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(isPrimaryCaregiverViolation(thrown)).toBe(true);
  });

  it('POST second primary caregiver returns 409 via the API', async () => {
    const student = await insertStudent(center.id, { first: 'Pickup', last: 'Conflict' });

    const first = await request(app)
      .post(`/api/students/${student.id}/caregivers`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ name: 'Pat Parent', relationship: 'parent', is_primary: true });
    expect(first.status).toBe(201);
    expect(first.body.is_primary).toBe(1);

    const second = await request(app)
      .post(`/api/students/${student.id}/caregivers`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ name: 'Gene Grandparent', relationship: 'grandparent', is_primary: true });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/primary caregiver/i);
  });

  it('validates caregiver fields: name required, phone shape, relationship whitelist', async () => {
    const student = await insertStudent(center.id, { first: 'Pickup', last: 'Validate' });

    const noName = await request(app)
      .post(`/api/students/${student.id}/caregivers`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ phone: '+1 213 555 0100' });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toMatch(/name is required/i);

    const badPhone = await request(app)
      .post(`/api/students/${student.id}/caregivers`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ name: 'Bad Phone', phone: 'not-a-phone' });
    expect(badPhone.status).toBe(400);

    const badRelationship = await request(app)
      .post(`/api/students/${student.id}/caregivers`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ name: 'Bad Rel', relationship: 'neighbor' });
    expect(badRelationship.status).toBe(400);

    const ok = await request(app)
      .post(`/api/students/${student.id}/caregivers`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ name: 'Sam Sitter', phone: '(213) 555-0100', relationship: 'babysitter' });
    expect(ok.status).toBe(201);
    expect(ok.body.phone).toBe('(213) 555-0100');
  });

  it('check-out with no picked_up_by still succeeds unchanged (regression)', async () => {
    const student = await insertStudent(center.id, { first: 'Pickup', last: 'Plain' });
    await checkInViaApi(cookie, student.id);

    stubTimeApi('2026-07-30T19:25:00.000Z');
    const res = await request(app)
      .post('/api/check-out')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ student_id: student.id });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('checked_out');
    expect(res.body.session.duration_minutes).toBe(25);
    expect(res.body.session.picked_up_by ?? null).toBeNull();
  });

  it("check-out with another student's caregiver is a clear 400 and leaves the session open", async () => {
    const student = await insertStudent(center.id, { first: 'Pickup', last: 'Owner' });
    const other = await insertStudent(center.id, { first: 'Other', last: 'Kid' });
    const otherCaregiverId = await insertCaregiver(center.id, other.id, { name: 'Wrong Kid' });

    await checkInViaApi(cookie, student.id);

    stubTimeApi('2026-07-30T19:25:00.000Z');
    const res = await request(app)
      .post('/api/check-out')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ student_id: student.id, picked_up_by: otherCaregiverId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not an approved caregiver for this student/i);

    const stillOpen = await db
      .prepare(
        'SELECT * FROM sessions WHERE center_id = ? AND student_id = ? AND check_out_time IS NULL'
      )
      .get(center.id, student.id);
    expect(stillOpen).toBeDefined();
  });

  it('check-out with a valid caregiver stores picked_up_by and shows in the pickup log', async () => {
    const student = await insertStudent(center.id, { first: 'Pickup', last: 'Logged' });
    const caregiverId = await insertCaregiver(center.id, student.id, {
      name: 'Grace Grandparent',
    });

    await checkInViaApi(cookie, student.id);

    stubTimeApi('2026-07-30T19:25:00.000Z');
    const checkOut = await request(app)
      .post('/api/check-out')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ student_id: student.id, picked_up_by: caregiverId });

    expect(checkOut.status).toBe(200);
    expect(checkOut.body.session.picked_up_by).toBe(caregiverId);

    const log = await request(app)
      .get('/api/reports/pickup-log?start=2026-07-30&end=2026-07-30')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP);

    expect(log.status).toBe(200);
    expect(log.body.count).toBe(1);
    expect(log.body.pickups[0].caregiver_id).toBe(caregiverId);
    expect(log.body.pickups[0].caregiver_name).toBe('Grace Grandparent');
    expect(log.body.pickups[0].student_id).toBe(student.id);
  });

  it('deactivating a caregiver hides them from selection but keeps history', async () => {
    const student = await insertStudent(center.id, { first: 'Pickup', last: 'History' });
    const caregiverId = await insertCaregiver(center.id, student.id, {
      name: 'Departing Sitter',
    });

    await checkInViaApi(cookie, student.id);
    stubTimeApi('2026-07-30T19:25:00.000Z');
    const checkOut = await request(app)
      .post('/api/check-out')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ student_id: student.id, picked_up_by: caregiverId });
    expect(checkOut.status).toBe(200);

    const deactivate = await request(app)
      .patch(`/api/students/${student.id}/caregivers/${caregiverId}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ active: false });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.active).toBe(0);

    const list = await request(app)
      .get(`/api/students/${student.id}/caregivers`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP);
    expect(list.status).toBe(200);
    expect(list.body.caregivers).toHaveLength(0);

    const session = await db
      .prepare('SELECT picked_up_by FROM sessions WHERE center_id = ? AND student_id = ?')
      .get(center.id, student.id);
    expect(session.picked_up_by).toBe(caregiverId);

    const log = await request(app)
      .get('/api/reports/pickup-log?start=2026-07-30&end=2026-07-30')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP);
    expect(log.status).toBe(200);
    expect(log.body.count).toBe(1);
    expect(log.body.pickups[0].caregiver_active).toBe(false);

    await checkInViaApi(cookie, student.id);
    stubTimeApi('2026-07-30T19:40:00.000Z');
    const rejected = await request(app)
      .post('/api/check-out')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', TEST_IP)
      .send({ student_id: student.id, picked_up_by: caregiverId });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/deactivated caregiver/i);
  });

  it('caregiver routes require staff authentication', async () => {
    const student = await insertStudent(center.id, { first: 'Pickup', last: 'Auth' });

    const list = await request(app)
      .get(`/api/students/${student.id}/caregivers`)
      .set('X-Forwarded-For', TEST_IP);
    expect(list.status).toBe(401);

    const log = await request(app)
      .get('/api/reports/pickup-log')
      .set('X-Forwarded-For', TEST_IP);
    expect(log.status).toBe(401);
  });
});
