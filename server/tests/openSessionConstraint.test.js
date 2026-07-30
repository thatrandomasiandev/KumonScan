import { beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

describe('open session unique index (F3)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM students');
  });

  it('rejects a second open session insert for the same student', () => {
    const qr = `KUMON-${uuidv4().slice(0, 8).toUpperCase()}`;
    const studentId = db
      .prepare(
        `INSERT INTO students (first_name, last_name, qr_code_value, active, enrolled_subjects)
         VALUES ('Unique', 'Constraint', ?, 1, 'math')`
      )
      .run(qr).lastInsertRowid;

    db.prepare(
      `INSERT INTO sessions (student_id, check_in_time, subjects, allowance_minutes)
       VALUES (?, '2026-07-30T10:00:00.000Z', 'math', 30)`
    ).run(studentId);

    expect(() => {
      db.prepare(
        `INSERT INTO sessions (student_id, check_in_time, subjects, allowance_minutes)
         VALUES (?, '2026-07-30T10:05:00.000Z', 'math', 30)`
      ).run(studentId);
    }).toThrow(/UNIQUE|constraint/i);
  });
});
