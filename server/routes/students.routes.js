import { Router } from 'express';
import db, { isUniqueViolation, sqlNow } from '../db.js';
import {
  getCenterTimezone,
  getDateInTimezone,
  getTodayInTimezone,
  getWeekdayShortForDate,
  normalizeScheduleDaysInput,
  parseScheduleDays,
} from '../timeService.js';
import { requireAdmin, requireRole, parseAdminSession } from '../middleware/auth.js';
import {
  formatFullName,
  normalizeName,
  splitFullName,
  validateNameField,
} from '../utils/names.js';
import { normalizeSubjects, SUBJECT_LABELS } from '../sessionRules.js';
import {
  serializeStudent,
  getStudentStats,
  correctSessionTimes,
  insertStudent,
  parseStudentNumber,
} from '../services/studentService.js';
import { emit as emitWebhookEvent } from '../services/webhookService.js';
import { getSupportedLanguages } from '../services/i18nService.js';
import { getAuthoritativeTimeOr503 } from './shared.js';

const router = Router();

router.get('/students', requireAdmin, async (req, res) => {
  const students = await db
    .prepare('SELECT * FROM students WHERE center_id = ? ORDER BY first_name ASC, last_name ASC')
    .all(req.center.id);

  const enriched = await Promise.all(
    students.map(async (student) => ({
      ...serializeStudent(student),
      stats: await getStudentStats(req.center.id, student.id),
    }))
  );

  res.json(enriched);
});

router.get('/students/:id/sessions', requireAdmin, async (req, res) => {
  const student = await db
    .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
    .get(req.params.id, req.center.id);

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const sessions = await db
    .prepare(
      `SELECT * FROM sessions
       WHERE center_id = ? AND student_id = ? ORDER BY check_in_time DESC`
    )
    .all(req.center.id, student.id);

  res.json({
    student: serializeStudent(student),
    sessions,
    stats: await getStudentStats(req.center.id, student.id),
  });
});

/** Correct a mistaken check-in/check-out timestamp on an existing session. */
router.patch('/students/:studentId/sessions/:sessionId', requireAdmin, async (req, res) => {
  const student = await db
    .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
    .get(req.params.studentId, req.center.id);

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const session = await db
    .prepare('SELECT * FROM sessions WHERE id = ? AND student_id = ? AND center_id = ?')
    .get(req.params.sessionId, student.id, req.center.id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { check_in_time, check_out_time } = req.body;
  if (!check_in_time) {
    return res.status(400).json({ error: 'check_in_time is required' });
  }

  const authoritativeTime = await getAuthoritativeTimeOr503(res);
  if (!authoritativeTime) return;

  try {
    const editedByStaffId = parseAdminSession(req.cookies?.admin_session)?.staffId ?? null;
    const updated = await correctSessionTimes(
      session,
      { check_in_time, check_out_time },
      authoritativeTime.iso,
      editedByStaffId
    );
    res.json(updated);
  } catch (err) {
    if (err.code === 'INVALID_SESSION_CORRECTION') {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

router.post('/students', requireAdmin, async (req, res) => {
  const { name, first_name: rawFirstName, last_name: rawLastName, enrolled_subjects: rawEnrolled } =
    req.body;

  let first_name;
  let last_name;

  if (rawFirstName && rawLastName) {
    const firstNameError = validateNameField(rawFirstName, 'First name');
    if (firstNameError) {
      return res.status(400).json({ error: firstNameError });
    }

    const lastNameError = validateNameField(rawLastName, 'Last name');
    if (lastNameError) {
      return res.status(400).json({ error: lastNameError });
    }

    ({ first_name, last_name } = normalizeName(rawFirstName, rawLastName));
  } else if (name?.trim()) {
    ({ first_name, last_name } = splitFullName(name));
    ({ first_name, last_name } = normalizeName(first_name, last_name));
  } else {
    return res.status(400).json({ error: 'Name is required' });
  }

  const enrolled_subjects = normalizeSubjects(rawEnrolled) || 'both';

  let student_number = null;
  if (req.body.student_number !== undefined && req.body.student_number !== null && req.body.student_number !== '') {
    try {
      student_number = parseStudentNumber(req.body.student_number);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  let studentId;
  try {
    studentId = await insertStudent(req.center.id, async (tx) => {
      const result = await tx
        .prepare(
          `INSERT INTO students
             (center_id, first_name, last_name, enrolled_subjects, registered_at, student_number)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(req.center.id, first_name, last_name, enrolled_subjects, sqlNow(), student_number);
      return result.lastInsertRowid;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'A student with that ID already exists at this center' });
    }
    throw err;
  }

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
      registered_at: student.registered_at,
    },
  });

  res.status(201).json(serializeStudent(student));
});

router.patch('/students/:id', requireAdmin, async (req, res) => {
  const student = await db
    .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
    .get(req.params.id, req.center.id);

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const updates = [];
  const values = [];

  if (req.body.enrolled_subjects !== undefined) {
    const enrolled = normalizeSubjects(req.body.enrolled_subjects);
    if (!enrolled) {
      return res.status(400).json({
        error: 'enrolled_subjects must be math, reading, or both',
      });
    }
    updates.push('enrolled_subjects = ?');
    values.push(enrolled);
  }

  if (req.body.schedule_days !== undefined) {
    try {
      const days = normalizeScheduleDaysInput(req.body.schedule_days);
      updates.push('schedule_days = ?');
      values.push(days == null ? null : JSON.stringify(days));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.body.parent_phone !== undefined) {
    const phone = req.body.parent_phone;
    if (phone !== null && typeof phone !== 'string') {
      return res.status(400).json({ error: 'parent_phone must be a string or null' });
    }
    updates.push('parent_phone = ?');
    values.push(phone == null || phone.trim() === '' ? null : phone.trim());
  }

  if (req.body.notify_channel !== undefined) {
    const channel = req.body.notify_channel;
    if (channel !== 'sms' && channel !== 'whatsapp') {
      return res.status(400).json({ error: "notify_channel must be 'sms' or 'whatsapp'" });
    }
    updates.push('notify_channel = ?');
    values.push(channel);
  }

  if (req.body.parent_whatsapp !== undefined) {
    const whatsapp = req.body.parent_whatsapp;
    if (whatsapp !== null && typeof whatsapp !== 'string') {
      return res.status(400).json({ error: 'parent_whatsapp must be a string or null' });
    }
    updates.push('parent_whatsapp = ?');
    values.push(whatsapp == null || whatsapp.trim() === '' ? null : whatsapp.trim());
  }

  if (req.body.preferred_language !== undefined) {
    const raw = req.body.preferred_language;
    // Admin edits come from a dropdown of supported languages, so anything
    // else is a client bug; reject instead of silently coercing to 'en'.
    const supported = getSupportedLanguages();
    if (typeof raw !== 'string' || !supported.includes(raw.trim().toLowerCase())) {
      return res.status(400).json({
        error: `preferred_language must be one of: ${supported.join(', ')}`,
      });
    }
    updates.push('preferred_language = ?');
    values.push(raw.trim().toLowerCase());
  }

  if (req.body.student_number !== undefined) {
    try {
      const parsed = parseStudentNumber(req.body.student_number);
      updates.push('student_number = ?');
      values.push(parsed);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const renaming =
    req.body.first_name !== undefined || req.body.last_name !== undefined;
  if (renaming) {
    const nextFirst =
      req.body.first_name !== undefined ? req.body.first_name : student.first_name;
    const nextLast =
      req.body.last_name !== undefined ? req.body.last_name : student.last_name;
    const firstErr = validateNameField(nextFirst, 'First name');
    if (firstErr) return res.status(400).json({ error: firstErr });
    const lastErr = validateNameField(nextLast, 'Last name');
    if (lastErr) return res.status(400).json({ error: lastErr });
    const { first_name, last_name } = normalizeName(nextFirst, nextLast);
    updates.push('first_name = ?', 'last_name = ?');
    values.push(first_name, last_name);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(student.id, req.center.id);
  try {
    await db
      .prepare(`UPDATE students SET ${updates.join(', ')} WHERE id = ? AND center_id = ?`)
      .run(...values);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'A student with that ID already exists at this center' });
    }
    throw err;
  }

  const updated = await db
    .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
    .get(student.id, req.center.id);
  res.json(serializeStudent(updated));
});

router.patch('/students/:id/deactivate', requireAdmin, requireRole('manager'), async (req, res) => {
  const student = await db
    .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
    .get(req.params.id, req.center.id);

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  await db
    .prepare('UPDATE students SET active = 0 WHERE id = ? AND center_id = ?')
    .run(req.params.id, req.center.id);

  res.json({ message: 'Student deactivated', id: student.id });
});

/**
 * Students scheduled for the given date who never checked in.
 * Query: ?date=YYYY-MM-DD (defaults to center today).
 */
router.get('/absent', requireAdmin, async (req, res) => {
  const date = req.query.date || getTodayInTimezone();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  let weekday;
  try {
    weekday = getWeekdayShortForDate(date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const activeStudents = await db
    .prepare(
      `SELECT * FROM students
       WHERE center_id = ? AND active = 1 ORDER BY first_name ASC, last_name ASC`
    )
    .all(req.center.id);

  const expected = activeStudents.filter((student) => {
    const days = parseScheduleDays(student.schedule_days);
    return days.includes(weekday);
  });

  const checkedInIds = new Set(
    (await db
      .prepare('SELECT student_id, check_in_time FROM sessions WHERE center_id = ?')
      .all(req.center.id))
      .filter((s) => getDateInTimezone(s.check_in_time) === date)
      .map((s) => s.student_id)
  );

  const students = expected
    .filter((student) => !checkedInIds.has(student.id))
    .map((student) => {
      const subjects = student.enrolled_subjects || 'both';
      return {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        name: formatFullName(student),
        enrolled_subjects: subjects,
        enrolled_subjects_label: SUBJECT_LABELS[subjects] || 'Both',
        schedule_days: parseScheduleDays(student.schedule_days),
      };
    });

  const scheduledWithNoDays = activeStudents.filter(
    (s) => parseScheduleDays(s.schedule_days).length === 0
  ).length;

  res.json({
    date,
    weekday,
    students,
    count: students.length,
    expected_count: expected.length,
    unchecked_schedule_count: scheduledWithNoDays,
    timezone: getCenterTimezone(),
  });
});

export default router;
