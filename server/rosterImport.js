import { parse } from 'csv-parse/sync';
import { v4 as uuidv4 } from 'uuid';
import { sqlNow, withRealTransaction } from './db.js';
import { normalizeName, validateNameField } from './utils/names.js';
import { normalizeSubjects } from './sessionRules.js';
import { normalizeScheduleDaysInput, WEEKDAY_SHORTS } from './timeService.js';

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
}) {
  const setClauses = [];
  if (hasSubjectsColumn && hasSubjectsValue) setClauses.push('enrolled_subjects = ?');
  if (hasDaysColumn) setClauses.push('schedule_days = ?');
  if (hasActiveColumn) setClauses.push('active = ?');
  setClauses.push("parent_phone = COALESCE(NULLIF(?, ''), parent_phone)");

  return `UPDATE students
     SET ${setClauses.join(', ')}
     WHERE id = ? AND center_id = ?`;
}

function rowLabel(i) {
  return `Row ${i + 2}`;
}

export async function importRosterFromContent(content, centerId) {
  if (!Number.isInteger(centerId) || centerId < 1) {
    throw new Error('importRosterFromContent requires a valid centerId');
  }
  const detectedDelimiter = detectDelimiter(content);

  const rawRecords = parse(content, {
    delimiter: detectedDelimiter,
    columns: true,
    trim: true,
    skip_empty_lines: true,
    bom: true,
  });

  if (rawRecords.length === 0) {
    return {
      detectedDelimiter,
      delimiterLabel: DELIMITER_NAMES[detectedDelimiter] || 'unknown',
      totalProcessed: 0,
      summary: {
        created: 0,
        updated: 0,
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

  const summary = {
    created: 0,
    updated: 0,
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
        ? normalizeSubjects(subjectsCell) || 'both'
        : 'both';

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

      candidates.push({
        first_name,
        last_name,
        hasSubjectsValue,
        enrolled_subjects,
        schedule_days,
        active,
        parent_phone,
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
    const insertStudent = tx.prepare(
      `INSERT INTO students
         (center_id, first_name, last_name, qr_code_value, active, enrolled_subjects, schedule_days, parent_phone, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const row of candidates) {
      const existing = await findByName.get(centerId, row.first_name, row.last_name);

      if (existing) {
        const updateStudent = tx.prepare(
          updateStudentSql({
            hasSubjectsColumn,
            hasSubjectsValue: row.hasSubjectsValue,
            hasDaysColumn,
            hasActiveColumn,
          })
        );
        const params = [];
        if (hasSubjectsColumn && row.hasSubjectsValue) params.push(row.enrolled_subjects);
        if (hasDaysColumn) params.push(row.schedule_days);
        if (hasActiveColumn) params.push(row.active);
        params.push(row.parent_phone, existing.id, centerId);
        await updateStudent.run(...params);
        summary.updated++;
      } else {
        const qr_code_value = `KUMON-${uuidv4().slice(0, 8).toUpperCase()}`;
        await insertStudent.run(
          centerId,
          row.first_name,
          row.last_name,
          qr_code_value,
          row.active,
          row.enrolled_subjects,
          row.schedule_days,
          row.parent_phone || null,
          sqlNow()
        );
        summary.created++;
      }
    }
  }).catch((err) => {
    // Counts accumulated before the failure are meaningless after rollback.
    summary.created = 0;
    summary.updated = 0;
    throw err;
  });

  return {
    detectedDelimiter,
    delimiterLabel: DELIMITER_NAMES[detectedDelimiter] || 'unknown',
    totalProcessed: rawRecords.length,
    summary,
    sourceColumns: {
      hasSubjectsColumn,
      hasDaysColumn,
      hasActiveColumn,
      hasPhoneColumn,
    },
  };
}
