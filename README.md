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
| Database | SQLite via better-sqlite3           |
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

Edit `server/.env`:

```
CENTER_TIMEZONE=America/Los_Angeles
PORT=3001
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

## Deploy (Railway)

One process serves the API and the built React SPA over HTTPS (required for camera QR scanning).

1. Re-auth CLI if needed: `railway login`
2. From repo root: `railway init` (or `railway link`)
3. Add a volume mounted at `/data` so SQLite survives restarts
4. Set variables:

```
NODE_ENV=production
CENTER_TIMEZONE=America/Los_Angeles
ADMIN_PASSWORD=<strong-secret>
DATA_DIR=/data
```

5. Deploy: `railway up` (or connect the GitHub repo and push)

Health check: `GET /health`. App URL from `railway domain` or the Railway dashboard.

Local production smoke test (no Docker):

```bash
npm run build --prefix client
NODE_ENV=production DATA_DIR=/tmp/kumonscan-data node server/index.js
# open http://localhost:3001
```

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
| GET    | `/api/reports/attendance`      | Monthly/annual attendance JSON or CSV            |
| GET    | `/api/students`                | List students with stats                         |
| GET    | `/api/students/:id/sessions`   | Session history for a student                    |
| POST   | `/api/students`                | Create student + QR code value                   |
| PATCH  | `/api/students/:id`            | Update enrolled subjects, schedule, phone        |
| PATCH  | `/api/students/:id/deactivate` | Deactivate a student                             |
| GET    | `/api/dashboard`               | Dashboard summary + charts                       |
| GET    | `/api/time`                    | Current server-sourced time                      |

## Check-In / Check-Out Logic

1. **Desk:** staff picks a roster name, selects Math / Reading / Both, then checks in. Allowance is 30 minutes for one subject and 60 minutes for both. Overtime rows turn red and show `+N min`.
2. **QR kiosk:** first scan of the day checks in (subjects default to the student's enrolled subjects, or both); second scan while checked in checks out.
3. timeapi.io unreachable: check-in/out rejected with error (no session written)
4. QR duplicate read within 3 seconds: ignored (`SCAN_DEDUP_SECONDS`)

## Regulars

Students with 3+ visits in the past 7 days are flagged as **Regulars** on the dashboard.
