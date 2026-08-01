import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import {
  WEBHOOK_TIMEOUT_MS,
  createSubscription,
  emit,
  ensureWebhookTables,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../services/webhookService.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

const TEST_IP = '198.51.100.62';

const realFetch = globalThis.fetch;

function stubTimeApi(iso = '2026-07-30T19:00:00.000Z') {
  vi.stubGlobal('fetch', async (url, options) => {
    if (String(url).includes('timeapi.io')) {
      return { ok: true, json: async () => ({ dateTime: iso }) };
    }
    // Everything else (Neon driver, webhook deliveries to localhost) is real.
    return realFetch(url, options);
  });
}

/** Mock consumer: records every request and answers 200. */
function startReceiver() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/hook`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/** Mock consumer that accepts the connection and never responds. */
function startHangingServer() {
  const sockets = new Set();
  const server = http.createServer(() => {
    // Intentionally never write a response.
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/hook`,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(done);
          }),
      });
    });
  });
}

async function waitFor(condition, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timed out');
}

describe('Outbound webhooks', () => {
  const openServers = [];
  let center;

  beforeEach(async () => {
    center = await defaultCenter();
    await ensureWebhookTables();
    await wipeCenterData(center.id);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    while (openServers.length) {
      await openServers.pop().close();
    }
  });

  describe('subscription management', () => {
    it('requires staff auth', async () => {
      const res = await request(app).get('/api/webhooks').set('X-Forwarded-For', TEST_IP);
      expect(res.status).toBe(401);
    });

    it('rejects bad URLs and unknown event types', async () => {
      const cookie = await loginCookie();

      const badUrl = await request(app)
        .post('/api/webhooks')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP)
        .send({ url: 'not-a-url', event_types: ['student.checked_in'] });
      expect(badUrl.status).toBe(400);

      const badEvents = await request(app)
        .post('/api/webhooks')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP)
        .send({ url: 'https://example.com/hook', event_types: ['student.exploded'] });
      expect(badEvents.status).toBe(400);
      expect(badEvents.body.error).toContain('student.exploded');
    });

    it('creates with a one-time secret, lists without it, and deletes', async () => {
      const cookie = await loginCookie();

      const created = await request(app)
        .post('/api/webhooks')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP)
        .send({
          url: 'https://example.com/hook',
          event_types: ['student.checked_in', 'student.checked_out'],
        });
      expect(created.status).toBe(201);
      expect(created.body.secret).toMatch(/^[0-9a-f]{64}$/);
      expect(created.body.event_types).toEqual(['student.checked_in', 'student.checked_out']);

      const list = await request(app)
        .get('/api/webhooks')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP);
      expect(list.status).toBe(200);
      expect(list.body.subscriptions).toHaveLength(1);
      // Standard practice: the secret is shown exactly once, at creation.
      expect(list.body.subscriptions[0].secret).toBeUndefined();
      expect(JSON.stringify(list.body)).not.toContain(created.body.secret);

      const deleted = await request(app)
        .delete(`/api/webhooks/${created.body.id}`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP);
      expect(deleted.status).toBe(200);

      const deletedAgain = await request(app)
        .delete(`/api/webhooks/${created.body.id}`)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP);
      expect(deletedAgain.status).toBe(404);
    });
  });

  describe('payload signing', () => {
    it('signs a payload that verifies, and rejects tampered payloads', () => {
      const secret = 'a'.repeat(64);
      const body = JSON.stringify({ event: 'student.checked_in', data: { student: { id: 1 } } });

      const signature = signWebhookPayload(secret, body);
      expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(verifyWebhookSignature(secret, body, signature)).toBe(true);

      const tampered = body.replace('"id":1', '"id":2');
      expect(verifyWebhookSignature(secret, tampered, signature)).toBe(false);
      expect(verifyWebhookSignature('b'.repeat(64), body, signature)).toBe(false);
      expect(verifyWebhookSignature(secret, body, 'sha256=deadbeef')).toBe(false);
    });
  });

  describe('delivery', () => {
    it('delivers only to subscriptions matching the emitted event type', async () => {
      const checkedInReceiver = await startReceiver();
      const checkedOutReceiver = await startReceiver();
      openServers.push(checkedInReceiver, checkedOutReceiver);

      const subIn = await createSubscription(center.id, {
        url: checkedInReceiver.url,
        event_types: ['student.checked_in'],
      });
      await createSubscription(center.id, {
        url: checkedOutReceiver.url,
        event_types: ['student.checked_out'],
      });

      const summary = await emit(center.id, 'student.checked_in', { student: { id: 42 } });
      expect(summary).toEqual({ matched: 1, delivered: 1, failed: 0 });

      expect(checkedInReceiver.requests).toHaveLength(1);
      expect(checkedOutReceiver.requests).toHaveLength(0);

      const delivery = checkedInReceiver.requests[0];
      expect(delivery.headers['x-webhook-event']).toBe('student.checked_in');
      expect(
        verifyWebhookSignature(subIn.secret, delivery.body, delivery.headers['x-webhook-signature'])
      ).toBe(true);

      const payload = JSON.parse(delivery.body);
      expect(payload.event).toBe('student.checked_in');
      expect(payload.occurred_at).toBeTruthy();
      expect(payload.data.student.id).toBe(42);
    });

    it('a real check-in/check-out round trip reaches the subscriber', async () => {
      const receiver = await startReceiver();
      openServers.push(receiver);
      await createSubscription(center.id, {
        url: receiver.url,
        event_types: ['student.checked_in', 'student.checked_out'],
      });

      stubTimeApi('2026-07-30T19:00:00.000Z');
      const cookie = await loginCookie();
      const student = await insertStudent(center.id, { first: 'Web', last: 'Hooked' });

      const checkIn = await request(app)
        .post('/api/check-in')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP)
        .send({ student_id: student.id, subjects: 'math' });
      expect(checkIn.status).toBe(201);

      // Delivery is fire-and-forget, so poll rather than assume ordering.
      await waitFor(() => receiver.requests.length >= 1);
      const inPayload = JSON.parse(receiver.requests[0].body);
      expect(inPayload.event).toBe('student.checked_in');
      expect(inPayload.data.student.id).toBe(student.id);
      expect(inPayload.data.session.mode).toBe('in_person');

      stubTimeApi('2026-07-30T19:30:00.000Z');
      const checkOut = await request(app)
        .post('/api/check-out')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP)
        .send({ student_id: student.id });
      expect(checkOut.status).toBe(200);

      await waitFor(() => receiver.requests.length >= 2);
      const outPayload = JSON.parse(receiver.requests[1].body);
      expect(outPayload.event).toBe('student.checked_out');
      expect(outPayload.data.session.duration_minutes).toBe(30);
    });

    it('a hanging subscriber does not delay or fail the triggering check-in/check-out', async () => {
      const hanging = await startHangingServer();
      openServers.push(hanging);
      await createSubscription(center.id, {
        url: hanging.url,
        event_types: ['student.checked_in', 'student.checked_out'],
      });

      stubTimeApi('2026-07-30T19:00:00.000Z');
      const cookie = await loginCookie();
      const student = await insertStudent(center.id, { first: 'Not', last: 'Blocked' });

      // A blocking implementation would take >= 6s here (3s timeout + one retry).
      const startedAt = Date.now();
      const checkIn = await request(app)
        .post('/api/check-in')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP)
        .send({ student_id: student.id, subjects: 'both' });
      const checkInElapsed = Date.now() - startedAt;

      expect(checkIn.status).toBe(201);
      expect(checkInElapsed).toBeLessThan(WEBHOOK_TIMEOUT_MS);

      stubTimeApi('2026-07-30T19:15:00.000Z');
      const outStartedAt = Date.now();
      const checkOut = await request(app)
        .post('/api/check-out')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP)
        .send({ student_id: student.id });
      const checkOutElapsed = Date.now() - outStartedAt;

      expect(checkOut.status).toBe(200);
      expect(checkOutElapsed).toBeLessThan(WEBHOOK_TIMEOUT_MS);
    });

    it('emit gives up after the timeout and one retry, and never rejects', async () => {
      const hanging = await startHangingServer();
      openServers.push(hanging);
      await createSubscription(center.id, { url: hanging.url, event_types: ['student.checked_in'] });

      const startedAt = Date.now();
      const summary = await emit(center.id, 'student.checked_in', { student: { id: 7 } });
      const elapsed = Date.now() - startedAt;

      expect(summary).toEqual({ matched: 1, delivered: 0, failed: 1 });
      // Two attempts, each capped at WEBHOOK_TIMEOUT_MS; then it gives up.
      expect(elapsed).toBeGreaterThanOrEqual(2 * WEBHOOK_TIMEOUT_MS - 300);
      expect(elapsed).toBeLessThan(2 * WEBHOOK_TIMEOUT_MS + 3000);
    });

    it('emit resolves cleanly when the endpoint is unreachable', async () => {
      // Nothing listens on this port; connection is refused immediately.
      await createSubscription(center.id, {
        url: 'http://127.0.0.1:9/hook',
        event_types: ['student.registered'],
      });

      const summary = await emit(center.id, 'student.registered', { student: { id: 1 } });
      expect(summary).toEqual({ matched: 1, delivered: 0, failed: 1 });
    });
  });
});
