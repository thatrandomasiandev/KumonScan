/** Session time allowances and subject validation for desk check-in. */

export const VALID_SUBJECTS = new Set(['math', 'reading', 'both']);

export const SUBJECT_LABELS = {
  math: 'Math',
  reading: 'Reading',
  both: 'Both',
};

/** One subject = 30 minutes; both subjects = 60 minutes. */
export function allowanceForSubjects(subjects) {
  return subjects === 'both' ? 60 : 30;
}

export function normalizeSubjects(raw) {
  if (raw == null || raw === '') return null;
  const value = String(raw).trim().toLowerCase();
  if (!VALID_SUBJECTS.has(value)) return null;
  return value;
}

/**
 * Elapsed / overtime for an open session.
 * @param {string} checkInTime ISO timestamp
 * @param {number} allowanceMinutes
 * @param {number} [nowMs] defaults to Date.now(); server present enrichment can pass authoritative ms
 */
export function sessionTiming(checkInTime, allowanceMinutes, nowMs = Date.now()) {
  const checkInMs = new Date(checkInTime).getTime();
  const elapsedMinutes = Math.max(0, Math.floor((nowMs - checkInMs) / 60000));
  const overtime = elapsedMinutes > allowanceMinutes;
  const overtimeMinutes = overtime ? elapsedMinutes - allowanceMinutes : 0;

  return {
    elapsed_minutes: elapsedMinutes,
    allowance_minutes: allowanceMinutes,
    is_overtime: overtime,
    overtime_minutes: overtimeMinutes,
  };
}

export function enrichOpenSession(row, nowMs = Date.now()) {
  const allowance = row.allowance_minutes ?? allowanceForSubjects(row.subjects || 'both');
  const timing = sessionTiming(row.check_in_time, allowance, nowMs);

  return {
    ...row,
    subjects: row.subjects || 'both',
    subjects_label: SUBJECT_LABELS[row.subjects || 'both'] || 'Both',
    ...timing,
  };
}
