import { beforeEach, describe, expect, it } from 'vitest';
import db from '../db.js';
import { defaultCenter, insertStudent, wipeCenterData } from './helpers.js';

describe('open session unique index (F3)', () => {
  let center;

  beforeEach(async () => {
    center = await defaultCenter();
    await wipeCenterData(center.id);
  });

  it('rejects a second open session insert for the same student', async () => {
    const student = await insertStudent(center.id, {
      first: 'Unique',
      last: 'Constraint',
      subjects: 'math',
    });

    await db.prepare(
      `INSERT INTO sessions (center_id, student_id, check_in_time, subjects, allowance_minutes)
       VALUES (?, ?, '2026-07-30T10:00:00.000Z', 'math', 30)`
    ).run(center.id, student.id);

    await expect(
      db.prepare(
        `INSERT INTO sessions (center_id, student_id, check_in_time, subjects, allowance_minutes)
         VALUES (?, ?, '2026-07-30T10:05:00.000Z', 'math', 30)`
      ).run(center.id, student.id)
    ).rejects.toThrow(/unique|constraint|duplicate/i);
  });
});
