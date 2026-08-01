import db, { sqlNow } from '../db.js';
import { getCenterTimezone, getDateInTimezone } from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import { csvEscape } from './reportService.js';

export const RESOURCE_CATEGORIES = ['worksheet', 'pencil', 'book', 'other'];

let schemaPromise = null;

async function tableExists(name) {
  const row = await db
    .prepare(
      `SELECT 1 AS ok
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ?`
    )
    .get(name);
  return Boolean(row);
}

async function columnNames(table) {
  const rows = await db
    .prepare(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ?
       ORDER BY ordinal_position`
    )
    .all(table);
  return rows.map((r) => r.column_name);
}

/**
 * Resource tables are owned by this service (not db.js ensureDb) so the
 * resources workstream merges without touching the shared migration file.
 * Both tables are center-scoped; ensureDb's TENANT_TABLES list also migrates
 * them when present, and this path creates them center-aware from the start.
 */
export async function ensureResourceSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS resources (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          name TEXT NOT NULL,
          category TEXT,
          quantity_on_hand INTEGER NOT NULL DEFAULT 0,
          low_stock_threshold INTEGER NOT NULL DEFAULT 5,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        )
      `);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS resource_usage (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          resource_id INTEGER NOT NULL REFERENCES resources(id),
          student_id INTEGER REFERENCES students(id),
          session_id INTEGER REFERENCES sessions(id),
          quantity INTEGER NOT NULL DEFAULT 1,
          used_at TEXT NOT NULL
        )
      `);

      // Idempotent backfill for tables created before tenancy landed.
      const defaultCenter = await db
        .prepare('SELECT id FROM centers ORDER BY id ASC LIMIT 1')
        .get();
      if (defaultCenter) {
        for (const table of ['resources', 'resource_usage']) {
          if (!(await tableExists(table))) continue;
          const cols = await columnNames(table);
          if (!cols.includes('center_id')) {
            await db.exec(
              `ALTER TABLE ${table} ADD COLUMN center_id INTEGER REFERENCES centers(id)`
            );
          }
          await db
            .prepare(`UPDATE ${table} SET center_id = ? WHERE center_id IS NULL`)
            .run(defaultCenter.id);
          await db.exec(`ALTER TABLE ${table} ALTER COLUMN center_id SET NOT NULL`);
          await db.exec(
            `CREATE INDEX IF NOT EXISTS idx_${table}_center_id ON ${table} (center_id)`
          );
        }
      }

      await db.exec(
        `CREATE INDEX IF NOT EXISTS idx_resource_usage_resource_id ON resource_usage(resource_id)`
      );
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

function codedError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function serializeResource(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantity_on_hand: row.quantity_on_hand,
    low_stock_threshold: row.low_stock_threshold,
    active: Boolean(row.active),
    created_at: row.created_at,
    low_stock: row.quantity_on_hand <= row.low_stock_threshold,
  };
}

export async function listResources(centerId, { includeInactive = false } = {}) {
  await ensureResourceSchema();
  const rows = await db
    .prepare(
      includeInactive
        ? `SELECT * FROM resources WHERE center_id = ? ORDER BY name ASC, id ASC`
        : `SELECT * FROM resources WHERE center_id = ? AND active = 1 ORDER BY name ASC, id ASC`
    )
    .all(centerId);
  return rows.map(serializeResource);
}

export async function listLowStock(centerId) {
  await ensureResourceSchema();
  const rows = await db
    .prepare(
      `SELECT * FROM resources
       WHERE center_id = ? AND active = 1 AND quantity_on_hand <= low_stock_threshold
       ORDER BY name ASC, id ASC`
    )
    .all(centerId);
  return rows.map(serializeResource);
}

export async function createResource(centerId, {
  name,
  category = 'other',
  quantity_on_hand = 0,
  low_stock_threshold = 5,
}) {
  await ensureResourceSchema();
  const result = await db
    .prepare(
      `INSERT INTO resources (center_id, name, category, quantity_on_hand, low_stock_threshold, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(centerId, name, category, quantity_on_hand, low_stock_threshold, sqlNow());

  const row = await db
    .prepare('SELECT * FROM resources WHERE id = ? AND center_id = ?')
    .get(result.lastInsertRowid, centerId);
  return serializeResource(row);
}

/** Restock is a plain increment: no negative-stock concern on this path. */
export async function restockResource(centerId, id, quantity) {
  await ensureResourceSchema();
  const result = await db
    .prepare(
      `UPDATE resources SET quantity_on_hand = quantity_on_hand + ?
       WHERE id = ? AND center_id = ? AND active = 1
       RETURNING *`
    )
    .run(quantity, id, centerId);

  if (result.changes === 0) return null;
  return serializeResource(result.rows[0]);
}

/**
 * Log usage and decrement stock atomically. The decrement is a conditional
 * UPDATE (`quantity_on_hand >= quantity` in the WHERE clause) so concurrent
 * requests can never race stock below zero; a read-then-write would.
 * The usage insert lives in the same data-modifying CTE, so both writes are
 * one statement (one implicit transaction on the Neon HTTP driver): stock
 * and the usage log cannot drift apart if either write fails.
 */
export async function useResource(
  centerId,
  id,
  { studentId = null, sessionId = null, quantity = 1 } = {}
) {
  await ensureResourceSchema();

  // Students and sessions are never deleted (only deactivated/closed), so
  // these friendly-400 existence checks cannot race the insert below.
  if (studentId != null) {
    const student = await db
      .prepare('SELECT id FROM students WHERE id = ? AND center_id = ?')
      .get(studentId, centerId);
    if (!student) throw codedError('STUDENT_NOT_FOUND', 'Student not found');
  }
  if (sessionId != null) {
    const session = await db
      .prepare('SELECT id FROM sessions WHERE id = ? AND center_id = ?')
      .get(sessionId, centerId);
    if (!session) throw codedError('SESSION_NOT_FOUND', 'Session not found');
  }

  const row = await db
    .prepare(
      `WITH decremented AS (
         UPDATE resources
            SET quantity_on_hand = quantity_on_hand - ?
          WHERE id = ? AND center_id = ? AND active = 1 AND quantity_on_hand >= ?
          RETURNING *
       ),
       logged AS (
         INSERT INTO resource_usage (center_id, resource_id, student_id, session_id, quantity, used_at)
         SELECT d.center_id, d.id, ?::int, ?::int, ?::int, ? FROM decremented d
         RETURNING *
       )
       SELECT
         (SELECT row_to_json(d) FROM decremented d) AS resource_row,
         (SELECT row_to_json(l) FROM logged l) AS usage_row`
    )
    .get(quantity, id, centerId, quantity, studentId, sessionId, quantity, sqlNow());

  if (!row?.resource_row) {
    const existing = await db
      .prepare('SELECT * FROM resources WHERE id = ? AND center_id = ? AND active = 1')
      .get(id, centerId);
    if (!existing) {
      throw codedError('RESOURCE_NOT_FOUND', 'Resource not found or inactive');
    }
    throw codedError(
      'INSUFFICIENT_STOCK',
      `Insufficient stock: ${existing.quantity_on_hand} on hand, ${quantity} requested`,
      { available: existing.quantity_on_hand }
    );
  }

  return {
    resource: serializeResource(row.resource_row),
    usage: row.usage_row,
  };
}

/**
 * Usage totals by resource and by student for a date range.
 * `start`/`end` are YYYY-MM-DD in the center timezone, matching how the
 * attendance report buckets check-ins; either bound may be omitted.
 */
export async function buildResourceUsageReport(centerId, { start = null, end = null } = {}) {
  await ensureResourceSchema();

  const rows = await db
    .prepare(
      `SELECT
         u.resource_id,
         u.student_id,
         u.quantity,
         u.used_at,
         r.name AS resource_name,
         r.category,
         s.first_name,
         s.last_name
       FROM resource_usage u
       JOIN resources r ON r.id = u.resource_id AND r.center_id = u.center_id
       LEFT JOIN students s ON s.id = u.student_id AND s.center_id = u.center_id
       WHERE u.center_id = ?
       ORDER BY u.used_at ASC`
    )
    .all(centerId);

  const inRange = rows.filter((row) => {
    const date = getDateInTimezone(row.used_at);
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  });

  const byResource = new Map();
  const byStudent = new Map();

  for (const row of inRange) {
    const quantity = row.quantity || 0;

    const resourceEntry = byResource.get(row.resource_id) || {
      resource_id: row.resource_id,
      name: row.resource_name,
      category: row.category,
      usage_count: 0,
      total_quantity: 0,
    };
    resourceEntry.usage_count += 1;
    resourceEntry.total_quantity += quantity;
    byResource.set(row.resource_id, resourceEntry);

    const studentKey = row.student_id ?? 'unattributed';
    const studentEntry = byStudent.get(studentKey) || {
      student_id: row.student_id ?? null,
      name: row.student_id
        ? formatFullName({ first_name: row.first_name, last_name: row.last_name })
        : 'Unattributed',
      usage_count: 0,
      total_quantity: 0,
    };
    studentEntry.usage_count += 1;
    studentEntry.total_quantity += quantity;
    byStudent.set(studentKey, studentEntry);
  }

  const sortByName = (a, b) => a.name.localeCompare(b.name);

  return {
    start_date: start,
    end_date: end,
    timezone: getCenterTimezone(),
    by_resource: [...byResource.values()].sort(sortByName),
    by_student: [...byStudent.values()].sort(sortByName),
    summary: {
      usage_count: inRange.length,
      total_quantity: inRange.reduce((sum, row) => sum + (row.quantity || 0), 0),
    },
  };
}

export function resourceUsageReportToCsv(report) {
  const header = ['group_type', 'id', 'name', 'category', 'usage_count', 'total_quantity'];
  const lines = [header.join(',')];

  for (const row of report.by_resource) {
    lines.push(
      [
        'resource',
        row.resource_id,
        csvEscape(row.name),
        csvEscape(row.category || ''),
        row.usage_count,
        row.total_quantity,
      ].join(',')
    );
  }

  for (const row of report.by_student) {
    lines.push(
      [
        'student',
        row.student_id ?? '',
        csvEscape(row.name),
        '',
        row.usage_count,
        row.total_quantity,
      ].join(',')
    );
  }

  return lines.join('\n') + '\n';
}
