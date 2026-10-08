import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { parseDateOfBirth, importRosterFromContent } from '../rosterImport.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

describe('parseDateOfBirth', () => {
  it('parses Kumon CRM MM/DD/YYYY', () => {
    expect(parseDateOfBirth('09/22/2012')).toBe('2012-09-22');
    expect(parseDateOfBirth('2/5/2015')).toBe('2015-02-05');
  });

  it('parses ISO dates and rejects garbage', () => {
    expect(parseDateOfBirth('2012-09-22')).toBe('2012-09-22');
    expect(parseDateOfBirth('2012-09-22T00:00:00.000Z')).toBe('2012-09-22');
    expect(parseDateOfBirth('')).toBeNull();
    expect(parseDateOfBirth('not-a-date')).toBeNull();
    expect(parseDateOfBirth('13/40/2012')).toBeNull();
  });
});

describe('GET /api/birthdays-this-month', () => {
  let center;
  let cookie;

  beforeEach(async () => {
    center = await defaultCenter();
    await wipeCenterData(center.id);
    cookie = await loginCookie();
  });

  it('returns active students whose DOB month matches the center calendar month', async () => {
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: process.env.CENTER_TIMEZONE || 'America/Los_Angeles',
    });
    const [year, month] = today.split('-');
    const inMonth = `${year - 10}-${month}-15`;
    const otherMonth = `${year - 10}-${month === '12' ? '01' : '12'}-15`;

    await insertStudent(center.id, { first: 'In', last: 'Month' });
    await insertStudent(center.id, { first: 'Other', last: 'Month' });
    await insertStudent(center.id, { first: 'Inactive', last: 'Kid', active: 0 });

    await db
      .prepare(`UPDATE students SET date_of_birth = ? WHERE center_id = ? AND first_name = 'In'`)
      .run(inMonth, center.id);
    await db
      .prepare(`UPDATE students SET date_of_birth = ? WHERE center_id = ? AND first_name = 'Other'`)
      .run(otherMonth, center.id);
    await db
      .prepare(
        `UPDATE students SET date_of_birth = ? WHERE center_id = ? AND first_name = 'Inactive'`
      )
      .run(inMonth, center.id);

    const res = await request(app).get('/api/birthdays-this-month').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.students[0].name).toBe('In Month');
    expect(res.body.students[0].date_of_birth).toBe(inMonth);
    expect(res.body.month).toBe(Number(month));
  });

  it('imports Date of Birth from a CRM CSV and surfaces it on the desk endpoint', async () => {
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: process.env.CENTER_TIMEZONE || 'America/Los_Angeles',
    });
    const [, month] = today.split('-');
    const csv = [
      'Student ID,First Name,Last Name,Date of Birth',
      `8402650999001,Birthday,Kid,${month}/08/2014`,
    ].join('\n');

    await importRosterFromContent(csv, center.id, { mode: 'merge' });

    const row = await db
      .prepare(`SELECT date_of_birth FROM students WHERE center_id = ? AND first_name = 'Birthday'`)
      .get(center.id);
    expect(row.date_of_birth).toMatch(new RegExp(`^\\d{4}-${month}-08$`));

    const res = await request(app).get('/api/birthdays-this-month').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.students.some((s) => s.name === 'Birthday Kid')).toBe(true);
  });
});
