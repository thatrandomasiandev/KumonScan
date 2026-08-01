import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { getWeekdayShortForDate } from '../timeService.js';
import { CAPACITY_SETTING_KEY, ensureBookingSchema } from '../services/bookingService.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  defaultCenter,
  insertStudent,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

/** Calendar date (YYYY-MM-DD) n days from now in the center timezone. */
function dateDaysAhead(n) {
  return new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  });
}

async function setCapacity(centerId, map) {
  await db
    .prepare(
      `INSERT INTO settings (center_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (center_id, key) DO UPDATE SET value = EXCLUDED.value
       RETURNING key`
    )
    .run(centerId, CAPACITY_SETTING_KEY, JSON.stringify(map));
}

async function postBooking(body, ip) {
  return request(app)
    .post('/api/booking')
    .set('X-Forwarded-For', ip)
    .send(body);
}

// Unique per-test IPs keep the public write rate limiter (10/min) out of the way.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

describe('parent self-scheduling', () => {
  let center;

  beforeEach(async () => {
    await ensureBookingSchema();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    await db.prepare('DELETE FROM bookings WHERE center_id = ?').run(center.id);
    await db
      .prepare('DELETE FROM settings WHERE center_id = ? AND key = ?')
      .run(center.id, CAPACITY_SETTING_KEY);
  });

  it('availability subtracts confirmed bookings and scheduled students from capacity', async () => {
    const date = dateDaysAhead(10);
    const weekday = getWeekdayShortForDate(date);
    await setCapacity(center.id, { [weekday]: 5 });

    await insertStudent(center.id, {
      first: 'Sched',
      last: 'Uled',
      days: JSON.stringify([weekday]),
    });

    const first = await postBooking(
      { requester_name: 'Parent One', requester_phone: '555-010-1001', booking_date: date },
      nextIp()
    );
    expect(first.status).toBe(201);

    const second = await postBooking(
      { requester_name: 'Parent Two', requester_phone: '555-010-1002', booking_date: date },
      nextIp()
    );
    expect(second.status).toBe(201);

    // A cancelled booking must not consume capacity.
    const cancelled = await postBooking(
      { requester_name: 'Parent Three', requester_phone: '555-010-1003', booking_date: date },
      nextIp()
    );
    expect(cancelled.status).toBe(201);
    const cancelRes = await request(app)
      .delete(`/api/booking/${cancelled.body.booking.id}?phone=5550101003`)
      .set('X-Forwarded-For', nextIp());
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.booking.status).toBe('cancelled');

    const res = await request(app)
      .get(`/api/booking/availability?date=${date}`)
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date,
      weekday,
      capacity: 5,
      already_booked: 2,
      already_checked_in_expected: 1,
      remaining: 2,
    });
  });

  it('a weekday with no capacity setting is unlimited, not fully booked', async () => {
    const date = dateDaysAhead(11);

    const availability = await request(app)
      .get(`/api/booking/availability?date=${date}`)
      .set('X-Forwarded-For', nextIp());
    expect(availability.status).toBe(200);
    expect(availability.body.capacity).toBeNull();
    expect(availability.body.remaining).toBeNull();

    const res = await postBooking(
      { requester_name: 'No Cap', requester_phone: '555-010-2001', booking_date: date },
      nextIp()
    );
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('confirmed');
  });

  it('only one of two near-simultaneous requests wins the last remaining slot', async () => {
    const date = dateDaysAhead(12);
    const weekday = getWeekdayShortForDate(date);
    await setCapacity(center.id, { [weekday]: 1 });

    const [a, b] = await Promise.all([
      postBooking(
        { requester_name: 'Racer A', requester_phone: '555-010-3001', booking_date: date },
        nextIp()
      ),
      postBooking(
        { requester_name: 'Racer B', requester_phone: '555-010-3002', booking_date: date },
        nextIp()
      ),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);

    const row = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM bookings
         WHERE center_id = ? AND booking_date = ? AND status = 'confirmed'`
      )
      .get(center.id, date);
    expect(Number(row.count)).toBe(1);
  });

  it('rejects a booking for a full date at write time', async () => {
    const date = dateDaysAhead(13);
    const weekday = getWeekdayShortForDate(date);
    await setCapacity(center.id, { [weekday]: 1 });

    const first = await postBooking(
      { requester_name: 'Fits', requester_phone: '555-010-4001', booking_date: date },
      nextIp()
    );
    expect(first.status).toBe(201);

    const overflow = await postBooking(
      { requester_name: 'Does Not', requester_phone: '555-010-4002', booking_date: date },
      nextIp()
    );
    expect(overflow.status).toBe(409);
    expect(overflow.body.error).toMatch(/fully booked/i);
  });

  it('rejects past dates and malformed input', async () => {
    const past = await postBooking(
      {
        requester_name: 'Too Late',
        requester_phone: '555-010-5001',
        booking_date: dateDaysAhead(-2),
      },
      nextIp()
    );
    expect(past.status).toBe(400);
    expect(past.body.error).toMatch(/past/i);

    const badPhone = await postBooking(
      { requester_name: 'Bad Phone', requester_phone: '12', booking_date: dateDaysAhead(9) },
      nextIp()
    );
    expect(badPhone.status).toBe(400);

    const badDate = await postBooking(
      { requester_name: 'Bad Date', requester_phone: '555-010-5002', booking_date: 'tomorrow' },
      nextIp()
    );
    expect(badDate.status).toBe(400);

    const badSubjects = await postBooking(
      {
        requester_name: 'Bad Subjects',
        requester_phone: '555-010-5003',
        booking_date: dateDaysAhead(9),
        subjects: 'piano',
      },
      nextIp()
    );
    expect(badSubjects.status).toBe(400);
  });

  it('cancellation requires the phone number that created the booking', async () => {
    const date = dateDaysAhead(14);
    const created = await postBooking(
      { requester_name: 'Owner', requester_phone: '(555) 010-6001', booking_date: date },
      nextIp()
    );
    expect(created.status).toBe(201);
    const id = created.body.booking.id;

    const wrong = await request(app)
      .delete(`/api/booking/${id}?phone=5550109999`)
      .set('X-Forwarded-For', nextIp());
    expect(wrong.status).toBe(403);

    const missing = await request(app)
      .delete(`/api/booking/${id}`)
      .set('X-Forwarded-For', nextIp());
    expect(missing.status).toBe(400);

    // Formatting differences must not block the rightful owner.
    const right = await request(app)
      .delete(`/api/booking/${id}?phone=555-010-6001`)
      .set('X-Forwarded-For', nextIp());
    expect(right.status).toBe(200);
    expect(right.body.booking.status).toBe('cancelled');
  });

  it('links an optional student_id and rejects unknown students', async () => {
    const student = await insertStudent(center.id, { first: 'Linked', last: 'Kid' });
    const date = dateDaysAhead(15);

    const linked = await postBooking(
      {
        requester_name: 'Linked Parent',
        requester_phone: '555-010-7001',
        booking_date: date,
        student_id: student.id,
      },
      nextIp()
    );
    expect(linked.status).toBe(201);
    expect(linked.body.booking.student_id).toBe(student.id);

    const unknown = await postBooking(
      {
        requester_name: 'Ghost Parent',
        requester_phone: '555-010-7002',
        booking_date: date,
        student_id: 999_999,
      },
      nextIp()
    );
    expect(unknown.status).toBe(404);
  });

  it('staff booking list requires auth and shows the day of bookings', async () => {
    const date = dateDaysAhead(16);
    await postBooking(
      { requester_name: 'Listed Parent', requester_phone: '555-010-8001', booking_date: date },
      nextIp()
    );

    const anonymous = await request(app)
      .get(`/api/admin/bookings?date=${date}`)
      .set('X-Forwarded-For', nextIp());
    expect(anonymous.status).toBe(401);

    const ip = nextIp();
    const cookie = await loginCookie(DEFAULT_ADMIN_PASSWORD);
    const res = await request(app)
      .get(`/api/admin/bookings?date=${date}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', ip);

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
