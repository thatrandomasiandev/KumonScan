import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { hashPassword } from '../utils/passwords.js';
import { defaultCenter } from './helpers.js';

describe('production fail-closed auth', () => {
  let previousHash;

  afterEach(async () => {
    vi.unstubAllEnvs();
    // Restore the center's admin hash so later suites can still log in.
    if (previousHash !== undefined) {
      const center = await defaultCenter();
      await db
        .prepare('UPDATE centers SET admin_password_hash = ? WHERE id = ?')
        .run(previousHash, center.id);
      previousHash = undefined;
    }
  });

  it('admin routes return 503 in production when the center has no admin password', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_SESSION_SECRET', 'test-secret');

    const center = await defaultCenter();
    previousHash = center.admin_password_hash;
    await db
      .prepare('UPDATE centers SET admin_password_hash = NULL WHERE id = ?')
      .run(center.id);

    const students = await request(app)
      .get('/api/students')
      .set('X-Forwarded-For', '198.51.100.50');
    expect(students.status).toBe(503);

    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.50')
      .send({ password: 'anything' });
    expect(login.status).toBe(503);

    const status = await request(app)
      .get('/api/auth/status')
      .set('X-Forwarded-For', '198.51.100.50');
    expect(status.status).toBe(503);
  });

  it('stays permissive outside production when the center has no admin password', async () => {
    const center = await defaultCenter();
    previousHash = center.admin_password_hash;
    await db
      .prepare('UPDATE centers SET admin_password_hash = NULL WHERE id = ?')
      .run(center.id);

    const res = await request(app)
      .get('/api/students')
      .set('X-Forwarded-For', '198.51.100.51');
    expect(res.status).toBe(200);
  });
});

describe('body size limits', () => {
  it('rejects large payloads on normal routes (256kb global limit)', async () => {
    const big = 'x'.repeat(300 * 1024);
    const res = await request(app)
      .post('/api/scan')
      .set('X-Forwarded-For', '198.51.100.60')
      .send({ qr_code_value: big });
    expect(res.status).toBe(413);
  });

  it('still accepts large payloads on the roster-import route (8mb limit)', async () => {
    // Ensure the default center still has a usable password (prior suites may
    // have cleared it; restore from the env-seeded test password).
    const center = await defaultCenter();
    await db
      .prepare('UPDATE centers SET admin_password_hash = ? WHERE id = ?')
      .run(hashPassword('test-admin-password'), center.id);

    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.61')
      .send({ password: 'test-admin-password' });
    const cookie = login.headers['set-cookie'];

    // ~400kb payload: must clear the body parser (no 413). The importer itself
    // rejects the malformed tail with an application-level 400, not a size error.
    const content = 'First Name,Last Name\nBig,Upload\n' + '#'.repeat(400_000);
    const res = await request(app)
      .post('/api/admin/roster-import')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.61')
      .send({ filename: 'big.csv', content });
    expect(res.status).not.toBe(413);
  });
});

describe('/api/scan rate limit', () => {
  it('returns 429 after 60 scans in a minute from one IP', async () => {
    const ip = '198.51.100.70';
    let lastStatus = 0;
    for (let i = 0; i < 61; i++) {
      const res = await request(app)
        .post('/api/scan')
        .set('X-Forwarded-For', ip)
        .send({});
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
