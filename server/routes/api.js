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
  isWithinPastDays,
  groupSessionsByDate,
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

function serializeStudent(student) {
  return {
    ...student,
    name: formatFullName(student),
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

  return {
    totalVisits,
    avgDurationMinutes: avgDuration,
    lastVisit,
    visitsThisWeek,
    isRegular: visitsThisWeek >= 3,
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

  res.cookie('admin_session', getAdminSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ authenticated: true, protectionEnabled: true });
});

router.post('/auth/logout', (_req, res) => {
  res.clearCookie('admin_session');
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
    const { qr_code_value, force } = req.body;

    if (!qr_code_value) {
      return res.status(400).json({ error: 'QR code value is required' });
    }

    const bypassDedup = force === true;

    let authoritativeTime;
    try {
      authoritativeTime = await fetchAuthoritativeTime();
    } catch {
      return res.status(503).json({
        error: 'Cannot verify time — check internet connection',
      });
    }

    const student = db
      .prepare('SELECT * FROM students WHERE qr_code_value = ? AND active = 1')
      .get(qr_code_value);

    if (!student) {
      return res.status(404).json({ error: 'Student not found or inactive' });
    }

    const today = getDateInTimezone(authoritativeTime.iso);
    const nowMs = new Date(authoritativeTime.iso).getTime();
    const openSession = db
      .prepare(
        `SELECT * FROM sessions
         WHERE student_id = ? AND check_out_time IS NULL
         ORDER BY check_in_time DESC LIMIT 1`
      )
      .get(student.id);

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
        const result = db
          .prepare(
            'INSERT INTO sessions (student_id, check_in_time) VALUES (?, ?)'
          )
          .run(student.id, authoritativeTime.iso);
        session = db
          .prepare('SELECT * FROM sessions WHERE id = ?')
          .get(result.lastInsertRowid);
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
        const duration = calculateDurationMinutes(
          openSession.check_in_time,
          authoritativeTime.iso
        );
        db.prepare(
          'UPDATE sessions SET check_out_time = ?, duration_minutes = ? WHERE id = ?'
        ).run(authoritativeTime.iso, duration, openSession.id);
        session = db
          .prepare('SELECT * FROM sessions WHERE id = ?')
          .get(openSession.id);
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
  const rows = db
    .prepare(
      `SELECT
         st.id,
         st.first_name,
         st.last_name,
         st.qr_code_value,
         ses.id AS session_id,
         ses.check_in_time
       FROM sessions ses
       JOIN students st ON st.id = ses.student_id
       WHERE ses.check_out_time IS NULL AND st.active = 1
       ORDER BY ses.check_in_time ASC`
    )
    .all();

  const students = rows.map((row) => ({
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    name: formatFullName(row),
    qr_code_value: row.qr_code_value,
    session_id: row.session_id,
    check_in_time: row.check_in_time,
  }));

  res.json({
    students,
    count: students.length,
    timezone: getCenterTimezone(),
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
  const { name, first_name: rawFirstName, last_name: rawLastName } = req.body;

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

  const qr_code_value = `KUMON-${uuidv4().slice(0, 8).toUpperCase()}`;

  const result = db
    .prepare(
      `INSERT INTO students (first_name, last_name, qr_code_value, registered_at)
       VALUES (?, ?, ?, datetime('now'))`
    )
    .run(first_name, last_name, qr_code_value);

  const student = db
    .prepare('SELECT * FROM students WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json(serializeStudent(student));
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
