import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { nanoid } from 'nanoid';
import db from '../db.js';
import {
  fetchAuthoritativeTime,
  calculateDurationMinutes,
  getCenterTimezone,
  getDateInTimezone,
  getTodayInTimezone,
  getWeekdayShortForDate,
  groupSessionsByDate,
  isWithinPastDays,
  normalizeScheduleDaysInput,
  parseScheduleDays,
} from '../timeService.js';
import {
  requireAdmin,
  verifyAdminPassword,
  getAdminSessionToken,
  isAdminPasswordConfigured,
} from '../middleware/auth.js';
import {
  formatFullName,
  normalizeName,
  splitFullName,
  validateNameField,
} from '../utils/names.js';
import {
  allowanceForSubjects,
  enrichOpenSession,
  normalizeSubjects,
  SUBJECT_LABELS,
} from '../sessionRules.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again in a minute.' },
});

const SCAN_DEDUP_SECONDS = 3;

function resolveCheckInSubjects(requested, student) {
  const fromRequest = normalizeSubjects(requested);
  if (fromRequest) return fromRequest;
  return normalizeSubjects(student.enrolled_subjects) || 'both';
}

async function getAuthoritativeTimeOr503(res) {
  try {
    return await fetchAuthoritativeTime();
  } catch {
    res.status(503).json({
      error: 'Cannot verify time — check internet connection',
    });
    return null;
  }
}

function getOpenSession(studentId) {
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE student_id = ? AND check_out_time IS NULL
       ORDER BY check_in_time DESC LIMIT 1`
    )
    .get(studentId);
}

function insertCheckIn(studentId, iso, subjects) {
  const allowance_minutes = allowanceForSubjects(subjects);
  const result = db
    .prepare(
      `INSERT INTO sessions (student_id, check_in_time, subjects, allowance_minutes)
       VALUES (?, ?, ?, ?)`
    )
    .run(studentId, iso, subjects, allowance_minutes);

  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);
}

function completeCheckOut(openSession, iso) {
  const duration = calculateDurationMinutes(openSession.check_in_time, iso);
  db.prepare(
    'UPDATE sessions SET check_out_time = ?, duration_minutes = ? WHERE id = ?'
  ).run(iso, duration, openSession.id);

  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(openSession.id);
}

function serializeStudent(student) {
  return {
    ...student,
    name: formatFullName(student),
    enrolled_subjects: student.enrolled_subjects || 'both',
    schedule_days: parseScheduleDays(student.schedule_days),
  };
}

function getStudentStats(studentId) {
  const completedSessions = db
    .prepare(
      `SELECT duration_minutes, check_in_time, check_out_time
       FROM sessions
       WHERE student_id = ? AND check_out_time IS NOT NULL
       ORDER BY check_in_time DESC`
    )
    .all(studentId);

  const totalVisits = completedSessions.length;
  const totalDuration = completedSessions.reduce(
    (sum, s) => sum + (s.duration_minutes || 0),
    0
  );
  const avgDuration = totalVisits > 0 ? Math.round((totalDuration / totalVisits) * 10) / 10 : 0;
  const lastVisit = completedSessions[0]?.check_in_time || null;

  const allSessions = db
    .prepare('SELECT check_in_time FROM sessions WHERE student_id = ?')
    .all(studentId);

  const visitsThisWeek = allSessions.filter((s) =>
    isWithinPastDays(s.check_in_time, 7)
  ).length;

  const isCheckedIn = Boolean(
    db
      .prepare(
        `SELECT 1 FROM sessions WHERE student_id = ? AND check_out_time IS NULL LIMIT 1`
      )
      .get(studentId)
  );

  return {
    totalVisits,
    avgDurationMinutes: avgDuration,
    lastVisit,
    visitsThisWeek,
    isRegular: visitsThisWeek >= 3,
    isCheckedIn,
  };
}

router.post('/auth/login', (req, res) => {
  const { password } = req.body;

  if (!isAdminPasswordConfigured()) {
    return res.json({ authenticated: true, protectionEnabled: false });
  }

  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  res.cookie('admin_session', getAdminSessionToken(), cookieOptions);

  res.json({ authenticated: true, protectionEnabled: true });
});

router.post('/auth/logout', (_req, res) => {
  res.clearCookie('admin_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  res.json({ authenticated: false });
});

router.get('/auth/status', (req, res) => {
  if (!isAdminPasswordConfigured()) {
    return res.json({ authenticated: true, protectionEnabled: false });
  }

  const token = getAdminSessionToken();
  res.json({
    authenticated: req.cookies?.admin_session === token,
    protectionEnabled: true,
  });
});

router.post('/register', registerLimiter, (req, res) => {
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

  const existing = db
    .prepare(
      `SELECT * FROM students
       WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)`
    )
    .get(first_name, last_name);

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
    const result = db
      .prepare(
        `INSERT INTO students (first_name, last_name, qr_code_value, registered_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(first_name, last_name, qr_code_value);

    const student = db
      .prepare('SELECT * FROM students WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json({
      student_id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      name: formatFullName(student),
      qr_code_value: student.qr_code_value,
      is_new: true,
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const duplicate = db
        .prepare(
          `SELECT * FROM students
           WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)`
        )
        .get(first_name, last_name);

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

router.post('/scan', async (req, res) => {
  try {
    const { qr_code_value, force, subjects: rawSubjects } = req.body;

    if (!qr_code_value) {
      return res.status(400).json({ error: 'QR code value is required' });
    }

    const bypassDedup = force === true;

    const authoritativeTime = await getAuthoritativeTimeOr503(res);
    if (!authoritativeTime) return;

    const student = db
      .prepare('SELECT * FROM students WHERE qr_code_value = ? AND active = 1')
      .get(qr_code_value);

    if (!student) {
      return res.status(404).json({ error: 'Student not found or inactive' });
    }

    const today = getDateInTimezone(authoritativeTime.iso);
    const nowMs = new Date(authoritativeTime.iso).getTime();
    const openSession = getOpenSession(student.id);

    const openSessionToday =
      openSession && getDateInTimezone(openSession.check_in_time) === today;

    const recentCheckout = db
      .prepare(
        `SELECT * FROM sessions
         WHERE student_id = ? AND check_out_time IS NOT NULL
         ORDER BY check_out_time DESC LIMIT 1`
      )
      .get(student.id);

    const secondsSinceCheckout = recentCheckout
      ? (nowMs - new Date(recentCheckout.check_out_time).getTime()) / 1000
      : Infinity;

    let action;
    let session;

    if (!openSessionToday) {
      if (!bypassDedup && secondsSinceCheckout < SCAN_DEDUP_SECONDS) {
        session = recentCheckout;
        action = 'checked_out';
      } else {
        const subjects = resolveCheckInSubjects(rawSubjects, student);
        session = insertCheckIn(student.id, authoritativeTime.iso, subjects);
        action = 'checked_in';
      }
    } else {
      const checkInMs = new Date(openSession.check_in_time).getTime();
      const secondsSinceCheckIn = (nowMs - checkInMs) / 1000;

      // Ignore accidental double-scans while the QR is still in front of the camera.
      if (!bypassDedup && secondsSinceCheckIn < SCAN_DEDUP_SECONDS) {
        session = openSession;
        action = 'checked_in';
      } else {
        session = completeCheckOut(openSession, authoritativeTime.iso);
        action = 'checked_out';
      }
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
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Staff desk check-in: pick student by id + subjects for today's visit. */
router.post('/check-in', requireAdmin, async (req, res) => {
  try {
    const studentId = Number(req.body.student_id);
    if (!Number.isInteger(studentId) || studentId < 1) {
      return res.status(400).json({ error: 'student_id is required' });
    }

    const subjects = normalizeSubjects(req.body.subjects);
    if (!subjects) {
      return res.status(400).json({
        error: 'subjects is required (math, reading, or both)',
      });
    }

    const authoritativeTime = await getAuthoritativeTimeOr503(res);
    if (!authoritativeTime) return;

    const student = db
      .prepare('SELECT * FROM students WHERE id = ? AND active = 1')
      .get(studentId);

    if (!student) {
      return res.status(404).json({ error: 'Student not found or inactive' });
    }

    const openSession = getOpenSession(student.id);
    if (openSession) {
      return res.status(409).json({
        error: 'Student is already checked in',
        session: enrichOpenSession(openSession, new Date(authoritativeTime.iso).getTime()),
      });
    }

    const session = insertCheckIn(student.id, authoritativeTime.iso, subjects);

    res.status(201).json({
      action: 'checked_in',
      student: {
        id: student.id,
        name: formatFullName(student),
        first_name: student.first_name,
        last_name: student.last_name,
      },
      session: enrichOpenSession(session, new Date(authoritativeTime.iso).getTime()),
      timestamp: authoritativeTime.iso,
      timezone: authoritativeTime.timezone,
    });
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Staff desk check-out by student_id or session_id. */
router.post('/check-out', requireAdmin, async (req, res) => {
  try {
    const studentId = req.body.student_id != null ? Number(req.body.student_id) : null;
    const sessionId = req.body.session_id != null ? Number(req.body.session_id) : null;

    if (
      (studentId == null || !Number.isInteger(studentId) || studentId < 1) &&
      (sessionId == null || !Number.isInteger(sessionId) || sessionId < 1)
    ) {
      return res.status(400).json({ error: 'student_id or session_id is required' });
    }

    const authoritativeTime = await getAuthoritativeTimeOr503(res);
    if (!authoritativeTime) return;

    let openSession;
    if (sessionId) {
      openSession = db
        .prepare('SELECT * FROM sessions WHERE id = ? AND check_out_time IS NULL')
        .get(sessionId);
    } else {
      openSession = getOpenSession(studentId);
    }

    if (!openSession) {
      return res.status(404).json({ error: 'No open session to check out' });
    }

    const student = db
      .prepare('SELECT * FROM students WHERE id = ?')
      .get(openSession.student_id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const session = completeCheckOut(openSession, authoritativeTime.iso);
    const allowance = session.allowance_minutes ?? allowanceForSubjects(session.subjects || 'both');
    const wasOvertime = (session.duration_minutes || 0) > allowance;

    res.json({
      action: 'checked_out',
      student: {
        id: student.id,
        name: formatFullName(student),
        first_name: student.first_name,
        last_name: student.last_name,
      },
      session: {
        ...session,
        subjects_label: SUBJECT_LABELS[session.subjects || 'both'] || 'Both',
        allowance_minutes: allowance,
        is_overtime: wasOvertime,
        overtime_minutes: wasOvertime
          ? Math.max(0, Math.round(session.duration_minutes - allowance))
          : 0,
      },
      timestamp: authoritativeTime.iso,
      timezone: authoritativeTime.timezone,
    });
  } catch (err) {
    console.error('Check-out error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/students', requireAdmin, (req, res) => {
  const students = db
    .prepare('SELECT * FROM students ORDER BY first_name ASC, last_name ASC')
    .all();

  const enriched = students.map((student) => ({
    ...serializeStudent(student),
    stats: getStudentStats(student.id),
  }));

  res.json(enriched);
});

router.get('/present', requireAdmin, (req, res) => {
  const nowMs = Date.now();
  const rows = db
    .prepare(
      `SELECT
         st.id,
         st.first_name,
         st.last_name,
         st.qr_code_value,
         ses.id AS session_id,
         ses.check_in_time,
         ses.subjects,
         ses.allowance_minutes
       FROM sessions ses
       JOIN students st ON st.id = ses.student_id
       WHERE ses.check_out_time IS NULL AND st.active = 1
       ORDER BY ses.check_in_time ASC`
    )
    .all();

  const students = rows.map((row) => {
    const enriched = enrichOpenSession(
      {
        check_in_time: row.check_in_time,
        subjects: row.subjects,
        allowance_minutes: row.allowance_minutes,
      },
      nowMs
    );

    return {
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      name: formatFullName(row),
      qr_code_value: row.qr_code_value,
      session_id: row.session_id,
      check_in_time: row.check_in_time,
      subjects: enriched.subjects,
      subjects_label: enriched.subjects_label,
      allowance_minutes: enriched.allowance_minutes,
      elapsed_minutes: enriched.elapsed_minutes,
      is_overtime: enriched.is_overtime,
      overtime_minutes: enriched.overtime_minutes,
    };
  });

  // Overtime first, then longest elapsed, so staff can triage red tags.
  students.sort((a, b) => {
    if (a.is_overtime !== b.is_overtime) return a.is_overtime ? -1 : 1;
    return b.elapsed_minutes - a.elapsed_minutes;
  });

  res.json({
    students,
    count: students.length,
    overtime_count: students.filter((s) => s.is_overtime).length,
    timezone: getCenterTimezone(),
  });
});

/** Completed check-outs for the center's current calendar day. */
router.get('/completed-today', requireAdmin, (req, res) => {
  const today = getTodayInTimezone();
  const rows = db
    .prepare(
      `SELECT
         st.id,
         st.first_name,
         st.last_name,
         ses.id AS session_id,
         ses.check_in_time,
         ses.check_out_time,
         ses.duration_minutes,
         ses.subjects,
         ses.allowance_minutes
       FROM sessions ses
       JOIN students st ON st.id = ses.student_id
       WHERE ses.check_out_time IS NOT NULL
       ORDER BY ses.check_out_time DESC`
    )
    .all()
    .filter((row) => getDateInTimezone(row.check_out_time) === today);

  const students = rows.map((row) => {
    const subjects = row.subjects || 'both';
    const allowance = row.allowance_minutes ?? allowanceForSubjects(subjects);
    const duration = row.duration_minutes || 0;
    const isOvertime = duration > allowance;

    return {
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      name: formatFullName(row),
      session_id: row.session_id,
      check_in_time: row.check_in_time,
      check_out_time: row.check_out_time,
      duration_minutes: duration,
      subjects,
      subjects_label: SUBJECT_LABELS[subjects] || 'Both',
      allowance_minutes: allowance,
      is_overtime: isOvertime,
      overtime_minutes: isOvertime ? Math.max(0, Math.round(duration - allowance)) : 0,
    };
  });

  res.json({
    students,
    count: students.length,
    timezone: getCenterTimezone(),
    date: today,
  });
});

router.get('/students/:id/sessions', requireAdmin, (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE id = ?')
    .get(req.params.id);

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const sessions = db
    .prepare(
      `SELECT * FROM sessions WHERE student_id = ? ORDER BY check_in_time DESC`
    )
    .all(student.id);

  res.json({
    student: serializeStudent(student),
    sessions,
    stats: getStudentStats(student.id),
  });
});

router.post('/students', requireAdmin, (req, res) => {
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
  const qr_code_value = `KUMON-${uuidv4().slice(0, 8).toUpperCase()}`;

  const result = db
    .prepare(
      `INSERT INTO students (first_name, last_name, qr_code_value, enrolled_subjects, registered_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
    .run(first_name, last_name, qr_code_value, enrolled_subjects);

  const student = db
    .prepare('SELECT * FROM students WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json(serializeStudent(student));
});

router.patch('/students/:id', requireAdmin, (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE id = ?')
    .get(req.params.id);

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

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(student.id);
  db.prepare(`UPDATE students SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(student.id);
  res.json(serializeStudent(updated));
});

router.patch('/students/:id/deactivate', requireAdmin, (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE id = ?')
    .get(req.params.id);

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  db.prepare('UPDATE students SET active = 0 WHERE id = ?').run(req.params.id);

  res.json({ message: 'Student deactivated', id: student.id });
});

router.get('/dashboard', requireAdmin, (req, res) => {
  const students = db
    .prepare('SELECT * FROM students WHERE active = 1 ORDER BY first_name ASC, last_name ASC')
    .all();

  const enriched = students.map((student) => {
    const stats = getStudentStats(student.id);
    const studentSessions = db
      .prepare(
        `SELECT check_in_time FROM sessions WHERE student_id = ? ORDER BY check_in_time ASC`
      )
      .all(student.id)
      .filter((s) => isWithinPastDays(s.check_in_time, 30));

    const dailySessions = groupSessionsByDate(studentSessions);

    return { ...serializeStudent(student), stats, dailySessions };
  });

  const today = getTodayInTimezone();
  const allTodaySessions = db
    .prepare('SELECT check_in_time FROM sessions')
    .all()
    .filter((s) => getDateInTimezone(s.check_in_time) === today);

  const activeNow = db
    .prepare(
      `SELECT COUNT(*) as count FROM sessions WHERE check_out_time IS NULL`
    )
    .get().count;

  res.json({
    students: enriched,
    summary: {
      totalActiveStudents: students.length,
      totalSessionsToday: allTodaySessions.length,
      currentlyCheckedIn: activeNow,
    },
    timezone: getCenterTimezone(),
  });
});

/**
 * Students scheduled for the given date who never checked in.
 * Query: ?date=YYYY-MM-DD (defaults to center today).
 */
router.get('/absent', requireAdmin, (req, res) => {
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

  const activeStudents = db
    .prepare('SELECT * FROM students WHERE active = 1 ORDER BY first_name ASC, last_name ASC')
    .all();

  const expected = activeStudents.filter((student) => {
    const days = parseScheduleDays(student.schedule_days);
    return days.includes(weekday);
  });

  const checkedInIds = new Set(
    db
      .prepare('SELECT student_id, check_in_time FROM sessions')
      .all()
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

function monthBounds(monthYyyyMm) {
  if (!/^\d{4}-\d{2}$/.test(monthYyyyMm)) {
    throw new Error('month must be YYYY-MM');
  }
  const [y, m] = monthYyyyMm.split('-').map(Number);
  if (m < 1 || m > 12) throw new Error('month must be YYYY-MM');
  const start = `${monthYyyyMm}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${monthYyyyMm}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function rollingAnnualBounds(endMonthYyyyMm) {
  const { end } = monthBounds(endMonthYyyyMm);
  const [y, m] = endMonthYyyyMm.split('-').map(Number);
  let startY = y;
  let startM = m - 11;
  while (startM < 1) {
    startM += 12;
    startY -= 1;
  }
  const startMonth = `${startY}-${String(startM).padStart(2, '0')}`;
  const { start } = monthBounds(startMonth);
  return { start, end };
}

function buildAttendanceReport({ period, month }) {
  const bounds =
    period === 'annual' ? rollingAnnualBounds(month) : monthBounds(month);

  const students = db
    .prepare('SELECT * FROM students ORDER BY first_name ASC, last_name ASC')
    .all();

  const rows = students.map((student) => {
    const sessions = db
      .prepare(
        `SELECT check_in_time, duration_minutes, subjects, allowance_minutes
         FROM sessions
         WHERE student_id = ? AND check_out_time IS NOT NULL`
      )
      .all(student.id)
      .filter((s) => {
        const d = getDateInTimezone(s.check_in_time);
        return d >= bounds.start && d <= bounds.end;
      });

    const visits = sessions.length;
    const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
    const overtimeCount = sessions.filter((s) => {
      const allowance = s.allowance_minutes ?? allowanceForSubjects(s.subjects || 'both');
      return (s.duration_minutes || 0) > allowance;
    }).length;

    return {
      id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      name: formatFullName(student),
      active: Boolean(student.active),
      visits,
      total_minutes: Math.round(totalMinutes * 10) / 10,
      overtime_count: overtimeCount,
    };
  });

  return {
    period,
    month,
    start_date: bounds.start,
    end_date: bounds.end,
    timezone: getCenterTimezone(),
    students: rows,
    summary: {
      student_count: rows.length,
      total_visits: rows.reduce((s, r) => s + r.visits, 0),
      total_minutes: Math.round(rows.reduce((s, r) => s + r.total_minutes, 0) * 10) / 10,
      overtime_sessions: rows.reduce((s, r) => s + r.overtime_count, 0),
    },
  };
}

function attendanceReportToCsv(report) {
  const header = [
    'student_id',
    'first_name',
    'last_name',
    'name',
    'active',
    'visits',
    'total_minutes',
    'overtime_count',
  ];
  const lines = [header.join(',')];
  for (const row of report.students) {
    lines.push(
      [
        row.id,
        csvEscape(row.first_name),
        csvEscape(row.last_name),
        csvEscape(row.name),
        row.active ? 1 : 0,
        row.visits,
        row.total_minutes,
        row.overtime_count,
      ].join(',')
    );
  }
  return lines.join('\n') + '\n';
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Attendance report: ?period=monthly|annual&month=YYYY-MM&format=json|csv
 * Annual = rolling 12 months ending in `month`.
 */
router.get('/reports/attendance', requireAdmin, (req, res) => {
  const period = req.query.period === 'annual' ? 'annual' : 'monthly';
  const now = getTodayInTimezone();
  const month = req.query.month || now.slice(0, 7);
  const format = req.query.format === 'csv' ? 'csv' : 'json';

  let report;
  try {
    report = buildAttendanceReport({ period, month });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (format === 'csv') {
    const filename = `kumonscan-attendance-${period}-${month}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(attendanceReportToCsv(report));
  }

  res.json(report);
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
