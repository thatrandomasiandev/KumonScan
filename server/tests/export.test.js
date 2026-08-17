import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { unzipSync, strFromU8 } from 'fflate';
import app from '../app.js';
import db, { sqlNow } from '../db.js';
import { EXPORT_TABLES, tableToCsv } from '../routes/export.routes.js';
import { ensureMessagingTables } from '../services/messagingService.js';
import { defaultCenter, loginCookie } from './helpers.js';

/**
 * These tests run against the shared Neon test branch, potentially alongside
 * other workstreams' suites. They therefore avoid destructive cleanup of
 * shared tables and assert on rows they inserted (unique per run) rather
 * than on absolute table contents.
 */

const TEST_IP = '198.51.100.60';

/** superagent only buffers known mime types; collect application/zip manually. */
function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk, 'binary')));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.setEncoding('binary');
}

function downloadExport(cookie, ip = TEST_IP) {
  return request(app)
    .get('/api/export/full')
    .set('Cookie', cookie)
    .set('X-Forwarded-For', ip)
    .buffer(true)
    .parse(binaryParser);
}

function csvText(files, name) {
  return strFromU8(files[`${name}.csv`]);
}

async function presentExportTables() {
  const rows = await db
    .prepare(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY(?::text[])`
    )
    .all(EXPORT_TABLES);
  return new Set(rows.map((r) => r.table_name));
}

describe('Full data export', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    center = await defaultCenter();
    cookie = await loginCookie();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .get('/api/export/full')
      .set('X-Forwarded-For', TEST_IP);
    expect(res.status).toBe(401);
  });

  it('produces valid CSV for every present table and skips absent tables', async () => {
    const runId = uuidv4().slice(0, 8);

    // Name with comma and quote exercises the CSV escaping path end to end.
    const studentResult = await db
      .prepare(
        `INSERT INTO students (center_id, first_name, last_name, active, parent_phone)
         VALUES (?, ?, ?, 1, ?)`
      )
      .run(center.id, `Comma, ${runId}`, 'Says "Hi"', '+12135550100');
    const studentId = studentResult.lastInsertRowid;

    const checkInTime = '2031-01-15T19:07:00.000Z';
    await db
      .prepare(
        `INSERT INTO sessions (center_id, student_id, check_in_time, check_out_time, duration_minutes)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(center.id, studentId, checkInTime, '2031-01-15T19:52:00.000Z', 45);

    const staffResult = await db
      .prepare(
        `INSERT INTO staff (center_id, first_name, last_name, role, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(center.id, `Export${runId}`, 'Staffer', 'Instructor', sqlNow());
    await db
      .prepare(
        `INSERT INTO staff_sessions (center_id, staff_id, clock_in_time, clock_out_time, duration_minutes)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        center.id,
        staffResult.lastInsertRowid,
        '2031-01-15T18:00:00.000Z',
        '2031-01-15T21:00:00.000Z',
        180
      );

    await ensureMessagingTables();
    const messageBody = `Running late today (${runId})`;
    await db
      .prepare(
        `INSERT INTO messages (center_id, student_id, direction, body, status, created_at)
         VALUES (?, ?, 'inbound', ?, 'sent', ?)`
      )
      .run(center.id, studentId, messageBody, sqlNow());

    const present = await presentExportTables();
    expect(present.has('students')).toBe(true);
    expect(present.has('messages')).toBe(true);

    const res = await downloadExport(cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="kumonscan-export-\d{4}-\d{2}-\d{2}\.zip"/
    );

    const files = unzipSync(new Uint8Array(res.body));

    // Exactly one CSV per table that exists in this checkout, plus the
    // manifest — tables missing from the schema are skipped, not errored.
    const expectedNames = [...EXPORT_TABLES.filter((t) => present.has(t)).map((t) => `${t}.csv`), 'manifest.json'];
    expect(Object.keys(files).sort()).toEqual(expectedNames.sort());

    // Every exported CSV is self-describing: header row with an id column.
    for (const table of present) {
      const header = csvText(files, table).split('\n')[0];
      expect(header.split(','), `${table}.csv header`).toContain('id');
    }

    const students = csvText(files, 'students');
    expect(students.split('\n')[0].split(',')).toContain('first_name');
    expect(students).toContain(`"Comma, ${runId}"`);
    expect(students).toContain('"Says ""Hi"""');
    expect(students).toContain('+12135550100');

    expect(csvText(files, 'sessions')).toContain(checkInTime);
    expect(csvText(files, 'staff')).toContain(`Export${runId}`);
    expect(csvText(files, 'staff_sessions')).toContain('2031-01-15T18:00:00.000Z');
    expect(csvText(files, 'messages')).toContain(messageBody);

    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.generated_at).toBeTruthy();
    expect(manifest.tables.map((t) => t.name).sort()).toEqual([...present].sort());
    expect(manifest.tables.find((t) => t.name === 'students').rows).toBeGreaterThanOrEqual(1);
  });

  it('never exports webhook secrets or internal auth state', () => {
    expect(EXPORT_TABLES).not.toContain('webhook_subscriptions');
    expect(EXPORT_TABLES).not.toContain('revoked_admin_tokens');
  });

  it('tableToCsv escapes commas and quotes and renders NULL as empty', () => {
    const csv = tableToCsv(
      ['id', 'note'],
      [
        { id: 1, note: 'plain' },
        { id: 2, note: 'has, comma' },
        { id: 3, note: null },
      ]
    );
    expect(csv).toBe('id,note\n1,plain\n2,"has, comma"\n3,\n');
  });

  it('rate-limits repeated export requests', async () => {
    // Dedicated IP so this test owns its own limiter bucket (5 per 15 min).
    const ip = '198.51.100.61';
    const limitedCookie = await loginCookie();

    let sawTooMany = false;
    for (let i = 0; i < 6; i++) {
      const res = await downloadExport(limitedCookie, ip);
      if (res.status === 429) {
        sawTooMany = true;
        break;
      }
      expect(res.status).toBe(200);
    }
    expect(sawTooMany).toBe(true);
  });
});
