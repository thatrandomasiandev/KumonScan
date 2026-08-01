import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

// Tests must hit the shared Neon test branch, never the live database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const { default: app } = await import('../app.js');
const { default: db } = await import('../db.js');
const {
  createAccessToken,
  createParentSession,
  ensureParentAuthTables,
  normalizePhone,
} = await import('../services/parentAuthService.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_PUBLIC = path.join(__dirname, '..', '..', 'client', 'public');

async function insertStudent({ first, last, phone = null } = {}) {
  const qr = `KUMON-${uuidv4().slice(0, 8).toUpperCase()}`;
  const { lastInsertRowid } = await db
    .prepare(
      `INSERT INTO students (first_name, last_name, qr_code_value, active, parent_phone)
       VALUES (?, ?, ?, 1, ?)`
    )
    .run(first, last, qr, phone);
  return { id: lastInsertRowid, qr };
}

async function insertSession(studentId, checkIn, checkOut = null, duration = null) {
  await db
    .prepare(
      `INSERT INTO sessions (student_id, check_in_time, check_out_time, duration_minutes)
       VALUES (?, ?, ?, ?)`
    )
    .run(studentId, checkIn, checkOut, duration);
}

/** Distinct client IP per call so the per-IP rate limiters never bleed across tests. */
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 200) + 1}`;
}

async function verifyAndGetCookie(token) {
  const res = await request(app)
    .get(`/api/parent-auth/verify?token=${encodeURIComponent(token)}`)
    .set('X-Forwarded-For', nextIp());
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'];
  expect(setCookie?.some((c) => c.startsWith('parent_session='))).toBe(true);
  return setCookie;
}

describe('parent auth', () => {
  beforeEach(async () => {
    await ensureParentAuthTables();
    await db.exec('DELETE FROM parent_access_tokens');
    await db.exec('DELETE FROM sessions');
    await db.exec('DELETE FROM students');
  });

  it('normalizes phone formats to a comparable form', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
    expect(normalizePhone('+1 555 123 4567')).toBe('5551234567');
    expect(normalizePhone('555.123.4567')).toBe('5551234567');
    expect(normalizePhone('12345')).toBe(null);
    expect(normalizePhone(null)).toBe(null);
  });

  it('gives an identical response whether or not the phone is on file', async () => {
    await insertStudent({ first: 'Known', last: 'Family', phone: '555-123-4567' });

    const onFile = await request(app)
      .post('/api/parent-auth/request')
      .set('X-Forwarded-For', nextIp())
      .send({ phone: '(555) 123-4567' });

    const notOnFile = await request(app)
      .post('/api/parent-auth/request')
      .set('X-Forwarded-For', nextIp())
      .send({ phone: '(555) 999-0000' });

    expect(onFile.status).toBe(200);
    expect(notOnFile.status).toBe(200);
    expect(notOnFile.body).toEqual(onFile.body);
    expect(JSON.stringify(onFile.body)).not.toMatch(/known/i);
  });

  it('request endpoint is rate limited to 5 per window per IP', async () => {
    const ip = '203.0.113.250';
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/parent-auth/request')
        .set('X-Forwarded-For', ip)
        .send({ phone: '555-000-0000' });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/api/parent-auth/request')
      .set('X-Forwarded-For', ip)
      .send({ phone: '555-000-0000' });
    expect(blocked.status).toBe(429);
  });

  it('a valid token issues a parent session scoped to that student', async () => {
    const student = await insertStudent({ first: 'Val', last: 'Id', phone: '555-111-2222' });
    const token = await createAccessToken(student.id);

    const res = await request(app)
      .get(`/api/parent-auth/verify?token=${encodeURIComponent(token)}`)
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.student.id).toBe(student.id);
    expect(res.headers['set-cookie'].some((c) => c.startsWith('parent_session='))).toBe(true);
  });

  it('rejects an expired token', async () => {
    const student = await insertStudent({ first: 'Ex', last: 'Pired', phone: '555-111-3333' });
    const token = await createAccessToken(student.id, { ttlMs: -1000 });

    const res = await request(app)
      .get(`/api/parent-auth/verify?token=${encodeURIComponent(token)}`)
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects an already-used token', async () => {
    const student = await insertStudent({ first: 'Re', last: 'Play', phone: '555-111-4444' });
    const token = await createAccessToken(student.id);

    await verifyAndGetCookie(token);

    const replay = await request(app)
      .get(`/api/parent-auth/verify?token=${encodeURIComponent(token)}`)
      .set('X-Forwarded-For', nextIp());

    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('TOKEN_INVALID');
  });

  it('rejects a garbage token', async () => {
    const res = await request(app)
      .get('/api/parent-auth/verify?token=not-a-real-token-aaaaaaaaaaaa')
      .set('X-Forwarded-For', nextIp());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('session endpoint reflects the cookie state', async () => {
    const anonymous = await request(app)
      .get('/api/parent-auth/session')
      .set('X-Forwarded-For', nextIp());
    expect(anonymous.body.authenticated).toBe(false);

    const student = await insertStudent({ first: 'Sesh', last: 'Un', phone: '555-111-5555' });
    const cookie = await verifyAndGetCookie(await createAccessToken(student.id));

    const authed = await request(app)
      .get('/api/parent-auth/session')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', nextIp());
    expect(authed.body.authenticated).toBe(true);
    expect(authed.body.student.id).toBe(student.id);
  });
});

describe('parent data isolation', () => {
  let studentA;
  let studentB;
  let cookieA;

  beforeEach(async () => {
    await ensureParentAuthTables();
    await db.exec('DELETE FROM parent_access_tokens');
    await db.exec('DELETE FROM sessions');
    await db.exec('DELETE FROM students');

    studentA = await insertStudent({ first: 'Alpha', last: 'Kid', phone: '555-222-0001' });
    studentB = await insertStudent({ first: 'Beta', last: 'Kid', phone: '555-222-0002' });

    await insertSession(studentA.id, '2026-07-01T18:00:00.000Z', '2026-07-01T18:45:00.000Z', 45);
    await insertSession(studentB.id, '2026-07-02T18:00:00.000Z', '2026-07-02T18:30:00.000Z', 30);

    cookieA = await verifyAndGetCookie(await createAccessToken(studentA.id));
  });

  it('returns only the session-scoped student attendance', async () => {
    const res = await request(app)
      .get('/api/parent/attendance')
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(200);
    expect(res.body.student.id).toBe(studentA.id);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].duration_minutes).toBe(45);
  });

  it('ignores id tampering via query or params', async () => {
    const tampered = await request(app)
      .get(`/api/parent/attendance?student_id=${studentB.id}&id=${studentB.id}`)
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', nextIp());

    expect(tampered.status).toBe(200);
    expect(tampered.body.student.id).toBe(studentA.id);
    expect(tampered.body.sessions.every((s) => s.duration_minutes === 45)).toBe(true);
  });

  it('rejects a forged parent session cookie', async () => {
    const forged = `${Date.now() + 86_400_000}.${studentB.id}.${'ab'.repeat(32)}`;
    const res = await request(app)
      .get('/api/parent/attendance')
      .set('Cookie', [`parent_session=${forged}`])
      .set('X-Forwarded-For', nextIp());
    expect(res.status).toBe(401);
  });

  it('a parent session grants nothing on staff routes', async () => {
    // Present the parent token under the admin cookie name too: it must
    // never validate as an admin session.
    const parentToken = createParentSession(studentA.id);
    const res = await request(app)
      .get('/api/students')
      .set('Cookie', [`parent_session=${parentToken}`, `admin_session=${parentToken}`])
      .set('X-Forwarded-For', nextIp());
    expect(res.status).toBe(401);
  });

  it('requires a session for every parent data endpoint', async () => {
    for (const endpoint of [
      '/api/parent/attendance',
      '/api/parent/bookings',
      '/api/parent/messages',
      '/api/parent/progress',
    ]) {
      const res = await request(app).get(endpoint).set('X-Forwarded-For', nextIp());
      expect(res.status, endpoint).toBe(401);
    }
  });

  it('optional sections report NOT_AVAILABLE when their tables are absent', async () => {
    for (const [endpoint, table] of [
      ['/api/parent/bookings', 'bookings'],
      ['/api/parent/progress', 'student_progress'],
    ]) {
      const exists = await db
        .prepare(
          `SELECT 1 AS ok FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ?`
        )
        .get(table);
      if (exists) continue; // a sibling agent's table landed; skip

      const res = await request(app)
        .get(endpoint)
        .set('Cookie', cookieA)
        .set('X-Forwarded-For', nextIp());
      expect(res.status, endpoint).toBe(404);
      expect(res.body.code).toBe('NOT_AVAILABLE');
    }
  });
});

describe('PWA installability assets', () => {
  it('manifest.json is valid and installable', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(CLIENT_PUBLIC, 'manifest.json'), 'utf8')
    );

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/family/');
    expect(manifest.scope).toBe('/family/');
    expect(manifest.theme_color).toBe('#1B6EF3');
    expect(manifest.background_color).toBe('#F8F9FF');

    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.every((icon) => icon.type === 'image/png')).toBe(true);
  });

  it('every manifest icon exists and is a real PNG', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(CLIENT_PUBLIC, 'manifest.json'), 'utf8')
    );
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    for (const icon of manifest.icons) {
      const filePath = path.join(CLIENT_PUBLIC, icon.src.replace(/^\//, ''));
      const bytes = fs.readFileSync(filePath);
      expect(bytes.subarray(0, 4).equals(PNG_MAGIC), icon.src).toBe(true);
    }
  });

  it('service worker precaches the shell and handles fetches', () => {
    const sw = fs.readFileSync(path.join(CLIENT_PUBLIC, 'sw.js'), 'utf8');
    expect(sw).toMatch(/addEventListener\('install'/);
    expect(sw).toMatch(/addEventListener\('activate'/);
    expect(sw).toMatch(/addEventListener\('fetch'/);
    expect(sw).toContain("'/family/'");
    expect(sw).toContain('/manifest.json');
  });
});
