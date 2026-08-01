import { all, ensureDb, exec, run, sqlNow } from '../db.js';
import { isValidAdminSession } from '../middleware/auth.js';

/**
 * Audit trail for personally identifiable data.
 *
 * Every write to students/sessions (and future student-linked tables) plus
 * every per-student export lands in `audit_log`, so staff can answer
 * "who touched this record, when" from queryable history. This is
 * data-handling hygiene, not a legal compliance certification.
 */

export const AUDIT_ACTOR_TYPES = ['staff', 'system', 'parent'];
export const AUDIT_ACTIONS = ['view', 'create', 'update', 'delete', 'export'];

let schemaPromise = null;

/**
 * Creates privacy tables and the students consent column. Additive only;
 * safe to call on every request (memoized after first success).
 */
export async function ensurePrivacySchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureDb();
      await exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id SERIAL PRIMARY KEY,
          actor_type TEXT NOT NULL,
          actor_id TEXT,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          occurred_at TEXT NOT NULL
        )
      `);
      await exec(`
        CREATE INDEX IF NOT EXISTS idx_audit_log_entity
          ON audit_log(entity_type, entity_id, occurred_at)
      `);
      await exec(`
        CREATE TABLE IF NOT EXISTS retention_policy (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      await exec(`
        ALTER TABLE students
          ADD COLUMN IF NOT EXISTS contact_consent_on_file INTEGER NOT NULL DEFAULT 0
      `);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

/**
 * @param {object} event
 * @param {'staff'|'system'|'parent'} event.actorType
 * @param {string|null} [event.actorId] e.g. 'admin', 'kiosk', 'retention'
 * @param {'view'|'create'|'update'|'delete'|'export'} event.action
 * @param {string} event.entityType e.g. 'student', 'session'
 * @param {string|number|null} [event.entityId]
 * @param {string} [event.occurredAt] UTC ISO; defaults to now
 */
export async function recordAuditEvent({
  actorType,
  actorId = null,
  action,
  entityType,
  entityId = null,
  occurredAt = sqlNow(),
}) {
  if (!AUDIT_ACTOR_TYPES.includes(actorType)) {
    throw new Error(`Invalid audit actor_type: ${actorType}`);
  }
  if (!AUDIT_ACTIONS.includes(action)) {
    throw new Error(`Invalid audit action: ${action}`);
  }
  if (!entityType) {
    throw new Error('audit entity_type is required');
  }

  await ensurePrivacySchema();
  await run(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      actorType,
      actorId == null ? null : String(actorId),
      action,
      entityType,
      entityId == null ? null : String(entityId),
      occurredAt,
    ]
  );
}

const MAX_AUDIT_PAGE = 1000;
const DEFAULT_AUDIT_PAGE = 200;

/**
 * @param {object} [filters]
 * @param {string} [filters.entityType]
 * @param {string} [filters.entityId]
 * @param {string} [filters.start] inclusive UTC ISO lower bound
 * @param {string} [filters.end] inclusive UTC ISO upper bound
 * @param {number} [filters.limit]
 */
export async function queryAuditLog({
  entityType,
  entityId,
  start,
  end,
  limit = DEFAULT_AUDIT_PAGE,
} = {}) {
  await ensurePrivacySchema();

  const where = [];
  const params = [];

  if (entityType) {
    where.push('entity_type = ?');
    params.push(entityType);
  }
  if (entityId != null && entityId !== '') {
    where.push('entity_id = ?');
    params.push(String(entityId));
  }
  if (start) {
    where.push('occurred_at >= ?');
    params.push(start);
  }
  if (end) {
    where.push('occurred_at <= ?');
    params.push(end);
  }

  const cappedLimit = Math.min(
    Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : DEFAULT_AUDIT_PAGE),
    MAX_AUDIT_PAGE
  );
  params.push(cappedLimit);

  return all(
    `SELECT id, actor_type, actor_id, action, entity_type, entity_id, occurred_at
     FROM audit_log
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY occurred_at DESC, id DESC
     LIMIT ?`,
    params
  );
}

/**
 * Route descriptors for the write endpoints in routes/api.js. Matching is
 * additive middleware (mounted before the API router) so the route handlers
 * themselves stay untouched.
 *
 * `resolve(req, body)` returns { action, entityType, entityId } or null to skip.
 */
const AUDITED_WRITE_ROUTES = [
  {
    method: 'POST',
    pattern: /^\/register\/?$/,
    resolve: (_req, body) =>
      // Re-registering an existing student is a read, not a write.
      body?.is_new === false
        ? null
        : { action: 'create', entityType: 'student', entityId: body?.student_id },
  },
  {
    method: 'POST',
    pattern: /^\/scan\/?$/,
    resolve: (_req, body) => ({
      action: body?.action === 'checked_out' ? 'update' : 'create',
      entityType: 'session',
      entityId: body?.session?.id,
    }),
  },
  {
    method: 'POST',
    pattern: /^\/check-in\/?$/,
    resolve: (_req, body) => ({
      action: 'create',
      entityType: 'session',
      entityId: body?.session?.id,
    }),
  },
  {
    method: 'POST',
    pattern: /^\/check-out\/?$/,
    resolve: (_req, body) => ({
      action: 'update',
      entityType: 'session',
      entityId: body?.session?.id,
    }),
  },
  {
    method: 'POST',
    pattern: /^\/students\/?$/,
    resolve: (_req, body) => ({
      action: 'create',
      entityType: 'student',
      entityId: body?.id,
    }),
  },
  {
    method: 'PATCH',
    pattern: /^\/students\/(\d+)\/?$/,
    resolve: (req) => ({
      action: 'update',
      entityType: 'student',
      entityId: req.path.match(/^\/students\/(\d+)/)[1],
    }),
  },
  {
    method: 'PATCH',
    pattern: /^\/students\/(\d+)\/deactivate\/?$/,
    resolve: (req) => ({
      action: 'update',
      entityType: 'student',
      entityId: req.path.match(/^\/students\/(\d+)/)[1],
    }),
  },
  {
    method: 'POST',
    pattern: /^\/admin\/roster-import\/?$/,
    // Bulk write; individual ids are in the import summary, not the trail.
    resolve: () => ({ action: 'create', entityType: 'student', entityId: null }),
  },
  {
    method: 'POST',
    pattern: /^\/admin\/schedule-bulk\/?$/,
    resolve: () => ({ action: 'update', entityType: 'student', entityId: null }),
  },
];

/** Actor for a request: staff when the admin cookie is valid, kiosk otherwise. */
export function actorForRequest(req) {
  if (isValidAdminSession(req.cookies?.admin_session)) {
    return { actorType: 'staff', actorId: 'admin' };
  }
  return { actorType: 'system', actorId: 'kiosk' };
}

/**
 * Express middleware. Mount on /api before the API router. Captures the JSON
 * response body, and after a successful (<400) response to an audited write
 * route, records the audit event. Audit failures are logged but never fail
 * the underlying request; the hard-delete path in privacy.routes.js logs
 * synchronously before deleting instead.
 */
export function auditTrailMiddleware(req, res, next) {
  ensurePrivacySchema()
    .then(() => {
      const route = AUDITED_WRITE_ROUTES.find(
        (r) => r.method === req.method && r.pattern.test(req.path)
      );
      if (!route) return next();

      let capturedBody;
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        capturedBody = body;
        return originalJson(body);
      };

      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        let descriptor;
        try {
          descriptor = route.resolve(req, capturedBody);
        } catch (err) {
          console.error('Audit descriptor error:', err);
          return;
        }
        if (!descriptor) return;
        recordAuditEvent({ ...actorForRequest(req), ...descriptor }).catch((err) => {
          console.error('Audit log write failed:', err);
        });
      });

      next();
    })
    .catch(next);
}
