# Operations Runbook

Five procedures an operator actually runs. Commands verified against the codebase. `<domain>` is the production domain; `<slug>` is the center's tenant slug.

## 1. Parent SMS / WhatsApp (removed)

Parent attendance texts, Staff Messages, Twilio/WhatsApp webhooks, the Android SMS gateway, weekly digests, the `/family` PWA, and public `/book` are **removed**. Do not configure `TWILIO_*`, `WHATSAPP_*`, `GATEWAY_*`, or `PARENT_SESSION_SECRET`. Status no longer reports `sms_gateway`. `parent_phone` remains an optional staff contact field on students and is never used to send SMS.

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
