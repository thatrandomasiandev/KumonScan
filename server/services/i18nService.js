import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCenterTimezone } from '../timeService.js';
import { formatFullName } from '../utils/names.js';

/**
 * Per-language notification template lookup for parent-facing SMS/WhatsApp.
 *
 * Templates live in `server/services/i18n-templates/<lang>.json`, one file per
 * language. The directory is scanned once at module load, so adding a language
 * means adding one JSON file with the same template keys — no code change.
 *
 * Lookup never crashes on an unknown or unset language: `resolveLanguage`
 * falls back to English ('en'), and a template key missing from a non-English
 * file falls back to the English text for that key. An unknown template NAME
 * throws, because that is a programming error at the call site, not bad data.
 *
 * Seam for notification dispatch (agent-1 SMS queue / agent-8 WhatsApp): call
 * `composeAttendanceNotification(student, action, iso)` instead of composing
 * the message inline. It reads `student.preferred_language` and formats the
 * time in the center timezone using the language's own Intl locale.
 */

const TEMPLATES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'i18n-templates'
);

export const DEFAULT_LANGUAGE = 'en';

function loadTemplates() {
  const byLanguage = new Map();
  for (const file of fs.readdirSync(TEMPLATES_DIR)) {
    if (!file.endsWith('.json')) continue;
    const language = path.basename(file, '.json').toLowerCase();
    const parsed = JSON.parse(
      fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8')
    );
    byLanguage.set(language, parsed);
  }
  if (!byLanguage.has(DEFAULT_LANGUAGE)) {
    throw new Error(
      `i18nService: missing default template file ${DEFAULT_LANGUAGE}.json in ${TEMPLATES_DIR}`
    );
  }
  return byLanguage;
}

const templatesByLanguage = loadTemplates();

/** Language codes with a template file on disk, sorted, default first. */
export function getSupportedLanguages() {
  return [...templatesByLanguage.keys()].sort((a, b) =>
    a === DEFAULT_LANGUAGE ? -1 : b === DEFAULT_LANGUAGE ? 1 : a.localeCompare(b)
  );
}

/**
 * Normalize any raw language value to a supported code. Accepts BCP 47 tags
 * ('es-MX' → 'es'), mixed case, null, undefined, and garbage; everything
 * unsupported resolves to 'en'.
 */
export function resolveLanguage(raw) {
  if (typeof raw !== 'string') return DEFAULT_LANGUAGE;
  const tag = raw.trim().toLowerCase();
  if (!tag) return DEFAULT_LANGUAGE;
  if (templatesByLanguage.has(tag)) return tag;
  const base = tag.split(/[-_]/)[0];
  return templatesByLanguage.has(base) ? base : DEFAULT_LANGUAGE;
}

/**
 * Raw template text for `templateName` in `language`. Falls back to English
 * for unsupported languages and for keys missing from a language file.
 * Throws only when the template name does not exist in English either.
 */
export function getTemplate(templateName, language) {
  if (typeof templateName !== 'string' || templateName.startsWith('_')) {
    throw new Error(`i18nService: invalid template name "${templateName}"`);
  }
  const lang = resolveLanguage(language);
  const text =
    templatesByLanguage.get(lang)?.[templateName] ??
    templatesByLanguage.get(DEFAULT_LANGUAGE)?.[templateName];
  if (typeof text !== 'string') {
    throw new Error(`i18nService: unknown template "${templateName}"`);
  }
  return text;
}

/**
 * `getTemplate` plus `{{placeholder}}` interpolation. A placeholder with no
 * matching var is left verbatim so it is visible in tests and message logs
 * rather than silently dropped.
 */
export function renderTemplate(templateName, language, vars = {}) {
  return getTemplate(templateName, language).replace(
    /\{\{(\w+)\}\}/g,
    (token, key) => (vars[key] != null ? String(vars[key]) : token)
  );
}

function intlLocaleFor(language) {
  const lang = resolveLanguage(language);
  return (
    templatesByLanguage.get(lang)?._meta?.intlLocale ||
    templatesByLanguage.get(DEFAULT_LANGUAGE)?._meta?.intlLocale ||
    'en-US'
  );
}

/**
 * Compose the full check-in/check-out notification text for one student in
 * the student's preferred language. `action` is 'checked_in' or
 * 'checked_out' (the values the scan/check-out flows already use); `iso` is
 * the authoritative event timestamp. The time is rendered in the center
 * timezone with the language's own Intl locale (e.g. "7:25 p. m." for es).
 */
export function composeAttendanceNotification(student, action, iso) {
  const language = resolveLanguage(student?.preferred_language);
  const time = new Intl.DateTimeFormat(intlLocaleFor(language), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: getCenterTimezone(),
  }).format(new Date(iso));
  return renderTemplate(action, language, {
    name: formatFullName(student),
    time,
  });
}

/** Test-only: raw per-language template objects for key-parity checks. */
export function getAllTemplatesForTests() {
  return new Map(templatesByLanguage);
}
