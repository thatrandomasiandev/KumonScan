import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../loadEnv.js';

/**
 * Demo seed tests run against TWO databases on the Neon test branch:
 *   real:  TEST_DATABASE_URL itself (stands in for a real center's database)
 *   demo:  a second database created on the same branch
 * The seeder always runs as a child process with an explicit DATABASE_URL,
 * exactly like the CLI and the /api/demo/reset cron path.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is required (Neon test branch). Refusing to run demo seed tests against DATABASE_URL.'
  );
}

const REAL_URL = process.env.TEST_DATABASE_URL;
const DEMO_DB_NAME = 'kumonscan_demo_seed_test';
const demoUrlObj = new URL(REAL_URL);
demoUrlObj.pathname = `/${DEMO_DB_NAME}`;
const DEMO_URL = demoUrlObj.toString();

// The in-process app/db modules must never see the demo database.
process.env.DATABASE_URL = REAL_URL;

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_SCRIPT = path.join(__dirname, '..', 'scripts', 'seed-demo-data.js');

const realSql = neon(REAL_URL, { fullResults: true });
let demoSql;

async function rows(sql, text, params = []) {
  const result = await sql.query(text, params);
  return result.rows || [];
}

async function count(sql, text, params = []) {
  const [row] = await rows(sql, text, params);
  return Number(row.count);
}

/**
 * Run the seed script in a child process. DEMO_MODE is stripped from the
 * inherited environment so each call opts in explicitly.
 */
async function runSeed({ databaseUrl, demoMode }) {
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  delete env.DEMO_MODE;
  if (demoMode) env.DEMO_MODE = 'true';

  try {
    const { stdout, stderr } = await execFileAsync('node', [SEED_SCRIPT], {
      cwd: path.join(__dirname, '..'),
      env,
      timeout: 90_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    if (typeof err.code !== 'number') throw err;
    return { code: err.code, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

async function insertSentinelStudent() {
  let [center] = await rows(realSql, 'SELECT id FROM centers ORDER BY id ASC LIMIT 1');
  if (!center) {
    [center] = await rows(
      realSql,
      `INSERT INTO centers (slug, name, timezone, created_at)
       VALUES ('demo-seed-test', 'Demo Seed Test Center', 'America/Los_Angeles', $1)
       RETURNING id`,
      [new Date().toISOString()]
    );
  }
  await rows(
    realSql,
    `INSERT INTO students (center_id, first_name, last_name, registered_at)
     VALUES ($1, $2, $3, $4)`,
    [center.id, 'Isolation', 'Sentinel', new Date().toISOString()]
  );
}

async function ensureDemoDatabaseExists() {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  // CREATE DATABASE cannot run over the HTTP driver's implicit transaction;
  // use a session (WebSocket) connection.
  const pool = new Pool({ connectionString: REAL_URL });
  try {
    await pool.query(`CREATE DATABASE ${DEMO_DB_NAME}`);
  } catch (err) {
    if (err?.code !== '42P04') throw err; // 42P04 = already exists
  } finally {
    await pool.end();
  }
}

describe('demo seed', () => {
  beforeAll(async () => {
    await ensureDemoDatabaseExists();
    demoSql = neon(DEMO_URL, { fullResults: true });

    // Make the "real" database unmistakably real: schema + a sentinel student.
    // db.js is env-bound; DATABASE_URL was pinned to REAL_URL above, so the
    // in-process connection can never point at the demo database.
    const { ensureDb } = await import('../db.js');
    await ensureDb();
    // CASCADE: sibling branches' runs may have left tables referencing
    // students (sms_queue etc.) on the shared test branch.
    await rows(realSql, 'TRUNCATE TABLE sessions, students RESTART IDENTITY CASCADE');
    await insertSentinelStudent();
  }, 120_000);

  afterAll(async () => {
    await rows(realSql, `DELETE FROM students WHERE last_name = 'Sentinel' AND first_name = 'Isolation'`);
  });

  it('refuses to run without DEMO_MODE=true', async () => {
    const result = await runSeed({ databaseUrl: DEMO_URL, demoMode: false });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/DEMO_MODE=true is required/);
  }, 90_000);

  it('refuses to wipe a database that has data but no demo marker', async () => {
    const before = await count(realSql, 'SELECT COUNT(*) AS count FROM students');
    expect(before).toBeGreaterThan(0);

    const result = await runSeed({ databaseUrl: REAL_URL, demoMode: true });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/Refusing to wipe/);

    // Nothing was deleted or added.
    expect(await count(realSql, 'SELECT COUNT(*) AS count FROM students')).toBe(before);
  }, 90_000);

  it('is idempotent: two runs rebuild the same roster with no duplicates', async () => {
    const first = await runSeed({ databaseUrl: DEMO_URL, demoMode: true });
    expect(first.code, first.stderr).toBe(0);

    const rosterOf = async () =>
      rows(
        demoSql,
        `SELECT first_name, last_name, student_number, active, enrolled_subjects
         FROM students ORDER BY student_number`
      );

    const rosterAfterFirst = await rosterOf();
    const sessionsAfterFirst = await count(demoSql, 'SELECT COUNT(*) AS count FROM sessions');

    const second = await runSeed({ databaseUrl: DEMO_URL, demoMode: true });
    expect(second.code, second.stderr).toBe(0);

    expect(await rosterOf()).toEqual(rosterAfterFirst);
    expect(await count(demoSql, 'SELECT COUNT(*) AS count FROM sessions')).toBe(
      sessionsAfterFirst
    );

    expect(rosterAfterFirst).toHaveLength(18);
    expect(
      await count(
        demoSql,
        `SELECT COUNT(DISTINCT LOWER(first_name) || '|' || LOWER(last_name)) AS count FROM students`
      )
    ).toBe(18);
    expect(await count(demoSql, 'SELECT COUNT(DISTINCT student_number) AS count FROM students')).toBe(18);

    // Every demo surface is populated: open sessions (some overtime),
    // completed-today visits, and 30 days of history.
    const open = await rows(
      demoSql,
      `SELECT s.check_in_time, s.allowance_minutes FROM sessions s WHERE s.check_out_time IS NULL`
    );
    expect(open).toHaveLength(6);
    const overtimeOpen = open.filter(
      (s) => (Date.now() - new Date(s.check_in_time).getTime()) / 60000 > s.allowance_minutes
    );
    expect(overtimeOpen.length).toBeGreaterThanOrEqual(2);
    expect(
      await count(demoSql, 'SELECT COUNT(*) AS count FROM sessions WHERE check_out_time IS NOT NULL')
    ).toBeGreaterThan(50);
  }, 180_000);

  it('demo data is fully isolated from the real database', async () => {
    const seeded = await runSeed({ databaseUrl: DEMO_URL, demoMode: true });
    expect(seeded.code, seeded.stderr).toBe(0);

    // Real database: only the sentinel, zero demo rows.
    expect(await count(realSql, 'SELECT COUNT(*) AS count FROM students')).toBe(1);
    expect(
      await count(realSql, `SELECT COUNT(*) AS count FROM students WHERE parent_phone LIKE '555-01%'`)
    ).toBe(0);
    expect(await count(realSql, 'SELECT COUNT(*) AS count FROM sessions')).toBe(0);

    // Demo database: every student uses the fictional 555-01XX phones, and
    // the real center's sentinel never leaked in.
    expect(
      await count(
        demoSql,
        `SELECT COUNT(*) AS count FROM students WHERE parent_phone IS NULL OR parent_phone NOT LIKE '555-01%'`
      )
    ).toBe(0);
    expect(
      await count(
        demoSql,
        `SELECT COUNT(*) AS count FROM students WHERE last_name = 'Sentinel'`
      )
    ).toBe(0);
  }, 180_000);

  it('reset endpoint is inert without DEMO_MODE and guarded with it', async () => {
    const { createApp } = await import('../app.js');

    delete process.env.DEMO_MODE;
    const offApp = createApp();
    const off = await request(offApp).post('/api/demo/reset');
    expect(off.status).toBe(404);

    process.env.DEMO_MODE = 'true';
    try {
      const onApp = createApp();
      const unauthorized = await request(onApp).post('/api/demo/reset');
      expect(unauthorized.status).toBe(401);
    } finally {
      delete process.env.DEMO_MODE;
    }
  }, 60_000);
});
