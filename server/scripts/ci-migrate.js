/**
 * CI schema migration: run `ensureDb()` against the ephemeral CI database.
 *
 * Usage (CI only):
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/kumonscan_ci \
 *   NEON_FETCH_ENDPOINT=http://localhost:4444/sql \
 *   node scripts/ci-migrate.js
 *
 * Guarantees:
 *   - Refuses to run against any Neon-hosted database (*.neon.tech). CI must
 *     never touch the shared Neon test branch; that is the point of this
 *     pipeline.
 *   - Retries the first query for up to WAIT_MS while the Postgres service
 *     container and HTTP proxy finish starting.
 *   - Exits non-zero (failing the CI job) if migration or the post-migration
 *     table check fails.
 */
import './ci-neon-proxy.js';
import { ensureDb, get, all } from '../db.js';

const WAIT_MS = 60_000;
const RETRY_INTERVAL_MS = 2_000;
const REQUIRED_TABLES = ['centers', 'students', 'sessions'];

function describeTarget() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!raw) {
    throw new Error('ci-migrate: DATABASE_URL is not set.');
  }
  const url = new URL(raw);
  if (url.hostname.endsWith('.neon.tech')) {
    throw new Error(
      `ci-migrate: refusing to run against Neon host "${url.hostname}". ` +
        'CI must use the ephemeral Postgres service container.'
    );
  }
  url.password = url.password ? '***' : '';
  return url.toString();
}

async function waitForDatabase() {
  const deadline = Date.now() + WAIT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await get('SELECT 1 AS ok');
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }
  throw new Error(
    `ci-migrate: database not reachable after ${WAIT_MS / 1000}s: ${lastError?.message}`
  );
}

async function verifyTables() {
  const rows = await all(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name`
  );
  const names = rows.map((r) => r.table_name);
  const missing = REQUIRED_TABLES.filter((t) => !names.includes(t));
  if (missing.length > 0) {
    throw new Error(
      `ci-migrate: migration ran but tables are missing: ${missing.join(', ')} ` +
        `(found: ${names.join(', ') || 'none'})`
    );
  }
  console.log(`ci-migrate: tables present: ${names.join(', ')}`);
}

const target = describeTarget();
console.log(`ci-migrate: target database ${target}`);
console.log(
  `ci-migrate: fetch endpoint ${process.env.NEON_FETCH_ENDPOINT || '(default Neon HTTPS)'}`
);

try {
  await waitForDatabase();
  await ensureDb();
  await verifyTables();
  console.log('ci-migrate: schema migration complete.');
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
