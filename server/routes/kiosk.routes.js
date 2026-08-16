import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { nanoid } from 'nanoid';
import db, { isUniqueViolation, sqlNow } from '../db.js';
import { fetchAuthoritativeTime } from '../timeService.js';
import { formatFullName, normalizeName, validateNameField } from '../utils/names.js';
import { enrichOpenSession } from '../sessionRules.js';
import {
  getOpenSession,
  insertCheckIn,
  completeCheckOut,
  resolveCheckInSubjects,
  insertStudentWithNumber,
} from '../services/studentService.js';
import { enqueueNotification } from '../services/smsQueueService.js';
import { emit as emitWebhookEvent } from '../services/webhookService.js';
import { resolveLanguage } from '../services/i18nService.js';
import { captureError } from '../services/errorReportingService.js';
import { getAuthoritativeTimeOr503 } from './shared.js';

const router = Router();

const SCAN_DEDUP_SECONDS = 3;

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again in a minute.' },
});

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many scans. Please wait a moment and try again.' },
});

// Generous: a debounced type-ahead search still fires several requests per
// name typed, and this is a public, unauthenticated endpoint.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please wait a moment and try again.' },
});

/**
 * Public kiosk lookup: find yourself by name or student number instead of
 * scanning a QR code. Deliberately returns only the fields already printed
 * on a student's own QR code (no phone, notes, or other admin data) so this
 * unauthenticated endpoint can never leak more than that.
 */
router.get('/search', searchLimiter, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    return res.json({ students: [] });
  }

  const like = `%${q}%`;
  const asNumber = /^\d+$/.test(q) ? Number(q) : null;

  const students = await db
    .prepare(
      `SELECT id, first_name, last_name, student_number, qr_code_value
       FROM students
       WHERE center_id = ? AND active = 1
         AND (
           first_name ILIKE ? OR last_name ILIKE ?
           OR (first_name || ' ' || last_name) ILIKE ?
           OR student_number = ?
         )
       ORDER BY first_name ASC, last_name ASC
       LIMIT 8`
    )
    .all(req.center.id, like, like, like, asNumber);

  res.json({
    students: students.map((s) => ({
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      name: formatFullName(s),
      student_number: s.student_number,
      qr_code_value: s.qr_code_value,
    })),
  });
});

router.post('/register', registerLimiter, async (req, res) => {
  const {
    first_name: rawFirstName,
    last_name: rawLastName,
    preferred_language: rawLanguage,
  } = req.body;

  const firstNameError = validateNameField(rawFirstName, 'First name');
  if (firstNameError) {
    return res.status(400).json({ error: firstNameError });
  }

  const lastNameError = validateNameField(rawLastName, 'Last name');
  if (lastNameError) {
    return res.status(400).json({ error: lastNameError });
  }

  const { first_name, last_name } = normalizeName(rawFirstName, rawLastName);

  const existing = await db
    .prepare(
      `SELECT * FROM students
       WHERE center_id = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)`
    )
    .get(req.center.id, first_name, last_name);

  if (existing) {
    return res.json({
      student_id: existing.id,
      first_name: existing.first_name,
      last_name: existing.last_name,
      name: formatFullName(existing),
      qr_code_value: existing.qr_code_value,
      student_number: existing.student_number,
      preferred_language: resolveLanguage(existing.preferred_language),
      is_new: false,
    });
  }

  const qr_code_value = nanoid(12);
  // Self-serve registration records the UI language the parent registered in.
  // Unsupported values resolve to 'en' rather than erroring; existing
  // students keep their stored preference (staff may have set it on purpose).
  const preferred_language = resolveLanguage(rawLanguage);

  try {
    const studentId = await insertStudentWithNumber(req.center.id, async (tx, studentNumber) => {
      const result = await tx
        .prepare(
          `INSERT INTO students
             (center_id, first_name, last_name, qr_code_value, registered_at, preferred_language, student_number)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.center.id,
          first_name,
          last_name,
          qr_code_value,
          sqlNow(),
          preferred_language,
          studentNumber
        );
      return result.lastInsertRowid;
    });

    const student = await db
      .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
      .get(studentId, req.center.id);

    // agent-10: fire-and-forget on purpose — a slow subscriber must not delay registration.
    void emitWebhookEvent(req.center.id, 'student.registered', {
      student: {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        name: formatFullName(student),
        preferred_language: student.preferred_language,
        registered_at: student.registered_at,
      },
    });

    res.status(201).json({
      student_id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      name: formatFullName(student),
      qr_code_value: student.qr_code_value,
      student_number: student.student_number,
      preferred_language: student.preferred_language,
      is_new: true,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const duplicate = await db
        .prepare(
          `SELECT * FROM students
           WHERE center_id = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)`
        )
        .get(req.center.id, first_name, last_name);

      if (duplicate) {
        return res.json({
          student_id: duplicate.id,
          first_name: duplicate.first_name,
          last_name: duplicate.last_name,
          name: formatFullName(duplicate),
          qr_code_value: duplicate.qr_code_value,
          student_number: duplicate.student_number,
          preferred_language: resolveLanguage(duplicate.preferred_language),
          is_new: false,
        });
      }
    }

    await captureError(err, {
      route: 'POST /api/register',
      centerId: req.center?.id,
      context: { first_name, last_name },
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/scan', scanLimiter, async (req, res) => {
  try {
    const { qr_code_value, force, subjects: rawSubjects } = req.body;

    if (!qr_code_value) {
      return res.status(400).json({ error: 'QR code value is required' });
    }

    const bypassDedup = force === true;

    const authoritativeTime = await getAuthoritativeTimeOr503(res);
    if (!authoritativeTime) return;

    const student = await db
      .prepare(
        'SELECT * FROM students WHERE center_id = ? AND qr_code_value = ? AND active = 1'
      )
      .get(req.center.id, qr_code_value);

    if (!student) {
      return res.status(404).json({ error: 'Student not found or inactive' });
    }

    const nowMs = new Date(authoritativeTime.iso).getTime();
    const openSession = await getOpenSession(req.center.id, student.id);

    const recentCheckout = await db
      .prepare(
        `SELECT * FROM sessions
         WHERE center_id = ? AND student_id = ? AND check_out_time IS NOT NULL
         ORDER BY check_out_time DESC LIMIT 1`
      )
      .get(req.center.id, student.id);

    const secondsSinceCheckout = recentCheckout
      ? (nowMs - new Date(recentCheckout.check_out_time).getTime()) / 1000
      : Infinity;

    let action;
    let session;
    let stateChanged = false;

    if (!openSession) {
      if (!bypassDedup && secondsSinceCheckout < SCAN_DEDUP_SECONDS) {
        session = recentCheckout;
        action = 'checked_out';
      } else {
        const subjects = resolveCheckInSubjects(rawSubjects, student);
        session = await insertCheckIn(req.center.id, student.id, authoritativeTime.iso, subjects);
        action = 'checked_in';
        stateChanged = true;
      }
    } else {
      const checkInMs = new Date(openSession.check_in_time).getTime();
      const secondsSinceCheckIn = (nowMs - checkInMs) / 1000;

      // Ignore accidental double-scans while the QR is still in front of the camera.
      if (!bypassDedup && secondsSinceCheckIn < SCAN_DEDUP_SECONDS) {
        session = openSession;
        action = 'checked_in';
      } else {
        session = await completeCheckOut(openSession, authoritativeTime.iso);
        action = 'checked_out';
        stateChanged = true;
      }
    }

    // Deduplicated scans (dedup window echoes) must not re-send.
    if (stateChanged) {
      await enqueueNotification(session, student, action, authoritativeTime.iso);

      // agent-10: fire-and-forget on purpose — a slow subscriber must not delay the scan.
      void emitWebhookEvent(req.center.id, `student.${action}`, {
        student: { id: student.id, first_name: student.first_name, last_name: student.last_name, name: formatFullName(student) },
        session: {
          id: session.id,
          check_in_time: session.check_in_time,
          check_out_time: session.check_out_time ?? null,
          duration_minutes: session.duration_minutes ?? null,
          subjects: session.subjects,
          mode: 'in_person',
        },
      });
    }

    res.json({
      action,
      student: {
        id: student.id,
        name: formatFullName(student),
        first_name: student.first_name,
      },
      session,
      timestamp: authoritativeTime.iso,
      timezone: authoritativeTime.timezone,
    });
  } catch (err) {
    if (err?.code === 'ALREADY_CHECKED_IN') {
      return res.status(409).json({
        error: 'Student is already checked in',
        session: err.openSession ? enrichOpenSession(err.openSession) : undefined,
      });
    }
    await captureError(err, {
      route: 'POST /api/scan',
      centerId: req.center?.id,
      context: { qr_code_value: req.body?.qr_code_value },
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/time', async (req, res) => {
  try {
    const time = await fetchAuthoritativeTime();
    res.json(time);
  } catch {
    res.status(503).json({
      error: 'Cannot verify time — check internet connection',
    });
  }
});

export default router;
