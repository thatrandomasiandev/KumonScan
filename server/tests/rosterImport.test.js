import { beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { importRosterFromContent } from '../rosterImport.js';
import { parseScheduleDays } from '../timeService.js';

async function seedStudent({
  first,
  last,
  subjects = 'math',
  days = '["Mon","Wed","Fri"]',
  phone = '555-0100',
} = {}) {
  const qr = `KUMON-${uuidv4().slice(0, 8).toUpperCase()}`;
  await db
    .prepare(
      `INSERT INTO students
         (first_name, last_name, qr_code_value, active, enrolled_subjects, schedule_days, parent_phone)
       VALUES (?, ?, ?, 1, ?, ?, ?)`
    )
    .run(first, last, qr, subjects, days, phone);
}

describe('rosterImport', () => {
  beforeEach(async () => {
    await db.exec('DELETE FROM sessions');
    await db.exec('DELETE FROM students');
  });

  it('does not touch schedule_days when CRM upload has no Days column', async () => {
    await seedStudent({ first: 'Ada', last: 'Lovelace', days: '["Tue","Thu"]' });

    const csv = [
      'First Name,Last Name,Subjects',
      'Ada,Lovelace,both',
    ].join('\n');

    const result = await importRosterFromContent(csv);
    expect(result.summary.updated).toBe(1);
    expect(result.sourceColumns.hasDaysColumn).toBe(false);

    const row = await db
      .prepare(`SELECT * FROM students WHERE first_name = 'Ada' AND last_name = 'Lovelace'`)
      .get();
    expect(parseScheduleDays(row.schedule_days)).toEqual(['Tue', 'Thu']);
    expect(row.enrolled_subjects).toBe('both');
  });

  it('does not overwrite subjects when Subjects cell is blank for an existing student', async () => {
    await seedStudent({ first: 'Grace', last: 'Hopper', subjects: 'reading' });

    const csv = [
      'First Name,Last Name,Subjects,Days',
      'Grace,Hopper,,Mon Wed',
    ].join('\n');

    const result = await importRosterFromContent(csv);
    expect(result.summary.updated).toBe(1);

    const row = await db
      .prepare(`SELECT * FROM students WHERE first_name = 'Grace' AND last_name = 'Hopper'`)
      .get();
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

    const result = await importRosterFromContent(csv);
    expect(result.summary.created).toBe(1);
    expect(result.summary.errored).toHaveLength(0);
    expect(result.summary.skipped.length).toBeGreaterThanOrEqual(2);

    const created = await db
      .prepare(`SELECT * FROM students WHERE first_name = 'Valid' AND last_name = 'Student'`)
      .get();
    expect(created).toBeTruthy();
    expect(created.enrolled_subjects).toBe('reading');
  });
});
