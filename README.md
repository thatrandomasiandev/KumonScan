# KumonScan

QR attendance for Kumon learning centers: per-student codes, kiosk check-in/out, staff dashboard.

## Features

- **QR scanning:** device-camera check-in/out via html5-qrcode
- **Server time:** timestamps from timeapi.io only; client clock ignored; scan rejected if timeapi.io is unreachable
- **Dashboard:** per-student stats, session history, 30-day charts (Recharts)
- **Admin:** add students, generate and download QR codes, deactivate accounts

## Tech Stack

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| Frontend | React + Vite + Material Design 3 (MUI) |
| Backend  | Express.js (Node)                   |
| Database | Neon Postgres (`@neondatabase/serverless`) |
| QR Scan  | html5-qrcode                        |
| QR Gen   | qrcode npm package                  |
| Charts   | Recharts                            |
| Time     | timeapi.io REST API                 |

## Quick Start

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

Edit `server/.env` (see `server/.env.example`):

```
CENTER_TIMEZONE=America/Los_Angeles
PORT=3001
ADMIN_PASSWORD=replace-with-a-strong-password
DATABASE_URL=postgresql://...@...neon.tech/neondb?sslmode=require
```

### 3. Seed sample students

```bash
cd server && npm run seed
```

### 4. Start the servers

```bash
# Terminal 1 — API server
cd server && npm run dev

# Terminal 2 — Frontend
cd client && npm run dev
```

Open **http://localhost:5173**

## Deploy (Vercel + Neon)

Static SPA on Vercel; `/api` and `/health` run as a serverless Express function. Data lives in Neon Postgres (`DATABASE_URL`).

```bash
vercel link
vercel env add DATABASE_URL
vercel env add ADMIN_PASSWORD
vercel env add CENTER_TIMEZONE
vercel --prod
```

Required production env:

```
DATABASE_URL=postgresql://...@...neon.tech/neondb?sslmode=require
ADMIN_PASSWORD=<strong-secret>
CENTER_TIMEZONE=America/Los_Angeles
NODE_ENV=production
```

Health check: `GET /health`. Same-origin `/api` needs no CORS allowlist; set `ALLOWED_ORIGINS` only for cross-origin admin clients.

In production, admin routes return 503 if `ADMIN_PASSWORD` is unset (auth fails closed). JSON bodies are capped at 256kb except `/api/admin/roster-import` (8mb). `/api/scan` is rate-limited to 60 requests per minute per IP.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`, in three parallel jobs:

- **Server tests:** spins up a fresh `postgres:16` service container plus an HTTP/WebSocket proxy (`local-neon-http-proxy`) that lets the `@neondatabase/serverless` driver reach it. `server/scripts/ci-migrate.js` runs `ensureDb()` against that container (and refuses any `*.neon.tech` host), then `vitest run --config vitest.ci.config.js` executes the suite. No CI run touches the shared Neon test branch; each run's database is created and destroyed with the job.
- **Client build:** `npm ci && npm run build` in `client/`. A build error fails the check.
- **Marketing site build:** same, in `marketing-site/` when that directory is present on the ref.

Preview deploys come from Vercel's Git integration (configured via `vercel.json`), not from Actions.

## Parent SMS gateway

Check-in and check-out enqueue a parent text in the `sms_queue` table (skipped when the student has no parent phone). A dedicated Android phone running `gateway-app/` sends the texts:

1. Set `GATEWAY_API_KEY` (any long random string) in the server environment.
2. Build and install `gateway-app/` on the phone (see `gateway-app/README.md`).
3. Enter the server URL and the same key in the app, grant SMS permission, start the service.

The phone polls `GET /api/gateway/pending` every 15 seconds (claims up to 20 messages atomically), sends via the phone's SMS plan, and reports each result to `POST /api/gateway/:id/ack`. Failures retry up to 3 attempts, then stay `failed`. `GET /api/admin/gateway-status` (staff-authenticated) reports the phone's last heartbeat and pending/failed counts. Without `GATEWAY_API_KEY`, gateway endpoints return 503 and queued rows accumulate unsent.

## WhatsApp channel

Each student has a `notify_channel` (`sms` default, or `whatsapp`) and an optional `parent_whatsapp` number, both editable in Admin. Students set to WhatsApp get check-in/check-out notifications through the Meta Cloud API (`graph.facebook.com/v19.0`) instead of the SMS queue; a missing `parent_whatsapp`, unset WhatsApp config, or a send failure never fails the check-in — the first two fall back to SMS with a logged warning, a send failure marks the message row `failed`. Inbound WhatsApp messages and delivery-status updates arrive at `/api/webhooks/whatsapp`, verified against `WHATSAPP_APP_SECRET` via `X-Hub-Signature-256`, and land in the same `messages` table as SMS (`channel = 'whatsapp'`) so staff see one thread per student.

Setup requires four env vars (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`) plus two message templates named `checked_in` and `checked_out` (each with two body parameters: student name, local time) submitted for approval in Meta Business Manager. Until the templates are approved, sends fail soft with a template-not-found API error.

## Pages

| Route        | Description                                                      |
| ------------ | ---------------------------------------------------------------- |
| `/`          | Full-screen QR scanner with live clock                           |
| `/desk`      | Front-desk name check-in, subject selection, timers, check-out   |
| `/dashboard` | Analytics table + session charts                                 |
| `/admin`     | Student + staff management, QR codes, capacity, payroll          |

## API Endpoints

| Method | Path                           | Description                                      |
| ------ | ------------------------------ | ------------------------------------------------ |
| POST   | `/api/scan`                    | Check in/out via QR code                         |
| POST   | `/api/check-in`                | Staff desk check-in (student_id + subjects)      |
| POST   | `/api/check-out`               | Staff desk check-out (student_id or session_id)  |
| GET    | `/api/present`                 | Open sessions with elapsed time and overtime     |
| GET    | `/api/absent`                  | Scheduled today but never checked in             |
| GET    | `/api/reports/attendance`      | Monthly/annual attendance JSON, CSV, or PDF      |
| GET    | `/api/students`                | List students with stats                         |
| GET    | `/api/students/:id/sessions`   | Session history for a student                    |
| POST   | `/api/students`                | Create student + QR code value                   |
| POST   | `/api/admin/roster-import`     | Admin CRM TSV/CSV roster upload                  |
| POST   | `/api/admin/schedule-bulk`     | Bulk-set schedule days (missing or all active)   |
| GET    | `/api/staff`                   | List staff with on-duty status                   |
| POST   | `/api/staff`                   | Create staff member (role, hourly rate)          |
| PATCH  | `/api/staff/:id`               | Update role, hourly rate, or active flag         |
| POST   | `/api/staff/:id/clock-in`      | Start a shift (timeapi.io timestamp)             |
| POST   | `/api/staff/:id/clock-out`     | End the open shift and record duration           |
| GET    | `/api/reports/payroll`         | Per-staff hours + gross pay (JSON or CSV)        |
| GET    | `/api/reports/utilization`     | Avg check-ins per weekday vs schedule + capacity |
| GET    | `/api/admin/capacity`          | Weekday seat limits                              |
| PUT    | `/api/admin/capacity`          | Set weekday seat limits                          |
| PATCH  | `/api/students/:id/deactivate` | Deactivate a student                             |
| GET    | `/api/dashboard`               | Dashboard summary + charts                       |
| GET    | `/api/time`                    | Current server-sourced time                      |
| GET    | `/api/gateway/pending`         | Gateway phone claims queued SMS (bearer key)     |
| POST   | `/api/gateway/:id/ack`         | Gateway phone reports send result                |
| POST   | `/api/gateway/heartbeat`       | Gateway phone liveness ping                      |
| GET    | `/api/admin/gateway-status`    | Last heartbeat + pending/failed queue counts     |
| GET    | `/api/webhooks/whatsapp`       | Meta webhook subscription handshake              |
| POST   | `/api/webhooks/whatsapp`       | Inbound WhatsApp + delivery status (signed)      |
| POST   | `/api/auth/login`              | Admin login (sets httpOnly cookie; rate-limited) |
| POST   | `/api/auth/logout`             | Clears cookie and revokes the server-side session |
| GET    | `/api/auth/status`             | Whether the current cookie is a valid admin session |

## Check-In / Check-Out Logic

1. **Desk:** staff picks a roster name, selects Math / Reading / Both, then checks in. Allowance is 30 minutes for one subject and 60 minutes for both. Overtime rows turn red and show `+N min`.
2. **QR kiosk:** first scan of the day checks in (subjects default to the student's enrolled subjects, or both); second scan while checked in checks out.
3. timeapi.io unreachable or slow (>5s): check-in/out rejected with error (no session written)
4. QR duplicate read within 3 seconds: ignored (`SCAN_DEDUP_SECONDS`)

## Auth

Admin routes require `ADMIN_PASSWORD`. Login issues a random httpOnly `admin_session` cookie (7-day server-side expiry). Logout clears the cookie and invalidates that token so replay fails. Login is rate-limited to 10 attempts/minute (same pattern as `/api/register`).

## Regulars

Students with 3+ visits in the past 7 days are flagged as **Regulars** on the dashboard.
