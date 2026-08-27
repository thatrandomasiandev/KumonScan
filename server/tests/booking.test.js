import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db, { sqlNow } from '../db.js';
import { getWeekdayShortForDate } from '../timeService.js';
import { ensureBookingSchema } from '../services/bookingService.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  defaultCenter,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

/** Calendar date (YYYY-MM-DD) n days from now in the center timezone. */
function dateDaysAhead(n) {
  return new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  });
}

describe('staff admin bookings', () => {
  let center;

  beforeEach(async () => {
    await ensureBookingSchema();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    await db.prepare('DELETE FROM bookings WHERE center_id = ?').run(center.id);
  });

  it('public parent booking endpoints are gone', async () => {
    const availability = await request(app).get('/api/booking/availability?date=2099-01-01');
    expect(availability.status).toBe(404);

    const create = await request(app)
      .post('/api/booking')
      .send({ requester_name: 'Parent', requester_phone: '555-010-1001', booking_date: dateDaysAhead(10) });
    expect(create.status).toBe(404);

    const cancel = await request(app).delete('/api/booking/1?phone=5550101001');
    expect(cancel.status).toBe(404);
  });

  it('staff booking list requires auth and shows the day of bookings', async () => {
    const date = dateDaysAhead(16);
    const weekday = getWeekdayShortForDate(date);
    await db
      .prepare(
        `INSERT INTO bookings
           (center_id, requester_name, requester_phone, booking_date, weekday, subjects, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)`
      )
      .run(center.id, 'Listed Parent', '5550108001', date, weekday, 'math', sqlNow());

    const anonymous = await request(app).get(`/api/admin/bookings?date=${date}`);
    expect(anonymous.status).toBe(401);

    const cookie = await loginCookie(DEFAULT_ADMIN_PASSWORD);
    const res = await request(app)
      .get(`/api/admin/bookings?date=${date}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.date).toBe(date);
    expect(res.body.confirmed_count).toBe(1);
    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0]).toMatchObject({
      requester_name: 'Listed Parent',
      status: 'confirmed',
    });
  });
});
