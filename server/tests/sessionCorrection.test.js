import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

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

describe('session time correction', () => {
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

  async function checkInAndOut(studentId) {
    await request(app)
      .post('/api/check-in')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.21')
      .send({ student_id: studentId, subjects: 'math' });

    stubTimeApi('2026-07-30T19:25:00.000Z');

    const checkOut = await request(app)
      .post('/api/check-out')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.21')
      .send({ student_id: studentId });

    return checkOut.body.session;
  }

  it('corrects a completed session and recomputes duration', async () => {
    const { id } = await insertStudent(center.id, { first: 'Correct', last: 'Me' });
    const session = await checkInAndOut(id);
    expect(session.duration_minutes).toBe(25);

    const res = await request(app)
      .patch(`/api/students/${id}/sessions/${session.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.21')
      .send({
        check_in_time: '2026-07-30T19:05:00.000Z',
        check_out_time: '2026-07-30T19:20:00.000Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.check_in_time).toBe('2026-07-30T19:05:00.000Z');
    expect(res.body.check_out_time).toBe('2026-07-30T19:20:00.000Z');
    expect(res.body.duration_minutes).toBe(15);
  });

  it('rejects check_out_time before check_in_time', async () => {
    const { id } = await insertStudent(center.id, { first: 'Bad', last: 'Order' });
    const session = await checkInAndOut(id);

    const res = await request(app)
      .patch(`/api/students/${id}/sessions/${session.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.21')
      .send({
        check_in_time: '2026-07-30T19:20:00.000Z',
        check_out_time: '2026-07-30T19:05:00.000Z',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after check_in_time/i);
  });

  it('rejects a check_in_time in the future', async () => {
    const { id } = await insertStudent(center.id, { first: 'Future', last: 'Time' });
    const session = await checkInAndOut(id);

    const res = await request(app)
      .patch(`/api/students/${id}/sessions/${session.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.21')
      .send({
        check_in_time: '2026-07-30T20:00:00.000Z',
        check_out_time: '2026-07-30T20:10:00.000Z',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/i);
  });

  it('allows correcting only the check-in time on a still-open session', async () => {
    const { id } = await insertStudent(center.id, { first: 'Still', last: 'Open' });
    await request(app)
      .post('/api/check-in')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.21')
      .send({ student_id: id, subjects: 'math' });

    const list = await request(app)
      .get(`/api/students/${id}/sessions`)
      .set('Cookie', cookie);
    const openSession = list.body.sessions[0];

    const res = await request(app)
      .patch(`/api/students/${id}/sessions/${openSession.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.21')
      .send({ check_in_time: '2026-07-30T18:50:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body.check_in_time).toBe('2026-07-30T18:50:00.000Z');
    expect(res.body.check_out_time).toBeNull();
  });

  it('404s for a session belonging to a different student', async () => {
    const a = await insertStudent(center.id, { first: 'Student', last: 'A' });
    const b = await insertStudent(center.id, { first: 'Student', last: 'B' });
    const session = await checkInAndOut(a.id);

    const res = await request(app)
      .patch(`/api/students/${b.id}/sessions/${session.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.21')
      .send({ check_in_time: '2026-07-30T19:05:00.000Z' });

    expect(res.status).toBe(404);
  });

  it('requires admin auth', async () => {
    const { id } = await insertStudent(center.id, { first: 'No', last: 'Auth' });
    const session = await checkInAndOut(id);

    const res = await request(app)
      .patch(`/api/students/${id}/sessions/${session.id}`)
      .send({ check_in_time: '2026-07-30T19:05:00.000Z' });

    expect(res.status).toBe(401);
  });
});
