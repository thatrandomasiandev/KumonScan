#!/usr/bin/env node
/**
 * seed-demo-data.js — wipe and re-seed the sales demo database.
 *
 * The demo environment is a SEPARATE deployment pointed at its own Neon
 * database. Isolation is physical (a different DATABASE_URL), never row-level:
 * this script wipes the target database's students and sessions entirely, so it
 * must never run against the shared multi-tenant production database. The
 * nightly cron (GET /api/demo/reset) and manual CLI runs both call
 * resetAndSeedDemo().
 *
 * Safety guards, in order:
 *   1. DEMO_MODE=true must be set in the environment, otherwise refuse.
 *   2. The target database (DATABASE_URL) must either carry the
 *      demo_meta.is_demo_database marker or be completely empty. A database
 *      with students/sessions but no marker is treated as a real center's
 *      data and the script refuses to touch it.
 *
 * Usage: DEMO_MODE=true node scripts/seed-demo-data.js
 *
 * Idempotent: every run deletes all demo rows and rebuilds the same roster
 * (names, student numbers, schedules) with timestamps relative to "now".
 */
import { fileURLToPath } from 'url';
import db, { ensureDb, exec, get, query, run } from '../db.js';
import { allowanceForSubjects } from '../sessionRules.js';
import { WEEKDAY_SHORTS, getTodayInTimezone, getWeekdayShortForDate } from '../timeService.js';

export const DEMO_CENTER_NAME = 'Kumon of Demo Springs';
export const DEMO_PHONE_PREFIX = '555-01';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HISTORY_DAYS = 30;

/**
 * Fixed roster. Indexes encode today's desk state so every feature surface is
 * populated no matter which weekday the seed runs:
 *   0..5  checked in right now (0 and 1 past their allowance -> overtime)
 *   6..9  completed a visit earlier today (8 ran overtime)
 *   10..16 no visit today -> the ones scheduled today appear as absences
 *   17    deactivated (roster realism)
 * Phones use the reserved fictional 555-01XX range and student_number is 1..18
 * so demo rows are recognizable at a glance in any query.
 */
export const DEMO_ROSTER = [
  { first: 'Mia', last: 'Tanaka', subjects: 'both', days: ['Mon', 'Wed', 'Fri'] },
  { first: 'Jayden', last: 'Brooks', subjects: 'math', days: ['Tue', 'Thu'] },
  { first: 'Sofia', last: 'Ramirez', subjects: 'both', days: ['Mon', 'Tue', 'Thu'] },
  { first: 'Ethan', last: 'Park', subjects: 'reading', days: ['Mon', 'Wed'] },
  { first: 'Zoe', last: 'Nguyen', subjects: 'both', days: ['Tue', 'Fri'] },
  { first: 'Lucas', last: 'Bianchi', subjects: 'math', days: ['Wed', 'Sat'] },
  { first: 'Amara', last: 'Okafor', subjects: 'both', days: ['Mon', 'Thu'] },
  { first: 'Henry', last: 'Whitfield', subjects: 'reading', days: ['Tue', 'Sat'] },
  { first: 'Priya', last: 'Sharma', subjects: 'both', days: ['Wed', 'Fri'] },
  { first: 'Caleb', last: 'Johansson', subjects: 'math', days: ['Mon', 'Fri'] },
  { first: 'Isabella', last: 'Reyes', subjects: 'both', days: ['Mon', 'Wed', 'Fri'] },
  { first: 'Noah', last: 'Fitzgerald', subjects: 'reading', days: ['Tue', 'Thu', 'Sun'] },
  { first: 'Grace', last: 'Liu', subjects: 'both', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
  { first: 'Omar', last: 'Haddad', subjects: 'math', days: ['Wed', 'Sat'] },
  { first: 'Ruby', last: 'Castellanos', subjects: 'both', days: ['Mon', 'Thu', 'Sat'] },
  { first: 'Theo', last: 'Vandermeer', subjects: 'reading', days: ['Tue', 'Fri', 'Sun'] },
  { first: 'Layla', last: 'Petrov', subjects: 'both', days: null },
  { first: 'Marcus', last: 'Delgado', subjects: 'math', days: ['Mon', 'Wed'], inactive: true },
];

const CHECKED_IN_INDEXES = [0, 1, 2, 3, 4, 5];
const OVERTIME_OPEN_INDEXES = new Set([0, 1]);
const COMPLETED_TODAY_INDEXES = [6, 7, 8, 9];
const OVERTIME_COMPLETED_INDEXES = new Set([8]);

export class DemoSeedRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'DemoSeedRefused';
  }
}

/** Deterministic PRNG so every reset rebuilds the same visit history shape. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoStudentNumber(index) {
  return index + 1;
}

function demoPhone(index) {
  return `${DEMO_PHONE_PREFIX}${String(index).padStart(2, '0')}`;
}

/**
 * The target database must be provably ours to wipe: either it already
 * carries the demo marker, or it holds no attendance data at all (fresh
 * database being claimed for demo use). Anything else is treated as a real
 * center's database and refused.
 */
async function assertSafeDemoTarget() {
  if (process.env.DEMO_MODE !== 'true') {
    throw new DemoSeedRefused(
      'DEMO_MODE=true is required. This script wipes its target database; ' +
        'it only runs inside the dedicated demo deployment.'
    );
  }

  await ensureDb();
  await exec(
    `CREATE TABLE IF NOT EXISTS demo_meta (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`
  );

  const marker = await get(`SELECT value FROM demo_meta WHERE key = 'is_demo_database'`);
  if (marker?.value === 'true') return;

  const studentCount = (await get('SELECT COUNT(*) AS count FROM students'))?.count || 0;
  const sessionCount = (await get('SELECT COUNT(*) AS count FROM sessions'))?.count || 0;
  if (studentCount > 0 || sessionCount > 0) {
    throw new DemoSeedRefused(
      `Refusing to wipe: target database has ${studentCount} students and ` +
        `${sessionCount} sessions but no demo_meta marker. It looks like a ` +
        'real center database. Point DATABASE_URL at the dedicated demo database.'
    );
  }

  await run(
    `INSERT INTO demo_meta (key, value) VALUES ('is_demo_database', 'true')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
  );
}

/** Multi-row insert keeping the ?-placeholder convention of db.js. */
async function insertRows(table, columns, rows) {
  if (rows.length === 0) return [];
  const CHUNK = 80;
  const inserted = [];
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const tuple = `(${columns.map(() => '?').join(', ')})`;
    const sql =
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ` +
      chunk.map(() => tuple).join(', ') +
      ' RETURNING *';
    const { rows: returned } = await query(sql, chunk.flat());
    inserted.push(...returned);
  }
  return inserted;
}

function buildStudentRows(now, centerId) {
  return DEMO_ROSTER.map((entry, index) => {
    const registeredAt = new Date(now.getTime() - (35 + index * 11) * DAY_MS).toISOString();
    return [
      centerId,
      entry.first,
      entry.last,
      entry.inactive ? 0 : 1,
      registeredAt,
      registeredAt,
      entry.subjects,
      entry.days ? JSON.stringify(entry.days) : null,
      demoPhone(index),
      demoStudentNumber(index),
    ];
  });
}

/**
 * Completed visits over the past HISTORY_DAYS on each student's scheduled
 * weekdays, pinned to afternoon hours (22:30-01:00 UTC ~= 15:30-18:00 in the
 * default center timezone) so history reads like a real center. Roughly 15%
 * of visits run past the allowance to exercise overtime reporting, and ~15%
 * of scheduled days are skipped so past absence queries have data too.
 */
function buildHistorySessionRows(now, studentIdByNumber, centerId, rand) {
  const rows = [];
  for (let index = 0; index < DEMO_ROSTER.length; index++) {
    const entry = DEMO_ROSTER[index];
    if (entry.inactive || !entry.days) continue;
    const studentId = studentIdByNumber.get(demoStudentNumber(index));
    const allowance = allowanceForSubjects(entry.subjects);

    for (let daysAgo = 1; daysAgo <= HISTORY_DAYS; daysAgo++) {
      const dayAnchor = new Date(now.getTime() - daysAgo * DAY_MS);
      const weekday = WEEKDAY_SHORTS[dayAnchor.getUTCDay()];
      if (!entry.days.includes(weekday)) continue;
      if (rand() < 0.15) continue; // skipped visit -> past absence

      const checkIn = new Date(dayAnchor.getTime());
      checkIn.setUTCHours(22, 30 + Math.floor(rand() * 150), Math.floor(rand() * 60), 0);

      const overtime = rand() < 0.15;
      const duration = overtime
        ? allowance + 5 + Math.floor(rand() * 16)
        : Math.max(15, allowance - 12 + Math.floor(rand() * 18));
      const checkOut = new Date(checkIn.getTime() + duration * MINUTE_MS);

      rows.push([
        centerId,
        studentId,
        checkIn.toISOString(),
        checkOut.toISOString(),
        duration,
        entry.subjects,
        allowance,
      ]);
    }
  }
  return rows;
}

/** Today's desk state: open sessions (some overtime) and completed visits. */
function buildTodaySessionRows(now, studentIdByNumber, centerId, rand) {
  const rows = [];

  for (const index of CHECKED_IN_INDEXES) {
    const entry = DEMO_ROSTER[index];
    const studentId = studentIdByNumber.get(demoStudentNumber(index));
    const allowance = allowanceForSubjects(entry.subjects);
    const minutesAgo = OVERTIME_OPEN_INDEXES.has(index)
      ? allowance + 12 + Math.floor(rand() * 10)
      : 8 + Math.floor(rand() * Math.max(10, allowance - 18));
    const checkIn = new Date(now.getTime() - minutesAgo * MINUTE_MS);
    rows.push([centerId, studentId, checkIn.toISOString(), null, null, entry.subjects, allowance]);
  }

  for (const index of COMPLETED_TODAY_INDEXES) {
    const entry = DEMO_ROSTER[index];
    const studentId = studentIdByNumber.get(demoStudentNumber(index));
    const allowance = allowanceForSubjects(entry.subjects);
    const duration = OVERTIME_COMPLETED_INDEXES.has(index)
      ? allowance + 14
      : Math.max(18, allowance - 8 + Math.floor(rand() * 10));
    const checkOut = new Date(now.getTime() - (25 + Math.floor(rand() * 60)) * MINUTE_MS);
    const checkIn = new Date(checkOut.getTime() - duration * MINUTE_MS);
    rows.push([
      centerId,
      studentId,
      checkIn.toISOString(),
      checkOut.toISOString(),
      duration,
      entry.subjects,
      allowance,
    ]);
  }

  return rows;
}

async function resolveDemoCenter() {
  const center = await get('SELECT * FROM centers ORDER BY id ASC LIMIT 1');
  if (!center) {
    throw new DemoSeedRefused('No center row after ensureDb; cannot seed demo data.');
  }
  if (center.name !== DEMO_CENTER_NAME) {
    await run('UPDATE centers SET name = ? WHERE id = ?', [DEMO_CENTER_NAME, center.id]);
    center.name = DEMO_CENTER_NAME;
  }
  return center;
}

/**
 * Wipe and rebuild the entire demo dataset. Throws DemoSeedRefused unless the
 * target is provably the demo database (see assertSafeDemoTarget).
 */
export async function resetAndSeedDemo({ now = new Date() } = {}) {
  await assertSafeDemoTarget();

  const center = await resolveDemoCenter();
  const rand = mulberry32(20260731);

  // Dedicated demo DB: wipe attendance and every child table that now FKs
  // onto students/sessions (worksheet_completions, caregivers, etc.).
  await exec('TRUNCATE TABLE sessions, students RESTART IDENTITY CASCADE');

  const students = await insertRows(
    'students',
    [
      'center_id',
      'first_name',
      'last_name',
      'active',
      'created_at',
      'registered_at',
      'enrolled_subjects',
      'schedule_days',
      'parent_phone',
      'student_number',
    ],
    buildStudentRows(now, center.id)
  );
  const studentIdByNumber = new Map(students.map((s) => [Number(s.student_number), s.id]));

  const sessionRows = [
    ...buildHistorySessionRows(now, studentIdByNumber, center.id, rand),
    ...buildTodaySessionRows(now, studentIdByNumber, center.id, rand),
  ];
  await insertRows(
    'sessions',
    [
      'center_id',
      'student_id',
      'check_in_time',
      'check_out_time',
      'duration_minutes',
      'subjects',
      'allowance_minutes',
    ],
    sessionRows
  );

  const seededAt = now.toISOString();
  await run(
    `INSERT INTO demo_meta (key, value) VALUES
       ('center_name', ?), ('last_seeded_at', ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [DEMO_CENTER_NAME, seededAt]
  );

  const today = getTodayInTimezone();
  const todayWeekday = getWeekdayShortForDate(today);
  const absentToday = DEMO_ROSTER.filter(
    (entry, index) =>
      !entry.inactive &&
      entry.days?.includes(todayWeekday) &&
      !CHECKED_IN_INDEXES.includes(index) &&
      !COMPLETED_TODAY_INDEXES.includes(index)
  ).length;

  return {
    center: DEMO_CENTER_NAME,
    seeded_at: seededAt,
    students: students.length,
    active_students: students.filter((s) => s.active === 1).length,
    sessions: sessionRows.length,
    open_sessions: CHECKED_IN_INDEXES.length,
    completed_today: COMPLETED_TODAY_INDEXES.length,
    absent_today: absentToday,
  };
}

async function main() {
  const summary = await resetAndSeedDemo();
  console.log(`Seeded ${summary.center}:`);
  console.log(
    `  ${summary.students} students (${summary.active_students} active), ` +
      `${summary.sessions} sessions, ${summary.open_sessions} checked in now, ` +
      `${summary.completed_today} completed today, ${summary.absent_today} absent today.`
  );
  await db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof DemoSeedRefused ? `demo-seed: ${err.message}` : err);
    process.exit(1);
  });
}
