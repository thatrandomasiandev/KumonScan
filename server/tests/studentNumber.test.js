import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { createTestCenter, defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

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
      .send({ first_name: 'Public', last_name: 'Register' });

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

  it('Desk search filter can match by student number (client-side, this asserts the field is present)', async () => {
    const res = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Findable', last_name: 'Kid' });

    const list = await request(app).get('/api/students').set('Cookie', cookie);
    const match = list.body.find((s) => s.id === res.body.id);
    expect(match.student_number).toBe(res.body.student_number);
  });
});
