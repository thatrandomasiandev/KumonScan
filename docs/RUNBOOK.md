# Operations Runbook

Five procedures an operator actually runs. Commands verified against the codebase at `b8f51ea` on 2026-08-01. `<domain>` is the production domain; `<slug>` is the center's tenant slug.

## 1. Is the SMS gateway phone online?

The gateway phone posts a heartbeat to `POST /api/gateway/heartbeat` (authenticated with `GATEWAY_API_KEY`). The server stores the timestamp in the `settings` table under `gateway_last_seen`.

Check it as a center admin (session cookie required, or use the Admin page which surfaces the same data):

```bash
curl -b "admin_session=<cookie>" https://<domain>/api/c/<slug>/admin/gateway-status
```

Response: `configured` (whether `GATEWAY_API_KEY` is set), `last_seen_at`, `seconds_since_seen`. The phone is considered offline when `seconds_since_seen` exceeds 600 (`GATEWAY_HEARTBEAT_STALE_SECONDS`).

If offline: on the phone, confirm the KumonScan Gateway app's foreground service is running, the app is excluded from battery optimization, and the phone has signal. Undelivered notifications are not lost; they sit in `sms_queue` with `status='pending'` and send once the phone reconnects.

## 2. Rotate a center's admin password

There is no rotation endpoint; the password hash lives in `centers.admin_password_hash` and is set at provisioning time. Rotate it with a manual update:

1. Generate a hash (run from `server/`, uses the repo's scrypt parameters):

```bash
node --input-type=module -e \
  "import('./utils/passwords.js').then(m => console.log(m.hashPassword(process.argv[1])))" \
  'the-new-password'
```

2. Apply it in the Neon SQL editor (project KumonScan, branch `main`):

```sql
UPDATE centers SET admin_password_hash = '<scrypt:...hash>' WHERE slug = '<slug>';
```

Rotating the password does not invalidate existing admin sessions: cookies are HMAC-signed with `ADMIN_SESSION_SECRET`, not the password hash. To force re-login everywhere, also rotate `ADMIN_SESSION_SECRET` in Vercel and redeploy (this logs out every center's admins at once).

Note: the `ADMIN_PASSWORD` env var does not rotate anything. It only seeds the original center's hash while that hash is NULL.

## 3. Provision a new center

Requires `SUPERADMIN_KEY` (unset = the endpoint returns 503). Slug rules: 1-63 characters, lowercase letters, digits, inner hyphens. Limited to 10 requests/minute.

```bash
curl -X POST https://<domain>/api/centers \
  -H "Authorization: Bearer $SUPERADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"slug":"<slug>","name":"<Display Name>","timezone":"America/Los_Angeles","admin_password":"<initial-admin-password>"}'
```

201 returns the center JSON; 409 means the slug is taken. The new center's surfaces are then live at `https://<domain>/<slug>/...` and `https://<domain>/api/c/<slug>/...`.

## 4. Manual database backup before a risky change

Full procedure in [BACKUP.md](./BACKUP.md). The short version:

```bash
neonctl branches create \
  --project-id fragrant-mouse-55891056 \
  --parent main \
  --name "backup-pre-<change>-$(date +%F)"
```

Or in the Neon console: project KumonScan, Branches, Create branch from `main`. Do this before deploying anything that touches `server/db.js` and before any manual SQL against production.

## 5. Roll back a bad Vercel deploy

Vercel dashboard, project, Deployments, pick the last good production deployment, "..." menu, **Instant Rollback** (or "Promote to Production"). CLI: `vercel rollback` from the project directory.

Rollback reverts code only. If the bad deploy's boot migration (`ensureDb()`) changed the schema, the old code may not run against the new schema; restore the database from the pre-deploy `backup-pre-*` branch per [BACKUP.md](./BACKUP.md) in the same operation.
