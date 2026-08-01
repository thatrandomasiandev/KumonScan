# Database Backup and Migration Safety

KumonScan runs on one Neon Postgres project: **KumonScan** (`fragrant-mouse-55891056`, org "Joshua", `aws-us-west-2`, Postgres 17). Branch layout as of 2026-08-01:

| Neon branch | Role |
|---|---|
| `main` | Production. `DATABASE_URL` in the Vercel project points at this branch's pooled connection string. |
| `test-suite` | Shared test branch. `TEST_DATABASE_URL` points here; the test suite refuses to run against anything else (`server/tests/env-setup.js`). |
| `backup-pre-<change>-<date>` | Point-in-time snapshot branches taken before risky changes (existing examples: `backup-pre-multitenant-2026-07-31`, `backup-pre-integration-2026-08-01`). |

Neon branches are copy-on-write snapshots: creating one is instant, costs only divergence, and freezes the parent's state at creation time. That is the backup mechanism for this project.

## Take a snapshot before any migration or risky change

Console: Neon dashboard, project KumonScan, Branches, "Create branch", parent `main`, name `backup-pre-<change>-<YYYY-MM-DD>`, "Current point in time".

CLI equivalent:

```bash
neonctl branches create \
  --project-id fragrant-mouse-55891056 \
  --parent main \
  --name "backup-pre-<change>-$(date +%F)"
```

Follow the existing `backup-pre-*` naming convention so snapshots are recognizable and safe to prune later. Do this before deploying any commit that changes `server/db.js` migrations, and before any manual SQL against production.

### `pg_dump` alternative (off-platform copy)

For a copy that survives the Neon project itself, dump over the **direct** (unpooled) connection string. Take the `main` branch connection string from the dashboard, remove the `-pooler` segment from the host, then:

```bash
pg_dump "<direct-main-connection-string>" --format=custom \
  --file="kumonscan-$(date +%F).dump"
```

Restore a dump with `pg_restore --dbname="<target-connection-string>" --clean --if-exists <file>`. Dumps contain student PII; store them encrypted and never commit them (the root `.gitignore` already blocks `*.csv`/`*.tsv` but a `.dump` lives outside the repo entirely).

## Restore procedures

Two options, fastest first:

1. **Neon branch restore (minutes, preferred).** Dashboard, Branches, select `main`, "Restore", choose the `backup-pre-*` branch (or a timestamp, see the PITR window below). This rewrites `main` in place; Neon keeps the pre-restore state in an automatically created `main_old_<timestamp>` branch, so the restore itself is reversible. Connection strings do not change, so Vercel needs no redeploy.
2. **Repoint `DATABASE_URL` (emergency).** If `main` is unusable and restore is unavailable, set the Vercel env var `DATABASE_URL` to the backup branch's pooled connection string and redeploy. This forks history: writes now land on the backup branch. Treat it as a stopgap and reconcile back to `main` afterward.

### Point-in-time recovery window

The project's history retention is currently **6 hours** (free-plan default). Within that window you can restore `main` to any timestamp even without a snapshot branch. Beyond it, only explicit `backup-pre-*` branches and off-platform dumps exist. Increasing retention (up to 7 days on paid plans, 30 on Business) is a plan/settings decision for the project owner.

### Protection gap

The `main` branch is **not marked protected** in Neon. Enabling protection (Branches, `main`, "Set as protected") blocks accidental deletion and reset. One-click fix for the project owner; noted in the launch checklist.

## Boot-time migration safety (`ensureDb()`)

`server/app.js` runs `ensureDb()` (from `server/db.js`) on every request via middleware, memoized per process: the migration promise is cached, and reset only if a run fails, so a transient failure retries on the next request instead of leaving a half-migrated marker.

Idempotency was verified directly on 2026-08-01, not assumed: `ensureDb()` was run three times in three separate Node processes against the shared `test-suite` branch (under the test-db lock), and a full snapshot was taken after each run covering every public-schema column definition, index definition, sequence position, per-table row count, and an order-independent per-table content hash. All three snapshots were byte-identical. Runs two and three performed zero writes.

Why it holds, mechanically: every `CREATE TABLE`/`CREATE INDEX` is `IF NOT EXISTS`; column additions go through guarded per-table `migrate*` functions; `DROP TABLE IF EXISTS parent_messages` removes a legacy table nothing recreates; `dedupeOpenSessionsForUniqueIndex()` only touches rows violating the unique open-session invariant, which cannot exist after the index is in place; the tenancy backfill (`migrateTenancy`) only inserts the default center when the `centers` table is empty.

Re-run this verification after any integration pass that touches `server/db.js`: the migration entry point may gain new steps, and the guarantee is only as good as the last direct check.
