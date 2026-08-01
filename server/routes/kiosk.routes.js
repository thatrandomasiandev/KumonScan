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
} from '../services/studentService.js';
import { enqueueNotification } from '../services/smsQueueService.js';
import { emit as emitWebhookEvent } from '../services/webhookService.js';
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

router.post('/register', registerLimiter, async (req, res) => {
  const { first_name: rawFirstName, last_name: rawLastName } = req.body;

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
      is_new: false,
    });
  }

  const qr_code_value = nanoid(12);

  try {
    const result = await db
      .prepare(
        `INSERT INTO students (center_id, first_name, last_name, qr_code_value, registered_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(req.center.id, first_name, last_name, qr_code_value, sqlNow());

    const student = await db
      .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
      .get(result.lastInsertRowid, req.center.id);

    // agent-10: fire-and-forget on purpose — a slow subscriber must not delay registration.
    void emitWebhookEvent(req.center.id, 'student.registered', {
      student: {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        name: formatFullName(student),
        registered_at: student.registered_at,
      },
    });

    res.status(201).json({
      student_id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      name: formatFullName(student),
      qr_code_value: student.qr_code_value,
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
          is_new: false,
        });
      }
    }

    console.error('Register error:', err);
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
    console.error('Scan error:', err);
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
