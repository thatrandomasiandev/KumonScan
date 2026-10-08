import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { sqlNow, withRealTransaction } from './db.js';
import { normalizeName, validateNameField } from './utils/names.js';
import { normalizeSubjects } from './sessionRules.js';
import { normalizeScheduleDaysInput, WEEKDAY_SHORTS } from './timeService.js';
import { parseStudentNumber } from './services/studentService.js';

export const DELIMITER_NAMES = {
  '\t': 'tab',
  ',': 'comma',
  ';': 'semicolon',
};

function normalizeHeaders(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    out[key.trim().toLowerCase()] = value;
  }
  return out;
}

export function detectDelimiter(content) {
  const firstLine = content.split(/\r?\n/, 1)[0] || '';
  const candidates = ['\t', ',', ';'];
  const scored = candidates.map((delimiter) => ({
    delimiter,
    count: (firstLine.match(new RegExp(`\\${delimiter}`, 'g')) || []).length,
  }));
  scored.sort((a, b) => b.count - a.count);
  return scored[0].delimiter;
}

function parseDaysCell(raw) {
  if (!raw || raw.trim() === '') return [];

  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .filter((t) => WEEKDAY_SHORTS.includes(t));

  return [...new Set(tokens)];
}

function parseActiveCell(raw) {
  if (!raw || raw.trim() === '') return true;
  const lower = raw.trim().toLowerCase();
  return lower !== 'false' && lower !== '0';
}

/**
 * Normalize CRM / spreadsheet birth dates to YYYY-MM-DD.
 * Accepts MM/DD/YYYY (Kumon CRM), YYYY-MM-DD, and ISO datetime strings.
 * Returns null when blank or unparseable (row still imports without DOB).
 */
export function parseDateOfBirth(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  // ISO datetime from ExcelJS Date cells (toISOString).
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidYmd(y, m, d)) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
    return null;
  }

  // Kumon CRM: 09/22/2012 or 9/22/2012
  const usMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const m = Number(usMatch[1]);
    const d = Number(usMatch[2]);
    const y = Number(usMatch[3]);
    if (isValidYmd(y, m, d)) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }

  return null;
}

function isValidYmd(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
  );
}

function headerHasAny(headers, names) {
  return names.some((name) => headers.has(name));
}

function firstNonBlankValue(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
}

function updateStudentSql({
  hasSubjectsColumn,
  hasSubjectsValue,
  hasDaysColumn,
  hasActiveColumn,
  hasStudentNumberColumn,
  hasDobValue,
}) {
  const setClauses = [];
  if (hasSubjectsColumn && hasSubjectsValue) setClauses.push('enrolled_subjects = ?');
  if (hasDaysColumn) setClauses.push('schedule_days = ?');
  if (hasActiveColumn) setClauses.push('active = ?');
  if (hasStudentNumberColumn) setClauses.push('student_number = ?');
  if (hasDobValue) setClauses.push('date_of_birth = ?');
  setClauses.push("parent_phone = COALESCE(NULLIF(?, ''), parent_phone)");

  return `UPDATE students
     SET ${setClauses.join(', ')}
     WHERE id = ? AND center_id = ?`;
}

function rowLabel(i) {
  return `Row ${i + 2}`;
}

/** Flattens an ExcelJS cell value (rich text, formula result, Date, ...) to a plain string. */
function cellToString(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join('');
    }
    if ('result' in value) return cellToString(value.result);
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value).trim();
}

/**
 * Parses the first worksheet of an XLSX workbook into the same shape
 * csv-parse's `{ columns: true }` produces: an array of objects keyed by the
 * raw header cell text, one per non-blank data row.
 */
async function parseXlsxRecords(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  // ExcelJS's getSheetValues() is 1-indexed on both rows and columns
  // (index 0 is always undefined) — mirrors the workbook's own numbering.
  const sheetRows = worksheet.getSheetValues();
  if (sheetRows.length < 2) return [];

  const headerRow = sheetRows[1] || [];
  const headers = headerRow.map((cell) => cellToString(cell));

  const records = [];
  for (let r = 2; r < sheetRows.length; r++) {
    const row = sheetRows[r];
    if (!row) continue;

    const record = {};
    let hasValue = false;
    for (let col = 1; col < headers.length; col++) {
      const header = headers[col];
      if (!header) continue;
      const value = cellToString(row[col]);
      record[header] = value;
      if (value !== '') hasValue = true;
    }
    if (hasValue) records.push(record);
  }
  return records;
}

/**
 * @param {string} content raw CSV/TSV text, or base64-encoded XLSX bytes when format === 'xlsx'
 * @param {number} centerId
 * @param {{ mode?: 'merge' | 'replace', format?: 'text' | 'xlsx' }} [options]
 *   mode 'replace' deactivates every existing active student not matched by
 *   the uploaded file (soft delete — session history is never destroyed).
 */
export async function importRosterFromContent(
  content,
  centerId,
  { mode = 'merge', format = 'text' } = {}
) {
  if (!Number.isInteger(centerId) || centerId < 1) {
    throw new Error('importRosterFromContent requires a valid centerId');
  }
  if (mode !== 'merge' && mode !== 'replace') {
    throw new Error("mode must be 'merge' or 'replace'");
  }

  let detectedDelimiter = null;
  let delimiterLabel = 'xlsx';
  let rawRecords;

  if (format === 'xlsx') {
    let buffer;
    try {
      buffer = Buffer.from(content, 'base64');
    } catch {
      throw new Error('Invalid XLSX file content');
    }
    rawRecords = await parseXlsxRecords(buffer);
  } else {
    detectedDelimiter = detectDelimiter(content);
    delimiterLabel = DELIMITER_NAMES[detectedDelimiter] || 'unknown';
    rawRecords = parse(content, {
      delimiter: detectedDelimiter,
      columns: true,
      trim: true,
      skip_empty_lines: true,
      bom: true,
    });
  }

  if (rawRecords.length === 0) {
    return {
      detectedDelimiter,
      delimiterLabel,
      totalProcessed: 0,
      summary: {
        created: 0,
        updated: 0,
        deactivated: 0,
        skipped: [],
        errored: [],
      },
    };
  }

  const normalizedHeaderSet = new Set(
    Object.keys(rawRecords[0] || {}).map((key) => key.trim().toLowerCase())
  );

  const hasSubjectsColumn = headerHasAny(normalizedHeaderSet, ['subjects']);
  const hasDaysColumn = headerHasAny(normalizedHeaderSet, ['days', 'schedule_days']);
  const hasActiveColumn = headerHasAny(normalizedHeaderSet, ['active']);
  const hasPhoneColumn = headerHasAny(normalizedHeaderSet, [
    'phone',
    'mother cell phone',
    'father cell phone',
    'home phone',
  ]);
  const hasStudentNumberColumn = headerHasAny(normalizedHeaderSet, [
    'student id',
    'student_id',
    'student number',
    'student_number',
    'id number',
    'id',
  ]);
  const hasDobColumn = headerHasAny(normalizedHeaderSet, [
    'date of birth',
    'date_of_birth',
    'dob',
    'birthday',
    'birth date',
  ]);

  const summary = {
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: [],
    errored: [],
  };

  // Pass 1: validate and normalize every row before touching the database.
  // Skips and normalization errors are collected here; only clean rows reach
  // the transactional write pass below.
  const candidates = [];

  for (let i = 0; i < rawRecords.length; i++) {
    const normalized = normalizeHeaders(rawRecords[i]);
    const label = rowLabel(i);

    try {
      const rawFirst = normalized['first name'] ?? normalized['firstname'] ?? '';
      const rawLast = normalized['last name'] ?? normalized['lastname'] ?? '';

      const firstError = validateNameField(rawFirst, 'First name');
      if (firstError) {
        summary.skipped.push({ row: label, reason: `First name invalid — ${firstError}` });
        continue;
      }

      const lastError = validateNameField(rawLast, 'Last name');
      if (lastError) {
        summary.skipped.push({ row: label, reason: `Last name invalid — ${lastError}` });
        continue;
      }

      const { first_name, last_name } = normalizeName(rawFirst, rawLast);
      const subjectsCell = String(normalized['subjects'] ?? '').trim();
      const hasSubjectsValue = subjectsCell !== '';
      const enrolled_subjects = hasSubjectsValue
        ? normalizeSubjects(subjectsCell) || 'math+reading'
        : 'math+reading';

      const days = parseDaysCell(normalized['days'] ?? '');
      const schedule_days = JSON.stringify(normalizeScheduleDaysInput(days));
      const active = parseActiveCell(normalized['active'] ?? '') ? 1 : 0;

      const parent_phone = hasPhoneColumn
        ? firstNonBlankValue(normalized, [
            'phone',
            'mother cell phone',
            'father cell phone',
            'home phone',
          ])
        : '';

      let student_number = null;
      if (hasStudentNumberColumn) {
        const rawId = firstNonBlankValue(normalized, [
          'student id',
          'student_id',
          'student number',
          'student_number',
          'id number',
          'id',
        ]);
        if (rawId !== '') {
          try {
            student_number = parseStudentNumber(rawId);
          } catch (err) {
            summary.skipped.push({
              row: label,
              reason: err.message || 'Invalid student ID',
            });
            continue;
          }
        }
      }

      let date_of_birth = null;
      if (hasDobColumn) {
        const rawDob = firstNonBlankValue(normalized, [
          'date of birth',
          'date_of_birth',
          'dob',
          'birthday',
          'birth date',
        ]);
        if (rawDob !== '') {
          date_of_birth = parseDateOfBirth(rawDob);
          // Unparseable DOB does not skip the row — CRM rows still import.
        }
      }

      candidates.push({
        first_name,
        last_name,
        hasSubjectsValue,
        enrolled_subjects,
        schedule_days,
        active,
        parent_phone,
        student_number,
        hasStudentNumberValue: student_number != null,
        date_of_birth,
        hasDobValue: date_of_birth != null,
      });
    } catch (err) {
      summary.errored.push({ row: label, error: err.message });
    }
  }

  // Pass 2: all writes happen in one real transaction. Any database error
  // (e.g. a mid-batch network failure) rolls back the entire import instead
  // of leaving the roster half-updated.
  await withRealTransaction(async (tx) => {
    const findByName = tx.prepare(
      `SELECT * FROM students
       WHERE center_id = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)`
    );
    const findByNumber = tx.prepare(
      'SELECT * FROM students WHERE center_id = ? AND student_number = ?'
    );
    const insertStudent = tx.prepare(
      `INSERT INTO students
         (center_id, first_name, last_name, active, enrolled_subjects, schedule_days, parent_phone, student_number, date_of_birth, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const touchedIds = [];

    for (const row of candidates) {
      let existing =
        row.hasStudentNumberValue
          ? await findByNumber.get(centerId, row.student_number)
          : null;
      if (!existing) {
        existing = await findByName.get(centerId, row.first_name, row.last_name);
      }

      if (existing) {
        const updateStudent = tx.prepare(
          updateStudentSql({
            hasSubjectsColumn,
            hasSubjectsValue: row.hasSubjectsValue,
            hasDaysColumn,
            hasActiveColumn,
            hasStudentNumberColumn: hasStudentNumberColumn && row.hasStudentNumberValue,
            hasDobValue: row.hasDobValue,
          })
        );
        const params = [];
        if (hasSubjectsColumn && row.hasSubjectsValue) params.push(row.enrolled_subjects);
        if (hasDaysColumn) params.push(row.schedule_days);
        if (hasActiveColumn) params.push(row.active);
        if (hasStudentNumberColumn && row.hasStudentNumberValue) {
          params.push(row.student_number);
        }
        if (row.hasDobValue) params.push(row.date_of_birth);
        params.push(row.parent_phone, existing.id, centerId);
        await updateStudent.run(...params);
        summary.updated++;
        touchedIds.push(existing.id);
      } else {
        const inserted = await insertStudent.run(
          centerId,
          row.first_name,
          row.last_name,
          row.active,
          row.enrolled_subjects,
          row.schedule_days,
          row.parent_phone || null,
          row.student_number,
          row.date_of_birth,
          sqlNow()
        );
        summary.created++;
        touchedIds.push(inserted.lastInsertRowid);
      }
    }

    if (mode === 'replace') {
      if (summary.created + summary.updated === 0) {
        throw new Error(
          'Replace mode requires at least one valid row in the uploaded file — refusing to deactivate the entire roster from an empty or invalid import.'
        );
      }
      const deactivateResult = await tx
        .prepare(
          `UPDATE students SET active = 0
           WHERE center_id = ? AND active = 1 AND id != ALL(?::int[])`
        )
        .run(centerId, touchedIds);
      summary.deactivated = deactivateResult.changes;
    }
  }).catch((err) => {
    // Counts accumulated before the failure are meaningless after rollback.
    summary.created = 0;
    summary.updated = 0;
    summary.deactivated = 0;
    throw err;
  });

  return {
    detectedDelimiter,
    delimiterLabel,
    totalProcessed: rawRecords.length,
    summary,
    sourceColumns: {
      hasSubjectsColumn,
      hasDaysColumn,
      hasActiveColumn,
      hasPhoneColumn,
      hasStudentNumberColumn,
      hasDobColumn,
    },
  };
}
