import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  defaultCenter,
  insertStudent,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

function stubTimeApi(iso = '2026-07-30T19:00:00.000Z') {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (url, options) => {
    if (String(url).includes('timeapi.io')) {
      return { ok: true, json: async () => ({ dateTime: iso }) };
    }
    return realFetch(url, options);
  });
}

describe('preferred_language over the API', () => {
  let center;
  let cookie;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    stubTimeApi();
    cookie = await loginCookie(DEFAULT_ADMIN_PASSWORD);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAdminSessionsForTests();
  });

  it('register stores the parent UI language; defaults and garbage resolve to en', async () => {
    const es = await request(app)
      .post('/api/register')
      .set('X-Forwarded-For', '198.51.100.31')
      .send({ first_name: 'Valentina', last_name: 'Morales', preferred_language: 'es' });
    expect(es.status).toBe(201);
    expect(es.body.preferred_language).toBe('es');

    const noLang = await request(app)
      .post('/api/register')
      .set('X-Forwarded-For', '198.51.100.31')
      .send({ first_name: 'Noah', last_name: 'Baker' });
    expect(noLang.status).toBe(201);
    expect(noLang.body.preferred_language).toBe('en');

    const garbage = await request(app)
      .post('/api/register')
      .set('X-Forwarded-For', '198.51.100.31')
      .send({ first_name: 'Mia', last_name: 'Kim', preferred_language: 'not-a-language' });
    expect(garbage.status).toBe(201);
    expect(garbage.body.preferred_language).toBe('en');

    const stored = await db
      .prepare(
        `SELECT preferred_language FROM students WHERE last_name = ? AND center_id = ?`
      )
      .get('Morales', center.id);
    expect(stored.preferred_language).toBe('es');
  });

  it('re-registering an existing student keeps the stored preference', async () => {
    await insertStudent(center.id, {
      first: 'Diego',
      last: 'Torres',
      preferred_language: 'es',
    });
    const res = await request(app)
      .post('/api/register')
      .set('X-Forwarded-For', '198.51.100.32')
      .send({ first_name: 'Diego', last_name: 'Torres', preferred_language: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.is_new).toBe(false);
    expect(res.body.preferred_language).toBe('es');
  });

  it('admin PATCH updates preferred_language and rejects unsupported values', async () => {
    const student = await insertStudent(center.id, { first: 'Emma', last: 'Lopez' });
    expect(student.preferred_language).toBe('en');

    const ok = await request(app)
      .patch(`/api/students/${student.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30')
      .send({ preferred_language: 'es' });
    expect(ok.status).toBe(200);
    expect(ok.body.preferred_language).toBe('es');

    const bad = await request(app)
      .patch(`/api/students/${student.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30')
      .send({ preferred_language: 'klingon' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/preferred_language must be one of/);

    const unchanged = await db
      .prepare('SELECT preferred_language FROM students WHERE id = ? AND center_id = ?')
      .get(student.id, center.id);
    expect(unchanged.preferred_language).toBe('es');
  });
});
