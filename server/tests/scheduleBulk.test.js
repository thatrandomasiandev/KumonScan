import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { parseScheduleDays } from '../timeService.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

describe('schedule-bulk set-based update', () => {
  let center;

  beforeEach(async () => {
    center = await defaultCenter();
    await wipeCenterData(center.id);
  });

  it('updates exactly the targeted rows in one ANY($2) statement', async () => {
    const missingA = await insertStudent(center.id, { first: 'Missing', last: 'One' });
    const missingB = await insertStudent(center.id, {
      first: 'Missing',
      last: 'Two',
      days: '[]',
    });
    const scheduled = await insertStudent(center.id, {
      first: 'Has',
      last: 'Days',
      days: JSON.stringify(['Tue', 'Thu']),
    });
    const inactive = await insertStudent(center.id, {
      first: 'Not',
      last: 'Active',
      active: 0,
    });

    const cookie = await loginCookie();
    const res = await request(app)
      .post('/api/admin/schedule-bulk')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30')
      .send({ days: ['Mon', 'Wed', 'Fri'], scope: 'missing' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.active_total).toBe(3);

    const rows = await db
      .prepare('SELECT id, schedule_days FROM students WHERE center_id = ?')
      .all(center.id);
    const byId = new Map(rows.map((r) => [r.id, parseScheduleDays(r.schedule_days)]));

    expect(byId.get(missingA.id)).toEqual(['Mon', 'Wed', 'Fri']);
    expect(byId.get(missingB.id)).toEqual(['Mon', 'Wed', 'Fri']);
    expect(byId.get(scheduled.id)).toEqual(['Tue', 'Thu']);
    expect(byId.get(inactive.id)).toEqual([]);
  });

  it('scope all_active overwrites schedules for every active student only', async () => {
    const a = await insertStudent(center.id, {
      first: 'Alpha',
      last: 'Kid',
      days: JSON.stringify(['Tue']),
    });
    const b = await insertStudent(center.id, { first: 'Beta', last: 'Kid' });
    const inactive = await insertStudent(center.id, {
      first: 'Gone',
      last: 'Kid',
      active: 0,
    });

    const cookie = await loginCookie();
    const res = await request(app)
      .post('/api/admin/schedule-bulk')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30')
      .send({ days: ['Sat'], scope: 'all_active' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);

    const rows = await db
      .prepare('SELECT id, schedule_days FROM students WHERE center_id = ?')
      .all(center.id);
    const byId = new Map(rows.map((r) => [r.id, parseScheduleDays(r.schedule_days)]));
    expect(byId.get(a.id)).toEqual(['Sat']);
    expect(byId.get(b.id)).toEqual(['Sat']);
    expect(byId.get(inactive.id)).toEqual([]);
  });
});
