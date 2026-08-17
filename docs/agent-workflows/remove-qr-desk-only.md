# Queued task: remove QR check-in, desk-only attendance

Decision record, 2026-08-01. The client no longer wants QR codes. Check-in becomes staff-operated only, from the Desk page. No kiosk, no student codes, no camera. Execute this after `agent-integration` marks `done` in `.agent-coordination/status.md`, in a fresh worktree off the merged `main`. Re-scope against that main first: the integration lands branches (offline idempotency, parent PWA, curriculum) that may reference the scan flow and are not covered by the file list below, which was audited at `b8f51ea`.

## Assumption to confirm with the client

Self-registration stays: `RegisterPage` keeps adding students to the roster but stops issuing a `KUMON-XXXX` code. If registration should also move behind the desk, delete the page and the public `/register` route instead.

## What replaces QR

Nothing new is built. The Desk page's existing roster-search check-in (per-subject allowances, in-person/remote toggle, session timers, checkout) becomes the only attendance path. It already enqueues parent SMS and enforces one open session per student via the partial unique index. Keep the timeapi.io authoritative-time gate; it lives in the shared check-in path, not the scanner.

## Removal checklist

Client:

- Delete `client/src/pages/ScanPage.jsx`; remove its route from `App.jsx` and make Desk the landing tab.
- Remove the Scan entry from `BottomNav.jsx` and `NavigationRail.jsx`.
- Strip QR issuance/display from `RegisterPage.jsx` (per the assumption above).
- Remove per-student QR display/printing from `AdminPage.jsx`.
- Remove scan/code API calls from `client/src/api.js`.
- Strip scan/QR strings from `client/src/i18n/locales/en.json` and `es.json`; remove scanner CSS from `index.css`.
- Drop `html5-qrcode` and `qrcode` from `client/package.json`.

Server:

- `kiosk.routes.js`: remove the scan endpoint, `scanLimiter`, and `SCAN_DEDUP_SECONDS` (dedup existed only for camera double-reads; the desk path is covered by the open-session unique index). Keep `/register` minus code issuance, with its 10/min limiter.
- Stop generating codes in `students.routes.js`, `rosterImport.js`, and `seed.js`; delete `generate-qr.js`.
- `db.js`: drop `students.qr_code` with a guarded migration (data is worthless once codes are dead); re-verify `ensureDb()` idempotency afterward per `docs/BACKUP.md`.
- Drop `qrcode` from `server/package.json`.

Tests: update `multitenant.test.js`, `export.test.js`, `hardening.test.js`, `helpers.js`, and any kiosk-scan tests to the desk-only flow.

Docs: rewrite the check-in story in `PRODUCT.md`, `README.md`, `DESIGN.md`, and `docs/PRODUCTION_ENV.md` if any env rows reference scanning; update `.cursor/rules/writing-quality.mdc` (the 3-second dedup and kiosk touch-target numbers stop being product facts).
