import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { createTestCenter, defaultCenter, loginCookie, wipeCenterData } from './helpers.js';

describe('student activate', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    cookie = await loginCookie();
  });

  it('turns an inactive student back on for this center', async () => {
    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Jayce', last_name: 'Chapman' });

    expect(created.status).toBe(201);

    const deactivated = await request(app)
      .patch(`/api/students/${created.body.id}/deactivate`)
      .set('Cookie', cookie);

    expect(deactivated.status).toBe(200);

    const activated = await request(app)
      .patch(`/api/students/${created.body.id}/activate`)
      .set('Cookie', cookie);

    expect(activated.status).toBe(200);
    expect(activated.body.active).toBe(1);
    expect(activated.body.name).toBe('Jayce Chapman');

    const row = await db
      .prepare('SELECT active FROM students WHERE id = ? AND center_id = ?')
      .get(created.body.id, center.id);
    expect(row.active).toBe(1);
  });

  it('does not activate another center’s student', async () => {
    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ first_name: 'Other', last_name: 'Center' });

    await request(app)
      .patch(`/api/students/${created.body.id}/deactivate`)
      .set('Cookie', cookie);

    const centerB = await createTestCenter({ slug: `act-b-${Date.now()}` });
    const cookieB = await loginCookie(undefined, centerB.slug);

    const rejected = await request(app)
      .patch(`/api/c/${centerB.slug}/students/${created.body.id}/activate`)
      .set('Cookie', cookieB);

    expect(rejected.status).toBe(404);

    const row = await db
      .prepare('SELECT active FROM students WHERE id = ? AND center_id = ?')
      .get(created.body.id, center.id);
    expect(row.active).toBe(0);
  });
});
