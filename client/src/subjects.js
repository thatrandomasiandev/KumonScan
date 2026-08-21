/**
 * Client-side subject helpers mirroring server/sessionRules.js.
 * Keep encoding in sync: atomics math|reading|efl, pairs joined with +, max two.
 */

export const ATOMIC_SUBJECTS = [
  { value: 'math', label: 'Math' },
  { value: 'reading', label: 'Reading' },
  { value: 'efl', label: 'EFL' },
];

const ORDER = ATOMIC_SUBJECTS.map((s) => s.value);

export function parseSubjectList(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return normalizeSubjectList(raw);
  const value = String(raw).trim().toLowerCase();
  if (!value) return [];
  if (value === 'both') return ['math', 'reading'];
  return normalizeSubjectList(value.split(/[+,\s|/]+/).filter(Boolean));
}

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
    if (!ORDER.includes(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  out.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return out.slice(0, 2);
}

export function encodeSubjects(list) {
  // Strings must go through parseSubjectList — iterating a string character-by-character
  // would drop every valid subject and yield null (desk "Pick at least one subject").
  const normalized = typeof list === 'string' || list == null
    ? parseSubjectList(list)
    : normalizeSubjectList(list);
  if (normalized.length === 0) return null;
  if (normalized.length === 1) return normalized[0];
  return normalized.join('+');
}

export function allowanceForSubjects(subjects) {
  return parseSubjectList(subjects).length >= 2 ? 60 : 30;
}

export function labelForSubjects(raw) {
  const parts = parseSubjectList(raw);
  if (parts.length === 0) return '';
  const labels = Object.fromEntries(ATOMIC_SUBJECTS.map((s) => [s.value, s.label]));
  return parts.map((p) => labels[p] || p).join(' · ');
}

/** Default pair when staff tap the Two subjects shortcut (legacy “both”). */
export const TWO_SUBJECTS_VALUE = 'math+reading';

export function isTwoSubjects(raw) {
  return parseSubjectList(raw).length >= 2;
}

/** Toggle one atomic in a max-2 selection (desk / admin cubes). */
export function toggleSubjectSelection(currentList, subjectValue) {
  const current = normalizeSubjectList(currentList);
  if (current.includes(subjectValue)) {
    return current.filter((s) => s !== subjectValue);
  }
  if (current.length >= 2) {
    // Replace the oldest selection so a third tap still feels responsive.
    return normalizeSubjectList([current[1], subjectValue]);
  }
  return normalizeSubjectList([...current, subjectValue]);
}
