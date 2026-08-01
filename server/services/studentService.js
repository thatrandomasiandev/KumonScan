import db, { isOpenSessionUniqueViolation } from '../db.js';
import { calculateDurationMinutes, isWithinPastDays, parseScheduleDays } from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import { allowanceForSubjects, normalizeSubjects } from '../sessionRules.js';

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

export async function completeCheckOut(openSession, iso) {
  const duration = calculateDurationMinutes(openSession.check_in_time, iso);
  await db
    .prepare(
      'UPDATE sessions SET check_out_time = ?, duration_minutes = ? WHERE id = ? AND center_id = ?'
    )
    .run(iso, duration, openSession.id, openSession.center_id);

  return await db
    .prepare('SELECT * FROM sessions WHERE id = ? AND center_id = ?')
    .get(openSession.id, openSession.center_id);
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
