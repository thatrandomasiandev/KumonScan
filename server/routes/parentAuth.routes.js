import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import db, { get } from '../db.js';
import {
  PARENT_SESSION_COOKIE,
  PARENT_SESSION_TTL_MS,
  consumeAccessToken,
  createParentSession,
  parentSessionStudentId,
  requestParentAccess,
} from '../services/parentAuthService.js';
import { getCenterTimezone, isWithinPastDays } from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import { SUBJECT_LABELS, allowanceForSubjects } from '../sessionRules.js';

const router = Router();

/**
 * /parent-auth/request is the most abuse-prone surface in the app: it is
 * unauthenticated and triggers an outbound message to any phone number.
 * 5 requests per 15 minutes per IP.
 */
const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many link requests. Please try again later.' },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

const parentCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: PARENT_SESSION_TTL_MS,
};

const GENERIC_REQUEST_RESPONSE = {
  message: "If this number is on file, you'll receive a link shortly.",
};

router.post('/parent-auth/request', requestLimiter, async (req, res) => {
  const { phone } = req.body ?? {};

  if (typeof phone !== 'string' || !phone.trim()) {
    return res.status(400).json({ error: 'phone is required' });
  }

  try {
    const baseUrl =
      process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    await requestParentAccess(phone, { baseUrl });
  } catch (err) {
    // Still answer generically: a 500 here would leak processing differences.
    console.error('Parent access request error:', err);
  }

  // Identical response whether or not the phone matched (enumeration safety).
  res.json(GENERIC_REQUEST_RESPONSE);
});

router.get('/parent-auth/verify', verifyLimiter, async (req, res) => {
  const token = req.query.token;

  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'token is required' });
  }

  try {
    const student = await consumeAccessToken(token);

    res.cookie(PARENT_SESSION_COOKIE, createParentSession(student.id), parentCookieOptions);
    res.json({
      authenticated: true,
      student: publicStudent(student),
    });
  } catch (err) {
    if (err?.code === 'TOKEN_EXPIRED') {
      return res.status(401).json({
        error: 'This link has expired. Request a new one.',
        code: 'TOKEN_EXPIRED',
      });
    }
    if (err?.code === 'TOKEN_INVALID') {
      return res.status(401).json({
        error: 'This link is invalid or has already been used. Request a new one.',
        code: 'TOKEN_INVALID',
      });
    }
    console.error('Parent verify error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/parent-auth/session', async (req, res) => {
  const studentId = parentSessionStudentId(req.cookies?.[PARENT_SESSION_COOKIE]);
  if (!studentId) {
    return res.json({ authenticated: false });
  }

  const student = await db
    .prepare('SELECT * FROM students WHERE id = ? AND active = 1')
    .get(studentId);

  if (!student) {
    return res.json({ authenticated: false });
  }

  res.json({ authenticated: true, student: publicStudent(student) });
});

router.post('/parent-auth/logout', (req, res) => {
  res.clearCookie(PARENT_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  res.json({ authenticated: false });
});

/**
 * The student id comes exclusively from the signed cookie. Request params
 * and query strings are never consulted, so a parent cannot reach another
 * student's data by editing ids.
 */
async function requireParent(req, res, next) {
  const studentId = parentSessionStudentId(req.cookies?.[PARENT_SESSION_COOKIE]);
  if (!studentId) {
    return res.status(401).json({ error: 'Parent sign-in required' });
  }

  const student = await db
    .prepare('SELECT * FROM students WHERE id = ? AND active = 1')
    .get(studentId);

  if (!student) {
    return res.status(401).json({ error: 'Parent sign-in required' });
  }

  req.parentStudent = student;
  next();
}

function publicStudent(student) {
  return {
    id: student.id,
    first_name: student.first_name,
    last_name: student.last_name,
    name: formatFullName(student),
  };
}

router.get('/parent/attendance', requireParent, async (req, res) => {
  const student = req.parentStudent;

  const sessions = await db
    .prepare(
      `SELECT id, check_in_time, check_out_time, duration_minutes, subjects, allowance_minutes
       FROM sessions
       WHERE student_id = ?
       ORDER BY check_in_time DESC
       LIMIT 200`
    )
    .all(student.id);

  const completed = sessions.filter((s) => s.check_out_time);
  const totalVisits = completed.length;
  const totalDuration = completed.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);

  res.json({
    student: publicStudent(student),
    sessions: sessions.map((s) => ({
      ...s,
      subjects_label: SUBJECT_LABELS[s.subjects || 'both'] || 'Both',
      allowance_minutes: s.allowance_minutes ?? allowanceForSubjects(s.subjects || 'both'),
    })),
    stats: {
      totalVisits,
      visitsThisWeek: sessions.filter((s) => isWithinPastDays(s.check_in_time, 7)).length,
      avgDurationMinutes:
        totalVisits > 0 ? Math.round((totalDuration / totalVisits) * 10) / 10 : 0,
      lastVisit: completed[0]?.check_in_time || null,
      isCheckedIn: sessions.some((s) => !s.check_out_time),
    },
    timezone: getCenterTimezone(),
  });
});

/**
 * Optional sections. Their tables are owned by sibling agents and may not
 * exist on this branch yet; each endpoint probes for its data source and
 * returns 404 NOT_AVAILABLE when absent so the PWA hides the section.
 */
async function tableExists(name) {
  const row = await get(
    `SELECT 1 AS ok
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ?`,
    [name]
  );
  return Boolean(row);
}

function sectionUnavailable(res) {
  return res.status(404).json({
    error: 'This section is not available yet',
    code: 'NOT_AVAILABLE',
  });
}

const SORT_KEY_CANDIDATES = [
  'created_at',
  'updated_at',
  'start_time',
  'booking_date',
  'date',
  'completed_at',
];

function sortByTimestampDesc(rows) {
  const key = SORT_KEY_CANDIDATES.find((k) => rows.some((row) => row[k] != null));
  if (!key) return rows;
  return [...rows].sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? '')));
}

function pickPresent(row, allowed) {
  const out = {};
  for (const key of allowed) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

function optionalSection({ table, allowedColumns, responseKey }) {
  return async (req, res) => {
    try {
      if (!(await tableExists(table))) {
        return sectionUnavailable(res);
      }

      const rows = await db
        .prepare(`SELECT * FROM ${table} WHERE student_id = ? LIMIT 100`)
        .all(req.parentStudent.id);

      res.json({
        student: publicStudent(req.parentStudent),
        [responseKey]: sortByTimestampDesc(rows).map((row) =>
          pickPresent(row, allowedColumns)
        ),
      });
    } catch (err) {
      // A sibling agent's schema we cannot query safely: treat as absent.
      console.warn(`Parent ${responseKey} section unavailable:`, err?.message || err);
      sectionUnavailable(res);
    }
  };
}

router.get(
  '/parent/bookings',
  requireParent,
  optionalSection({
    table: 'bookings',
    responseKey: 'bookings',
    allowedColumns: [
      'id',
      'booking_date',
      'date',
      'start_time',
      'end_time',
      'slot',
      'subjects',
      'status',
      'notes',
      'created_at',
    ],
  })
);

router.get(
  '/parent/messages',
  requireParent,
  optionalSection({
    table: 'messages',
    responseKey: 'messages',
    allowedColumns: ['id', 'direction', 'body', 'status', 'created_at'],
  })
);

router.get(
  '/parent/progress',
  requireParent,
  optionalSection({
    table: 'student_progress',
    responseKey: 'progress',
    allowedColumns: [
      'id',
      'subject',
      'level',
      'level_name',
      'worksheet',
      'worksheet_number',
      'status',
      'started_at',
      'completed_at',
      'updated_at',
      'created_at',
    ],
  })
);

export default router;
