import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * i18n for parent-facing surfaces only (registration today; booking and the
 * marketing site when those ship). Staff tools (Desk, Admin, Dashboard) stay
 * English and never call useTranslation.
 *
 * Locale files are auto-discovered from ./locales/<lang>.json, so adding a
 * language is one new JSON file — no code change. Each file carries its own
 * display name in _meta.nativeName, which drives the selector options.
 */

const STORAGE_KEY = 'kumonscan.language';
export const DEFAULT_LANGUAGE = 'en';

const localeModules = import.meta.glob('./locales/*.json', { eager: true });

const resources = {};
for (const [file, mod] of Object.entries(localeModules)) {
  const code = file.match(/([\w-]+)\.json$/)[1].toLowerCase();
  resources[code] = { translation: mod.default ?? mod };
}

/** [{ code, nativeName }] for every locale file, default language first. */
export function getLanguageOptions() {
  return Object.keys(resources)
    .sort((a, b) =>
      a === DEFAULT_LANGUAGE ? -1 : b === DEFAULT_LANGUAGE ? 1 : a.localeCompare(b)
    )
    .map((code) => ({
      code,
      nativeName: resources[code].translation?._meta?.nativeName || code.toUpperCase(),
    }));
}

function detectLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && resources[stored]) return stored;
  } catch {
    // Private mode / blocked storage: fall through to browser language.
  }
  const browser = (navigator.language || '').toLowerCase();
  if (resources[browser]) return browser;
  const base = browser.split('-')[0];
  if (resources[base]) return base;
  return DEFAULT_LANGUAGE;
}

/** Switch the UI language and persist the choice for the next visit. */
export function setLanguage(code) {
  const next = resources[code] ? code : DEFAULT_LANGUAGE;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Persistence is best-effort; the in-memory switch still applies.
  }
  return i18n.changeLanguage(next);
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: Object.keys(resources),
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
