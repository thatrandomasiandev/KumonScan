import { beforeEach, describe, expect, it } from 'vitest';
import db from '../db.js';
import { importRosterFromContent } from '../rosterImport.js';
import { parseScheduleDays } from '../timeService.js';
import { defaultCenter, insertStudent, wipeCenterData } from './helpers.js';

describe('rosterImport', () => {
  let center;

  beforeEach(async () => {
    center = await defaultCenter();
    await wipeCenterData(center.id);
  });

  it('does not touch schedule_days when CRM upload has no Days column', async () => {
    await insertStudent(center.id, {
      first: 'Ada',
      last: 'Lovelace',
      days: '["Tue","Thu"]',
      parent_phone: '555-0100',
    });

    const csv = [
      'First Name,Last Name,Subjects',
      'Ada,Lovelace,both',
    ].join('\n');

    const result = await importRosterFromContent(csv, center.id);
    expect(result.summary.updated).toBe(1);
    expect(result.sourceColumns.hasDaysColumn).toBe(false);

    const row = await db
      .prepare(
        `SELECT * FROM students WHERE center_id = ? AND first_name = 'Ada' AND last_name = 'Lovelace'`
      )
      .get(center.id);
    expect(parseScheduleDays(row.schedule_days)).toEqual(['Tue', 'Thu']);
    expect(row.enrolled_subjects).toBe('both');
  });

  it('does not overwrite subjects when Subjects cell is blank for an existing student', async () => {
    await insertStudent(center.id, {
      first: 'Grace',
      last: 'Hopper',
      subjects: 'reading',
      parent_phone: '555-0100',
    });

    const csv = [
      'First Name,Last Name,Subjects,Days',
      'Grace,Hopper,,Mon Wed',
    ].join('\n');

    const result = await importRosterFromContent(csv, center.id);
    expect(result.summary.updated).toBe(1);

    const row = await db
      .prepare(
        `SELECT * FROM students WHERE center_id = ? AND first_name = 'Grace' AND last_name = 'Hopper'`
      )
      .get(center.id);
    expect(row.enrolled_subjects).toBe('reading');
    expect(parseScheduleDays(row.schedule_days)).toEqual(['Mon', 'Wed']);
  });

  it('lands invalid names in skipped without aborting the batch', async () => {
    const csv = [
      'First Name,Last Name,Subjects',
      ',MissingFirst,math',
      'Valid,Student,reading',
      '123,OnlyNumbers,both',
    ].join('\n');

    const result = await importRosterFromContent(csv, center.id);
    expect(result.summary.created).toBe(1);
    expect(result.summary.errored).toHaveLength(0);
    expect(result.summary.skipped.length).toBeGreaterThanOrEqual(2);

    const created = await db
      .prepare(
        `SELECT * FROM students WHERE center_id = ? AND first_name = 'Valid' AND last_name = 'Student'`
      )
      .get(center.id);
    expect(created).toBeTruthy();
    expect(created.enrolled_subjects).toBe('reading');
  });

  it('rolls back the entire import when a row fails mid-batch (real transaction)', async () => {
    // Inject a genuine database failure on the third row: a temporary check
    // constraint that rejects one specific name. Rows 1 and 2 insert cleanly,
    // row 3 aborts the transaction, and BEGIN/COMMIT semantics must roll the
    // first two inserts back too.
    await db.exec(
      `ALTER TABLE students ADD CONSTRAINT test_reject_evil CHECK (first_name <> 'Evil')`
    );

    try {
      const csv = [
        'First Name,Last Name,Subjects',
        'Alan,Turing,math',
        'Katherine,Johnson,reading',
        'Evil,Row,both',
      ].join('\n');

      await expect(importRosterFromContent(csv, center.id)).rejects.toThrow(/test_reject_evil|check/i);

      const count = (
        await db
          .prepare('SELECT COUNT(*) AS count FROM students WHERE center_id = ?')
          .get(center.id)
      ).count;
      expect(count).toBe(0);
    } finally {
      await db.exec('ALTER TABLE students DROP CONSTRAINT IF EXISTS test_reject_evil');
    }
  });
});
