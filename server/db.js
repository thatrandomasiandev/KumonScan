import { neon } from '@neondatabase/serverless';
import './loadEnv.js';

/**
 * Neon Postgres client for Vercel (and local).
 * Call sites keep `?` placeholders; they are rewritten to `$1..$n`.
 * `db.prepare()` stays sync; `.get` / `.all` / `.run` are async.
 */

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (Neon connection string). See server/.env.example'
    );
  }
  return url;
}

/** @type {ReturnType<typeof neon> | null} */
let sqlFn = null;

function getSql() {
  if (!sqlFn) {
    sqlFn = neon(requireDatabaseUrl(), { fullResults: true });
  }
  return sqlFn;
}

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function normalizeRow(row) {
  if (!row) return row;
  const out = { ...row };
  if (typeof out.id === 'bigint') out.id = Number(out.id);
  if (typeof out.student_id === 'bigint') out.student_id = Number(out.student_id);
  if (typeof out.session_id === 'bigint') out.session_id = Number(out.session_id);
  if (typeof out.count === 'bigint' || typeof out.count === 'string') {
    out.count = Number(out.count);
  }
  if (typeof out.active === 'boolean') out.active = out.active ? 1 : 0;
  return out;
}

/**
 * @param {string} sqlText
 * @param {unknown[]} [params]
 */
export async function query(sqlText, params = []) {
  const sql = getSql();
  const result = await sql.query(toPgPlaceholders(sqlText), params);
  const rows = (result.rows || []).map(normalizeRow);
  return {
    rows,
    rowCount: result.rowCount ?? rows.length,
  };
}

export async function get(sqlText, params = []) {
  const { rows } = await query(sqlText, params);
  return rows[0];
}

export async function all(sqlText, params = []) {
  const { rows } = await query(sqlText, params);
  return rows;
}

export async function run(sqlText, params = []) {
  const { rows, rowCount } = await query(sqlText, params);
  const lastInsertRowid = rows[0]?.id != null ? Number(rows[0].id) : undefined;
  return { lastInsertRowid, changes: rowCount ?? 0, rows };
}

export async function exec(sqlText) {
  const sql = getSql();
  const statements = sqlText
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await sql.query(statement, []);
  }
}

export async function withTransaction(fn) {
  return fn();
}

export function isUniqueViolation(err) {
  return (
    err?.code === '23505' ||
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (typeof err?.message === 'string' &&
      (err.message.includes('duplicate key') ||
        err.message.includes('unique constraint') ||
        err.message.includes('idx_one_open_session_per_student') ||
        err.message.includes('idx_students_name_ci')))
  );
}

export function isOpenSessionUniqueViolation(err) {
  if (!isUniqueViolation(err)) return false;
  if (typeof err?.message !== 'string') return true;
  return (
    err.message.includes('idx_one_open_session_per_student') ||
    err.message.includes('one_open_session') ||
    err.message.includes('duplicate key')
  );
}

async function tableExists(name) {
  const row = await get(
    `SELECT 1 AS ok
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ?`,
    [name]
  );
  return Boolean(row);
}

async function columnNames(table) {
  const rows = await all(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ?
     ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

async function migrateStudentsTable() {
  if (!(await tableExists('students'))) {
    await exec(`
      CREATE TABLE students (
        id SERIAL PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        qr_code_value TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        registered_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        enrolled_subjects TEXT NOT NULL DEFAULT 'both',
        schedule_days TEXT,
        parent_phone TEXT
      )
    `);
    return;
  }

  const columns = await columnNames('students');

  if (columns.includes('name') && !columns.includes('first_name')) {
    await exec(`
      CREATE TABLE IF NOT EXISTS students_new (
        id INTEGER PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        qr_code_value TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        registered_at TEXT NOT NULL
      )
    `);

    const students = await all('SELECT * FROM students');
    for (const student of students) {
      const parts = String(student.name || '').trim().split(/\s+/);
      const first_name = parts[0] || 'Unknown';
      const last_name = parts.slice(1).join(' ') || 'Student';
      await run(
        `INSERT INTO students_new (id, first_name, last_name, qr_code_value, active, created_at, registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          student.id,
          first_name,
          last_name,
          student.qr_code_value,
          student.active,
          student.created_at,
          student.created_at,
        ]
      );
    }

    await exec('DROP TABLE students');
    await exec('ALTER TABLE students_new RENAME TO students');
    await exec(`CREATE SEQUENCE IF NOT EXISTS students_id_seq`);
    await exec(`ALTER TABLE students ALTER COLUMN id SET DEFAULT nextval('students_id_seq')`);
    await exec(
      `SELECT setval('students_id_seq', COALESCE((SELECT MAX(id) FROM students), 1))`
    );
  }

  let cols = await columnNames('students');
  if (cols.includes('first_name') && !cols.includes('registered_at')) {
    await exec(`ALTER TABLE students ADD COLUMN registered_at TEXT`);
    await exec(
      `UPDATE students SET registered_at = COALESCE(created_at, TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHERE registered_at IS NULL`
    );
  }
  cols = await columnNames('students');
  if (!cols.includes('enrolled_subjects')) {
    await exec(
      `ALTER TABLE students ADD COLUMN enrolled_subjects TEXT NOT NULL DEFAULT 'both'`
    );
  }
  if (!cols.includes('schedule_days')) {
    await exec(`ALTER TABLE students ADD COLUMN schedule_days TEXT`);
  }
  if (!cols.includes('parent_phone')) {
    await exec(`ALTER TABLE students ADD COLUMN parent_phone TEXT`);
  }
}

async function migrateSessionsTable() {
  if (!(await tableExists('sessions'))) return;

  const columns = await columnNames('sessions');
  if (!columns.includes('subjects')) {
    await exec(
      `ALTER TABLE sessions ADD COLUMN subjects TEXT NOT NULL DEFAULT 'both'`
    );
  }
  if (!columns.includes('allowance_minutes')) {
    await exec(
      `ALTER TABLE sessions ADD COLUMN allowance_minutes INTEGER NOT NULL DEFAULT 60`
    );
  }
}

async function dedupeOpenSessionsForUniqueIndex() {
  const openRows = await all(
    `SELECT id, student_id, check_in_time, subjects, allowance_minutes
     FROM sessions
     WHERE check_out_time IS NULL
     ORDER BY check_in_time DESC`
  );

  if (openRows.length === 0) return;

  const seen = new Set();
  for (const ses of openRows) {
    if (!seen.has(ses.student_id)) {
      seen.add(ses.student_id);
      continue;
    }
    const allowance =
      ses.allowance_minutes ?? (ses.subjects === 'both' || !ses.subjects ? 60 : 30);
    const checkInMs = new Date(ses.check_in_time).getTime();
    const checkoutIso = new Date(checkInMs + allowance * 60_000).toISOString();
    await run(
      `UPDATE sessions
       SET check_out_time = ?, duration_minutes = ?
       WHERE id = ? AND check_out_time IS NULL`,
      [checkoutIso, Math.round(allowance * 10) / 10, ses.id]
    );
  }
}

let migratePromise = null;

export async function ensureDb() {
  if (!migratePromise) {
    migratePromise = (async () => {
      await migrateStudentsTable();
      await exec(`DROP TABLE IF EXISTS parent_messages`);
      await exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id SERIAL PRIMARY KEY,
          student_id INTEGER NOT NULL REFERENCES students(id),
          check_in_time TEXT NOT NULL,
          check_out_time TEXT,
          duration_minutes DOUBLE PRECISION,
          subjects TEXT NOT NULL DEFAULT 'both',
          allowance_minutes INTEGER NOT NULL DEFAULT 60
        )
      `);
      await exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_student_id ON sessions(student_id)`
      );
      await exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_check_in ON sessions(check_in_time)`
      );
      await exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_students_name_ci
          ON students (LOWER(first_name), LOWER(last_name))
      `);
      await migrateSessionsTable();
      await dedupeOpenSessionsForUniqueIndex();
      await exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_session_per_student
          ON sessions(student_id) WHERE check_out_time IS NULL
      `);
    })().catch((err) => {
      migratePromise = null;
      throw err;
    });
  }
  await migratePromise;
}

/** UTC ISO timestamp for inserts (replaces SQLite datetime('now')). */
export function sqlNow() {
  return new Date().toISOString();
}

/**
 * better-sqlite3-shaped facade:
 * - prepare() is sync
 * - get/all/run are async
 * - transaction() returns an async function
 */
const db = {
  prepare(sqlText) {
    const trimmed = sqlText.trim();
    const isInsert = /^insert\b/i.test(trimmed);
    return {
      async get(...params) {
        await ensureDb();
        return get(sqlText, params);
      },
      async all(...params) {
        await ensureDb();
        return all(sqlText, params);
      },
      async run(...params) {
        await ensureDb();
        if (isInsert && !/\breturning\b/i.test(sqlText)) {
          return run(`${sqlText} RETURNING id`, params);
        }
        return run(sqlText, params);
      },
    };
  },
  async exec(sqlText) {
    await ensureDb();
    return exec(sqlText);
  },
  transaction(fn) {
    return async (...args) => {
      await ensureDb();
      return withTransaction(() => fn(...args));
    };
  },
  async close() {
    sqlFn = null;
  },
};

export default db;
