import { Router } from 'express';
import db from '../db.js';
import {
  fetchAuthoritativeTime,
  getCenterTimezone,
  getDateInTimezone,
  getTodayInTimezone,
  getWeekdayShortForDate,
} from '../timeService.js';
import { requireAdmin } from '../middleware/auth.js';
import { formatFullName } from '../utils/names.js';
import {
  allowanceForSubjects,
  enrichOpenSession,
  normalizeSubjects,
  overtimeMinutesDisplay,
  SUBJECT_LABELS,
} from '../sessionRules.js';
import { closeStaleOpenSessions } from '../sessionHygiene.js';
import {
  getOpenSession,
  insertCheckIn,
  completeCheckOut,
} from '../services/studentService.js';
import { getWeekdayCapacity, countExpectedForWeekday } from '../services/capacityService.js';
import { captureError } from '../services/errorReportingService.js';
import { logger } from '../services/loggingService.js';
import { enqueueNotification } from '../services/smsQueueService.js';
import { emit as emitWebhookEvent } from '../services/webhookService.js';
import { assertCaregiverCanPickUp } from '../services/caregiverService.js'; // agent-2-pickup-auth
import { getAuthoritativeTimeOr503 } from './shared.js';

const router = Router();

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

    const student = await db
      .prepare('SELECT * FROM students WHERE id = ? AND center_id = ? AND active = 1')
      .get(studentId, req.center.id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found or inactive' });
    }

    const openSession = await getOpenSession(req.center.id, student.id);
    if (openSession) {
      return res.status(409).json({
        error: 'Student is already checked in',
        session: enrichOpenSession(openSession, new Date(authoritativeTime.iso).getTime()),
      });
    }

    const session = await insertCheckIn(req.center.id, student.id, authoritativeTime.iso, subjects);

    await enqueueNotification(session, student, 'checked_in', authoritativeTime.iso);

    // agent-10: fire-and-forget on purpose — a slow subscriber must not delay check-in.
    void emitWebhookEvent(req.center.id, 'student.checked_in', {
      student: { id: student.id, first_name: student.first_name, last_name: student.last_name, name: formatFullName(student) },
      session: { id: session.id, check_in_time: session.check_in_time, subjects: session.subjects, mode: 'in_person' },
    });

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
    if (err?.code === 'ALREADY_CHECKED_IN') {
      return res.status(409).json({
        error: 'Student is already checked in',
        session: err.openSession ? enrichOpenSession(err.openSession) : undefined,
      });
    }
    await captureError(err, {
      route: 'POST /api/check-in',
      centerId: req.center?.id,
      context: { student_id: req.body?.student_id, subjects: req.body?.subjects },
    });
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
      openSession = await db
        .prepare(
          'SELECT * FROM sessions WHERE id = ? AND center_id = ? AND check_out_time IS NULL'
        )
        .get(sessionId, req.center.id);
    } else {
      openSession = await getOpenSession(req.center.id, studentId);
    }

    if (!openSession) {
      return res.status(404).json({ error: 'No open session to check out' });
    }

    const student = await db
      .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
      .get(openSession.student_id, req.center.id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // agent-2-pickup-auth: optional pickup record. Validated BEFORE completing
    // the check-out so a bad caregiver id never half-completes a session;
    // omitting it keeps check-out behavior exactly as before.
    let pickedUpBy = null;
    if (req.body.picked_up_by != null && req.body.picked_up_by !== '') {
      try {
        const caregiver = await assertCaregiverCanPickUp(
          req.center.id,
          openSession.student_id,
          req.body.picked_up_by
        );
        pickedUpBy = caregiver.id;
      } catch (err) {
        if (err?.status) {
          return res.status(err.status).json({ error: err.message });
        }
        throw err;
      }
    }

    const session = await completeCheckOut(openSession, authoritativeTime.iso, pickedUpBy);
    const allowance = session.allowance_minutes ?? allowanceForSubjects(session.subjects || 'both');
    const wasOvertime = (session.duration_minutes || 0) > allowance;

    await enqueueNotification(session, student, 'checked_out', authoritativeTime.iso);

    // agent-10: fire-and-forget on purpose — a slow subscriber must not delay check-out.
    void emitWebhookEvent(req.center.id, 'student.checked_out', {
      student: { id: student.id, first_name: student.first_name, last_name: student.last_name, name: formatFullName(student) },
      session: {
        id: session.id,
        check_in_time: session.check_in_time,
        check_out_time: session.check_out_time,
        duration_minutes: session.duration_minutes,
        subjects: session.subjects,
        is_overtime: wasOvertime,
      },
    });

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
        overtime_minutes: overtimeMinutesDisplay(session.duration_minutes, allowance),
      },
      timestamp: authoritativeTime.iso,
      timezone: authoritativeTime.timezone,
    });
  } catch (err) {
    await captureError(err, {
      route: 'POST /api/check-out',
      centerId: req.center?.id,
      context: { student_id: req.body?.student_id, session_id: req.body?.session_id },
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/present', requireAdmin, async (req, res) => {
  await closeStaleOpenSessions(req.center.id);

  let nowMs = Date.now();
  let clockIso = new Date(nowMs).toISOString();
  try {
    const authoritativeTime = await fetchAuthoritativeTime();
    nowMs = new Date(authoritativeTime.iso).getTime();
    clockIso = authoritativeTime.iso;
  } catch (err) {
    logger.warn({ err, route: 'GET /api/present' }, 'present clock fell back to host time');
  }

  const rows = await db
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
       WHERE ses.center_id = ? AND st.center_id = ?
         AND ses.check_out_time IS NULL AND st.active = 1
       ORDER BY ses.check_in_time ASC`
    )
    .all(req.center.id, req.center.id);

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

  const today = getTodayInTimezone();
  let capacityToday = null;
  let expectedToday = null;
  try {
    const weekday = getWeekdayShortForDate(today);
    const capacityMap = await getWeekdayCapacity(req.center.id);
    capacityToday = Number.isFinite(Number(capacityMap[weekday]))
      ? Number(capacityMap[weekday])
      : null;
    expectedToday = await countExpectedForWeekday(req.center.id, weekday);
  } catch (err) {
    logger.warn({ err, route: 'GET /api/present' }, 'present capacity lookup failed');
  }

  res.json({
    students,
    count: students.length,
    overtime_count: students.filter((s) => s.is_overtime).length,
    expected_today: expectedToday,
    capacity_today: capacityToday,
    timezone: getCenterTimezone(),
    clock_iso: clockIso,
  });
});

/** Completed check-outs for the center's current calendar day. */
router.get('/completed-today', requireAdmin, async (req, res) => {
  const today = getTodayInTimezone();
  const rows = (await db
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
       WHERE ses.center_id = ? AND st.center_id = ?
         AND ses.check_out_time IS NOT NULL
       ORDER BY ses.check_out_time DESC`
    )
    .all(req.center.id, req.center.id))
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
      overtime_minutes: overtimeMinutesDisplay(duration, allowance),
    };
  });

  res.json({
    students,
    count: students.length,
    timezone: getCenterTimezone(),
    date: today,
  });
});

export default router;
