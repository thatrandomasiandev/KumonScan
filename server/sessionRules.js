/** Session time allowances and subject validation for desk check-in. */

/** Atomic subjects staff can pick (at most two per visit / enrollment). */
export const ATOMIC_SUBJECTS = ['math', 'reading', 'efl'];

export const ATOMIC_SUBJECT_LABELS = {
  math: 'Math',
  reading: 'Reading',
  efl: 'EFL',
};

/** @deprecated Prefer encodeSubjects / parseSubjectList. Kept for call sites that still pass legacy `both`. */
export const VALID_SUBJECTS = new Set([
  'math',
  'reading',
  'efl',
  'both',
  'math+reading',
  'math+efl',
  'efl+math',
  'efl+reading',
  'reading+efl',
]);

/**
 * Human labels for stored subject codes (singles, pairs, and legacy `both`).
 * Pair keys are sorted alphabetically with `+`.
 */
export const SUBJECT_LABELS = {
  math: 'Math',
  reading: 'Reading',
  efl: 'EFL',
  both: 'Math · Reading',
  'math+reading': 'Math · Reading',
  'math+efl': 'Math · EFL',
  'efl+math': 'Math · EFL',
  'efl+reading': 'Reading · EFL',
  'reading+efl': 'Reading · EFL',
};

/** Split a stored subjects value into atomic subject codes (0–2). */
export function parseSubjectList(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return normalizeSubjectList(raw);
  }
  const value = String(raw).trim().toLowerCase();
  if (!value) return [];
  if (value === 'both') return ['math', 'reading'];
  const parts = value.split(/[+,\s|/]+/).filter(Boolean);
  return normalizeSubjectList(parts);
}

/** Dedupe, keep only known atomics, sort, cap at two. */
export function normalizeSubjectList(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const v = String(item).trim().toLowerCase();
    if (v === 'both') {
      for (const s of ['math', 'reading']) {
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
      }
      continue;
    }
    if (!ATOMIC_SUBJECTS.includes(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  out.sort((a, b) => ATOMIC_SUBJECTS.indexOf(a) - ATOMIC_SUBJECTS.indexOf(b));
  return out.slice(0, 2);
}

/** Canonical DB / API string: one atomic, or `a+b` for a pair. */
export function encodeSubjects(list) {
  // Strings must go through parseSubjectList — iterating a string character-by-character
  // would drop every valid subject and yield null.
  const normalized = typeof list === 'string' || list == null
    ? parseSubjectList(list)
    : normalizeSubjectList(list);
  if (normalized.length === 0) return null;
  if (normalized.length === 1) return normalized[0];
  return normalized.join('+');
}

/** Label for a stored or list value. */
export function labelForSubjects(raw) {
  const encoded = typeof raw === 'string' ? normalizeSubjects(raw) : encodeSubjects(raw);
  if (!encoded) return '';
  if (SUBJECT_LABELS[encoded]) return SUBJECT_LABELS[encoded];
  return parseSubjectList(encoded)
    .map((s) => ATOMIC_SUBJECT_LABELS[s] || s)
    .join(' · ');
}

/** One subject = 30 minutes; two subjects = 60 minutes. */
export function allowanceForSubjects(subjects) {
  const count = parseSubjectList(subjects).length;
  if (count >= 2) return 60;
  return 30;
}

/**
 * Normalize a client/API subjects value to a canonical stored string, or null if invalid.
 * Accepts legacy `both` (→ math+reading), singles, and pairs.
 */
export function normalizeSubjects(raw) {
  if (raw == null || raw === '') return null;
  if (Array.isArray(raw)) {
    const encoded = encodeSubjects(raw);
    return encoded;
  }
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (value === 'both') return 'math+reading';
  if (ATOMIC_SUBJECTS.includes(value)) return value;
  const encoded = encodeSubjects(parseSubjectList(value));
  if (!encoded) return null;
  // Reject three-or-more / garbage that parsed empty after filter.
  const parts = parseSubjectList(value);
  if (parts.length === 0) return null;
  return encoded;
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

/** Display overage for completed visits (never show +0 when overtime). */
export function overtimeMinutesDisplay(durationMinutes, allowanceMinutes) {
  const duration = Number(durationMinutes) || 0;
  const allowance = Number(allowanceMinutes) || 0;
  if (!(duration > allowance)) return 0;
  return Math.max(1, Math.ceil(duration - allowance));
}

export function enrichOpenSession(row, nowMs = Date.now()) {
  const subjects = normalizeSubjects(row.subjects) || 'math+reading';
  const allowance = row.allowance_minutes ?? allowanceForSubjects(subjects);
  const timing = sessionTiming(row.check_in_time, allowance, nowMs);

  return {
    ...row,
    subjects,
    subjects_label: labelForSubjects(subjects),
    ...timing,
  };
}
