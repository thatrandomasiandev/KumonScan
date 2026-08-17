import db, { ensureDb, exec, get, sqlNow } from '../db.js';
import { fetchAuthoritativeTime } from '../timeService.js';
import { formatFullName } from '../utils/names.js';

/**
 * Curriculum / worksheet progress tracking.
 *
 * Every Kumon level is 200 worksheet pages. Level codes are Kumon's real
 * public naming (Math 7A→O, Reading 7A→L with the I/II split levels), so
 * they are not alphabetically sortable — `sequence_order` provides ordering.
 *
 * Level advancement is an explicit staff action: a completion only moves the
 * student to another level when `level_code` is passed. Logging page 200 (or
 * page 1 after page 200) never auto-advances.
 */

export const PAGES_PER_LEVEL = 200;

export const SUBJECTS = ['math', 'reading'];

/** Kumon Math program: 21 levels, 7A through O. */
export const MATH_LEVELS = [
  '7A', '6A', '5A', '4A', '3A', '2A',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
];

/** Kumon Reading program: 7A–2A, then the I/II split levels AI through FII, then G–L. */
export const READING_LEVELS = [
  '7A', '6A', '5A', '4A', '3A', '2A',
  'AI', 'AII', 'BI', 'BII', 'CI', 'CII',
  'DI', 'DII', 'EI', 'EII', 'FI', 'FII',
  'G', 'H', 'I', 'J', 'K', 'L',
];

const LEVELS_BY_SUBJECT = { math: MATH_LEVELS, reading: READING_LEVELS };

export class CurriculumError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CurriculumError';
    this.status = status;
  }
}

let schemaPromise = null;

/**
 * Creates the curriculum tables and seeds `curriculum_levels` once per
 * process. Kept out of `ensureDb()` so this feature stays self-contained.
 */
export async function ensureCurriculumSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      // students/sessions must exist first: the tables below reference them.
      await ensureDb();
      await exec(`
        CREATE TABLE IF NOT EXISTS curriculum_levels (
          id SERIAL PRIMARY KEY,
          subject TEXT NOT NULL,
          level_code TEXT NOT NULL,
          sequence_order INTEGER NOT NULL,
          UNIQUE(subject, level_code)
        )
      `);
      await exec(`
        CREATE TABLE IF NOT EXISTS student_progress (
          id SERIAL PRIMARY KEY,
          student_id INTEGER NOT NULL REFERENCES students(id),
          subject TEXT NOT NULL,
          current_level_id INTEGER REFERENCES curriculum_levels(id),
          current_page INTEGER,
          updated_at TEXT NOT NULL,
          UNIQUE(student_id, subject)
        )
      `);
      // graded_by_staff_id is a plain integer: there is no staff table yet
      // (auth is a single admin password). Becomes an FK when staff lands.
      await exec(`
        CREATE TABLE IF NOT EXISTS worksheet_completions (
          id SERIAL PRIMARY KEY,
          student_id INTEGER NOT NULL REFERENCES students(id),
          session_id INTEGER REFERENCES sessions(id),
          level_id INTEGER NOT NULL REFERENCES curriculum_levels(id),
          page_number INTEGER NOT NULL,
          accuracy_pct INTEGER,
          completed_at TEXT NOT NULL,
          graded_by_staff_id INTEGER
        )
      `);
      await exec(`
        CREATE INDEX IF NOT EXISTS idx_worksheet_completions_student
          ON worksheet_completions(student_id, completed_at)
      `);
      await seedLevels();
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

async function seedLevels() {
  for (const subject of SUBJECTS) {
    const { count } = await get(
      'SELECT COUNT(*) AS count FROM curriculum_levels WHERE subject = ?',
      [subject]
    );
    if (count > 0) continue;
    const codes = LEVELS_BY_SUBJECT[subject];
    for (let i = 0; i < codes.length; i++) {
      await db
        .prepare(
          `INSERT INTO curriculum_levels (subject, level_code, sequence_order)
           VALUES (?, ?, ?)
           ON CONFLICT (subject, level_code) DO NOTHING`
        )
        .run(subject, codes[i], i + 1);
    }
  }
}

function assertSubject(subject) {
  if (!SUBJECTS.includes(subject)) {
    throw new CurriculumError('subject must be math or reading');
  }
}

/** Progress logging must not depend on timeapi.io being reachable. */
async function completionTimestamp() {
  try {
    const time = await fetchAuthoritativeTime();
    return time.iso;
  } catch {
    return sqlNow();
  }
}

export async function listLevels(subject = null) {
  await ensureCurriculumSchema();
  if (subject != null) {
    assertSubject(subject);
    return db
      .prepare(
        `SELECT id, subject, level_code, sequence_order
         FROM curriculum_levels WHERE subject = ? ORDER BY sequence_order ASC`
      )
      .all(subject);
  }
  return db
    .prepare(
      `SELECT id, subject, level_code, sequence_order
       FROM curriculum_levels ORDER BY subject ASC, sequence_order ASC`
    )
    .all();
}

/**
 * Current level/page per subject plus recent completion history.
 */
export async function getStudentProgress(studentId, { historyLimit = 20 } = {}) {
  await ensureCurriculumSchema();

  const progress = await db
    .prepare(
      `SELECT sp.subject, sp.current_page, sp.updated_at,
              cl.id AS level_id, cl.level_code, cl.sequence_order
       FROM student_progress sp
       LEFT JOIN curriculum_levels cl ON cl.id = sp.current_level_id
       WHERE sp.student_id = ?
       ORDER BY sp.subject ASC`
    )
    .all(studentId);

  const history = await db
    .prepare(
      `SELECT wc.id, wc.page_number, wc.accuracy_pct, wc.completed_at,
              wc.session_id, cl.subject, cl.level_code
       FROM worksheet_completions wc
       JOIN curriculum_levels cl ON cl.id = wc.level_id
       WHERE wc.student_id = ?
       ORDER BY wc.completed_at DESC, wc.id DESC
       LIMIT ${Number(historyLimit)}`
    )
    .all(studentId);

  return {
    progress: progress.map((row) => ({
      subject: row.subject,
      level_code: row.level_code,
      sequence_order: row.sequence_order,
      current_page: row.current_page,
      pages_per_level: PAGES_PER_LEVEL,
      updated_at: row.updated_at,
    })),
    history,
  };
}

/**
 * Log a completed worksheet and move `current_page` to it.
 *
 * Level resolution:
 * - `level_code` passed → that level (the explicit advancement/correction path).
 * - otherwise → the student's current level for the subject; if none exists
 *   yet, the caller must pass `level_code` to set the starting level.
 */
export async function logCompletion(
  studentId,
  { subject, page_number, accuracy_pct = null, session_id = null, level_code = null } = {}
) {
  await ensureCurriculumSchema();
  assertSubject(subject);

  const page = Number(page_number);
  if (!Number.isInteger(page) || page < 1 || page > PAGES_PER_LEVEL) {
    throw new CurriculumError(`page_number must be an integer from 1 to ${PAGES_PER_LEVEL}`);
  }

  let accuracy = null;
  if (accuracy_pct != null && accuracy_pct !== '') {
    accuracy = Number(accuracy_pct);
    if (!Number.isInteger(accuracy) || accuracy < 0 || accuracy > 100) {
      throw new CurriculumError('accuracy_pct must be an integer from 0 to 100');
    }
  }

  const existing = await db
    .prepare(
      `SELECT sp.id, sp.current_level_id, cl.level_code
       FROM student_progress sp
       LEFT JOIN curriculum_levels cl ON cl.id = sp.current_level_id
       WHERE sp.student_id = ? AND sp.subject = ?`
    )
    .get(studentId, subject);

  let levelId;
  if (level_code != null && level_code !== '') {
    const level = await db
      .prepare('SELECT id FROM curriculum_levels WHERE subject = ? AND level_code = ?')
      .get(subject, String(level_code).toUpperCase());
    if (!level) {
      throw new CurriculumError(`Unknown ${subject} level: ${level_code}`);
    }
    levelId = level.id;
  } else if (existing?.current_level_id) {
    levelId = existing.current_level_id;
  } else {
    throw new CurriculumError(
      `No current ${subject} level for this student. Pass level_code to set the starting level.`
    );
  }

  let sessionId = null;
  if (session_id != null && session_id !== '') {
    sessionId = Number(session_id);
    if (!Number.isInteger(sessionId) || sessionId < 1) {
      throw new CurriculumError('session_id must be a positive integer');
    }
    const session = await db
      .prepare('SELECT id FROM sessions WHERE id = ? AND student_id = ?')
      .get(sessionId, studentId);
    if (!session) {
      throw new CurriculumError('session_id does not belong to this student');
    }
  }

  const completedAt = await completionTimestamp();

  const inserted = await db
    .prepare(
      `INSERT INTO worksheet_completions
         (student_id, session_id, level_id, page_number, accuracy_pct, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(studentId, sessionId, levelId, page, accuracy, completedAt);

  await db
    .prepare(
      `INSERT INTO student_progress (student_id, subject, current_level_id, current_page, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (student_id, subject) DO UPDATE SET
         current_level_id = EXCLUDED.current_level_id,
         current_page = EXCLUDED.current_page,
         updated_at = EXCLUDED.updated_at`
    )
    .run(studentId, subject, levelId, page, completedAt);

  const completion = await db
    .prepare(
      `SELECT wc.id, wc.page_number, wc.accuracy_pct, wc.completed_at,
              wc.session_id, cl.subject, cl.level_code
       FROM worksheet_completions wc
       JOIN curriculum_levels cl ON cl.id = wc.level_id
       WHERE wc.id = ?`
    )
    .get(inserted.lastInsertRowid);

  return completion;
}

/**
 * Pages completed per week per active student over a trailing window.
 * Students with zero completions in the window report a pace of 0.
 *
 * Window filtering parses timestamps in JS because `completed_at` may be a
 * timeapi.io local ISO (no zone suffix) or a UTC fallback; epoch comparison
 * handles both, matching how the attendance report filters sessions.
 */
export async function getProgressPace({ centerId, weeks = 4 } = {}) {
  await ensureCurriculumSchema();

  if (!Number.isInteger(centerId) || centerId < 1) {
    throw new CurriculumError('centerId is required', 500);
  }

  const parsedWeeks = Number(weeks);
  if (!Number.isInteger(parsedWeeks) || parsedWeeks < 1 || parsedWeeks > 26) {
    throw new CurriculumError('weeks must be an integer from 1 to 26');
  }

  const windowStartMs = Date.now() - parsedWeeks * 7 * 24 * 60 * 60 * 1000;

  const students = await db
    .prepare(
      `SELECT id, first_name, last_name FROM students
       WHERE active = 1 AND center_id = ? ORDER BY first_name ASC, last_name ASC`
    )
    .all(centerId);

  const completions = await db
    .prepare(
      `SELECT wc.student_id, wc.completed_at, cl.subject
       FROM worksheet_completions wc
       JOIN curriculum_levels cl ON cl.id = wc.level_id
       JOIN students st ON st.id = wc.student_id
       WHERE st.center_id = ?`
    )
    .all(centerId);

  const counts = new Map();
  for (const row of completions) {
    const completedMs = new Date(row.completed_at).getTime();
    if (Number.isNaN(completedMs) || completedMs < windowStartMs) continue;
    const entry = counts.get(row.student_id) || { math: 0, reading: 0 };
    entry[row.subject] += 1;
    counts.set(row.student_id, entry);
  }

  const rows = students.map((student) => {
    const entry = counts.get(student.id) || { math: 0, reading: 0 };
    const total = entry.math + entry.reading;
    return {
      id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      name: formatFullName(student),
      math_pages: entry.math,
      reading_pages: entry.reading,
      total_pages: total,
      pages_per_week: Math.round((total / parsedWeeks) * 10) / 10,
    };
  });

  return {
    weeks: parsedWeeks,
    window_start: new Date(windowStartMs).toISOString(),
    students: rows,
    summary: {
      student_count: rows.length,
      total_pages: rows.reduce((sum, r) => sum + r.total_pages, 0),
      avg_pages_per_week:
        rows.length > 0
          ? Math.round(
              (rows.reduce((sum, r) => sum + r.pages_per_week, 0) / rows.length) * 10
            ) / 10
          : 0,
    },
  };
}
