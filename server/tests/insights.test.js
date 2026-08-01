// agent-7-insights: math proofs for the owner analytics endpoints.
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { getTodayInTimezone } from '../timeService.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

const IP = '198.51.100.77';

function authed(req, cookie) {
  return req.set('Cookie', cookie).set('X-Forwarded-For', IP);
}

/** YYYY-MM-DD in the center timezone (America/Los_Angeles under tests), n days from today. */
function ymdDaysAgo(n) {
  const [y, m, d] = getTodayInTimezone().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - n * 86_400_000).toISOString().slice(0, 10);
}

/** Noon-ish LA instant for a civil date: 20:00Z is 12:00 or 13:00 LA, same date year-round. */
function isoNoonLA(ymd) {
  return `${ymd}T20:00:00.000Z`;
}

/** Bulk-insert completed sessions in one statement (avoids N round trips to Neon). */
async function insertCompletedSessions(centerId, studentId, isoTimes) {
  if (isoTimes.length === 0) return;
  const tuples = isoTimes.map(() => '(?, ?, ?, ?, 30)').join(', ');
  const params = isoTimes.flatMap((iso) => [centerId, studentId, iso, iso]);
  await db
    .prepare(
      `INSERT INTO sessions (center_id, student_id, check_in_time, check_out_time, duration_minutes)
       VALUES ${tuples}`
    )
    .run(...params);
}

async function insertStaff(centerId, first, last, hourlyRate) {
  const result = await db
    .prepare(
      `INSERT INTO staff (center_id, first_name, last_name, hourly_rate, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(centerId, first, last, hourlyRate, new Date().toISOString());
  return result.lastInsertRowid;
}

async function insertCompletedShift(centerId, staffId, iso, durationMinutes) {
  const outIso = new Date(new Date(iso).getTime() + durationMinutes * 60_000).toISOString();
  await db
    .prepare(
      `INSERT INTO staff_sessions (center_id, staff_id, clock_in_time, clock_out_time, duration_minutes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(centerId, staffId, iso, outIso, durationMinutes);
}

describe('insights', () => {
  let center;

  beforeEach(async () => {
    center = await defaultCenter();
    await wipeCenterData(center.id);
    await db.exec('DROP TABLE IF EXISTS bookings');
    await db
      .prepare('DELETE FROM settings WHERE center_id = ? AND key = ?')
      .run(center.id, 'weekday_capacity');
  });

  it('requires admin authentication', async () => {
    const res = await request(app)
      .get('/api/insights/summary')
      .set('X-Forwarded-For', IP);
    expect(res.status).toBe(401);
  });

  it('rejects an out-of-range threshold and window', async () => {
    const cookie = await loginCookie();
    const badThreshold = await authed(
      request(app).get('/api/insights/summary?at_risk_threshold=1.5'),
      cookie
    );
    expect(badThreshold.status).toBe(400);

    const badWindow = await authed(
      request(app).get('/api/insights/summary?window_days=2'),
      cookie
    );
    expect(badWindow.status).toBe(400);
  });

  describe('at-risk detection at the exact threshold boundary', () => {
    it('flags a >50% drop but not 49% or exactly 50%', async () => {
      // 100 prior-window visits each; recent-window visits chosen so the drop
      // is exactly 49%, 50%, and 51%. "More than 50%" is strict, so only the
      // 51% drop qualifies.
      const priorIso = isoNoonLA(ymdDaysAgo(40));
      const recentIso = isoNoonLA(ymdDaysAgo(10));

      const drop49 = await insertStudent(center.id, { first: 'Forty', last: 'Nine' });
      await insertCompletedSessions(center.id, drop49.id, Array(100).fill(priorIso));
      await insertCompletedSessions(center.id, drop49.id, Array(51).fill(recentIso));

      const drop50 = await insertStudent(center.id, { first: 'Fifty', last: 'Even' });
      await insertCompletedSessions(center.id, drop50.id, Array(100).fill(priorIso));
      await insertCompletedSessions(center.id, drop50.id, Array(50).fill(recentIso));

      const drop51 = await insertStudent(center.id, { first: 'Fifty', last: 'One' });
      await insertCompletedSessions(center.id, drop51.id, Array(100).fill(priorIso));
      await insertCompletedSessions(center.id, drop51.id, Array(49).fill(recentIso));

      const cookie = await loginCookie();
      const res = await authed(request(app).get('/api/insights/at-risk'), cookie);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.students).toHaveLength(1);
      expect(res.body.students[0]).toMatchObject({
        id: drop51.id,
        name: 'Fifty One',
        recent_visits: 49,
        prior_visits: 100,
        drop_pct: 51,
      });
    });

    it('paginates the detailed list', async () => {
      const priorIso = isoNoonLA(ymdDaysAgo(40));
      for (const last of ['Alpha', 'Beta', 'Gamma']) {
        const student = await insertStudent(center.id, { first: 'Gone', last });
        await insertCompletedSessions(center.id, student.id, Array(4).fill(priorIso)); // 100% drop
      }

      const cookie = await loginCookie();
      const res = await authed(
        request(app).get('/api/insights/at-risk?page=2&page_size=2'),
        cookie
      );
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.page).toBe(2);
      expect(res.body.students).toHaveLength(1);
    });

    it('ignores students with no prior-window baseline', async () => {
      const brandNew = await insertStudent(center.id, { first: 'Brand', last: 'New' });
      await insertCompletedSessions(center.id, brandNew.id, [isoNoonLA(ymdDaysAgo(3))]);

      const cookie = await loginCookie();
      const res = await authed(request(app).get('/api/insights/at-risk'), cookie);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    });
  });

  describe('regulars vs lapsing', () => {
    it('counts current regulars and names lapsed ones', async () => {
      const regular = await insertStudent(center.id, { first: 'Still', last: 'Regular' });
      await insertCompletedSessions(center.id, regular.id, Array(3).fill(isoNoonLA(ymdDaysAgo(2))));

      const lapsed = await insertStudent(center.id, { first: 'Now', last: 'Lapsed' });
      await insertCompletedSessions(center.id, lapsed.id, Array(4).fill(isoNoonLA(ymdDaysAgo(10))));

      const cookie = await loginCookie();
      const res = await authed(request(app).get('/api/insights/summary'), cookie);
      expect(res.status).toBe(200);
      expect(res.body.regulars.regular_count).toBe(1);
      expect(res.body.regulars.lapsed_count).toBe(1);
      expect(res.body.regulars.lapsed_students[0]).toMatchObject({
        id: lapsed.id,
        name: 'Now Lapsed',
        visits_this_week: 0,
        visits_prior_week: 4,
      });
    });
  });

  describe('staff cost-per-visit', () => {
    it('matches a hand-computed fixture', async () => {
      // Staff A: $20/h x 2h = $40. Staff B: $15/h x 1h = $15. Staff C has a
      // 30-min shift but no rate, so cost stays $55 while hours total 3.5.
      // 11 completed visits: $55 / 11 = $5.00 per visit.
      const shiftIso = isoNoonLA(ymdDaysAgo(1));
      const staffA = await insertStaff(center.id, 'Ada', 'Rate', 20);
      await insertCompletedShift(center.id, staffA, shiftIso, 120);

      const staffB = await insertStaff(center.id, 'Ben', 'Rate', 15);
      await insertCompletedShift(center.id, staffB, shiftIso, 60);

      const staffC = await insertStaff(center.id, 'Cal', 'NoRate', null);
      await insertCompletedShift(center.id, staffC, shiftIso, 30);

      const student = await insertStudent(center.id, { first: 'Busy', last: 'Kid' });
      await insertCompletedSessions(center.id, student.id, Array(11).fill(isoNoonLA(ymdDaysAgo(5))));

      const cookie = await loginCookie();
      const res = await authed(request(app).get('/api/insights/summary'), cookie);
      expect(res.status).toBe(200);
      expect(res.body.staff_efficiency).toMatchObject({
        available: true,
        total_payroll_cost: 55,
        total_staff_hours: 3.5,
        total_visits: 11,
        cost_per_visit: 5,
        staff_missing_rate: 1,
      });
    });

    it('returns a null cost-per-visit when there are no shifts', async () => {
      const student = await insertStudent(center.id, { first: 'Only', last: 'Visits' });
      await insertCompletedSessions(center.id, student.id, [isoNoonLA(ymdDaysAgo(1))]);

      const cookie = await loginCookie();
      const res = await authed(request(app).get('/api/insights/summary'), cookie);
      expect(res.status).toBe(200);
      expect(res.body.staff_efficiency.cost_per_visit).toBeNull();
    });
  });

  describe('booking-to-visit conversion', () => {
    async function createBookingsTable() {
      await db.exec(`
        CREATE TABLE bookings (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          booking_date TEXT NOT NULL,
          status TEXT NOT NULL
        )
      `);
    }

    async function insertBooking(studentId, ymd, status) {
      await db
        .prepare(
          'INSERT INTO bookings (center_id, student_id, booking_date, status) VALUES (?, ?, ?, ?)'
        )
        .run(center.id, studentId, ymd, status);
    }

    it('excludes future bookings and non-confirmed statuses', async () => {
      await createBookingsTable();
      const student = await insertStudent(center.id, { first: 'Booked', last: 'Kid' });

      // Converted: confirmed yesterday with a check-in on the same civil date.
      await insertBooking(student.id, ymdDaysAgo(1), 'confirmed');
      await insertCompletedSessions(center.id, student.id, [isoNoonLA(ymdDaysAgo(1))]);
      // Not converted: confirmed two days ago, no visit.
      await insertBooking(student.id, ymdDaysAgo(2), 'confirmed');
      // Excluded: tomorrow has not had the chance to convert yet.
      await insertBooking(student.id, ymdDaysAgo(-1), 'confirmed');
      // Excluded: not a confirmed booking.
      await insertBooking(student.id, ymdDaysAgo(3), 'pending');

      const cookie = await loginCookie();
      const res = await authed(request(app).get('/api/insights/summary'), cookie);
      expect(res.status).toBe(200);
      expect(res.body.booking_conversion).toMatchObject({
        available: true,
        confirmed_bookings: 2,
        converted_bookings: 1,
        conversion_pct: 50,
      });
    });
  });

  describe('graceful degradation', () => {
    it('reports unavailable metrics instead of crashing when optional tables are missing', async () => {
      const cookie = await loginCookie();
      const res = await authed(request(app).get('/api/insights/summary'), cookie);
      expect(res.status).toBe(200);

      // No bookings table in this checkout.
      expect(res.body.booking_conversion.available).toBe(false);
      // No weekday capacity configured yet.
      expect(res.body.capacity_headroom.available).toBe(false);
      // Core metrics still compute from the base tables.
      expect(res.body.at_risk.available).toBe(true);
      expect(res.body.regulars.available).toBe(true);
      expect(res.body.staff_efficiency.available).toBe(true);
    });

    it('computes capacity headroom once capacity is configured', async () => {
      await db
        .prepare(
          `INSERT INTO settings (center_id, key, value) VALUES (?, 'weekday_capacity', ?)
           ON CONFLICT (center_id, key) DO UPDATE SET value = EXCLUDED.value
           RETURNING key`
        )
        .run(center.id, JSON.stringify({ Tue: 10 }));

      const cookie = await loginCookie();
      const res = await authed(request(app).get('/api/insights/summary'), cookie);
      expect(res.status).toBe(200);
      expect(res.body.capacity_headroom.available).toBe(true);

      const tuesday = res.body.capacity_headroom.weekdays.find((d) => d.weekday === 'Tue');
      // No check-ins seeded, so the full capacity is headroom.
      expect(tuesday).toMatchObject({ capacity: 10, avg_checkins: 0, headroom: 10 });
    });
  });
});
