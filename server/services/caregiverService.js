import db, { ensureDb, exec, isUniqueViolation, sqlNow } from '../db.js';

/**
 * Approved-caregiver registry per student, plus the per-session pickup record.
 *
 * Safety posture: caregivers are additive to `students.parent_phone` (which
 * stays the primary messaging contact). Recording who picked a student up is
 * always optional at check-out; validation here exists so that when a pickup
 * IS recorded, it can only reference an active caregiver of that student.
 *
 * Every query is center-scoped: a caregiver row created at center A can never
 * be listed, updated, or used as a pickup for center B.
 */

export const RELATIONSHIPS = ['parent', 'grandparent', 'babysitter', 'other'];

const MAX_NAME_LENGTH = 80;

/** Error with an HTTP status the route layer can pass through. */
function serviceError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

let schemaPromise = null;

async function tableExists(name) {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ?`
    )
    .get(name);
  return Boolean(row);
}

async function columnNames(table) {
  const rows = await db
    .prepare(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ?
       ORDER BY ordinal_position`
    )
    .all(table);
  return rows.map((r) => r.column_name);
}

/**
 * Owns the caregiver schema so `db.js` stays untouched. Memoized like
 * `ensureDb`; every exported function awaits this before touching the tables.
 */
export async function ensureCaregiverSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureDb();
      await exec(`
        CREATE TABLE IF NOT EXISTS caregivers (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          student_id INTEGER NOT NULL REFERENCES students(id),
          name TEXT NOT NULL,
          phone TEXT,
          relationship TEXT,
          is_primary INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        )
      `);

      // Idempotent backfill for tables created before tenancy landed.
      const defaultCenter = await db
        .prepare('SELECT id FROM centers ORDER BY id ASC LIMIT 1')
        .get();
      if (defaultCenter && (await tableExists('caregivers'))) {
        const cols = await columnNames('caregivers');
        if (!cols.includes('center_id')) {
          await exec('ALTER TABLE caregivers ADD COLUMN center_id INTEGER REFERENCES centers(id)');
        }
        await db
          .prepare('UPDATE caregivers SET center_id = ? WHERE center_id IS NULL')
          .run(defaultCenter.id);
        await exec('ALTER TABLE caregivers ALTER COLUMN center_id SET NOT NULL');
        await exec('CREATE INDEX IF NOT EXISTS idx_caregivers_center_id ON caregivers (center_id)');
      }

      await exec(
        `CREATE INDEX IF NOT EXISTS idx_caregivers_student_id ON caregivers(student_id)`
      );
      // At most one active primary caregiver per student within a center.
      // student_id is already unique globally, but center_id is included so the
      // uniqueness scope matches every other tenant-scoped partial unique index.
      await exec('DROP INDEX IF EXISTS idx_one_primary_caregiver');
      await exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_primary_caregiver
          ON caregivers(center_id, student_id) WHERE is_primary = 1 AND active = 1
      `);
      await exec(
        `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS picked_up_by INTEGER REFERENCES caregivers(id)`
      );
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

export function isPrimaryCaregiverViolation(err) {
  return (
    isUniqueViolation(err) &&
    typeof err?.message === 'string' &&
    err.message.includes('idx_one_primary_caregiver')
  );
}

/**
 * Phone shape check: optional "+", 7–15 digits, with spaces/dashes/dots/parens
 * allowed as separators. Returns the trimmed original (human-entered format is
 * kept for display), or null for empty input. Throws 400 on a bad shape.
 */
export function normalizePhone(phone) {
  if (phone == null) return null;
  if (typeof phone !== 'string') {
    throw serviceError(400, 'phone must be a string');
  }
  const trimmed = phone.trim();
  if (trimmed === '') return null;
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) {
    throw serviceError(400, 'phone contains invalid characters');
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    throw serviceError(400, 'phone must contain 7 to 15 digits');
  }
  return trimmed;
}

function normalizeName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw serviceError(400, 'name is required');
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw serviceError(400, `name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeRelationship(relationship) {
  if (relationship == null || relationship === '') return null;
  if (typeof relationship !== 'string' || !RELATIONSHIPS.includes(relationship)) {
    throw serviceError(
      400,
      `relationship must be one of: ${RELATIONSHIPS.join(', ')}`
    );
  }
  return relationship;
}

function normalizeFlag(value, field) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === 0 || value === 1) return value;
  throw serviceError(400, `${field} must be a boolean`);
}

async function requireStudent(centerId, studentId) {
  const id = Number(studentId);
  if (!Number.isInteger(id) || id < 1) {
    throw serviceError(400, 'Invalid student id');
  }
  const student = await db
    .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
    .get(id, centerId);
  if (!student) {
    throw serviceError(404, 'Student not found');
  }
  return student;
}

export async function listCaregivers(centerId, studentId, { includeInactive = false } = {}) {
  await ensureCaregiverSchema();
  const student = await requireStudent(centerId, studentId);
  const rows = await db
    .prepare(
      `SELECT * FROM caregivers
       WHERE center_id = ? AND student_id = ?${includeInactive ? '' : ' AND active = 1'}
       ORDER BY is_primary DESC, name ASC`
    )
    .all(centerId, student.id);
  return rows;
}

export async function createCaregiver(
  centerId,
  studentId,
  { name, phone, relationship, is_primary } = {}
) {
  await ensureCaregiverSchema();
  const student = await requireStudent(centerId, studentId);

  const safeName = normalizeName(name);
  const safePhone = normalizePhone(phone);
  const safeRelationship = normalizeRelationship(relationship);
  const primaryFlag = normalizeFlag(is_primary, 'is_primary') ?? 0;

  try {
    const result = await db
      .prepare(
        `INSERT INTO caregivers (center_id, student_id, name, phone, relationship, is_primary, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        centerId,
        student.id,
        safeName,
        safePhone,
        safeRelationship,
        primaryFlag,
        sqlNow()
      );
    return await db
      .prepare('SELECT * FROM caregivers WHERE id = ? AND center_id = ?')
      .get(result.lastInsertRowid, centerId);
  } catch (err) {
    if (isPrimaryCaregiverViolation(err)) {
      throw serviceError(
        409,
        'This student already has a primary caregiver. Unset the current primary first.'
      );
    }
    throw err;
  }
}

export async function updateCaregiver(centerId, studentId, caregiverId, fields = {}) {
  await ensureCaregiverSchema();
  const student = await requireStudent(centerId, studentId);

  const id = Number(caregiverId);
  if (!Number.isInteger(id) || id < 1) {
    throw serviceError(400, 'Invalid caregiver id');
  }

  const caregiver = await db
    .prepare('SELECT * FROM caregivers WHERE id = ? AND student_id = ? AND center_id = ?')
    .get(id, student.id, centerId);
  if (!caregiver) {
    throw serviceError(404, 'Caregiver not found for this student');
  }

  const updates = [];
  const values = [];

  if (fields.name !== undefined) {
    updates.push('name = ?');
    values.push(normalizeName(fields.name));
  }
  if (fields.phone !== undefined) {
    updates.push('phone = ?');
    values.push(normalizePhone(fields.phone));
  }
  if (fields.relationship !== undefined) {
    updates.push('relationship = ?');
    values.push(normalizeRelationship(fields.relationship));
  }
  const primaryFlag = normalizeFlag(fields.is_primary, 'is_primary');
  if (primaryFlag !== undefined) {
    updates.push('is_primary = ?');
    values.push(primaryFlag);
  }
  const activeFlag = normalizeFlag(fields.active, 'active');
  if (activeFlag !== undefined) {
    updates.push('active = ?');
    values.push(activeFlag);
  }

  if (updates.length === 0) {
    throw serviceError(400, 'No valid fields to update');
  }

  values.push(caregiver.id, centerId);
  try {
    await db
      .prepare(`UPDATE caregivers SET ${updates.join(', ')} WHERE id = ? AND center_id = ?`)
      .run(...values);
  } catch (err) {
    if (isPrimaryCaregiverViolation(err)) {
      throw serviceError(
        409,
        'This student already has a primary caregiver. Unset the current primary first.'
      );
    }
    throw err;
  }

  return await db
    .prepare('SELECT * FROM caregivers WHERE id = ? AND center_id = ?')
    .get(caregiver.id, centerId);
}

/**
 * Validates a `picked_up_by` value at check-out time. Fail-safe: any caregiver
 * that is missing, inactive, or belongs to another student/center is rejected
 * before the check-out is completed. Returns the caregiver row.
 */
export async function assertCaregiverCanPickUp(centerId, studentId, caregiverId) {
  await ensureCaregiverSchema();

  const id = Number(caregiverId);
  if (!Number.isInteger(id) || id < 1) {
    throw serviceError(400, 'picked_up_by must be a caregiver id');
  }

  const caregiver = await db
    .prepare('SELECT * FROM caregivers WHERE id = ? AND center_id = ?')
    .get(id, centerId);
  if (!caregiver || Number(caregiver.student_id) !== Number(studentId)) {
    throw serviceError(400, 'picked_up_by is not an approved caregiver for this student');
  }
  if (!caregiver.active) {
    throw serviceError(400, 'picked_up_by refers to a deactivated caregiver');
  }
  return caregiver;
}

/**
 * Pickup log rows for a [start, end] date range (dates resolved by the caller
 * in the center timezone). Historical rows keep their caregiver even if that
 * caregiver has since been deactivated.
 */
export async function getPickupLogRows(centerId) {
  await ensureCaregiverSchema();
  return await db
    .prepare(
      `SELECT
         ses.id AS session_id,
         ses.check_in_time,
         ses.check_out_time,
         ses.subjects,
         st.id AS student_id,
         st.first_name,
         st.last_name,
         cg.id AS caregiver_id,
         cg.name AS caregiver_name,
         cg.relationship AS caregiver_relationship,
         cg.phone AS caregiver_phone,
         cg.active AS caregiver_active
       FROM sessions ses
       JOIN students st ON st.id = ses.student_id AND st.center_id = ses.center_id
       JOIN caregivers cg ON cg.id = ses.picked_up_by AND cg.center_id = ses.center_id
       WHERE ses.center_id = ?
         AND ses.picked_up_by IS NOT NULL AND ses.check_out_time IS NOT NULL
       ORDER BY ses.check_out_time DESC`
    )
    .all(centerId);
}
