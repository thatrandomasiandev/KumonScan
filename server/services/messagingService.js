import db, { sqlNow } from '../db.js';

/**
 * Two-way parent messaging on top of the SMS gateway queue.
 *
 * Outbound: staff message -> `messages` row + one `sms_queue` row. The queue
 * row is drained by the same Android gateway poll loop as check-in/check-out
 * notifications (see routes/gateway.routes.js), so there is exactly one send
 * mechanism. `smsQueueService.enqueueNotification` is not called here because
 * it composes fixed check-in/check-out texts; free-form staff messages need
 * the same queue insert with a caller-supplied body, and unlike notifications
 * a failed enqueue must surface to staff, not be swallowed.
 *
 * Inbound: the gateway phone POSTs every received SMS. Messages that match a
 * student's parent_phone (both sides normalized to E.164) are linked; the rest
 * are stored with student_id = NULL and surfaced in an unmatched list. Inbound
 * messages are never dropped.
 *
 * Every function is center-scoped: threads, unmatched lists, unread counts,
 * and phone matching all operate within one center's data only.
 */

export const MESSAGES_LAST_VIEWED_KEY = 'messages_last_viewed_at';

/** Longest body accepted for a staff-composed outbound SMS (~10 segments). */
export const MAX_MESSAGE_LENGTH = 1600;

let tablesPromise = null;

/**
 * The messages table lives here (not db.js) so this workstream stays inside
 * its own files. `student_id` is nullable on purpose: unmatched inbound
 * messages are stored with NULL and linked manually by staff. `from_phone`
 * preserves the sender for unmatched triage. `center_id` is NOT NULL — even
 * an unmatched message belongs to the center whose gateway received it.
 */
export async function ensureMessagingTables() {
  if (!tablesPromise) {
    tablesPromise = (async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          student_id INTEGER REFERENCES students(id),
          direction TEXT NOT NULL,
          body TEXT NOT NULL,
          from_phone TEXT,
          staff_id INTEGER REFERENCES staff(id),
          status TEXT NOT NULL DEFAULT 'sent',
          created_at TEXT NOT NULL
        )
      `);
      await db.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_student_id ON messages(student_id, created_at)`
      );
      await db.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_center_id ON messages(center_id)`
      );
    })().catch((err) => {
      tablesPromise = null;
      throw err;
    });
  }
  await tablesPromise;
}

/**
 * Normalize a phone number to E.164. Bare 10-digit numbers are assumed to be
 * US/Canada (+1), matching how centers store parent phones. Returns null when
 * the input cannot be normalized; callers must not drop data on null.
 */
export function normalizePhoneE164(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function messagingError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Parent phones are stored in whatever format staff typed, so matching
 * normalizes both sides in JS. Siblings can share a parent_phone; the thread
 * attaches to the first active match (lowest id) deterministically. Matching
 * never crosses centers: a parent number on file at center A cannot claim an
 * inbound message received by center B.
 */
async function findStudentByParentPhone(centerId, normalizedPhone) {
  if (!normalizedPhone) return null;
  const candidates = await db
    .prepare(
      `SELECT id, parent_phone, active FROM students
       WHERE center_id = ? AND parent_phone IS NOT NULL AND parent_phone <> ''
       ORDER BY active DESC, id ASC`
    )
    .all(centerId);
  return (
    candidates.find((s) => normalizePhoneE164(s.parent_phone) === normalizedPhone) || null
  );
}

function toIsoOrNow(value) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return sqlNow();
}

/**
 * Store an SMS relayed by the gateway phone. Always inserts a row, matched or
 * not — an inbound parent message must never be silently discarded.
 */
export async function recordInboundMessage(centerId, { from_phone, body, received_at }) {
  await ensureMessagingTables();

  const normalizedPhone = normalizePhoneE164(from_phone);
  const student = await findStudentByParentPhone(centerId, normalizedPhone);
  const createdAt = toIsoOrNow(received_at);

  const result = await db
    .prepare(
      `INSERT INTO messages (center_id, student_id, direction, body, from_phone, status, created_at)
       VALUES (?, ?, 'inbound', ?, ?, 'sent', ?)`
    )
    .run(
      centerId,
      student?.id ?? null,
      body,
      normalizedPhone || String(from_phone).trim(),
      createdAt
    );

  return {
    id: result.lastInsertRowid,
    student_id: student?.id ?? null,
    matched: Boolean(student),
  };
}

/**
 * Staff -> parent message. Inserts the thread row, then exactly one pending
 * sms_queue row for the gateway to send. If the enqueue fails the thread row
 * is marked 'failed' and the error propagates — no silent failure.
 */
export async function sendOutboundMessage(centerId, { student_id, body, staff_id = null }) {
  await ensureMessagingTables();

  const student = await db
    .prepare('SELECT id, parent_phone FROM students WHERE id = ? AND center_id = ?')
    .get(student_id, centerId);
  if (!student) {
    throw messagingError('STUDENT_NOT_FOUND', 'Student not found');
  }

  const phone = typeof student.parent_phone === 'string' ? student.parent_phone.trim() : '';
  if (!phone) {
    throw messagingError(
      'NO_PARENT_PHONE',
      'Student has no parent phone number on file'
    );
  }

  const createdAt = sqlNow();
  const messageResult = await db
    .prepare(
      `INSERT INTO messages (center_id, student_id, direction, body, staff_id, status, created_at)
       VALUES (?, ?, 'outbound', ?, ?, 'sent', ?)`
    )
    .run(centerId, student.id, body, staff_id, createdAt);
  const messageId = messageResult.lastInsertRowid;

  try {
    await db
      .prepare(
        `INSERT INTO sms_queue (center_id, session_id, student_id, parent_phone, message, created_at)
         VALUES (?, NULL, ?, ?, ?, ?)`
      )
      .run(centerId, student.id, phone, body, createdAt);
  } catch (err) {
    try {
      await db
        .prepare(`UPDATE messages SET status = 'failed' WHERE id = ? AND center_id = ?`)
        .run(messageId, centerId);
    } catch (markErr) {
      console.error('Failed to mark message as failed:', markErr?.message || markErr);
    }
    console.error('Messaging enqueue failed:', err?.message || err);
    throw messagingError('ENQUEUE_FAILED', 'Message saved but could not be queued for sending');
  }

  return getMessageById(centerId, messageId);
}

export async function getMessageById(centerId, id) {
  await ensureMessagingTables();
  return db
    .prepare('SELECT * FROM messages WHERE id = ? AND center_id = ?')
    .get(id, centerId);
}

/** Full thread for one student, oldest first. */
export async function getThread(centerId, studentId) {
  await ensureMessagingTables();
  return db
    .prepare(
      `SELECT * FROM messages WHERE center_id = ? AND student_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(centerId, studentId);
}

/** Inbound messages that matched no parent_phone, newest first. */
export async function getUnmatchedMessages(centerId) {
  await ensureMessagingTables();
  return db
    .prepare(
      `SELECT * FROM messages
       WHERE center_id = ? AND direction = 'inbound' AND student_id IS NULL
       ORDER BY created_at DESC, id DESC`
    )
    .all(centerId);
}

/**
 * Manually attach an unmatched inbound message to a student. When
 * `savePhone` is set and the student has no parent_phone yet, the sender's
 * number is stored so future inbound messages match automatically. Both the
 * message and the student must belong to the caller's center.
 */
export async function linkMessageToStudent(
  centerId,
  messageId,
  studentId,
  { savePhone = false } = {}
) {
  await ensureMessagingTables();

  const message = await db
    .prepare('SELECT * FROM messages WHERE id = ? AND center_id = ?')
    .get(messageId, centerId);
  if (!message) throw messagingError('MESSAGE_NOT_FOUND', 'Message not found');
  if (message.direction !== 'inbound' || message.student_id != null) {
    throw messagingError('NOT_LINKABLE', 'Only unmatched inbound messages can be linked');
  }

  const student = await db
    .prepare('SELECT id, parent_phone FROM students WHERE id = ? AND center_id = ?')
    .get(studentId, centerId);
  if (!student) throw messagingError('STUDENT_NOT_FOUND', 'Student not found');

  await db
    .prepare('UPDATE messages SET student_id = ? WHERE id = ? AND center_id = ?')
    .run(student.id, message.id, centerId);

  const normalizedPhone = normalizePhoneE164(message.from_phone);
  if (savePhone && normalizedPhone && !student.parent_phone) {
    await db
      .prepare('UPDATE students SET parent_phone = ? WHERE id = ? AND center_id = ?')
      .run(normalizedPhone, student.id, centerId);
  }

  return getMessageById(centerId, message.id);
}

/**
 * Inbound messages newer than the staff's last panel view (center-wide:
 * admin auth is a single shared identity per center). ISO-8601 UTC strings
 * compare correctly as text.
 */
export async function getUnreadInboundCount(centerId) {
  await ensureMessagingTables();
  const setting = await db
    .prepare('SELECT value FROM settings WHERE center_id = ? AND key = ?')
    .get(centerId, MESSAGES_LAST_VIEWED_KEY);

  const row = setting?.value
    ? await db
        .prepare(
          `SELECT COUNT(*) AS count FROM messages
           WHERE center_id = ? AND direction = 'inbound' AND created_at > ?`
        )
        .get(centerId, setting.value)
    : await db
        .prepare(
          `SELECT COUNT(*) AS count FROM messages WHERE center_id = ? AND direction = 'inbound'`
        )
        .get(centerId);

  return Number(row?.count ?? 0);
}

/** Record that staff viewed the messages panel; resets the unread count. */
export async function markMessagesViewed(centerId) {
  const viewedAt = sqlNow();
  await db
    .prepare(
      `INSERT INTO settings (center_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (center_id, key) DO UPDATE SET value = EXCLUDED.value
       RETURNING key`
    )
    .run(centerId, MESSAGES_LAST_VIEWED_KEY, viewedAt);
  return viewedAt;
}
