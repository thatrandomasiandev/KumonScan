import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import app from '../app.js';
import db from '../db.js';
import {
  captureError,
  ensureErrorLogTable,
  expressErrorHandler,
  recentErrorCount,
} from '../services/errorReportingService.js';
import { runStatusChecks } from '../routes/status.routes.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  defaultCenter,
  loginCookie,
} from './helpers.js';

// Unique per run so assertions ignore rows left by other agents on the
// shared test branch, and cleanup removes only ours.
const MARKER = `obs-test-${uuidv4()}`;

describe('observability', () => {
  let center;

  beforeAll(async () => {
    await ensureErrorLogTable();
    center = await defaultCenter();
    // Seed the known admin hash so the unauthenticated 401 test is deterministic
    // (requireAdmin bypasses auth when no hash is configured).
    await loginCookie(DEFAULT_ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM error_log WHERE message LIKE ?`).run(`${MARKER}%`);
  });

  describe('GET /api/status', () => {
    it('requires staff authentication', async () => {
      const res = await request(app).get('/api/status');
      expect(res.status).toBe(401);
    });

    it('aggregates all checks in one payload', async () => {
      const cookie = await loginCookie(DEFAULT_ADMIN_PASSWORD);
      const res = await request(app)
        .get('/api/status')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', '198.51.100.77');

      expect(res.status).toBe(200);
      expect(res.body.generated_at).toBeTruthy();
      expect(['ok', 'warn', 'down']).toContain(res.body.overall);

      for (const name of ['database', 'sms_gateway', 'webhooks', 'errors']) {
        expect(res.body.checks[name]).toBeTruthy();
        expect(['ok', 'warn', 'down', 'not_configured']).toContain(
          res.body.checks[name].status
        );
      }

      // The test database is reachable, so this check must be green.
      expect(res.body.checks.database.status).toBe('ok');
      expect(typeof res.body.checks.database.latency_ms).toBe('number');
    });
  });

  describe('check independence', () => {
    it('a database failure does not prevent reporting the gateway status', async () => {
      const report = await runStatusChecks(center.id, {
        database: async () => {
          throw new Error('connection refused');
        },
        sms_gateway: async () => ({ status: 'ok', detail: 'heartbeat 5s ago' }),
      });

      expect(report.checks.database.status).toBe('down');
      expect(report.checks.database.detail).toMatch(/connection refused/);
      expect(report.checks.sms_gateway.status).toBe('ok');
      expect(report.overall).toBe('down');
    });

    it('a gateway failure does not prevent reporting the database status', async () => {
      const report = await runStatusChecks(center.id, {
        database: async () => ({ status: 'ok', latency_ms: 3 }),
        sms_gateway: async () => {
          throw new Error('settings read exploded');
        },
      });

      expect(report.checks.sms_gateway.status).toBe('down');
      expect(report.checks.database.status).toBe('ok');
      expect(report.overall).toBe('down');
    });

    it('not_configured checks never degrade the overall status', async () => {
      const report = await runStatusChecks(center.id, {
        database: async () => ({ status: 'ok' }),
        webhooks: async () => ({ status: 'not_configured' }),
      });

      expect(report.overall).toBe('ok');
    });
  });

  describe('error reporting', () => {
    it('captureError persists message, stack, route, context, and center_id', async () => {
      const message = `${MARKER}-capture`;
      const id = await captureError(new Error(message), {
        route: 'POST /api/check-in',
        centerId: center.id,
        context: { studentId: 42, subjects: 'math' },
      });

      expect(id).toBeGreaterThan(0);

      const row = await db.prepare('SELECT * FROM error_log WHERE id = ?').get(id);
      expect(row.message).toBe(message);
      expect(row.stack).toContain('Error');
      expect(row.route).toBe('POST /api/check-in');
      expect(Number(row.center_id)).toBe(center.id);
      expect(JSON.parse(row.context)).toEqual({ studentId: 42, subjects: 'math' });
      expect(row.occurred_at).toBeTruthy();
    });

    it('the global Express handler captures with route + context, then answers 500', async () => {
      const message = `${MARKER}-handler`;
      const testApp = express();
      testApp.get('/explode', () => {
        throw new Error(message);
      });
      testApp.use(expressErrorHandler);

      const res = await request(testApp).get('/explode?probe=1');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });

      const row = await db
        .prepare('SELECT * FROM error_log WHERE message = ? ORDER BY id DESC LIMIT 1')
        .get(message);
      expect(row).toBeTruthy();
      expect(row.route).toBe('GET /explode');
      const context = JSON.parse(row.context);
      expect(context.method).toBe('GET');
      expect(context.path).toBe('/explode?probe=1');
    });

    it('recentErrorCount only counts errors inside the window', async () => {
      const before = await recentErrorCount({ hours: 24, centerId: center.id });

      const staleIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      await db
        .prepare(
          `INSERT INTO error_log (center_id, message, stack, route, context, occurred_at)
           VALUES (?, ?, NULL, NULL, NULL, ?)`
        )
        .run(center.id, `${MARKER}-stale`, staleIso);

      expect(await recentErrorCount({ hours: 24, centerId: center.id })).toBe(before);

      await captureError(new Error(`${MARKER}-fresh`), {
        route: 'GET /api/present',
        centerId: center.id,
      });
      expect(await recentErrorCount({ hours: 24, centerId: center.id })).toBe(before + 1);
    });
  });
});
