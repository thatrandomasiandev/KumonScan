import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

describe('POST /api/admin/roster-import — replace mode HTTP contract', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    cookie = await loginCookie();
  });

  it('rejects mode=replace without confirm_replace', async () => {
    const res = await request(app)
      .post('/api/admin/roster-import')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.80')
      .send({ filename: 'roster.csv', content: 'First Name,Last Name\nA,B', mode: 'replace' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirm_replace/i);
  });

  it('accepts mode=replace with confirm_replace: true and deactivates missing students', async () => {
    const dropped = await insertStudent(center.id, { first: 'Old', last: 'One' });

    const res = await request(app)
      .post('/api/admin/roster-import')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.81')
      .send({
        filename: 'roster.csv',
        content: 'First Name,Last Name\nNew,One',
        mode: 'replace',
        confirm_replace: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('replace');
    expect(res.body.created).toBe(1);
    expect(res.body.deactivated).toBe(1);

    const row = await db.prepare('SELECT active FROM students WHERE id = ?').get(dropped.id);
    expect(row.active).toBe(0);
  });

  it('defaults to merge mode and never deactivates', async () => {
    const kept = await insertStudent(center.id, { first: 'Merge', last: 'Kept' });

    const res = await request(app)
      .post('/api/admin/roster-import')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.82')
      .send({ filename: 'roster.csv', content: 'First Name,Last Name\nNew,Merge' });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('merge');
    expect(res.body.deactivated).toBe(0);

    const row = await db.prepare('SELECT active FROM students WHERE id = ?').get(kept.id);
    expect(row.active).toBe(1);
  });

  it('requires admin auth', async () => {
    const res = await request(app)
      .post('/api/admin/roster-import')
      .send({ filename: 'roster.csv', content: 'First Name,Last Name\nA,B' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/roster-template.{csv,xlsx}', () => {
  let cookie;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    cookie = await loginCookie();
  });

  it('returns a non-empty sample CSV', async () => {
    const res = await request(app)
      .get('/api/admin/roster-template.csv')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toMatch(/first name/i);
  });

  it('returns a non-empty sample XLSX', async () => {
    const res = await request(app)
      .get('/api/admin/roster-template.xlsx')
      .set('Cookie', cookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('requires admin auth', async () => {
    const res = await request(app).get('/api/admin/roster-template.csv');
    expect(res.status).toBe(401);
  });
});
