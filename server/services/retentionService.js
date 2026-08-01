import { all, get, run, sqlNow } from '../db.js';
import { ensurePrivacySchema, recordAuditEvent } from './auditLogService.js';

/**
 * Opt-in data retention.
 *
 * Default behavior is "retain everything": with no policy rows configured,
 * purgeExpiredData() deletes nothing regardless of record age. A policy only
 * exists after staff deliberately sets one through the privacy routes, and
 * the purge itself only runs when staff explicitly triggers it. There is no
 * cron or automatic invocation anywhere in this service.
 */

/**
 * Tables a retention window may be applied to, with the timestamp column the
 * window is measured against. Only closed sessions are purgeable; an open
 * session is an in-progress visit, not history.
 */
const PURGEABLE_TABLES = {
  sessions: {
    timestampColumn: 'check_in_time',
    extraWhere: 'check_out_time IS NOT NULL',
    description: 'Completed check-in/check-out records',
  },
  audit_log: {
    timestampColumn: 'occurred_at',
    extraWhere: null,
    description: 'Audit trail entries',
  },
  messages: {
    timestampColumn: 'created_at',
    extraWhere: null,
    description: 'Parent messages (if the messages table exists)',
  },
};

const POLICY_KEY_PREFIX = 'retention:';
const MIN_RETAIN_DAYS = 1;
const MAX_RETAIN_DAYS = 3650;

async function tableExists(name) {
  const row = await get(
    `SELECT 1 AS ok
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ?`,
    [name]
  );
  return Boolean(row);
}

/** Purgeable tables that exist in this database right now. */
export async function listPurgeableTables() {
  await ensurePrivacySchema();
  const names = [];
  for (const [table, config] of Object.entries(PURGEABLE_TABLES)) {
    if (await tableExists(table)) {
      names.push({ table, description: config.description });
    }
  }
  return names;
}

/** @returns {Promise<Array<{ table: string, retain_days: number }>>} */
export async function listRetentionPolicies() {
  await ensurePrivacySchema();
  const rows = await all(
    `SELECT key, value FROM retention_policy WHERE key LIKE ?`,
    [`${POLICY_KEY_PREFIX}%`]
  );

  const policies = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value);
      if (parsed?.table && Number.isInteger(parsed.retain_days)) {
        policies.push({ table: parsed.table, retain_days: parsed.retain_days });
      }
    } catch {
      console.error(`Skipping malformed retention_policy row: ${row.key}`);
    }
  }
  return policies;
}

/**
 * Sets a retention window for one table. Throws for unknown/missing tables
 * and out-of-range windows; callers surface the message as a 400.
 */
export async function setRetentionPolicy(table, retainDays) {
  await ensurePrivacySchema();

  if (!PURGEABLE_TABLES[table]) {
    throw new Error(
      `Retention is not supported for "${table}". Supported: ${Object.keys(PURGEABLE_TABLES).join(', ')}`
    );
  }
  if (!(await tableExists(table))) {
    throw new Error(`Table "${table}" does not exist in this database`);
  }
  const days = Number(retainDays);
  if (!Number.isInteger(days) || days < MIN_RETAIN_DAYS || days > MAX_RETAIN_DAYS) {
    throw new Error(
      `retain_days must be an integer between ${MIN_RETAIN_DAYS} and ${MAX_RETAIN_DAYS}`
    );
  }

  const key = `${POLICY_KEY_PREFIX}${table}`;
  const value = JSON.stringify({ table, retain_days: days });
  await run(
    `INSERT INTO retention_policy (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
  return { table, retain_days: days };
}

export async function clearRetentionPolicy(table) {
  await ensurePrivacySchema();
  const result = await run(`DELETE FROM retention_policy WHERE key = ?`, [
    `${POLICY_KEY_PREFIX}${table}`,
  ]);
  return { table, cleared: result.changes > 0 };
}

/**
 * Deletes records older than each configured retention window.
 *
 * With zero policies configured this is a no-op that reports
 * `policies_applied: 0` — it never infers a window or falls back to a
 * default. Each per-table purge is recorded in audit_log.
 *
 * @param {object} [options]
 * @param {number} [options.nowMs] injection point for tests
 */
export async function purgeExpiredData({ nowMs = Date.now() } = {}) {
  await ensurePrivacySchema();

  const policies = await listRetentionPolicies();
  const deleted = {};

  if (policies.length === 0) {
    return { policies_applied: 0, deleted, ran_at: sqlNow() };
  }

  for (const policy of policies) {
    const config = PURGEABLE_TABLES[policy.table];
    if (!config || !(await tableExists(policy.table))) continue;

    const cutoffIso = new Date(nowMs - policy.retain_days * 86_400_000).toISOString();
    const where = [`${config.timestampColumn} < ?`];
    if (config.extraWhere) where.push(config.extraWhere);

    const result = await run(
      `DELETE FROM ${policy.table} WHERE ${where.join(' AND ')}`,
      [cutoffIso]
    );
    deleted[policy.table] = result.changes;

    await recordAuditEvent({
      actorType: 'system',
      actorId: 'retention',
      action: 'delete',
      entityType: policy.table,
      entityId: null,
    });
  }

  return { policies_applied: policies.length, deleted, ran_at: sqlNow() };
}
