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

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`, in three parallel jobs:

- **Server tests:** spins up a fresh `postgres:16` service container plus an HTTP proxy (`local-neon-http-proxy`) that lets the `@neondatabase/serverless` driver reach it. `server/scripts/ci-migrate.js` runs `ensureDb()` against that container (and refuses any `*.neon.tech` host), then `vitest run --config vitest.ci.config.js` executes the suite. No CI run touches the shared Neon test branch; each run's database is created and destroyed with the job.
- **Client build:** `npm ci && npm run build` in `client/`. A build error fails the check.
- **Marketing site build:** same, in `marketing-site/`; skipped with a notice until that directory exists on the ref.

Preview deploys come from Vercel's Git integration (configured via `vercel.json`), not from Actions.

## Pages

| Route        | Description                                                      |
| ------------ | ---------------------------------------------------------------- |
| `/`          | Full-screen QR scanner with live clock                           |
| `/desk`      | Front-desk name check-in, subject selection, timers, check-out   |
| `/dashboard` | Analytics table + session charts                                 |
| `/admin`     | Student management + QR code generation                          |

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
| PATCH  | `/api/students/:id/deactivate` | Deactivate a student                             |
| GET    | `/api/dashboard`               | Dashboard summary + charts                       |
| GET    | `/api/time`                    | Current server-sourced time                      |
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
