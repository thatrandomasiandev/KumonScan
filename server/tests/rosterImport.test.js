import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import db from '../db.js';
import { importRosterFromContent } from '../rosterImport.js';
import { parseScheduleDays } from '../timeService.js';
import { defaultCenter, insertStudent, wipeCenterData } from './helpers.js';

async function buildXlsxBase64(headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Roster');
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString('base64');
}

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

  it('replace mode deactivates existing students absent from the new file', async () => {
    const keep = await insertStudent(center.id, { first: 'Keep', last: 'Me' });
    const drop = await insertStudent(center.id, { first: 'Drop', last: 'Me' });

    const csv = ['First Name,Last Name', 'Keep,Me', 'New,Student'].join('\n');
    const result = await importRosterFromContent(csv, center.id, { mode: 'replace' });

    expect(result.summary.created).toBe(1);
    expect(result.summary.updated).toBe(1);
    expect(result.summary.deactivated).toBe(1);

    const keepRow = await db.prepare('SELECT active FROM students WHERE id = ?').get(keep.id);
    const dropRow = await db.prepare('SELECT active FROM students WHERE id = ?').get(drop.id);
    expect(keepRow.active).toBe(1);
    expect(dropRow.active).toBe(0);
  });

  it('replace mode is a soft delete — session history for a dropped student survives', async () => {
    const dropped = await insertStudent(center.id, { first: 'History', last: 'Kept' });
    await db
      .prepare(
        `INSERT INTO sessions (center_id, student_id, check_in_time, check_out_time, duration_minutes)
         VALUES (?, ?, '2026-01-01T10:00:00.000Z', '2026-01-01T10:30:00.000Z', 30)`
      )
      .run(center.id, dropped.id);

    const csv = ['First Name,Last Name', 'Someone,Else'].join('\n');
    await importRosterFromContent(csv, center.id, { mode: 'replace' });

    const session = await db
      .prepare('SELECT * FROM sessions WHERE student_id = ?')
      .get(dropped.id);
    expect(session).toBeTruthy();
    const student = await db.prepare('SELECT active FROM students WHERE id = ?').get(dropped.id);
    expect(student.active).toBe(0);
  });

  it('replace mode refuses to wipe the roster when the file has no valid rows', async () => {
    await insertStudent(center.id, { first: 'Still', last: 'Here' });
    const csv = ['First Name,Last Name', ',Missing'].join('\n');

    await expect(
      importRosterFromContent(csv, center.id, { mode: 'replace' })
    ).rejects.toThrow(/refusing to deactivate/i);

    const count = (
      await db.prepare('SELECT COUNT(*) AS count FROM students WHERE center_id = ? AND active = 1').get(center.id)
    ).count;
    expect(count).toBe(1);
  });

  it('merge mode never deactivates students missing from the file', async () => {
    const untouched = await insertStudent(center.id, { first: 'Untouched', last: 'Student' });
    const csv = ['First Name,Last Name', 'New,Student'].join('\n');

    const result = await importRosterFromContent(csv, center.id, { mode: 'merge' });
    expect(result.summary.deactivated).toBe(0);

    const row = await db.prepare('SELECT active FROM students WHERE id = ?').get(untouched.id);
    expect(row.active).toBe(1);
  });

  it('imports an XLSX roster with the same results as the equivalent CSV', async () => {
    const base64 = await buildXlsxBase64(
      ['First Name', 'Last Name', 'Subjects', 'Days'],
      [
        ['Xavier', 'Excel', 'math', 'Mon Wed'],
        ['Yara', 'Sheets', 'reading', ''],
      ]
    );

    const result = await importRosterFromContent(base64, center.id, { format: 'xlsx' });
    expect(result.delimiterLabel).toBe('xlsx');
    expect(result.summary.created).toBe(2);
    expect(result.summary.errored).toEqual([]);
    expect(result.summary.skipped).toEqual([]);

    const xavier = await db
      .prepare(`SELECT * FROM students WHERE center_id = ? AND first_name = 'Xavier'`)
      .get(center.id);
    expect(xavier.enrolled_subjects).toBe('math');
    expect(parseScheduleDays(xavier.schedule_days)).toEqual(['Mon', 'Wed']);
  });

  it('XLSX import supports replace mode too', async () => {
    const drop = await insertStudent(center.id, { first: 'Old', last: 'Roster' });
    const base64 = await buildXlsxBase64(['First Name', 'Last Name'], [['Fresh', 'Roster']]);

    const result = await importRosterFromContent(base64, center.id, {
      format: 'xlsx',
      mode: 'replace',
    });
    expect(result.summary.created).toBe(1);
    expect(result.summary.deactivated).toBe(1);

    const row = await db.prepare('SELECT active FROM students WHERE id = ?').get(drop.id);
    expect(row.active).toBe(0);
  });
});
