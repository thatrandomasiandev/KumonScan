import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { createTestCenter, defaultCenter, loginCookie, wipeCenterData } from './helpers.js';

describe('student_number (Kumon center ID)', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    cookie = await loginCookie();
  });

  it('does not auto-assign a student number on POST /students', async () => {
    const res = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'No', last_name: 'IdYet' });

    expect(res.status).toBe(201);
    expect(res.body.student_number).toBeNull();
  });

  it('accepts an explicit Kumon student ID on create', async () => {
    const res = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Alex', last_name: 'Kim', student_number: 8401551142645 });

    expect(res.status).toBe(201);
    expect(res.body.student_number).toBe(8401551142645);
  });

  it('rejects duplicate student IDs within one center', async () => {
    await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'First', last_name: 'Kid', student_number: 9001 });

    const dup = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Second', last_name: 'Kid', student_number: 9001 });

    expect(dup.status).toBe(409);
  });

  it('allows the same Kumon ID on different centers', async () => {
    const centerB = await createTestCenter({ slug: `id-b-${Date.now()}` });
    const cookieB = await loginCookie(undefined, centerB.slug);

    const a = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Shared', last_name: 'Id', student_number: 7000 });

    const b = await request(app)
      .post(`/api/c/${centerB.slug}/students`)
      .set('Cookie', cookieB)
      .send({ first_name: 'Shared', last_name: 'Id', student_number: 7000 });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.student_number).toBe(7000);
    expect(b.body.student_number).toBe(7000);
  });

  it('POST /register does not assign a student number', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ first_name: 'Public', last_name: 'Register' });

    expect(res.status).toBe(201);
    expect(res.body.student_number).toBeNull();
  });

  it('PATCH /students/:id can set and clear the Kumon ID', async () => {
    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Patch', last_name: 'Me' });

    const setId = await request(app)
      .patch(`/api/students/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ student_number: 55555 });

    expect(setId.body.student_number).toBe(55555);

    const cleared = await request(app)
      .patch(`/api/students/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ student_number: null });

    expect(cleared.body.student_number).toBeNull();
  });

  it('list endpoint returns student_number for desk search', async () => {
    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Findable', last_name: 'Kid', student_number: 424242 });

    const list = await request(app).get('/api/students').set('Cookie', cookie);
    const match = list.body.find((s) => s.id === created.body.id);
    expect(match.student_number).toBe(424242);
  });
});
