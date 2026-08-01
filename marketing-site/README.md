# KumonScan marketing site

Public site for KumonScan: what the product does, why it fits Kumon centers, and a lead-capture form. Standalone static site (Vite, no framework) plus one serverless function. It does not import from or depend on `client/` or `server/`.

## Stack

| Piece         | Technology                                        |
| ------------- | ------------------------------------------------- |
| Site          | Static HTML/CSS/JS built with Vite                |
| Lead capture  | `api/lead.js`, a Vercel Node serverless function  |
| Lead storage  | `leads` table in Neon Postgres (`DATABASE_URL`)   |

## Local development

```bash
npm install
echo "DATABASE_URL=postgresql://..." > .env   # same Neon database the app uses
npm run dev
```

Open http://localhost:5173. The Vite dev server mounts `api/lead.js` at `/api/lead` (see `vite.config.js`), so the form works end to end locally.

`npm run build` writes the production bundle to `dist/`.

## Lead capture

`POST /api/lead` accepts `{ name, center_name, email, center_size }` and inserts one row into `leads` (`CREATE TABLE IF NOT EXISTS` runs on first request, so no migration step). `center_size` must be one of `under-50`, `50-150`, `150-300`, `over-300`. A hidden `website` honeypot field silently drops bot submissions. Without `DATABASE_URL` the endpoint returns 503 and the form shows an error; it never pretends to succeed.

Read leads with:

```sql
SELECT name, center_name, email, center_size, created_at FROM leads ORDER BY created_at DESC;
```

## Deploy (Vercel)

Deploy as its own Vercel project with this directory as the project root:

```bash
vercel link          # root directory: marketing-site
vercel env add DATABASE_URL
vercel --prod
```

Vercel auto-detects Vite for the static build and serves `api/lead.js` as a function (`vercel.json` pins a 10s max duration).

## Content rules

- Every claim on the page must be true of the product today. No fabricated customers, testimonials, or pricing.
- Testimonials: a clearly marked HTML comment in `index.html` reserves the spot; only add real, permissioned quotes.
- The primary CTA points at the lead form because no self-serve signup/provisioning exists yet. When it does, point the header and hero CTAs at it and demote the form to "Request a demo".
- Copy follows `.cursor/rules/writing-quality.mdc`: mechanisms over adjectives, no em dashes, concrete numbers (30/60-minute rule, 3-second dedup, timeapi.io).
