import db, { isOpenSessionUniqueViolation, withRealTransaction } from '../db.js';
import { calculateDurationMinutes, isWithinPastDays, parseScheduleDays } from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import { allowanceForSubjects, normalizeSubjects } from '../sessionRules.js';

/**
 * Assigns the next sequential student_number for a center and inserts the
 * new student in the same transaction (holding a Postgres advisory lock for
 * the duration) so two concurrent registrations can never be handed the
 * same number. `insertFn(tx, studentNumber)` must run the INSERT and
 * return the new student's id.
 */
export async function insertStudentWithNumber(centerId, insertFn) {
  return withRealTransaction(async (tx) => {
    await tx
      .prepare(`SELECT pg_advisory_xact_lock(hashtext('student_number:' || ?::text))`)
      .run(centerId);
    const row = await tx
      .prepare('SELECT COALESCE(MAX(student_number), 0) AS max FROM students WHERE center_id = ?')
      .get(centerId);
    const studentNumber = Number(row?.max || 0) + 1;
    return insertFn(tx, studentNumber);
  });
}

export function alreadyCheckedInError(openSession) {
  const error = new Error('Student is already checked in');
  error.code = 'ALREADY_CHECKED_IN';
  error.openSession = openSession;
  return error;
}

export function resolveCheckInSubjects(requested, student) {
  const fromRequest = normalizeSubjects(requested);
  if (fromRequest) return fromRequest;
  return normalizeSubjects(student.enrolled_subjects) || 'both';
}

export async function getOpenSession(centerId, studentId) {
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE center_id = ? AND student_id = ? AND check_out_time IS NULL
       ORDER BY check_in_time DESC LIMIT 1`
    )
    .get(centerId, studentId);
}

export async function insertCheckIn(centerId, studentId, iso, subjects) {
  const allowance_minutes = allowanceForSubjects(subjects);
  try {
    const result = await db
      .prepare(
        `INSERT INTO sessions (center_id, student_id, check_in_time, subjects, allowance_minutes)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(centerId, studentId, iso, subjects, allowance_minutes);

    return await db
      .prepare('SELECT * FROM sessions WHERE id = ? AND center_id = ?')
      .get(result.lastInsertRowid, centerId);
  } catch (err) {
    if (isOpenSessionUniqueViolation(err)) {
      throw alreadyCheckedInError(await getOpenSession(centerId, studentId));
    }
    throw err;
  }
}

export async function completeCheckOut(openSession, iso, pickedUpBy = null) {
  const duration = calculateDurationMinutes(openSession.check_in_time, iso);
  // agent-2-pickup-auth: only reference picked_up_by when a pickup is recorded;
  // the column is guaranteed to exist because caregiver validation ran first.
  if (pickedUpBy != null) {
    await db
      .prepare(
        `UPDATE sessions SET check_out_time = ?, duration_minutes = ?, picked_up_by = ?
         WHERE id = ? AND center_id = ?`
      )
      .run(iso, duration, pickedUpBy, openSession.id, openSession.center_id);
  } else {
    await db
      .prepare(
        'UPDATE sessions SET check_out_time = ?, duration_minutes = ? WHERE id = ? AND center_id = ?'
      )
      .run(iso, duration, openSession.id, openSession.center_id);
  }

  return await db
    .prepare('SELECT * FROM sessions WHERE id = ? AND center_id = ?')
    .get(openSession.id, openSession.center_id);
}

export function sessionTimeCorrectionError(message) {
  const error = new Error(message);
  error.code = 'INVALID_SESSION_CORRECTION';
  return error;
}

/**
 * Fix a mistaken check-in/check-out timestamp on an existing session.
 * Only ever mutates timestamps + the derived duration — never toggles a
 * session between open/closed, which would collide with
 * idx_one_open_session_per_student.
 */
export async function correctSessionTimes(
  session,
  { check_in_time, check_out_time },
  nowIso,
  editedByStaffId = null
) {
  const checkIn = new Date(check_in_time);
  if (Number.isNaN(checkIn.getTime())) {
    throw sessionTimeCorrectionError('check_in_time must be a valid date');
  }

  const hadOpenSession = session.check_out_time == null;
  const checkOutProvided = check_out_time !== undefined && check_out_time !== null;

  if (!checkOutProvided && !hadOpenSession) {
    throw sessionTimeCorrectionError('check_out_time is required for a completed session');
  }

  let checkOut = null;
  if (checkOutProvided) {
    checkOut = new Date(check_out_time);
    if (Number.isNaN(checkOut.getTime())) {
      throw sessionTimeCorrectionError('check_out_time must be a valid date');
    }
    if (checkOut.getTime() <= checkIn.getTime()) {
      throw sessionTimeCorrectionError('check_out_time must be after check_in_time');
    }
  }

  const now = new Date(nowIso);
  if (checkIn.getTime() > now.getTime()) {
    throw sessionTimeCorrectionError('check_in_time cannot be in the future');
  }
  if (checkOut && checkOut.getTime() > now.getTime()) {
    throw sessionTimeCorrectionError('check_out_time cannot be in the future');
  }

  const duration = checkOut ? calculateDurationMinutes(checkIn.toISOString(), checkOut.toISOString()) : null;

  if (checkOut) {
    await db
      .prepare(
        `UPDATE sessions
         SET check_in_time = ?, check_out_time = ?, duration_minutes = ?, edited_at = ?, edited_by_staff_id = ?
         WHERE id = ? AND center_id = ?`
      )
      .run(
        checkIn.toISOString(),
        checkOut.toISOString(),
        duration,
        nowIso,
        editedByStaffId,
        session.id,
        session.center_id
      );
  } else {
    await db
      .prepare(
        `UPDATE sessions SET check_in_time = ?, edited_at = ?, edited_by_staff_id = ?
         WHERE id = ? AND center_id = ?`
      )
      .run(checkIn.toISOString(), nowIso, editedByStaffId, session.id, session.center_id);
  }

  return db
    .prepare('SELECT * FROM sessions WHERE id = ? AND center_id = ?')
    .get(session.id, session.center_id);
}

export function serializeStudent(student) {
  return {
    ...student,
    name: formatFullName(student),
    enrolled_subjects: student.enrolled_subjects || 'both',
    schedule_days: parseScheduleDays(student.schedule_days),
    notify_channel: student.notify_channel || 'sms',
  };
}

export async function getStudentStats(centerId, studentId) {
  const completedSessions = await db
    .prepare(
      `SELECT duration_minutes, check_in_time, check_out_time
       FROM sessions
       WHERE center_id = ? AND student_id = ? AND check_out_time IS NOT NULL
       ORDER BY check_in_time DESC`
    )
    .all(centerId, studentId);

  const totalVisits = completedSessions.length;
  const totalDuration = completedSessions.reduce(
    (sum, s) => sum + (s.duration_minutes || 0),
    0
  );
  const avgDuration = totalVisits > 0 ? Math.round((totalDuration / totalVisits) * 10) / 10 : 0;
  const lastVisit = completedSessions[0]?.check_in_time || null;

  const allSessions = await db
    .prepare('SELECT check_in_time FROM sessions WHERE center_id = ? AND student_id = ?')
    .all(centerId, studentId);

  const visitsThisWeek = allSessions.filter((s) =>
    isWithinPastDays(s.check_in_time, 7)
  ).length;

  const isCheckedIn = Boolean(
    await db
      .prepare(
        `SELECT 1 FROM sessions
         WHERE center_id = ? AND student_id = ? AND check_out_time IS NULL LIMIT 1`
      )
      .get(centerId, studentId)
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
