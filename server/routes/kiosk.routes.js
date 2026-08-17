import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import db, { isUniqueViolation, sqlNow } from '../db.js';
import { fetchAuthoritativeTime } from '../timeService.js';
import { formatFullName, normalizeName, validateNameField } from '../utils/names.js';
import { insertStudent } from '../services/studentService.js';
import { emit as emitWebhookEvent } from '../services/webhookService.js';
import { resolveLanguage } from '../services/i18nService.js';
import { captureError } from '../services/errorReportingService.js';

const router = Router();

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again in a minute.' },
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
      student_number: existing.student_number,
      preferred_language: resolveLanguage(existing.preferred_language),
      is_new: false,
    });
  }

  // Self-serve registration records the UI language the parent registered in.
  // Unsupported values resolve to 'en' rather than erroring; existing
  // students keep their stored preference (staff may have set it on purpose).
  const preferred_language = resolveLanguage(rawLanguage);

  try {
    const studentId = await insertStudent(req.center.id, async (tx) => {
      const result = await tx
        .prepare(
          `INSERT INTO students
             (center_id, first_name, last_name, registered_at, preferred_language)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(req.center.id, first_name, last_name, sqlNow(), preferred_language);
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
