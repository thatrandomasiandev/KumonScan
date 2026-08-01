# Production Environment Variables

Every environment variable the codebase reads, what it controls, and what happens when it is unset. Audited 2026-08-01 by grepping `process.env.*` across `server/`, `client/`, `gateway-app/`, `marketing-site/`, `api/`, and `scripts/` at commit `b8f51ea`. Variables that land with still-unmerged agent branches are listed in their own section at the bottom.

Scope notes:

- The **client** reads zero environment variables. The API base is the same-origin path `/api/c/:centerSlug` built at runtime (`client/src/api.js`), so no `client/.env.example` exists and none is needed.
- The **gateway app** (`gateway-app/`) is a native Android project configured through in-app preferences (`Prefs.kt`: server URL and API key entered on the phone), not environment variables.
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
| `GATEWAY_API_KEY` | For SMS | Static bearer token the Android gateway phone presents to `/api/gateway/*` (`server/routes/gateway.routes.js`, `messaging.routes.js`). | Fail closed: gateway endpoints return 503. Check-in/out SMS rows still queue in `sms_queue`, unsent, and send once the key is configured. |
| `GATEWAY_HEARTBEAT_STALE_SECONDS` | No | Seconds without a gateway heartbeat before `/api/status` reports the SMS gateway offline (`server/routes/status.routes.js`). | Defaults to 600. |
| `ZOOM_WEBHOOK_SECRET` | No | Zoom webhook signature verification for automatic remote attendance (`server/services/zoomService.js`). | Fail closed: `POST /api/webhooks/zoom` returns 503. Staff log remote sessions manually via the desk Remote toggle. |
| `WHATSAPP_ACCESS_TOKEN` | No | WhatsApp Cloud API outbound auth (`server/services/whatsappService.js`). | Channel disabled with `WHATSAPP_PHONE_NUMBER_ID`; notifications fall back to SMS. |
| `WHATSAPP_PHONE_NUMBER_ID` | No | WhatsApp Cloud API sender phone-number id. | Same fallback as above. |
| `WHATSAPP_VERIFY_TOKEN` | No | WhatsApp webhook subscription handshake (`GET /api/webhooks/whatsapp`). | Fail closed: handshake returns 503. |
| `WHATSAPP_APP_SECRET` | No | `X-Hub-Signature-256` verification on inbound WhatsApp webhooks. | Fail closed: `POST /api/webhooks/whatsapp` returns 503. |
| `LOG_LEVEL` | No | pino log level (`server/services/loggingService.js`). | Defaults to `info`; `silent` under `NODE_ENV=test`. |
| `PORT` | Local only | Listen port for `server/index.js` (local/Railway process mode). Unused on Vercel, which invokes `api/index.js` as a function. | Defaults to 3001. |

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

## Landing with the integration pass (unmerged agent branches, audited per branch)

These are referenced on branches the integration captain has not yet reintegrated. Re-verify this table against `main` after integration lands; the reintegration may rename or drop some.

| Variable | Branch | Purpose | Behavior when unset (as written on the branch) |
|---|---|---|---|
| `CRON_SECRET` | `agent-12-digests`, `agent-demo` | Authenticates Vercel cron invocations (digest send, demo reset). | Cron endpoints reject unauthenticated calls. |
| `PARENT_SESSION_SECRET` | `agent-13-parent-pwa` | Signs parent magic-link sessions. | Parent auth fails closed. |
| `PUBLIC_BASE_URL` | `agent-13-parent-pwa`, `agent-billing` | Absolute URL for magic links and Stripe redirect URLs. | Links cannot be built; the features 503 or misbehave. Set to the real production origin. |
| `STRIPE_SECRET_KEY` | `agent-billing` | Stripe API auth for Checkout and invoicing. | Billing endpoints fail closed. |
| `STRIPE_WEBHOOK_SECRET` | `agent-billing` | Stripe webhook signature verification. | Webhook reconciliation fails closed. |
| `DEMO_MODE` | `agent-demo` | Marks a deployment as the sales demo (guarded seed, nightly reset). | Demo features disabled. Never set on the production deployment. |

## Secrets audit (2026-08-01)

- Working tree at `b8f51ea`: pattern scan for Stripe keys (`sk_live_`, `sk_test_`, `whsec_`), AWS keys, Slack tokens, private-key blocks, and credentialed Neon connection strings found nothing outside placeholder values in `.env.example`.
- Full git history (`git log --all -p`): same patterns, zero matches. No `.env` file was ever committed on any branch.
- `.gitignore` coverage: the root `.gitignore` ignores `.env` and `.env.*` at every depth (bare pattern, no slash), covering `client/`, `gateway-app/`, and `api/`; `server/.gitignore` and `marketing-site/.gitignore` add their own `.env` entries. `git check-ignore` confirms `client/.env`, `gateway-app/.env`, `marketing-site/.env`, `server/.env`, and `api/.env` are all ignored.
- Roster CSV/TSV exports (student PII) and `invoices/` are also ignored at the root.
