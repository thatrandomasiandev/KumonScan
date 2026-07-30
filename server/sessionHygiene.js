import db from './db.js';
import { getDateInTimezone, getTodayInTimezone } from './timeService.js';
import { allowanceForSubjects } from './sessionRules.js';

/**
 * Close open sessions from a prior calendar day (center TZ).
 * Checkout is stamped at check-in + allowance so overnight orphans
 * do not inflate report averages to multi-day durations.
 */
export async function closeStaleOpenSessions(todayYmd = getTodayInTimezone()) {
  const openRows = await db
    .prepare(
      `SELECT id, student_id, check_in_time, subjects, allowance_minutes
       FROM sessions
       WHERE check_out_time IS NULL
       ORDER BY check_in_time ASC`
    )
    .all();

  const update = db.prepare(
    `UPDATE sessions
     SET check_out_time = ?, duration_minutes = ?
     WHERE id = ? AND check_out_time IS NULL`
  );

  let closed = 0;

  for (const ses of openRows) {
    const day = getDateInTimezone(ses.check_in_time);
    if (day >= todayYmd) continue;

    const allowance =
      ses.allowance_minutes ?? allowanceForSubjects(ses.subjects || 'both');
    const checkInMs = new Date(ses.check_in_time).getTime();
    const checkoutIso = new Date(checkInMs + allowance * 60_000).toISOString();
    const duration = Math.round(allowance * 10) / 10;
    await update.run(checkoutIso, duration, ses.id);
    closed += 1;
  }

  // Collapse same-day duplicate open sessions: keep newest, close older.
  const byStudent = new Map();
  const stillOpen = await db
    .prepare(
      `SELECT id, student_id, check_in_time, subjects, allowance_minutes
       FROM sessions
       WHERE check_out_time IS NULL
       ORDER BY check_in_time DESC`
    )
    .all();

  for (const ses of stillOpen) {
    const list = byStudent.get(ses.student_id) || [];
    list.push(ses);
    byStudent.set(ses.student_id, list);
  }

  for (const list of byStudent.values()) {
    if (list.length < 2) continue;
    const [, ...dupes] = list;
    for (const ses of dupes) {
      const allowance =
        ses.allowance_minutes ?? allowanceForSubjects(ses.subjects || 'both');
      const checkInMs = new Date(ses.check_in_time).getTime();
      const checkoutIso = new Date(checkInMs + allowance * 60_000).toISOString();
      await update.run(checkoutIso, Math.round(allowance * 10) / 10, ses.id);
      closed += 1;
    }
  }

  return closed;
}
