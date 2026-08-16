import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

function bufferResponse(req) {
  return req.buffer(true).parse((response, callback) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
  });
}

describe('report exports — format=xlsx', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    cookie = await loginCookie();
  });

  it('GET /reports/attendance?format=xlsx returns a non-empty workbook', async () => {
    await insertStudent(center.id, { first: 'Xlsx', last: 'Student' });

    const res = await bufferResponse(
      request(app)
        .get('/api/reports/attendance?period=monthly&month=2026-07&format=xlsx')
        .set('Cookie', cookie)
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('GET /reports/payroll?format=xlsx returns a non-empty workbook', async () => {
    const res = await bufferResponse(
      request(app)
        .get('/api/reports/payroll?start=2026-07-01&end=2026-07-31&format=xlsx')
        .set('Cookie', cookie)
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
