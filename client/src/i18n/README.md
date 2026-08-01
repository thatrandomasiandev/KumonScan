# Parent-Facing i18n

Scope: parent-facing surfaces only (registration today; booking and the marketing site when they ship). Staff tools (`DeskPage`, `AdminPage`, `DashboardPage`, `ScanPage`) stay English and must not import `useTranslation`.

## Adding a language (no code changes)

1. Client UI: copy `locales/en.json` to `locales/<code>.json` (BCP 47 base code, e.g. `vi.json`) and translate every key. Keep `_meta.nativeName` in the language itself ("Tiếng Việt"); it becomes the selector option label. The file is auto-discovered by `import.meta.glob` in `index.js`, the language appears in `LanguageSelector`, and browser detection picks it up.
2. Notifications: copy `server/services/i18n-templates/en.json` to `<code>.json` and translate. Set `_meta.intlLocale` to the Intl locale used for time formatting (e.g. `vi-VN`). `server/tests/i18n.test.js` fails if any language file is missing a key present in English.
3. There is no step 3. `students.preferred_language` accepts any code with a template file; anything else resolves to English.

Do not machine-translate and ship. Have a native speaker review both files before enabling a language for real parents.

## How language is chosen

- Client: `localStorage["kumonscan.language"]`, then `navigator.language` (base-tag match), then `en`. `setLanguage()` persists the choice.
- Registration sends the active UI language as `preferred_language`; it is stored on the new student row. Re-registering never overwrites a stored preference.
- Notifications (`server/services/i18nService.js`): `composeAttendanceNotification(student, action, iso)` reads `student.preferred_language`. Unknown or unset values fall back to English; a key missing from one language falls back to the English text for that key.

## Known gap

Server validation errors (e.g. name rules on `/api/register`) are returned in English and shown verbatim. Translating them needs error codes on the API, out of scope here.
