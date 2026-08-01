import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import {
  defaultCenter,
  insertStudent,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

const realFetch = globalThis.fetch;

function stubTimeApi(iso = '2026-07-30T19:00:00.000Z') {
  vi.stubGlobal('fetch', async (url, options) => {
    if (String(url).includes('timeapi.io')) {
      return {
        ok: true,
        json: async () => ({ dateTime: iso }),
      };
    }
    return realFetch(url, options);
  });
}

describe('API integration', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    stubTimeApi('2026-07-30T19:00:00.000Z');
    cookie = await loginCookie();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAdminSessionsForTests();
  });

  it('check-in → check-out round trip produces correct duration_minutes', async () => {
    const { id } = await insertStudent(center.id, {
      first: 'Round',
      last: 'Trip',
      subjects: 'math',
    });

    const checkIn = await request(app)
      .post('/api/check-in')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ student_id: id, subjects: 'math' });
    expect(checkIn.status).toBe(201);

    stubTimeApi('2026-07-30T19:25:00.000Z');

    const checkOut = await request(app)
      .post('/api/check-out')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ student_id: id });
    expect(checkOut.status).toBe(200);
    expect(checkOut.body.session.duration_minutes).toBe(25);
  });

  it('duplicate check-in returns 409', async () => {
    const { id } = await insertStudent(center.id, {
      first: 'Already',
      last: 'In',
      subjects: 'both',
    });

    const first = await request(app)
      .post('/api/check-in')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ student_id: id, subjects: 'both' });
    expect(first.status).toBe(201);

    const dup = await request(app)
      .post('/api/check-in')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ student_id: id, subjects: 'both' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already checked in/i);
  });

  it('/api/absent excludes already-checked-in and no-schedule students', async () => {
    // 2026-07-30 is a Thursday in America/Los_Angeles.
    const scheduled = await insertStudent(center.id, {
      first: 'Expected',
      last: 'Absent',
      days: JSON.stringify(['Thu']),
    });
    const checkedIn = await insertStudent(center.id, {
      first: 'Expected',
      last: 'Present',
      days: JSON.stringify(['Thu']),
    });
    await insertStudent(center.id, {
      first: 'No',
      last: 'Schedule',
      days: null,
    });

    await request(app)
      .post('/api/check-in')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ student_id: checkedIn.id, subjects: 'math' });

    const res = await request(app)
      .get('/api/absent?date=2026-07-30')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.20');

    expect(res.status).toBe(200);
    expect(res.body.weekday).toBe('Thu');
    const ids = res.body.students.map((s) => s.id);
    expect(ids).toContain(scheduled.id);
    expect(ids).not.toContain(checkedIn.id);
    expect(res.body.students.every((s) => s.last_name !== 'Schedule')).toBe(true);
  });
});
