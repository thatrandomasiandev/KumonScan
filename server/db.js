import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import './loadEnv.js';
import { hashPassword } from './utils/passwords.js';

// The Pool (session) client needs a WebSocket implementation. Node 22+ has a
// global one; fail loudly on older runtimes rather than hanging.
if (typeof globalThis.WebSocket === 'function') {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
}

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
  if (typeof out.center_id === 'bigint') out.center_id = Number(out.center_id);
  if (typeof out.student_id === 'bigint') out.student_id = Number(out.student_id);
  if (typeof out.session_id === 'bigint') out.session_id = Number(out.session_id);
  if (typeof out.staff_id === 'bigint') out.staff_id = Number(out.staff_id);
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

function makeStatement(executor, sqlText) {
  const trimmed = sqlText.trim();
  const isInsert = /^insert\b/i.test(trimmed);
  return {
    async get(...params) {
      const { rows } = await executor(sqlText, params);
      return rows[0];
    },
    async all(...params) {
      const { rows } = await executor(sqlText, params);
      return rows;
    },
    async run(...params) {
      const text =
        isInsert && !/\breturning\b/i.test(sqlText) ? `${sqlText} RETURNING id` : sqlText;
      const { rows, rowCount } = await executor(text, params);
      const lastInsertRowid = rows[0]?.id != null ? Number(rows[0].id) : undefined;
      return { lastInsertRowid, changes: rowCount ?? 0, rows };
    },
  };
}

/**
 * Real multi-statement transaction over the Neon session (WebSocket) client.
 * The HTTP `neon()` client used everywhere else runs each statement in its own
 * implicit transaction; use this only for batches that genuinely need
 * BEGIN/COMMIT atomicity (e.g. roster import).
 *
 * `fn` receives a `tx` facade with the same `prepare().get/all/run` shape as
 * the default export, bound to the transaction's connection.
 */
export async function withRealTransaction(fn) {
  await ensureDb();
  const pool = new Pool({ connectionString: requireDatabaseUrl() });
  const client = await pool.connect();

  const executor = async (sqlText, params) => {
    const result = await client.query(toPgPlaceholders(sqlText), params);
    return {
      rows: (result.rows || []).map(normalizeRow),
      rowCount: result.rowCount ?? (result.rows || []).length,
    };
  };

  const tx = {
    prepare: (sqlText) => makeStatement(executor, sqlText),
  };

  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Transaction rollback failed:', rollbackErr?.message || rollbackErr);
    }
    throw err;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

export function isUniqueViolation(err) {
  return (
    err?.code === '23505' ||
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (typeof err?.message === 'string' &&
      (err.message.includes('duplicate key') ||
        err.message.includes('unique constraint') ||
        err.message.includes('idx_one_open_session_per_student') ||
        err.message.includes('idx_students_name_ci') ||
        err.message.includes('idx_staff_name_ci')))
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

/**
 * Every table that holds center-scoped data. Order matters only for
 * readability; each table is migrated independently. `revoked_admin_tokens`
 * is intentionally absent (token hashes are globally unique) and the lazily
 * created tables (messages, zoom_meetings, webhook_subscriptions) are
 * migrated here when they already exist and created center-aware by their
 * owning service otherwise.
 */
export const TENANT_TABLES = [
  'students',
  'sessions',
  'staff',
  'staff_sessions',
  'settings',
  'sms_queue',
  'messages',
  'zoom_meetings',
  'webhook_subscriptions',
  // Optional tables from sibling agents — migrated when present so a
  // forgotten WHERE can never read another center's rows from them either.
  'bookings',
  'caregivers',
  'resources',
  'resource_usage',
];

/**
 * Step 1 of the multi-center migration: the centers table plus exactly one
 * row for the pre-existing, currently-live center. The one-time credential
 * migration reads ADMIN_PASSWORD from the environment into
 * admin_password_hash so the current login keeps working; after that the
 * database row is authoritative.
 */
async function migrateCentersTable() {
  await exec(`
    CREATE TABLE IF NOT EXISTS centers (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      admin_password_hash TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  const existing = await get('SELECT id, admin_password_hash FROM centers ORDER BY id ASC LIMIT 1');
  if (!existing) {
    await run(
      `INSERT INTO centers (slug, name, timezone, admin_password_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        process.env.DEFAULT_CENTER_SLUG || 'main',
        process.env.CENTER_NAME || 'KumonScan Center',
        process.env.CENTER_TIMEZONE || 'America/Los_Angeles',
        process.env.ADMIN_PASSWORD ? hashPassword(process.env.ADMIN_PASSWORD) : null,
        sqlNow(),
      ]
    );
  } else if (!existing.admin_password_hash && process.env.ADMIN_PASSWORD) {
    await run(
      'UPDATE centers SET admin_password_hash = ? WHERE id = ? AND admin_password_hash IS NULL',
      [hashPassword(process.env.ADMIN_PASSWORD), existing.id]
    );
  }
}

/**
 * Steps 3–4 of the multi-center migration, idempotent so it can run on every
 * cold start: add center_id to every pre-existing tenant table, backfill all
 * rows onto the original center, enforce NOT NULL, then rebuild the unique
 * constraints that must now account for tenancy. By the time this function
 * returns, no row in any existing tenant table has a NULL center_id.
 */
async function migrateTenancy() {
  const defaultCenter = await get('SELECT id FROM centers ORDER BY id ASC LIMIT 1');
  if (!defaultCenter) {
    throw new Error('Tenancy migration requires at least one row in centers');
  }

  for (const table of TENANT_TABLES) {
    if (!(await tableExists(table))) continue;
    const cols = await columnNames(table);
    if (!cols.includes('center_id')) {
      await exec(`ALTER TABLE ${table} ADD COLUMN center_id INTEGER REFERENCES centers(id)`);
    }
    await run(`UPDATE ${table} SET center_id = ? WHERE center_id IS NULL`, [defaultCenter.id]);
    await exec(`ALTER TABLE ${table} ALTER COLUMN center_id SET NOT NULL`);
    await exec(`CREATE INDEX IF NOT EXISTS idx_${table}_center_id ON ${table} (center_id)`);
  }

  // settings: PRIMARY KEY (key) -> PRIMARY KEY (center_id, key), because two
  // centers each get their own copy of every setting key.
  const settingsPk = await all(
    `SELECT kcu.column_name, tc.constraint_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'settings'
       AND tc.constraint_type = 'PRIMARY KEY'`
  );
  if (settingsPk.length > 0 && !settingsPk.some((r) => r.column_name === 'center_id')) {
    await exec(`ALTER TABLE settings DROP CONSTRAINT ${settingsPk[0].constraint_name}`);
    await exec('ALTER TABLE settings ADD PRIMARY KEY (center_id, key)');
  }

  // Name uniqueness is per center: two centers can both enroll an
  // "Emma Johnson"; one center still cannot enroll her twice. The open-session
  // and open-shift partial unique indexes stay keyed on student_id/staff_id
  // alone: each of those ids belongs to exactly one center, so per-id
  // uniqueness already implies per-center uniqueness.
  await exec('DROP INDEX IF EXISTS idx_students_name_ci');
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_name_ci_center
      ON students (center_id, LOWER(first_name), LOWER(last_name))
  `);
  await exec('DROP INDEX IF EXISTS idx_staff_name_ci');
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_name_ci_center
      ON staff (center_id, LOWER(first_name), LOWER(last_name))
  `);
}

async function migrateStudentsTable() {
  if (!(await tableExists('students'))) {
    await exec(`
      CREATE TABLE students (
        id SERIAL PRIMARY KEY,
        center_id INTEGER NOT NULL REFERENCES centers(id),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        qr_code_value TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        registered_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        enrolled_subjects TEXT NOT NULL DEFAULT 'both',
        schedule_days TEXT,
        parent_phone TEXT,
        notify_channel TEXT NOT NULL DEFAULT 'sms',
        parent_whatsapp TEXT,
        preferred_language TEXT NOT NULL DEFAULT 'en'
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
  // agent-8-whatsapp: 'sms' | 'whatsapp'. parent_whatsapp may differ from
  // parent_phone (E.164); empty means fall back to SMS even when preferred.
  if (!cols.includes('notify_channel')) {
    await exec(`ALTER TABLE students ADD COLUMN notify_channel TEXT NOT NULL DEFAULT 'sms'`);
  }
  if (!cols.includes('parent_whatsapp')) {
    await exec(`ALTER TABLE students ADD COLUMN parent_whatsapp TEXT`);
  }
  if (!cols.includes('preferred_language')) {
    await exec(
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en'`
    );
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
      // Centers must exist first: fresh tenant tables reference centers(id)
      // and the tenancy backfill needs the original center's row.
      await migrateCentersTable();
      await migrateStudentsTable();
      await exec(`DROP TABLE IF EXISTS parent_messages`);
      await exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
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
      await migrateSessionsTable();
      await dedupeOpenSessionsForUniqueIndex();
      await exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_session_per_student
          ON sessions(student_id) WHERE check_out_time IS NULL
      `);
      await exec(`
        CREATE TABLE IF NOT EXISTS staff (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          role TEXT,
          hourly_rate DOUBLE PRECISION,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        )
      `);
      await exec(`
        CREATE TABLE IF NOT EXISTS staff_sessions (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          staff_id INTEGER NOT NULL REFERENCES staff(id),
          clock_in_time TEXT NOT NULL,
          clock_out_time TEXT,
          duration_minutes DOUBLE PRECISION
        )
      `);
      await exec(
        `CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff_id ON staff_sessions(staff_id)`
      );
      await exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_shift_per_staff
          ON staff_sessions(staff_id) WHERE clock_out_time IS NULL
      `);
      await exec(`
        CREATE TABLE IF NOT EXISTS settings (
          center_id INTEGER NOT NULL REFERENCES centers(id),
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (center_id, key)
        )
      `);
      await exec(`
        CREATE TABLE IF NOT EXISTS sms_queue (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          session_id INTEGER REFERENCES sessions(id),
          student_id INTEGER NOT NULL REFERENCES students(id),
          parent_phone TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          claimed_at TEXT,
          sent_at TEXT
        )
      `);
      await exec(
        `CREATE INDEX IF NOT EXISTS idx_sms_queue_status ON sms_queue(status)`
      );
      await exec(`
        CREATE TABLE IF NOT EXISTS revoked_admin_tokens (
          token_hash TEXT PRIMARY KEY,
          expires_at BIGINT NOT NULL
        )
      `);
      await migrateTenancy();
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
 * For multi-statement atomicity, use withRealTransaction instead.
 */
const db = {
  prepare(sqlText) {
    return makeStatement(async (text, params) => {
      await ensureDb();
      return query(text, params);
    }, sqlText);
  },
  async exec(sqlText) {
    await ensureDb();
    return exec(sqlText);
  },
  async close() {
    sqlFn = null;
  },
};

export default db;
