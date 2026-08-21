import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

function bufferResponse(req) {
  return req.buffer(true).parse((response, callback) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
  });
}

describe('daily attendance reports', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    cookie = await loginCookie();
  });

  async function seedCompletedVisit(studentId, checkInIso, minutes) {
    const checkOut = new Date(new Date(checkInIso).getTime() + minutes * 60_000).toISOString();
    await db
      .prepare(
        `INSERT INTO sessions
           (center_id, student_id, check_in_time, check_out_time, duration_minutes, subjects, allowance_minutes)
         VALUES (?, ?, ?, ?, ?, 'math', 30)`
      )
      .run(center.id, studentId, checkInIso, checkOut, minutes);
  }

  it('JSON daily report includes only sessions on that calendar day', async () => {
    const student = await insertStudent(center.id, { first: 'Daily', last: 'Target' });
    // 2026-07-15 12:00 PDT = 19:00 UTC; neighbor day must be excluded.
    await seedCompletedVisit(student.id, '2026-07-15T19:00:00.000Z', 40);
    await seedCompletedVisit(student.id, '2026-07-14T19:00:00.000Z', 25);
    await seedCompletedVisit(student.id, '2026-07-16T19:00:00.000Z', 25);

    const res = await request(app)
      .get('/api/reports/attendance?period=daily&date=2026-07-15')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      period: 'daily',
      date: '2026-07-15',
      start_date: '2026-07-15',
      end_date: '2026-07-15',
    });
    expect(res.body.summary.total_visits).toBe(1);
    expect(res.body.summary.total_minutes).toBe(40);

    const row = res.body.students.find((s) => s.id === student.id);
    expect(row).toMatchObject({ visits: 1, total_minutes: 40 });
  });

  it('rejects an invalid date', async () => {
    const res = await request(app)
      .get('/api/reports/attendance?period=daily&date=2026-02-30')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/);
  });

  it('CSV / XLSX / PDF daily exports return downloadable files', async () => {
    const student = await insertStudent(center.id, { first: 'Export', last: 'Day' });
    await seedCompletedVisit(student.id, '2026-07-15T19:00:00.000Z', 30);

    const csv = await request(app)
      .get('/api/reports/attendance?period=daily&date=2026-07-15&format=csv')
      .set('Cookie', cookie);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(
      /kumonscan-attendance-daily-2026-07-15\.csv/
    );
    expect(csv.text).toContain('Export');

    const xlsx = await bufferResponse(
      request(app)
        .get('/api/reports/attendance?period=daily&date=2026-07-15&format=xlsx')
        .set('Cookie', cookie)
    );
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect(xlsx.headers['content-disposition']).toMatch(
      /kumonscan-attendance-daily-2026-07-15\.xlsx/
    );
    expect(xlsx.body.length).toBeGreaterThan(0);

    const pdf = await bufferResponse(
      request(app)
        .get('/api/reports/attendance?period=daily&date=2026-07-15&format=pdf')
        .set('Cookie', cookie)
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.headers['content-disposition']).toMatch(
      /kumonscan-attendance-daily-2026-07-15\.pdf/
    );
    expect(pdf.body.length).toBeGreaterThan(0);
    expect(pdf.body.slice(0, 4).toString('utf8')).toBe('%PDF');
  });
});
