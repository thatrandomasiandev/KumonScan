import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import app from '../app.js';
import { createCorsOptions, parseAllowedOrigins } from '../corsConfig.js';

describe('CORS allowlist (F1)', () => {
  it('parses ALLOWED_ORIGINS and rejects unknown origins in the cors callback', () => {
    expect(parseAllowedOrigins({ ALLOWED_ORIGINS: 'https://a.example,https://b.example' })).toEqual([
      'https://a.example',
      'https://b.example',
    ]);

    const options = createCorsOptions({
      ALLOWED_ORIGINS: 'http://localhost:5173',
    });

    return new Promise((resolve, reject) => {
      options.origin('https://evil.example', (err, allow) => {
        try {
          expect(err).toBeNull();
          expect(allow).toBe(false);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('does not echo Access-Control-Allow-Origin or credentials for a disallowed Origin', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('allows the configured Vite origin with credentials', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('admin session auth (F2)', () => {
  beforeEach(() => {
    clearAdminSessionsForTests();
  });

  afterEach(() => {
    clearAdminSessionsForTests();
  });

  it('login authenticates, logout clears the cookie, cookieless requests get 401', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ password: 'test-admin-password' });

    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeTruthy();

    const authed = await request(app)
      .get('/api/students')
      .set('X-Forwarded-For', '203.0.113.10')
      .set('Cookie', cookie);
    expect(authed.status).toBe(200);

    // Admin sessions are stateless HMAC-signed cookies (no server-side store,
    // required for Vercel serverless; see middleware/auth.js). Logout clears
    // the browser cookie but cannot revoke an already-captured token before
    // its 7-day expiry. This test asserts the implemented contract; token
    // revocation would require a denylist.
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('X-Forwarded-For', '203.0.113.10')
      .set('Cookie', cookie);
    expect(logout.status).toBe(200);
    expect(logout.headers['set-cookie']?.[0]).toMatch(/admin_session=;/);

    const cookieless = await request(app)
      .get('/api/students')
      .set('X-Forwarded-For', '203.0.113.10');
    expect(cookieless.status).toBe(401);

    const garbage = await request(app)
      .get('/api/students')
      .set('X-Forwarded-For', '203.0.113.10')
      .set('Cookie', 'admin_session=123.deadbeef');
    expect(garbage.status).toBe(401);
  });

  it('returns 429 after too many login attempts', async () => {
    const ip = '203.0.113.99';
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ password: 'wrong-password' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
