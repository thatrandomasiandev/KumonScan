import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests, parseAdminSession } from '../middleware/auth.js';
import {
  createTestCenter,
  defaultCenter,
  insertStudent,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

function randomIp() {
  return `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
}

async function createStaffWithLogin(cookie, { first = 'Staff', last = 'Member', permission_role } = {}) {
  const create = await request(app)
    .post('/api/staff')
    .set('Cookie', cookie)
    .send({ first_name: first, last_name: last });
  const staffId = create.body.id;

  if (permission_role) {
    await request(app)
      .patch(`/api/staff/${staffId}`)
      .set('Cookie', cookie)
      .send({ permission_role });
  }

  const email = `${first}.${last}.${staffId}@example.com`.toLowerCase();
  const loginRes = await request(app)
    .post(`/api/staff/${staffId}/login`)
    .set('Cookie', cookie)
    .send({ email });

  return { staffId, email, tempPassword: loginRes.body.temp_password };
}

async function staffLoginCookie(email, password) {
  const res = await request(app)
    .post('/api/auth/staff-login')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`staff login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.headers['set-cookie'];
}

describe('per-staff accounts', () => {
  let managerCookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    managerCookie = await loginCookie();
  });

  it('creates a login and signs in with email + password', async () => {
    const { email, tempPassword } = await createStaffWithLogin(managerCookie);
    const cookie = await staffLoginCookie(email, tempPassword);
    expect(cookie).toBeTruthy();

    const status = await request(app).get('/api/auth/status').set('Cookie', cookie);
    expect(status.body.authenticated).toBe(true);
    expect(status.body.staff.email).toBe(email);
    expect(status.body.staff.must_change_password).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const { email } = await createStaffWithLogin(managerCookie);
    const res = await request(app)
      .post('/api/auth/staff-login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password: 'totally-wrong' });
    expect(res.status).toBe(401);
  });

  it('front_desk role is rejected from manager-only routes', async () => {
    const { email, tempPassword } = await createStaffWithLogin(managerCookie, {
      permission_role: 'front_desk',
    });
    const cookie = await staffLoginCookie(email, tempPassword);

    const roster = await request(app)
      .post('/api/admin/roster-import')
      .set('Cookie', cookie)
      .send({ filename: 'r.csv', content: 'First Name,Last Name\nA,B' });
    expect(roster.status).toBe(403);

    const createStaff = await request(app)
      .post('/api/staff')
      .set('Cookie', cookie)
      .send({ first_name: 'New', last_name: 'Hire' });
    expect(createStaff.status).toBe(403);

    const capacity = await request(app)
      .put('/api/admin/capacity')
      .set('Cookie', cookie)
      .send({ capacity: { Mon: 5 } });
    expect(capacity.status).toBe(403);

    const fullExport = await request(app).get('/api/export/full').set('Cookie', cookie);
    expect(fullExport.status).toBe(403);

    const payroll = await request(app).get('/api/reports/payroll').set('Cookie', cookie);
    expect(payroll.status).toBe(403);
  });

  it('manager role is allowed on manager-only routes', async () => {
    const { email, tempPassword } = await createStaffWithLogin(managerCookie, {
      permission_role: 'manager',
    });
    const cookie = await staffLoginCookie(email, tempPassword);

    const roster = await request(app)
      .post('/api/admin/roster-import')
      .set('Cookie', cookie)
      .send({ filename: 'r.csv', content: 'First Name,Last Name\nA,B' });
    expect(roster.status).toBe(200);

    const payroll = await request(app).get('/api/reports/payroll').set('Cookie', cookie);
    expect(payroll.status).toBe(200);
  });

  it('front_desk role is allowed on ordinary operational routes', async () => {
    const { email, tempPassword } = await createStaffWithLogin(managerCookie, {
      permission_role: 'front_desk',
    });
    const cookie = await staffLoginCookie(email, tempPassword);

    const students = await request(app).get('/api/students').set('Cookie', cookie);
    expect(students.status).toBe(200);

    const present = await request(app).get('/api/present').set('Cookie', cookie);
    expect(present.status).toBe(200);

    const { id } = await insertStudent(center.id, { first: 'Check', last: 'In' });
    const checkIn = await request(app)
      .post('/api/check-in')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.90')
      .send({ student_id: id, subjects: 'math' });
    expect(checkIn.status).toBe(201);
  });

  it('the shared center password session is always manager-equivalent', async () => {
    const roster = await request(app)
      .post('/api/admin/roster-import')
      .set('Cookie', managerCookie)
      .send({ filename: 'r.csv', content: 'First Name,Last Name\nA,B' });
    expect(roster.status).toBe(200);
  });

  it('forced first-login password change clears must_change_password', async () => {
    const { email, tempPassword } = await createStaffWithLogin(managerCookie);
    const cookie = await staffLoginCookie(email, tempPassword);

    const change = await request(app)
      .post('/api/auth/staff-change-password')
      .set('Cookie', cookie)
      .send({ new_password: 'a-real-password-123' });
    expect(change.status).toBe(200);

    const status = await request(app).get('/api/auth/status').set('Cookie', cookie);
    expect(status.body.staff.must_change_password).toBe(false);

    // Old temp password no longer works; the new one does.
    const oldLogin = await request(app)
      .post('/api/auth/staff-login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password: tempPassword });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/staff-login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password: 'a-real-password-123' });
    expect(newLogin.status).toBe(200);
  });

  it('a voluntary password change requires the current password', async () => {
    const { email, tempPassword } = await createStaffWithLogin(managerCookie);
    const cookie = await staffLoginCookie(email, tempPassword);
    await request(app)
      .post('/api/auth/staff-change-password')
      .set('Cookie', cookie)
      .send({ new_password: 'first-real-password' });

    const wrongCurrent = await request(app)
      .post('/api/auth/staff-change-password')
      .set('Cookie', cookie)
      .send({ current_password: 'nope', new_password: 'second-real-password' });
    expect(wrongCurrent.status).toBe(401);

    const rightCurrent = await request(app)
      .post('/api/auth/staff-change-password')
      .set('Cookie', cookie)
      .send({ current_password: 'first-real-password', new_password: 'second-real-password' });
    expect(rightCurrent.status).toBe(200);
  });

  it('reset-password issues a new temp password and invalidates the old one', async () => {
    const { staffId, email, tempPassword } = await createStaffWithLogin(managerCookie);
    const reset = await request(app)
      .post(`/api/staff/${staffId}/reset-password`)
      .set('Cookie', managerCookie);
    expect(reset.status).toBe(200);
    expect(reset.body.temp_password).toBeTruthy();
    expect(reset.body.temp_password).not.toBe(tempPassword);

    const oldLogin = await request(app)
      .post('/api/auth/staff-login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password: tempPassword });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/staff-login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password: reset.body.temp_password });
    expect(newLogin.status).toBe(200);
  });

  it('a staff session for center A cannot authenticate against center B', async () => {
    const { email, tempPassword } = await createStaffWithLogin(managerCookie);
    const cookieA = await staffLoginCookie(email, tempPassword);

    const centerB = await createTestCenter({ slug: `staff-isolation-${Date.now()}` });
    const res = await request(app)
      .get(`/api/c/${centerB.slug}/students`)
      .set('Cookie', cookieA);
    expect(res.status).toBe(401);
  });

  it('deactivated staff cannot log in even with the right password', async () => {
    const { staffId, email, tempPassword } = await createStaffWithLogin(managerCookie);
    await request(app).patch(`/api/staff/${staffId}`).set('Cookie', managerCookie).send({ active: 0 });

    const res = await request(app)
      .post('/api/auth/staff-login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password: tempPassword });
    expect(res.status).toBe(401);
  });

  it('parseAdminSession rejects a tampered role segment', async () => {
    const { email, tempPassword } = await createStaffWithLogin(managerCookie, {
      permission_role: 'front_desk',
    });
    const cookie = await staffLoginCookie(email, tempPassword);
    const raw = cookie[0].split(';')[0].split('=')[1];
    const parts = raw.split('.');
    parts[3] = 'manager'; // attempt to escalate role without a valid signature
    const tampered = parts.join('.');

    expect(parseAdminSession(decodeURIComponent(raw))).toBeTruthy();
    expect(parseAdminSession(tampered)).toBeNull();
  });

  it('session correction records the editing staff member', async () => {
    const { email, tempPassword } = await createStaffWithLogin(managerCookie, {
      permission_role: 'manager',
    });
    const cookie = await staffLoginCookie(email, tempPassword);
    const staffRow = await db
      .prepare(`SELECT id FROM staff WHERE center_id = ? AND LOWER(email) = ?`)
      .get(center.id, email);

    const realFetch = globalThis.fetch;
    const { id: studentId } = await insertStudent(center.id, { first: 'Edit', last: 'Trail' });
    let currentIso = '2026-07-30T19:00:00.000Z';
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('timeapi.io')) {
        return { ok: true, json: async () => ({ dateTime: currentIso }) };
      }
      return realFetch(url, options);
    };
    try {
      await request(app)
        .post('/api/check-in')
        .set('Cookie', managerCookie)
        .set('X-Forwarded-For', '198.51.100.91')
        .send({ student_id: studentId, subjects: 'math' });
      const checkoutRes = await request(app)
        .post('/api/check-out')
        .set('Cookie', managerCookie)
        .set('X-Forwarded-For', '198.51.100.91')
        .send({ student_id: studentId });
      const sessionId = checkoutRes.body.session.id;

      currentIso = '2026-07-30T19:30:00.000Z';
      const correction = await request(app)
        .patch(`/api/students/${studentId}/sessions/${sessionId}`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', '198.51.100.91')
        .send({
          check_in_time: '2026-07-30T19:05:00.000Z',
          check_out_time: '2026-07-30T19:20:00.000Z',
        });
      expect(correction.status).toBe(200);

      const row = await db.prepare('SELECT edited_by_staff_id FROM sessions WHERE id = ?').get(sessionId);
      expect(row.edited_by_staff_id).toBe(staffRow.id);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
