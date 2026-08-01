import crypto from 'crypto';
import db, { exec, sqlNow } from '../db.js';
import { enqueueRawSms } from './smsQueueService.js';

/**
 * Parent magic-link auth, fully isolated from staff auth:
 * - Short-lived (15 min), single-use access tokens delivered out-of-band.
 * - Long-lived (30 days) stateless `parent_session` cookie scoped to ONE
 *   student id. Signed with a parent-specific secret and a `parent:` payload
 *   prefix, so a parent token can never validate as an admin session (and
 *   vice versa) even if the same base secret is configured.
 * - Only token hashes are stored; a database leak does not leak live links.
 */

export const PARENT_TOKEN_TTL_MS = 15 * 60 * 1000;
export const PARENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PARENT_SESSION_COOKIE = 'parent_session';

let tablesPromise = null;

export async function ensureParentAuthTables() {
  if (!tablesPromise) {
    tablesPromise = (async () => {
      await exec(`
        CREATE TABLE IF NOT EXISTS parent_access_tokens (
          id SERIAL PRIMARY KEY,
          student_id INTEGER NOT NULL REFERENCES students(id),
          token TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      await exec(
        `CREATE INDEX IF NOT EXISTS idx_parent_tokens_student ON parent_access_tokens(student_id)`
      );
    })().catch((err) => {
      tablesPromise = null;
      throw err;
    });
  }
  await tablesPromise;
}

function parentSessionSecret() {
  return (
    process.env.PARENT_SESSION_SECRET ||
    `parent::${process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'dev-insecure'}`
  );
}

function signParentPayload(payload) {
  return crypto.createHmac('sha256', parentSessionSecret()).update(payload).digest('hex');
}

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(len);
  const paddedB = Buffer.alloc(len);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

/**
 * US-centric normalization: keep the last 10 digits (drops a leading
 * country-code 1 and all formatting). Returns null when fewer than 10
 * digits remain, which never matches anything.
 */
export function normalizePhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const trimmed =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (trimmed.length !== 10) return null;
  return trimmed;
}

export async function findActiveStudentsByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const candidates = await db
    .prepare(
      `SELECT id, first_name, last_name, parent_phone, center_id
       FROM students
       WHERE active = 1 AND parent_phone IS NOT NULL`
    )
    .all();

  return candidates.filter(
    (student) => normalizePhone(student.parent_phone) === normalized
  );
}

/**
 * Mints a single-use access token for one student and returns the raw token.
 * Only the SHA-256 hash is persisted.
 */
export async function createAccessToken(studentId, { ttlMs = PARENT_TOKEN_TTL_MS } = {}) {
  await ensureParentAuthTables();
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  await db
    .prepare(
      `INSERT INTO parent_access_tokens (student_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(studentId, hashToken(rawToken), expiresAt, sqlNow());

  return rawToken;
}

function tokenError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Validates a raw token and consumes it (single use). Returns the student.
 * Throws TOKEN_INVALID for unknown/reused tokens, TOKEN_EXPIRED past 15 min.
 */
export async function consumeAccessToken(rawToken) {
  await ensureParentAuthTables();

  if (typeof rawToken !== 'string' || rawToken.length < 16) {
    throw tokenError('TOKEN_INVALID', 'Invalid access token');
  }

  const row = await db
    .prepare('SELECT * FROM parent_access_tokens WHERE token = ?')
    .get(hashToken(rawToken));

  if (!row) {
    throw tokenError('TOKEN_INVALID', 'Invalid access token');
  }

  // Consume before the expiry check so an expired token also becomes unusable.
  await db.prepare('DELETE FROM parent_access_tokens WHERE id = ?').run(row.id);

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw tokenError('TOKEN_EXPIRED', 'Access token has expired');
  }

  const student = await db
    .prepare('SELECT * FROM students WHERE id = ? AND active = 1')
    .get(row.student_id);

  if (!student) {
    throw tokenError('TOKEN_INVALID', 'Invalid access token');
  }

  return student;
}

/** Stateless signed session, format: `<expiresAt>.<studentId>.<hmac>`. */
export function createParentSession(studentId) {
  const id = Number(studentId);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error('createParentSession requires a valid student id');
  }
  const expiresAt = Date.now() + PARENT_SESSION_TTL_MS;
  return `${expiresAt}.${id}.${signParentPayload(`parent:${id}:${expiresAt}`)}`;
}

/** Returns the session's student id, or null when missing/expired/forged. */
export function parentSessionStudentId(token) {
  if (!token || typeof token !== 'string') return null;
  const [expiresAtRaw, studentIdRaw, sig] = token.split('.');
  const expiresAt = Number(expiresAtRaw);
  const studentId = Number(studentIdRaw);
  if (!Number.isFinite(expiresAt) || !Number.isInteger(studentId) || !sig) return null;
  if (studentId < 1 || Date.now() > expiresAt) return null;
  const expected = signParentPayload(`parent:${studentId}:${expiresAt}`);
  return timingSafeEqualString(sig, expected) ? studentId : null;
}

/**
 * Delivers one magic link per matching student through the SMS gateway
 * queue (agent-1-messaging). Each queue row carries the student's own
 * center_id so the gateway phone for another center can never claim it.
 *
 * WhatsApp is not offered here even for notify_channel='whatsapp' students:
 * business-initiated WhatsApp messages are limited to pre-approved Meta
 * templates (WHATSAPP_TEMPLATES), and no magic-link template exists. SMS-only
 * is an explicit scope cut for this flow.
 *
 * Never throws, and swallows per-link enqueue failures (enqueueRawSms itself
 * never throws): requestParentAccess must resolve identically whether or not
 * delivery worked, so a caller cannot distinguish outcomes (enumeration
 * safety).
 */
async function deliverMagicLinks(links) {
  for (const { student, url } of links) {
    try {
      await enqueueRawSms({
        centerId: student.center_id,
        studentId: student.id,
        phone: student.parent_phone.trim(),
        message:
          `KumonScan: your sign-in link for ${student.first_name} ${student.last_name}: ` +
          `${url} (expires in 15 minutes, single use)`,
      });
    } catch (err) {
      console.error('parent-auth: magic link enqueue failed:', err?.message || err);
    }

    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.log(
        `parent-auth: magic link for ${student.first_name} ${student.last_name}: ${url}`
      );
    }
  }
}

/**
 * Handles a link request. Always resolves, whether or not the phone matched,
 * so callers cannot distinguish the two cases (enumeration safety).
 */
export async function requestParentAccess(phone, { baseUrl }) {
  await ensureParentAuthTables();

  const students = await findActiveStudentsByPhone(phone);
  if (students.length === 0) return;

  const links = [];
  for (const student of students) {
    const rawToken = await createAccessToken(student.id);
    links.push({
      student,
      url: `${baseUrl}/family/verify?token=${rawToken}`,
    });
  }

  await deliverMagicLinks(links);
}
