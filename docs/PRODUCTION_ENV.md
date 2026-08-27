# Production Environment Variables

Every environment variable the codebase reads, what it controls, and what happens when it is unset. Audited against the current tree (parent SMS/WhatsApp/gateway/PWA removed).

Scope notes:

- The **client** reads zero environment variables. The API base is the same-origin path `/api/c/:centerSlug` built at runtime (`client/src/api.js`), so no `client/.env.example` exists and none is needed.
- The **marketing site** deploys as its own Vercel project and needs exactly one variable: `DATABASE_URL` for the lead-capture function.

## Server (main Vercel project)

Set these in the Vercel project that serves `api/index.js`. "Fail behavior" is what the running code does when the variable is unset, verified against the source cited.

| Variable | Required | Purpose | Behavior when unset |
|---|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres pooled connection string. | Fail closed: `server/db.js` throws on first query; every API request 500s. `POSTGRES_URL` is accepted as an alias. |
| `ADMIN_SESSION_SECRET` | Yes (or `ADMIN_PASSWORD`) | HMAC key for signing `admin_session` cookies (`server/middleware/auth.js`). | Falls back to `ADMIN_PASSWORD`. If both are unset under `NODE_ENV=production`, session code throws (fail closed); dev/test use a fixed insecure fallback. |
| `ADMIN_PASSWORD` | First boot only | One-time seed of the original center's `admin_password_hash` (`server/db.js` `migrateCentersTable`). After the first migration the database row is authoritative; changing the env var later does not rotate the password. Also the session-secret fallback above. | Center is seeded with no admin hash. Admin routes then return 503 in production (`requireAdmin` fails closed), and are unprotected with a console warning outside production. |
| `SUPERADMIN_KEY` | For provisioning | Platform-operator bearer token for `POST /api/centers` (`requireSuperadmin`). | Fail closed in every environment: provisioning returns 503. |
| `NODE_ENV` | Yes (`production`) | Gates the fail-closed paths above, `secure` cookies, and prod-only 503s for unconfigured center admin auth. | Server behaves as dev: insecure session fallback allowed, cookies not `secure`, unprotected admin routes only warn. Vercel sets this automatically. |
| `ALLOWED_ORIGINS` | Same-origin: no | Comma-separated origins for credentialed CORS (`server/corsConfig.js`). `ALLOWED_ORIGIN` (singular) is an alias. | Falls back to localhost dev origins (5173/3001). Same-origin production traffic is unaffected; any cross-origin browser client is silently denied CORS headers. |
| `CENTER_TIMEZONE` | No | Fallback timezone when a center row has none (`server/timeService.js`). Also seeds the original center's timezone on first boot. | Defaults to `America/Los_Angeles`. |
| `CENTER_NAME` | No | Display name for the original center seeded on first boot. | Defaults to `KumonScan Center`. |
| `DEFAULT_CENTER_SLUG` | No | Slug for the original center seeded on first boot; also the slug legacy unslugged `/api/...` paths resolve to. | Defaults to `main`. |
| `ZOOM_WEBHOOK_SECRET` | No | Zoom webhook signature verification for automatic remote attendance (`server/services/zoomService.js`). | Fail closed: `POST /api/webhooks/zoom` returns 503. Staff log remote sessions manually via the desk Remote toggle. |
| `LOG_LEVEL` | No | pino log level (`server/services/loggingService.js`). | Defaults to `info`; `silent` under `NODE_ENV=test`. |
| `PORT` | Local only | Listen port for `server/index.js` (local/Railway process mode). Unused on Vercel, which invokes `api/index.js` as a function. | Defaults to 3001. |
| `CRON_SECRET` | For scheduled jobs | Bearer token Vercel Cron sends to `GET /api/demo/reset`. | Demo reset 401s when unset. |
| `DEMO_MODE` | Demo deployment only | Marks a deployment as the sales demo (`docs/DEMO.md`): enables `/api/demo/reset` and the seed-script wipe guards. | Demo features disabled (reset 404s). Never set on a deployment whose `DATABASE_URL` holds real center data. |

### Removed / unused (do not set)

Parent communication was removed. These env vars are ignored if still present in Vercel:

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `GATEWAY_API_KEY`, `GATEWAY_HEARTBEAT_STALE_SECONDS`, `PARENT_SESSION_SECRET`, `PUBLIC_BASE_URL` (was only for parent magic links).

## Platform-provided (never set by hand)

| Variable | Set by | Purpose |
|---|---|---|
| `VERCEL` | Vercel | Skips Express static-file serving (`server/app.js`); Vercel serves `client/dist` via rewrites instead. |

## Test and CI only (never set in production)

| Variable | Used by | Purpose |
|---|---|---|
| `TEST_DATABASE_URL` | `server/tests/` | Neon test-branch connection string. The test suite refuses to target the production branch. |
| `NEON_FETCH_ENDPOINT` | `server/scripts/ci-neon-proxy.js`, `ci-migrate.js` | Points the Neon serverless driver at the local Postgres proxy in GitHub Actions. |

## Marketing site (separate Vercel project)

| Variable | Required | Purpose | Behavior when unset |
|---|---|---|---|
| `DATABASE_URL` | Yes | Neon connection string for the `leads` table (`marketing-site/api/lead.js`). | Fail closed: `POST /api/lead` returns 503 and logs the misconfiguration. |

## Landing with the integration pass (unmerged agent branches)

`agent-billing` (Stripe tuition billing) is excluded from integration by product decision, not a merge-ordering gap — its `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` vars are intentionally omitted here.

## Security pass (2026-08-01)

**CORS.** `ALLOWED_ORIGINS` is unset in production terms: `server/corsConfig.js` falls back to localhost dev origins. Production on Vercel is same-origin (client and API share one domain), so no allowlist entry is needed for the main app.

**Rate limiting under tenancy.** The login (10/min) and registration (10/min) limiters are module-level singletons keyed by client IP. The same router instances serve both `/api/c/:centerSlug/...` and legacy `/api/...` mounts (`server/app.js`), so rotating center slugs hits the same per-IP bucket: no bypass. Known limitation: the store is in-memory per serverless instance, so limits reset on cold starts and are per-instance; acceptable as brute-force friction, not a hard quota.

**Admin session cookie.** `httpOnly`, `sameSite: 'lax'`, `secure` when `NODE_ENV=production`, 7-day expiry, HMAC-signed and bound to one center id, with a revocation denylist on logout (`server/middleware/auth.js`, `auth.routes.js`). Correct for a same-origin deployment on any single production domain.

## Secrets audit (2026-08-01)

- Pattern scan for Stripe keys, AWS keys, Slack tokens, private-key blocks, and credentialed Neon connection strings found nothing outside placeholder values in `.env.example`.
- `.gitignore` coverage: the root `.gitignore` ignores `.env` and `.env.*` at every depth; `server/.gitignore` and `marketing-site/.gitignore` add their own `.env` entries.
- Roster CSV/TSV exports (student PII) are also ignored at the root.
