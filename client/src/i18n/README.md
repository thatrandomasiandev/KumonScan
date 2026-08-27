# Registration UI i18n

Scope: desk registration language selector (`en` / `es`). Staff tools (`DeskPage`, `AdminPage`, `DashboardPage`) stay English and must not import `useTranslation`.

## Adding a language (no code changes)

1. Client UI: copy `locales/en.json` to `locales/<code>.json` (BCP 47 base code, e.g. `vi.json`) and translate every key. Keep `_meta.nativeName` in the language itself ("Tiếng Việt"); it becomes the selector option label. The file is auto-discovered by `import.meta.glob` in `index.js`, the language appears in `LanguageSelector`, and browser detection picks it up.
2. Add the same base code to `SUPPORTED_LANGUAGES` in `server/routes/students.routes.js` (and the `resolveLanguage` allowlist in `server/routes/kiosk.routes.js`) so Admin PATCH and registration accept it.
3. There is no notification-template step: attendance SMS/WhatsApp templates were removed.

Do not machine-translate and ship. Have a native speaker review before enabling a language.

## How language is chosen

- Client: `localStorage["kumonscan.language"]`, then `navigator.language` (base-tag match), then `en`. `setLanguage()` persists the choice.
- Registration sends the active UI language as `preferred_language`; it is stored on the new student row. Re-registering never overwrites a stored preference.

## Known gap

Server validation errors (e.g. name rules on `/api/register`) are returned in English and shown verbatim. Translating them needs error codes on the API, out of scope here.
