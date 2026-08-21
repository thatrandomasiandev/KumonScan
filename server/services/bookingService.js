import { neonConfig, Pool } from '@neondatabase/serverless';
import db, { ensureDb, exec, sqlNow } from '../db.js';
import {
  getTodayInTimezone,
  getWeekdayShortForDate,
  parseScheduleDays,
} from '../timeService.js';
import { normalizeSubjects } from '../sessionRules.js';
import { getWeekdayCapacity, CAPACITY_SETTING_KEY } from './capacityService.js';

// The Pool (session) client needs a WebSocket implementation; Node 22+ has a
// global one. Required for the advisory-lock transaction in createBooking.
if (typeof globalThis.WebSocket === 'function') {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
}

/**
 * Parent self-scheduling against per-weekday capacity.
 *
 * A booking is an intent to visit, not an attendance record: staff still
 * check the student in normally on arrival. Capacity comes from the same
 * `weekday_capacity` settings key the admin capacity screen writes; this
 * module never stores a second capacity value.
 *
 * Every query and the advisory lock key are center-scoped so two centers
 * cannot block or overbook each other on the same weekday/date.
 */

export { CAPACITY_SETTING_KEY };

/** Reject dates absurdly far out so the public form can't fill the table. */
export const MAX_DAYS_AHEAD = 90;

const NAME_MAX_LENGTH = 80;
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

export class BookingError extends Error {
  /**
   * @param {number} status HTTP status the route should respond with
   * @param {string} message parent-safe message (no internals)
   */
  constructor(status, message) {
    super(message);
    this.name = 'BookingError';
    this.status = status;
  }
}

let schemaPromise = null;

async function tableExists(name) {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ?`
    )
    .get(name);
  return Boolean(row);
}

async function columnNames(table) {
  const rows = await db
    .prepare(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ?
       ORDER BY ordinal_position`
    )
    .all(table);
  return rows.map((r) => r.column_name);
}

/** Idempotent DDL, safe to run alongside the core ensureDb() migrations. */
export async function ensureBookingSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureDb();
      // Do NOT recreate settings here — tenancy owns PRIMARY KEY (center_id, key).
      await exec(`
        CREATE TABLE IF NOT EXISTS bookings (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          student_id INTEGER REFERENCES students(id),
          requester_name TEXT NOT NULL,
          requester_phone TEXT NOT NULL,
          booking_date TEXT NOT NULL,
          weekday TEXT NOT NULL,
          subjects TEXT NOT NULL DEFAULT 'both',
          status TEXT NOT NULL DEFAULT 'confirmed',
          created_at TEXT NOT NULL
        )
      `);

      const defaultCenter = await db
        .prepare('SELECT id FROM centers ORDER BY id ASC LIMIT 1')
        .get();
      if (defaultCenter && (await tableExists('bookings'))) {
        const cols = await columnNames('bookings');
        if (!cols.includes('center_id')) {
          await exec('ALTER TABLE bookings ADD COLUMN center_id INTEGER REFERENCES centers(id)');
        }
        await db
          .prepare('UPDATE bookings SET center_id = ? WHERE center_id IS NULL')
          .run(defaultCenter.id);
        await exec('ALTER TABLE bookings ALTER COLUMN center_id SET NOT NULL');
        await exec('CREATE INDEX IF NOT EXISTS idx_bookings_center_id ON bookings (center_id)');
      }

      await exec(
        `CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(center_id, booking_date)`
      );
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

/** Digits-only canonical form so cancellation matching ignores formatting. */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) return null;
  return digits;
}

function validateRequesterName(raw) {
  if (typeof raw !== 'string') {
    throw new BookingError(400, 'Name is required');
  }
  const name = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!name) {
    throw new BookingError(400, 'Name is required');
  }
  if (name.length > NAME_MAX_LENGTH) {
    throw new BookingError(400, `Name must be ${NAME_MAX_LENGTH} characters or fewer`);
  }
  return name;
}

function validateBookingDate(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BookingError(400, 'booking_date must be YYYY-MM-DD');
  }
  const [y, m, d] = raw.split('-').map(Number);
  const roundTrip = new Date(Date.UTC(y, m - 1, d));
  if (
    roundTrip.getUTCFullYear() !== y ||
    roundTrip.getUTCMonth() !== m - 1 ||
    roundTrip.getUTCDate() !== d
  ) {
    throw new BookingError(400, 'booking_date is not a valid calendar date');
  }
  return raw;
}

async function getCapacityForWeekday(centerId, weekday) {
  const map = await getWeekdayCapacity(centerId);
  const value = Number(map[weekday]);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** Students whose schedule_days include this weekday (same logic as /absent). */
async function countScheduledForWeekday(centerId, weekday) {
  const rows = await db
    .prepare('SELECT schedule_days FROM students WHERE center_id = ? AND active = 1')
    .all(centerId);
  return rows.filter((s) => parseScheduleDays(s.schedule_days).includes(weekday)).length;
}

async function countConfirmedBookings(centerId, date) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM bookings
       WHERE center_id = ? AND booking_date = ? AND status = 'confirmed'`
    )
    .get(centerId, date);
  return Number(row?.count) || 0;
}

/**
 * Availability for one calendar date.
 * A weekday with no capacity setting is unlimited (`remaining: null`), never
 * treated as fully booked.
 */
export async function getAvailability(centerId, date) {
  await ensureBookingSchema();

  validateBookingDate(date);
  const weekday = getWeekdayShortForDate(date);

  const capacity = await getCapacityForWeekday(centerId, weekday);
  const alreadyBooked = await countConfirmedBookings(centerId, date);
  const alreadyExpected = await countScheduledForWeekday(centerId, weekday);

  return {
    date,
    weekday,
    capacity,
    already_booked: alreadyBooked,
    already_checked_in_expected: alreadyExpected,
    remaining:
      capacity == null ? null : Math.max(0, capacity - alreadyBooked - alreadyExpected),
  };
}

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required (Neon connection string)');
  }
  return url;
}

/**
 * Serialize booking writes per (center, date) with a Postgres advisory lock
 * inside a real transaction. The lock key includes center_id so two centers
 * cannot block each other's bookings on the same calendar date.
 */
async function withBookingDateLock(centerId, bookingDate, fn) {
  const pool = new Pool({ connectionString: requireDatabaseUrl() });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('bookings:' || $1::text || ':' || $2))`,
      [String(centerId), bookingDate]
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Booking rollback failed:', rollbackErr?.message || rollbackErr);
    }
    throw err;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

/**
 * Create a confirmed booking, re-checking remaining capacity at write time
 * under the per-center-date lock rather than trusting an earlier availability read.
 */
export async function createBooking(
  centerId,
  {
    requester_name,
    requester_phone,
    booking_date,
    subjects,
    student_id,
  } = {}
) {
  await ensureBookingSchema();

  const name = validateRequesterName(requester_name);

  const phone = normalizePhone(typeof requester_phone === 'string' ? requester_phone : '');
  if (!phone) {
    throw new BookingError(
      400,
      `Phone number must contain ${PHONE_MIN_DIGITS}–${PHONE_MAX_DIGITS} digits`
    );
  }

  validateBookingDate(booking_date);
  const today = getTodayInTimezone();
  if (booking_date < today) {
    throw new BookingError(400, 'Bookings for past dates are not accepted');
  }
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + MAX_DAYS_AHEAD);
  if (booking_date > horizon.toISOString().slice(0, 10)) {
    throw new BookingError(400, `Bookings can be made up to ${MAX_DAYS_AHEAD} days ahead`);
  }

  const normalizedSubjects = subjects == null || subjects === ''
    ? 'math+reading'
    : normalizeSubjects(subjects);
  if (!normalizedSubjects) {
    throw new BookingError(400, 'subjects must be math, reading, efl, or a pair (e.g. math+reading)');
  }

  let studentId = null;
  if (student_id != null && student_id !== '') {
    studentId = Number(student_id);
    if (!Number.isInteger(studentId) || studentId < 1) {
      throw new BookingError(400, 'student_id must be a positive integer');
    }
    const student = await db
      .prepare('SELECT id FROM students WHERE id = ? AND center_id = ? AND active = 1')
      .get(studentId, centerId);
    if (!student) {
      throw new BookingError(404, 'Student not found or inactive');
    }
  }

  const weekday = getWeekdayShortForDate(booking_date);
  const capacity = await getCapacityForWeekday(centerId, weekday);
  const alreadyExpected = await countScheduledForWeekday(centerId, weekday);

  return withBookingDateLock(centerId, booking_date, async (client) => {
    if (capacity != null) {
      const { rows } = await client.query(
        `SELECT COUNT(*) AS count FROM bookings
         WHERE center_id = $1 AND booking_date = $2 AND status = 'confirmed'`,
        [centerId, booking_date]
      );
      const alreadyBooked = Number(rows[0]?.count) || 0;
      if (capacity - alreadyBooked - alreadyExpected <= 0) {
        throw new BookingError(409, 'That day is fully booked — please pick another date');
      }
    }

    const { rows } = await client.query(
      `INSERT INTO bookings
         (center_id, student_id, requester_name, requester_phone, booking_date, weekday, subjects, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8)
       RETURNING *`,
      [centerId, studentId, name, phone, booking_date, weekday, normalizedSubjects, sqlNow()]
    );
    return rows[0];
  });
}

/**
 * Cancel a booking. The phone check is casual ownership protection (the
 * number that created the booking), not a security boundary — there are no
 * parent accounts in scope.
 */
export async function cancelBooking(centerId, id, phone) {
  await ensureBookingSchema();

  const bookingId = Number(id);
  if (!Number.isInteger(bookingId) || bookingId < 1) {
    throw new BookingError(400, 'Booking id must be a positive integer');
  }

  const normalizedPhone = normalizePhone(typeof phone === 'string' ? phone : '');
  if (!normalizedPhone) {
    throw new BookingError(400, 'The phone number used to book is required to cancel');
  }

  const booking = await db
    .prepare('SELECT * FROM bookings WHERE id = ? AND center_id = ?')
    .get(bookingId, centerId);
  if (!booking) {
    throw new BookingError(404, 'Booking not found');
  }
  if (normalizePhone(booking.requester_phone) !== normalizedPhone) {
    throw new BookingError(403, 'Phone number does not match this booking');
  }

  if (booking.status !== 'cancelled') {
    await db
      .prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ? AND center_id = ?`)
      .run(bookingId, centerId);
  }

  return db
    .prepare('SELECT * FROM bookings WHERE id = ? AND center_id = ?')
    .get(bookingId, centerId);
}

/** Staff view: all bookings for a date, with the linked student when known. */
export async function listBookingsForDate(centerId, date) {
  await ensureBookingSchema();

  validateBookingDate(date);
  const weekday = getWeekdayShortForDate(date);

  const rows = await db
    .prepare(
      `SELECT
         b.*,
         st.first_name AS student_first_name,
         st.last_name AS student_last_name
       FROM bookings b
       LEFT JOIN students st ON st.id = b.student_id AND st.center_id = b.center_id
       WHERE b.center_id = ? AND b.booking_date = ?
       ORDER BY b.created_at ASC`
    )
    .all(centerId, date);

  const bookings = rows.map((row) => ({
    id: row.id,
    student_id: row.student_id,
    student_name:
      row.student_first_name != null
        ? `${row.student_first_name} ${row.student_last_name}`.trim()
        : null,
    requester_name: row.requester_name,
    requester_phone: row.requester_phone,
    booking_date: row.booking_date,
    weekday: row.weekday,
    subjects: row.subjects,
    status: row.status,
    created_at: row.created_at,
  }));

  return {
    date,
    weekday,
    bookings,
    confirmed_count: bookings.filter((b) => b.status === 'confirmed').length,
  };
}
