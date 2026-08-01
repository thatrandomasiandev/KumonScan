import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { enrichOpenSession, sessionTiming } from '../sessionRules.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

const realFetch = globalThis.fetch;
const TEST_IP = '198.51.100.44';

function stubTimeApi(iso) {
  vi.stubGlobal('fetch', async (url, options) => {
    if (String(url).includes('timeapi.io')) {
      return {
        ok: true,
        json: async () => ({ dateTime: iso }),
      };
    }
    // Anything else (the Neon HTTP driver) goes to the real network.
    return realFetch(url, options);
  });
}

function checkIn(cookie, body) {
  return request(app)
    .post('/api/check-in')
    .set('Cookie', cookie)
    .set('X-Forwarded-For', TEST_IP)
    .send(body);
}

function checkOut(cookie, body) {
  return request(app)
    .post('/api/check-out')
    .set('Cookie', cookie)
    .set('X-Forwarded-For', TEST_IP)
    .send(body);
}

describe('remote attendance', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    stubTimeApi('2026-07-30T19:00:00.000Z');
    // First request runs ensureRemoteAttendanceSchema before cleanup queries
    // touch the mode column / zoom_meetings table.
    cookie = await loginCookie();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAdminSessionsForTests();
  });

  describe('mode does not affect timing math (sessionRules parity)', () => {
    // Same boundary cases as sessionRules.test.js, run against rows that
    // carry mode='remote': identical results, since timing ignores mode.
    it('sessionTiming boundaries are identical for a remote row', () => {
      const checkInTime = '2026-07-30T10:00:00.000Z';
      const checkInMs = Date.parse(checkInTime);
      const allowance = 30;

      const atAllowance = sessionTiming(checkInTime, allowance, checkInMs + 30 * 60_000);
      expect(atAllowance.is_overtime).toBe(false);
      expect(atAllowance.overtime_minutes).toBe(0);

      const remoteRow = {
        check_in_time: checkInTime,
        subjects: 'math',
        allowance_minutes: allowance,
        mode: 'remote',
      };
      const inPersonRow = { ...remoteRow, mode: 'in_person' };

      for (const offsetMinutes of [29, 30, 31]) {
        const nowMs = checkInMs + offsetMinutes * 60_000;
        const remote = enrichOpenSession(remoteRow, nowMs);
        const inPerson = enrichOpenSession(inPersonRow, nowMs);

        expect(remote.elapsed_minutes).toBe(inPerson.elapsed_minutes);
        expect(remote.is_overtime).toBe(inPerson.is_overtime);
        expect(remote.overtime_minutes).toBe(inPerson.overtime_minutes);
        expect(remote.is_overtime).toBe(offsetMinutes > allowance);
      }
    });
  });

  describe('POST /check-in with mode', () => {
    it('defaults to in_person when mode is omitted (existing behavior preserved)', async () => {
      const student = await insertStudent(center.id, {
        first: 'Default',
        last: 'Mode',
        subjects: 'math',
      });

      const res = await checkIn(cookie, { student_id: student.id, subjects: 'math' });
      expect(res.status).toBe(201);
      expect(res.body.session.mode).toBe('in_person');
      expect(res.body.session.zoom_meeting_id).toBeNull();
    });

    it("creates a remote session for mode='remote'", async () => {
      const student = await insertStudent(center.id, {
        first: 'Zoom',
        last: 'Kid',
        subjects: 'both',
      });

      const res = await checkIn(cookie, { student_id: student.id, subjects: 'both', mode: 'remote' });
      expect(res.status).toBe(201);
      expect(res.body.action).toBe('checked_in');
      expect(res.body.session.mode).toBe('remote');
      expect(res.body.session.zoom_meeting_id).toBeNull();
      // Same allowance rules as in-person.
      expect(res.body.session.allowance_minutes).toBe(60);
    });

    it('rejects unknown modes with 400', async () => {
      const student = await insertStudent(center.id, { first: 'Bad', last: 'Mode' });

      const res = await checkIn(cookie, { student_id: student.id, subjects: 'both', mode: 'zoom' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mode/i);
    });

    it('rejects a duplicate remote check-in with 409', async () => {
      const student = await insertStudent(center.id, {
        first: 'Twice',
        last: 'Remote',
        subjects: 'math',
      });

      const first = await checkIn(cookie, { student_id: student.id, subjects: 'math', mode: 'remote' });
      expect(first.status).toBe(201);

      const dup = await checkIn(cookie, { student_id: student.id, subjects: 'math', mode: 'remote' });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toMatch(/already checked in/i);
    });

    it('remote and in-person sessions produce identical overtime math end to end', async () => {
      const remote = await insertStudent(center.id, {
        first: 'Remote',
        last: 'Parity',
        subjects: 'math',
      });
      const inPerson = await insertStudent(center.id, {
        first: 'InPerson',
        last: 'Parity',
        subjects: 'math',
      });

      stubTimeApi('2026-07-30T19:00:00.000Z');
      expect(
        (await checkIn(cookie, { student_id: remote.id, subjects: 'math', mode: 'remote' })).status
      ).toBe(201);
      expect(
        (await checkIn(cookie, { student_id: inPerson.id, subjects: 'math' })).status
      ).toBe(201);

      // 31 minutes on a 30-minute (single subject) allowance: 1 minute over.
      stubTimeApi('2026-07-30T19:31:00.000Z');
      const remoteOut = await checkOut(cookie, { student_id: remote.id });
      const inPersonOut = await checkOut(cookie, { student_id: inPerson.id });

      expect(remoteOut.status).toBe(200);
      expect(inPersonOut.status).toBe(200);
      expect(remoteOut.body.session.mode).toBe('remote');
      expect(inPersonOut.body.session.mode).toBe('in_person');

      expect(remoteOut.body.session.duration_minutes).toBe(31);
      expect(remoteOut.body.session.duration_minutes).toBe(
        inPersonOut.body.session.duration_minutes
      );
      expect(remoteOut.body.session.is_overtime).toBe(true);
      expect(remoteOut.body.session.is_overtime).toBe(inPersonOut.body.session.is_overtime);
      expect(remoteOut.body.session.overtime_minutes).toBe(1);
      expect(remoteOut.body.session.overtime_minutes).toBe(
        inPersonOut.body.session.overtime_minutes
      );
    });
  });

  describe('GET /remote-attendance/open-sessions', () => {
    it('returns only open remote session ids', async () => {
      const remote = await insertStudent(center.id, { first: 'Open', last: 'Remote' });
      const inPerson = await insertStudent(center.id, { first: 'Open', last: 'InPerson' });

      const remoteRes = await checkIn(cookie, {
        student_id: remote.id,
        subjects: 'both',
        mode: 'remote',
      });
      await checkIn(cookie, { student_id: inPerson.id, subjects: 'both' });

      const res = await request(app)
        .get('/api/remote-attendance/open-sessions')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP);

      expect(res.status).toBe(200);
      expect(res.body.session_ids).toEqual([remoteRes.body.session.id]);
    });

    it('requires admin auth', async () => {
      const res = await request(app)
        .get('/api/remote-attendance/open-sessions')
        .set('X-Forwarded-For', TEST_IP);
      expect(res.status).toBe(401);
    });
  });

  describe('attendance report mode breakout', () => {
    it('counts both modes in totals and breaks out remote vs in-person', async () => {
      const remote = await insertStudent(center.id, {
        first: 'Report',
        last: 'Remote',
        subjects: 'math',
      });
      const inPerson = await insertStudent(center.id, {
        first: 'Report',
        last: 'InPerson',
        subjects: 'math',
      });

      stubTimeApi('2026-07-30T19:00:00.000Z');
      await checkIn(cookie, { student_id: remote.id, subjects: 'math', mode: 'remote' });
      await checkIn(cookie, { student_id: inPerson.id, subjects: 'math' });

      stubTimeApi('2026-07-30T19:20:00.000Z');
      await checkOut(cookie, { student_id: remote.id });
      await checkOut(cookie, { student_id: inPerson.id });

      const res = await request(app)
        .get('/api/reports/attendance?period=monthly&month=2026-07')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP);

      expect(res.status).toBe(200);
      // Existing shape intact.
      expect(res.body.summary.total_visits).toBe(2);
      expect(res.body.summary.total_minutes).toBe(40);
      expect(res.body.summary.overtime_sessions).toBe(0);
      // Additive breakout.
      expect(res.body.summary.remote_visits).toBe(1);
      expect(res.body.summary.in_person_visits).toBe(1);

      const remoteRow = res.body.students.find((s) => s.id === remote.id);
      const inPersonRow = res.body.students.find((s) => s.id === inPerson.id);
      expect(remoteRow).toMatchObject({ visits: 1, remote_visits: 1, in_person_visits: 0 });
      expect(inPersonRow).toMatchObject({ visits: 1, remote_visits: 0, in_person_visits: 1 });
    });
  });

  describe('POST /webhooks/zoom (Layer 2 stub)', () => {
    it('refuses all traffic while ZOOM_WEBHOOK_SECRET is unset and creates nothing', async () => {
      const before = (
        await db
          .prepare('SELECT COUNT(*) AS count FROM sessions WHERE center_id = ?')
          .get(center.id)
      ).count;
      const studentsBefore = (
        await db
          .prepare('SELECT COUNT(*) AS count FROM students WHERE center_id = ?')
          .get(center.id)
      ).count;

      const res = await request(app)
        .post('/api/webhooks/zoom')
        .set('X-Forwarded-For', TEST_IP)
        .send({
          event: 'meeting.participant_joined',
          payload: {
            object: {
              id: '123456789',
              participant: { user_name: 'Totally Unknown Kid' },
            },
          },
        });

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not configured/i);

      const after = (
        await db
          .prepare('SELECT COUNT(*) AS count FROM sessions WHERE center_id = ?')
          .get(center.id)
      ).count;
      const studentsAfter = (
        await db
          .prepare('SELECT COUNT(*) AS count FROM students WHERE center_id = ?')
          .get(center.id)
      ).count;
      expect(after).toBe(before);
      expect(studentsAfter).toBe(studentsBefore);
    });
  });
});
