import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import {
  createTestCenter,
  defaultCenter,
  insertStudent,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

describe('student_number assignment', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    cookie = await loginCookie();
  });

  it('POST /students assigns sequential numbers per center', async () => {
    const a = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'First', last_name: 'Kid' });
    const b = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Second', last_name: 'Kid' });

    expect(a.body.student_number).toBeTruthy();
    expect(b.body.student_number).toBe(a.body.student_number + 1);
  });

  it('POST /register assigns a student number too', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ first_name: 'Public', last_name: 'Kiosk' });

    expect(res.status).toBe(201);
    expect(res.body.student_number).toBeTruthy();
  });

  it('numbering continues after an existing max rather than restarting', async () => {
    await insertStudent(center.id, { first: 'Manual', last: 'Insert' });
    await db
      .prepare('UPDATE students SET student_number = 40 WHERE center_id = ?')
      .run(center.id);

    const res = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'New', last_name: 'Kid' });

    expect(res.body.student_number).toBe(41);
  });

  it('concurrent registrations never receive the same student number', async () => {
    const names = ['A', 'B', 'C', 'D', 'E'];
    const results = await Promise.all(
      names.map((n) =>
        request(app).post('/api/register').send({ first_name: n, last_name: 'Concurrent' })
      )
    );

    const numbers = results.map((r) => r.body.student_number);
    expect(numbers.every((n) => Number.isInteger(n))).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('two centers number independently starting at 1', async () => {
    const centerB = await createTestCenter({ slug: `numbering-b-${Date.now()}` });

    const a = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Center', last_name: 'A' });

    const cookieB = await loginCookie(undefined, centerB.slug);
    const b = await request(app)
      .post(`/api/c/${centerB.slug}/students`)
      .set('Cookie', cookieB)
      .send({ first_name: 'Center', last_name: 'B' });

    expect(a.body.student_number).toBe(1);
    expect(b.body.student_number).toBe(1);
  });
});

describe('GET /api/search — public kiosk name/number lookup', () => {
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
  });

  it('does not require auth', async () => {
    const res = await request(app).get('/api/search?q=a');
    expect(res.status).toBe(200);
  });

  it('matches by first or last name substring, case-insensitively', async () => {
    await insertStudent(center.id, { first: 'Emma', last: 'Johnson' });
    await insertStudent(center.id, { first: 'Liam', last: 'Chen' });

    const res = await request(app).get('/api/search?q=emm');
    expect(res.body.students).toHaveLength(1);
    expect(res.body.students[0].first_name).toBe('Emma');
  });

  it('matches by exact student number', async () => {
    const student = await insertStudent(center.id, { first: 'Numbered', last: 'Kid' });
    await db.prepare('UPDATE students SET student_number = 7 WHERE id = ?').run(student.id);

    const res = await request(app).get('/api/search?q=7');
    expect(res.body.students).toHaveLength(1);
    expect(res.body.students[0].id).toBe(student.id);
  });

  it('excludes inactive students', async () => {
    await insertStudent(center.id, { first: 'Gone', last: 'Student', active: 0 });

    const res = await request(app).get('/api/search?q=gone');
    expect(res.body.students).toHaveLength(0);
  });

  it('only returns kiosk-safe fields — no parent_phone or notes', async () => {
    await insertStudent(center.id, {
      first: 'Private',
      last: 'Data',
      parent_phone: '+15551234567',
    });

    const res = await request(app).get('/api/search?q=private');
    expect(res.body.students).toHaveLength(1);
    const fields = Object.keys(res.body.students[0]).sort();
    expect(fields).toEqual(['id', 'first_name', 'last_name', 'name', 'qr_code_value', 'student_number'].sort());
  });

  it('returns empty results for a blank query', async () => {
    await insertStudent(center.id, { first: 'Some', last: 'Kid' });
    const res = await request(app).get('/api/search?q=');
    expect(res.body.students).toEqual([]);
  });

  it('never returns another center\'s students', async () => {
    const centerB = await createTestCenter({ slug: `search-isolation-${Date.now()}` });
    await insertStudent(center.id, { first: 'Shared', last: 'Name' });
    await insertStudent(centerB.id, { first: 'Shared', last: 'Name' });

    const res = await request(app).get('/api/search?q=shared');
    expect(res.body.students).toHaveLength(1);

    const resB = await request(app).get(`/api/c/${centerB.slug}/search?q=shared`);
    expect(resB.body.students).toHaveLength(1);
    expect(resB.body.students[0].id).not.toBe(res.body.students[0].id);
  });
});
