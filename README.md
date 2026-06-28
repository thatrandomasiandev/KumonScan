# KumonScan

QR code attendance tracking system for Kumon learning centers.

## Features

- **QR Scanning** — Check in/out via device camera using html5-qrcode
- **Authoritative Time** — All timestamps sourced from timeapi.io (never client clock)
- **Dashboard** — Student analytics, session history, 30-day charts (Recharts)
- **Admin** — Add students, generate/download QR codes, deactivate students

## Tech Stack

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| Frontend | React + Vite + Tailwind CSS         |
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

## Pages

| Route        | Description                              |
| ------------ | ---------------------------------------- |
| `/`          | Full-screen QR scanner with live clock   |
| `/dashboard` | Analytics table + session charts         |
| `/admin`     | Student management + QR code generation  |

## API Endpoints

| Method | Path                        | Description                    |
| ------ | --------------------------- | ------------------------------ |
| POST   | `/api/scan`                 | Check in/out via QR code       |
| GET    | `/api/students`             | List students with stats       |
| GET    | `/api/students/:id/sessions`| Session history for a student  |
| POST   | `/api/students`             | Create student + QR code value |
| PATCH  | `/api/students/:id/deactivate` | Deactivate a student       |
| GET    | `/api/dashboard`            | Dashboard summary + charts     |
| GET    | `/api/time`                 | Current authoritative time     |

## Check-In / Check-Out Logic

1. First scan of the day → **Check In** (stores student ID + timestamp)
2. Second scan while checked in → **Check Out** (stores checkout time + duration)
3. If timeapi.io is unreachable → scan is blocked with an error message

## Regulars

Students with 3+ visits in the past 7 days are highlighted as **Regulars** on the dashboard.
