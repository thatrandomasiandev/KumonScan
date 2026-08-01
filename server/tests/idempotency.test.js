import { randomUUID } from 'node:crypto';
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

describe('idempotency keys on desk check-in/check-out', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    await db
      .prepare('DELETE FROM idempotency_keys WHERE center_id = ?')
      .run(center.id);
    stubTimeApi('2026-07-30T19:00:00.000Z');
    cookie = await loginCookie();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAdminSessionsForTests();
  });

  function checkIn(studentId, key) {
    const req = request(app)
      .post('/api/check-in')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.20');
    if (key) req.set('Idempotency-Key', key);
    return req.send({ student_id: studentId, subjects: 'math' });
  }

  function checkOut(body, key) {
    const req = request(app)
      .post('/api/check-out')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.20');
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  }

  async function openSessionCount(studentId) {
    const row = await db
      .prepare(
        'SELECT COUNT(*) AS count FROM sessions WHERE student_id = ? AND check_out_time IS NULL'
      )
      .get(studentId);
    return row.count;
  }

  it('same key sent twice creates exactly one session and returns the identical response', async () => {
    const { id } = await insertStudent(center.id, { first: 'Replay', last: 'Once', subjects: 'math' });
    const key = randomUUID();

    const first = await checkIn(id, key);
    expect(first.status).toBe(201);
    expect(first.body.action).toBe('checked_in');

    const replay = await checkIn(id, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    expect(await openSessionCount(id)).toBe(1);
  });

  it('replay after a lost response syncs exactly once (queue reconnect simulation)', async () => {
    // Offline mid check-in: the queued action's key is generated at creation
    // time, the send never reaches the server, and the same key is replayed
    // on reconnect. First delivery executes; every later delivery (client
    // crashed before recording the ack, double flush, etc.) replays the
    // stored response without a second execution.
    const { id } = await insertStudent(center.id, { first: 'Queued', last: 'Offline', subjects: 'math' });
    const key = randomUUID();

    const delivered = await checkIn(id, key);
    expect(delivered.status).toBe(201);

    const redelivered = await checkIn(id, key);
    expect(redelivered.status).toBe(201);
    expect(redelivered.headers['idempotency-replayed']).toBe('true');
    expect(redelivered.body).toEqual(delivered.body);

    const totalSessions = await db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE student_id = ?')
      .get(id);
    expect(totalSessions.count).toBe(1);
    expect(await openSessionCount(id)).toBe(1);
  });

  it('a genuinely different duplicate check-in (new key, same student) is still rejected with 409', async () => {
    const { id } = await insertStudent(center.id, { first: 'Still', last: 'Guarded', subjects: 'math' });

    const first = await checkIn(id, randomUUID());
    expect(first.status).toBe(201);

    const duplicate = await checkIn(id, randomUUID());
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers['idempotency-replayed']).toBeUndefined();
    expect(duplicate.body.error).toMatch(/already checked in/i);
    expect(await openSessionCount(id)).toBe(1);
  });

  it('stores deterministic 4xx responses so their replays do not re-execute either', async () => {
    const { id } = await insertStudent(center.id, { first: 'Conflict', last: 'Stored', subjects: 'math' });
    await checkIn(id, randomUUID());

    const dupKey = randomUUID();
    const rejected = await checkIn(id, dupKey);
    expect(rejected.status).toBe(409);

    const replayedRejection = await checkIn(id, dupKey);
    expect(replayedRejection.status).toBe(409);
    expect(replayedRejection.headers['idempotency-replayed']).toBe('true');
    expect(replayedRejection.body).toEqual(rejected.body);
  });

  it('check-out with the same key completes once and replays the identical response', async () => {
    const { id } = await insertStudent(center.id, { first: 'Out', last: 'Once', subjects: 'math' });
    const checkedIn = await checkIn(id, randomUUID());
    const sessionId = checkedIn.body.session.id;

    stubTimeApi('2026-07-30T19:25:00.000Z');
    const key = randomUUID();

    const first = await checkOut({ session_id: sessionId }, key);
    expect(first.status).toBe(200);
    expect(first.body.session.duration_minutes).toBe(25);

    const replay = await checkOut({ session_id: sessionId }, key);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    // Without the key the session is genuinely closed: a fresh attempt 404s.
    const fresh = await checkOut({ session_id: sessionId }, randomUUID());
    expect(fresh.status).toBe(404);
  });

  it('requests without the header behave exactly as before', async () => {
    const { id } = await insertStudent(center.id, { first: 'No', last: 'Header', subjects: 'math' });

    const first = await checkIn(id);
    expect(first.status).toBe(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const dup = await checkIn(id);
    expect(dup.status).toBe(409);

    const stored = await db
      .prepare('SELECT COUNT(*) AS count FROM idempotency_keys WHERE center_id = ?')
      .get(center.id);
    expect(stored.count).toBe(0);
  });

  it('rejects malformed keys with 400 before executing anything', async () => {
    const { id } = await insertStudent(center.id, { first: 'Bad', last: 'Key', subjects: 'math' });

    const res = await checkIn(id, 'short');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Idempotency-Key/);
    expect(await openSessionCount(id)).toBe(0);
  });
});
