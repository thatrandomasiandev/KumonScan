import db, { sqlNow } from '../db.js';
import { logger } from './loggingService.js';

/**
 * Self-contained error reporting backed by an `error_log` table.
 *
 * The public interface (`captureError`, `recentErrorCount`) mirrors what a
 * hosted service (Sentry etc.) would provide, so swapping one in later is a
 * change to this file only. `captureError` never throws: if the database
 * insert fails, the error still reaches the structured logger.
 *
 * `center_id` is nullable: Express-level failures can fire before center
 * resolution. Status checks filter by the requesting center when set.
 */

const MESSAGE_MAX_LENGTH = 2000;
const STACK_MAX_LENGTH = 8000;

let tablePromise = null;

export async function ensureErrorLogTable() {
  if (!tablePromise) {
    tablePromise = (async () => {
      await db.exec(
        `CREATE TABLE IF NOT EXISTS error_log (
          id SERIAL PRIMARY KEY,
          center_id INTEGER REFERENCES centers(id),
          message TEXT NOT NULL,
          stack TEXT,
          route TEXT,
          context TEXT,
          occurred_at TEXT NOT NULL
        )`
      );
      // Additive for DBs that created the table before center_id existed.
      await db.exec(
        `ALTER TABLE error_log ADD COLUMN IF NOT EXISTS center_id INTEGER REFERENCES centers(id)`
      );
    })().catch((err) => {
      tablePromise = null;
      throw err;
    });
  }
  await tablePromise;
}

function serializeContext(context) {
  if (context == null) return null;
  try {
    return JSON.stringify(context);
  } catch {
    return JSON.stringify({ unserializable: String(context) });
  }
}

/**
 * Record an error durably and log it structurally.
 *
 * @param {unknown} err
 * @param {{ route?: string, context?: object, centerId?: number|null }} [details]
 * @returns {Promise<number|null>} error_log row id, or null if persisting failed.
 */
export async function captureError(err, { route, context, centerId } = {}) {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: error, route, centerId, ...context }, error.message);

  try {
    await ensureErrorLogTable();
    const result = await db
      .prepare(
        `INSERT INTO error_log (center_id, message, stack, route, context, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        centerId ?? null,
        String(error.message || 'Unknown error').slice(0, MESSAGE_MAX_LENGTH),
        error.stack ? String(error.stack).slice(0, STACK_MAX_LENGTH) : null,
        route || null,
        serializeContext(context),
        sqlNow()
      );
    return result.lastInsertRowid ?? null;
  } catch (persistErr) {
    logger.error({ err: persistErr }, 'error_log insert failed; error was logged only');
    return null;
  }
}

/**
 * Count captured errors within the trailing window. occurred_at is a UTC ISO
 * string, so lexicographic comparison against the cutoff is correct.
 * When `centerId` is set, only that center's rows (plus unscoped nulls) count.
 */
export async function recentErrorCount({ hours = 24, centerId } = {}) {
  await ensureErrorLogTable();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  if (centerId != null) {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM error_log
         WHERE occurred_at >= ? AND (center_id = ? OR center_id IS NULL)`
      )
      .get(cutoff, centerId);
    return row?.count ?? 0;
  }
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM error_log WHERE occurred_at >= ?')
    .get(cutoff);
  return row?.count ?? 0;
}

/**
 * Global Express error handler: captures with route + request context, then
 * answers 500. Mount after every route so nothing falls through silently.
 */
export async function expressErrorHandler(err, req, res, next) {
  // Client/request errors (body too large, malformed JSON, etc.) already carry
  // a 4xx status from Express middleware. Preserve that status and skip the
  // durable error_log — they are not server failures.
  const clientStatus = Number(err?.status || err?.statusCode);
  if (Number.isInteger(clientStatus) && clientStatus >= 400 && clientStatus < 500) {
    if (res.headersSent) return next(err);
    return res.status(clientStatus).json({
      error: err.type === 'entity.too.large' ? 'Payload too large' : err.message || 'Bad request',
    });
  }

  await captureError(err, {
    route: `${req.method} ${req.originalUrl?.split('?')[0] || req.path}`,
    centerId: req.center?.id ?? null,
    context: {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    },
  });

  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
}
