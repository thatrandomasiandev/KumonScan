# Sales Demo Environment

The demo is a separate KumonScan deployment pointed at its own Neon database. Multi-tenancy has not landed on `main`, so isolation is physical: the demo deployment's `DATABASE_URL` names a database that no real center ever uses. Demo rows never share a database, schema, or table with real attendance data.

## Architecture

- One Vercel project (e.g. `kumonscan-demo`) built from the same repository as production.
- `DEMO_MODE=true` in that project's environment enables `/api/demo/reset` and the seed guards. Production never sets it, so the endpoint 404s there.
- `server/scripts/seed-demo-data.js` wipes and rebuilds the demo dataset. It refuses to run unless `DEMO_MODE=true` and the target database either carries the `demo_meta.is_demo_database` marker or is completely empty. A database with students but no marker is treated as a real center's data and left untouched.
- Vercel Cron (`vercel.json` `crons`) calls `GET /api/demo/reset` at 08:00 UTC (midnight/1am Pacific) nightly, authenticated by the `CRON_SECRET` bearer token Vercel attaches. Prospects can click around all day; the environment rebuilds to a known state every night. On the production deployment the same cron entry hits a 404 and changes nothing.
- A logged-in demo admin can also `POST /api/demo/reset` to reset on demand mid-demo.

## Seeded dataset

`Kumon of Demo Springs`: 18 students (17 active, 1 deactivated), fictional 555-01XX parent phones, `DEMO-`-prefixed QR values, varied subjects (math/reading/both) and schedule days. Every run rebuilds, relative to the current time:

- 6 students checked in right now, 2 of them past their allowance (overtime timers on the desk view).
- 4 visits completed earlier today, 1 overtime.
- 30 days of completed session history on each student's scheduled days (~15% skipped for past absences, ~15% overtime), which populates the dashboard's 30-day charts, regulars (3+ visits in 7 days), and monthly/annual CSV/PDF reports.
- Students scheduled today with no visit, so the absences view is never empty.
- One student with no schedule days, exercising the "unchecked schedule" count.

Seeding is idempotent: two consecutive runs produce the same roster and session counts, never duplicates. `server/tests/demoSeed.test.js` proves idempotency, the refusal guards, and cross-database isolation (it seeds a demo database and confirms zero row overlap with a sentinel "real" database on the same Neon branch).

## Deployment checklist

1. Create a dedicated Neon project (or at minimum a dedicated database) for the demo. Never reuse a real center's database or branch.
2. Create the Vercel project from this repo with environment:
   - `DATABASE_URL` = the demo database connection string
   - `DEMO_MODE=true`
   - `ADMIN_PASSWORD=try-kumonscan` (the public demo credential, below)
   - `CRON_SECRET` = any long random string (Vercel sends it on cron invocations)
   - `CENTER_TIMEZONE=America/Los_Angeles` (seed times assume a US timezone)
3. Seed once: `DEMO_MODE=true DATABASE_URL=<demo-url> node server/scripts/seed-demo-data.js`, or hit `POST /api/demo/reset` with `Authorization: Bearer <CRON_SECRET>`.

## Demo credential (public by design)

The demo admin password is `try-kumonscan`. Publishing it is intentional: the demo exists so prospects can reach the desk, dashboard, and reports without a sales call. The credential is scoped to the demo deployment's environment only; production deployments have their own `ADMIN_PASSWORD` and a different database, so this password grants nothing against real center data.

## Marketing site wiring (for the marketing-site owner)

The marketing site has not landed on `main` (it lives in the pre-triage snapshot on `agent-1-messaging`), so agent-demo did not edit it. The intended change, for whoever lands it: keep the existing "Request a demo" lead-capture form, and add a "Try it now" link beside it pointing at the demo deployment URL (e.g. `https://demo.kumonscan.app`) with the credential `try-kumonscan` shown next to the link. Add alongside, do not replace: the lead form still captures contact intent; the live demo converts the impatient.
