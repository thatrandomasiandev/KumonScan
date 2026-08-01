import { Router } from 'express';
import { all, get, run, sqlNow } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { formatFullName } from '../utils/names.js';
import {
  ensurePrivacySchema,
  queryAuditLog,
  recordAuditEvent,
} from '../services/auditLogService.js';
import {
  clearRetentionPolicy,
  listPurgeableTables,
  listRetentionPolicies,
  purgeExpiredData,
  setRetentionPolicy,
} from '../services/retentionService.js';

/**
 * Privacy and data-handling routes: queryable audit history, opt-in
 * retention, per-student export, and irreversible per-student deletion.
 * All staff-authenticated. These are technical capabilities; nothing here
 * asserts legal compliance with any privacy statute.
 */
const router = Router();

const ISO_DATEISH = /^\d{4}-\d{2}-\d{2}/;

/**
 * Every public table with a student_id column, discovered at request time so
 * tables added by other workstreams (messages, progress, bookings, …) are
 * included automatically once they exist.
 */
async function tablesReferencingStudents() {
  const rows = await all(
    `SELECT table_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'student_id'
     ORDER BY table_name`
  );
  return rows.map((r) => r.table_name);
}

async function loadStudent(id) {
  const studentId = Number(id);
  if (!Number.isInteger(studentId) || studentId < 1) return null;
  return get('SELECT * FROM students WHERE id = ?', [studentId]);
}

router.get('/admin/audit-log', requireAdmin, async (req, res) => {
  try {
    const { entity_type, entity_id, start, end, limit } = req.query;

    if (start && !ISO_DATEISH.test(String(start))) {
      return res.status(400).json({ error: 'start must be an ISO date or timestamp' });
    }
    if (end && !ISO_DATEISH.test(String(end))) {
      return res.status(400).json({ error: 'end must be an ISO date or timestamp' });
    }

    const entries = await queryAuditLog({
      entityType: entity_type ? String(entity_type) : undefined,
      entityId: entity_id ? String(entity_id) : undefined,
      start: start ? String(start) : undefined,
      end: end ? String(end) : undefined,
      limit,
    });

    res.json({ entries, count: entries.length });
  } catch (err) {
    console.error('Audit log query error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin/privacy/retention', requireAdmin, async (_req, res) => {
  try {
    const [policies, purgeableTables] = await Promise.all([
      listRetentionPolicies(),
      listPurgeableTables(),
    ]);
    res.json({ policies, purgeable_tables: purgeableTables });
  } catch (err) {
    console.error('Retention read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Sets or clears a retention window. Setting requires `confirm: true` so a
 * destructive window can never be configured by a bare API call.
 * body: { table, retain_days: number | null, confirm?: boolean }
 */
router.put('/admin/privacy/retention', requireAdmin, async (req, res) => {
  const { table, retain_days, confirm } = req.body ?? {};

  if (!table || typeof table !== 'string') {
    return res.status(400).json({ error: 'table is required' });
  }

  try {
    if (retain_days == null) {
      const result = await clearRetentionPolicy(table);
      return res.json({ ok: true, ...result, policies: await listRetentionPolicies() });
    }

    if (confirm !== true) {
      return res.status(400).json({
        error:
          'Setting a retention window schedules permanent deletion of old records. Pass confirm: true to proceed.',
      });
    }

    const policy = await setRetentionPolicy(table, retain_days);
    res.json({ ok: true, ...policy, policies: await listRetentionPolicies() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Staff-triggered purge. Refuses to run when no policy is configured — the
 * default state deletes nothing, ever.
 */
router.post('/admin/privacy/purge-expired', requireAdmin, async (_req, res) => {
  try {
    const policies = await listRetentionPolicies();
    if (policies.length === 0) {
      return res.status(400).json({
        error: 'No retention policy is configured. Nothing was deleted.',
      });
    }

    const result = await purgeExpiredData();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Retention purge error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * One student's complete data across every table that references them —
 * the shape of a parent's "give me my child's data" request. The export
 * itself is recorded in audit_log.
 */
router.get('/admin/privacy/export-student-data/:id', requireAdmin, async (req, res) => {
  try {
    await ensurePrivacySchema();

    const student = await loadStudent(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const tables = {};
    for (const table of await tablesReferencingStudents()) {
      tables[table] = await all(
        `SELECT * FROM ${table} WHERE student_id = ? ORDER BY id`,
        [student.id]
      );
    }

    await recordAuditEvent({
      actorType: 'staff',
      actorId: 'admin',
      action: 'export',
      entityType: 'student',
      entityId: student.id,
    });

    const filename = `kumonscan-student-${student.id}-data.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json({
      exported_at: sqlNow(),
      student,
      tables,
    });
  } catch (err) {
    console.error('Student export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Irreversible hard delete for a parent's deletion request — distinct from
 * the soft deactivate. Requires re-typing the student's full name, and the
 * deletion is written to audit_log before any row is removed.
 * body: { confirm_name: string }
 */
router.delete('/admin/students/:id/purge', requireAdmin, async (req, res) => {
  try {
    await ensurePrivacySchema();

    const student = await loadStudent(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const expected = formatFullName(student).replace(/\s+/g, ' ').trim().toLowerCase();
    const provided = String(req.body?.confirm_name ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!provided || provided !== expected) {
      return res.status(400).json({
        error:
          "confirm_name must exactly match the student's full name. This deletion is irreversible.",
      });
    }

    // The audit row must exist before the data is gone; if this insert
    // fails, the whole request fails and nothing is deleted.
    await recordAuditEvent({
      actorType: 'staff',
      actorId: 'admin',
      action: 'delete',
      entityType: 'student',
      entityId: student.id,
    });

    const deleted = {};
    for (const table of await tablesReferencingStudents()) {
      const result = await run(`DELETE FROM ${table} WHERE student_id = ?`, [student.id]);
      deleted[table] = result.changes;
    }
    await run('DELETE FROM students WHERE id = ?', [student.id]);
    deleted.students = 1;

    res.json({
      ok: true,
      id: student.id,
      name: formatFullName(student),
      deleted,
    });
  } catch (err) {
    console.error('Student purge error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Flags whether a signed parent-contact consent form is on file for this
 * student. A UI checkbox backed by a column, recorded in the audit trail.
 * body: { contact_consent_on_file: boolean }
 */
router.patch('/admin/students/:id/consent', requireAdmin, async (req, res) => {
  try {
    await ensurePrivacySchema();

    const student = await loadStudent(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const value = req.body?.contact_consent_on_file;
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'contact_consent_on_file must be a boolean' });
    }

    await run('UPDATE students SET contact_consent_on_file = ? WHERE id = ?', [
      value ? 1 : 0,
      student.id,
    ]);

    await recordAuditEvent({
      actorType: 'staff',
      actorId: 'admin',
      action: 'update',
      entityType: 'student',
      entityId: student.id,
    });

    res.json({ ok: true, id: student.id, contact_consent_on_file: value ? 1 : 0 });
  } catch (err) {
    console.error('Consent update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
