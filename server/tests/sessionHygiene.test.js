import { beforeEach, describe, expect, it } from 'vitest';
import db from '../db.js';
import { closeStaleOpenSessions } from '../sessionHygiene.js';
import { defaultCenter, insertStudent, wipeCenterData } from './helpers.js';

describe('sessionHygiene', () => {
  let center;

  beforeEach(async () => {
    center = await defaultCenter();
    await wipeCenterData(center.id);
  });

  it('closes a prior-day orphan at check-in + allowance', async () => {
    const student = await insertStudent(center.id, { first: 'Orphan', last: 'Prior' });
    const checkIn = '2026-07-29T18:00:00.000Z';
    await db.prepare(
      `INSERT INTO sessions (center_id, student_id, check_in_time, subjects, allowance_minutes)
       VALUES (?, ?, ?, 'math', 30)`
    ).run(center.id, student.id, checkIn);

    const closed = await closeStaleOpenSessions(center.id, '2026-07-30');
    expect(closed).toBe(1);

    const row = await db.prepare('SELECT * FROM sessions WHERE student_id = ?').get(student.id);
    expect(row.check_out_time).toBe(new Date(Date.parse(checkIn) + 30 * 60_000).toISOString());
    expect(row.duration_minutes).toBe(30);
  });

  it('collapses same-day duplicate open sessions down to the newest', async () => {
    const student = await insertStudent(center.id, { first: 'Dup', last: 'Open' });

    // Seed the historical bug state (two open rows) by temporarily dropping the unique index.
    await db.exec('DROP INDEX IF EXISTS idx_one_open_session_per_student');
    await db.prepare(
      `INSERT INTO sessions (center_id, student_id, check_in_time, subjects, allowance_minutes)
       VALUES (?, ?, '2026-07-30T16:00:00.000Z', 'math', 30)`
    ).run(center.id, student.id);
    await db.prepare(
      `INSERT INTO sessions (center_id, student_id, check_in_time, subjects, allowance_minutes)
       VALUES (?, ?, '2026-07-30T17:00:00.000Z', 'reading', 30)`
    ).run(center.id, student.id);

    const closed = await closeStaleOpenSessions(center.id, '2026-07-30');
    expect(closed).toBeGreaterThanOrEqual(1);

    const open = await db
      .prepare(
        `SELECT * FROM sessions
         WHERE student_id = ? AND check_out_time IS NULL
         ORDER BY check_in_time DESC`
      )
      .all(student.id);
    expect(open).toHaveLength(1);
    expect(open[0].check_in_time).toBe('2026-07-30T17:00:00.000Z');

    const closedRows = await db
      .prepare(
        `SELECT * FROM sessions WHERE student_id = ? AND check_out_time IS NOT NULL`
      )
      .all(student.id);
    expect(closedRows).toHaveLength(1);
    expect(closedRows[0].check_in_time).toBe('2026-07-30T16:00:00.000Z');
    expect(closedRows[0].duration_minutes).toBe(30);

    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_session_per_student
        ON sessions(student_id) WHERE check_out_time IS NULL
    `);
  });
});
