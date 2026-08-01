import crypto from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { enqueueNotification } from '../services/smsQueueService.js';
import {
  ensureWhatsAppSchema,
  isWhatsAppConfigured,
  sendWhatsAppTemplate,
} from '../services/whatsappService.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

const TEST_IP = '198.51.100.40';

const WA_ENV = {
  WHATSAPP_ACCESS_TOKEN: 'test-access-token',
  WHATSAPP_PHONE_NUMBER_ID: '109999999999999',
  WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  WHATSAPP_APP_SECRET: 'test-app-secret',
};

function stubWhatsAppEnv(overrides = {}) {
  for (const [key, value] of Object.entries({ ...WA_ENV, ...overrides })) {
    if (value === undefined) {
      vi.stubEnv(key, '');
    } else {
      vi.stubEnv(key, value);
    }
  }
}

/**
 * Intercept only Meta Graph API calls; everything else (Neon driver,
 * timeapi.io) passes through to the real fetch. Stubbing fetch wholesale
 * would break the database client.
 */
const realFetch = globalThis.fetch;
let graphCalls = [];
let graphResponder = null;

function defaultGraphResponse() {
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUTBOUND1' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function signPayload(payload, secret) {
  return (
    'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
  );
}

function inboundPayload({ from, text, wamid }) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '10999',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: WA_ENV.WHATSAPP_PHONE_NUMBER_ID },
              messages: [
                { from, id: wamid, timestamp: '1770000000', type: 'text', text: { body: text } },
              ],
            },
          },
        ],
      },
    ],
  };
}

function statusPayload({ wamid, status }) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '10999',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: WA_ENV.WHATSAPP_PHONE_NUMBER_ID },
              statuses: [{ id: wamid, status, timestamp: '1770000001' }],
            },
          },
        ],
      },
    ],
  };
}

function postWebhook(payload, { signature } = {}) {
  const req = request(app).post('/api/webhooks/whatsapp').set('X-Forwarded-For', TEST_IP);
  if (signature !== undefined) req.set('X-Hub-Signature-256', signature);
  return req.send(payload);
}

describe('WhatsApp notification channel', () => {
  let cookie;
  let center;

  beforeAll(async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input?.url ?? String(input));
      if (url.includes('graph.facebook.com')) {
        graphCalls.push({ url, init });
        return Promise.resolve(graphResponder ? graphResponder() : defaultGraphResponse());
      }
      return realFetch(input, init);
    });

    await ensureWhatsAppSchema();
    cookie = await loginCookie();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  beforeEach(async () => {
    center = await defaultCenter();
    graphCalls = [];
    graphResponder = null;
    stubWhatsAppEnv();
    await wipeCenterData(center.id);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('configuration gate', () => {
    it('isWhatsAppConfigured() false short-circuits sends without any network call', async () => {
      stubWhatsAppEnv({ WHATSAPP_ACCESS_TOKEN: undefined, WHATSAPP_PHONE_NUMBER_ID: undefined });
      expect(isWhatsAppConfigured()).toBe(false);

      const result = await sendWhatsAppTemplate('+15551230001', 'checked_in', ['Kid', '3:00 PM']);
      expect(result).toEqual({ sent: false, reason: 'not_configured' });
      expect(graphCalls).toHaveLength(0);
    });

    it('unconfigured WhatsApp falls back to SMS even when the student prefers WhatsApp', async () => {
      stubWhatsAppEnv({ WHATSAPP_ACCESS_TOKEN: undefined, WHATSAPP_PHONE_NUMBER_ID: undefined });
      const seeded = await insertStudent(center.id, {
        first: 'Fallback',
        last: 'Config',
        parent_phone: '+12135550100',
        notify_channel: 'whatsapp',
        parent_whatsapp: '+12135550101',
      });
      const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(seeded.id);

      const result = await enqueueNotification({ id: null }, student, 'checked_in', '2026-07-31T19:00:00.000Z');
      expect(result.enqueued).toBe(true);
      expect(graphCalls).toHaveLength(0);

      const queueRows = await db.prepare('SELECT * FROM sms_queue').all();
      expect(queueRows).toHaveLength(1);
      expect(queueRows[0].parent_phone).toBe('+12135550100');
    });
  });

  describe('notification dispatch', () => {
    it('routes to WhatsApp when preferred and configured, with no sms_queue row', async () => {
      const seeded = await insertStudent(center.id, {
        first: 'Whats',
        last: 'App',
        parent_phone: '+12135550100',
        notify_channel: 'whatsapp',
        parent_whatsapp: '+12135550101',
      });
      const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(seeded.id);

      const result = await enqueueNotification({ id: null }, student, 'checked_in', '2026-07-31T19:00:00.000Z');
      expect(result).toMatchObject({ enqueued: true, channel: 'whatsapp' });

      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].url).toBe(
        `https://graph.facebook.com/v19.0/${WA_ENV.WHATSAPP_PHONE_NUMBER_ID}/messages`
      );
      expect(graphCalls[0].init.headers.Authorization).toBe(`Bearer ${WA_ENV.WHATSAPP_ACCESS_TOKEN}`);
      const body = JSON.parse(graphCalls[0].init.body);
      expect(body.to).toBe('+12135550101');
      expect(body.template.name).toBe('checked_in');
      expect(body.template.components[0].parameters[0].text).toBe('Whats App');

      const queueRows = await db.prepare('SELECT * FROM sms_queue').all();
      expect(queueRows).toHaveLength(0);

      const messages = await db.prepare('SELECT * FROM messages').all();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        student_id: seeded.id,
        direction: 'outbound',
        channel: 'whatsapp',
        status: 'sent',
        wa_message_id: 'wamid.OUTBOUND1',
      });
    });

    it('falls back to SMS with a warning when WhatsApp is preferred but no parent_whatsapp is set', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const seeded = await insertStudent(center.id, {
        first: 'No',
        last: 'Number',
        parent_phone: '+12135550100',
        notify_channel: 'whatsapp',
        parent_whatsapp: null,
      });
      const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(seeded.id);

      const result = await enqueueNotification({ id: null }, student, 'checked_out', '2026-07-31T20:00:00.000Z');
      expect(result.enqueued).toBe(true);
      expect(graphCalls).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no parent_whatsapp'));

      const queueRows = await db.prepare('SELECT * FROM sms_queue').all();
      expect(queueRows).toHaveLength(1);
      warn.mockRestore();
    });

    it('does not propagate a WhatsApp API failure to the check-in response', async () => {
      graphResponder = () =>
        new Response(JSON.stringify({ error: { message: 'Template not approved' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });

      const seeded = await insertStudent(center.id, {
        first: 'Fail',
        last: 'Soft',
        notify_channel: 'whatsapp',
        parent_whatsapp: '+12135550102',
      });

      const res = await request(app)
        .post('/api/check-in')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP)
        .send({ student_id: seeded.id, subjects: 'math' });
      expect(res.status).toBe(201);
      expect(res.body.action).toBe('checked_in');

      expect(graphCalls).toHaveLength(1);
      const messages = await db.prepare('SELECT * FROM messages').all();
      expect(messages).toHaveLength(1);
      expect(messages[0].status).toBe('failed');
      expect(messages[0].channel).toBe('whatsapp');
    });

    it('does not propagate a network-level send failure either', async () => {
      graphResponder = () => {
        throw new Error('ECONNRESET');
      };
      const seeded = await insertStudent(center.id, {
        first: 'Net',
        last: 'Down',
        notify_channel: 'whatsapp',
        parent_whatsapp: '+12135550103',
      });
      const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(seeded.id);

      const result = await enqueueNotification({ id: null }, student, 'checked_in', '2026-07-31T19:00:00.000Z');
      expect(result).toMatchObject({ enqueued: false, channel: 'whatsapp' });
    });
  });

  describe('GET /api/webhooks/whatsapp (subscription handshake)', () => {
    it('returns 503 when WHATSAPP_VERIFY_TOKEN is unset', async () => {
      stubWhatsAppEnv({ WHATSAPP_VERIFY_TOKEN: undefined });
      const res = await request(app).get('/api/webhooks/whatsapp').set('X-Forwarded-For', TEST_IP);
      expect(res.status).toBe(503);
    });

    it('echoes hub.challenge when the verify token matches', async () => {
      const res = await request(app)
        .get('/api/webhooks/whatsapp')
        .set('X-Forwarded-For', TEST_IP)
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': WA_ENV.WHATSAPP_VERIFY_TOKEN,
          'hub.challenge': '1158201444',
        });
      expect(res.status).toBe(200);
      expect(res.text).toBe('1158201444');
    });

    it('rejects a wrong verify token', async () => {
      const res = await request(app)
        .get('/api/webhooks/whatsapp')
        .set('X-Forwarded-For', TEST_IP)
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': '1158201444',
        });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/webhooks/whatsapp (signature verification)', () => {
    it('returns 503 when WHATSAPP_APP_SECRET is unset', async () => {
      stubWhatsAppEnv({ WHATSAPP_APP_SECRET: undefined });
      const payload = inboundPayload({ from: '12135550100', text: 'hi', wamid: 'wamid.IN0' });
      const res = await postWebhook(payload, { signature: signPayload(payload, 'anything') });
      expect(res.status).toBe(503);
    });

    it('rejects a forged signature and records nothing', async () => {
      const payload = inboundPayload({ from: '12135550100', text: 'forged', wamid: 'wamid.IN1' });
      const res = await postWebhook(payload, {
        signature: signPayload(payload, 'not-the-app-secret'),
      });
      expect(res.status).toBe(401);

      const messages = await db.prepare('SELECT * FROM messages').all();
      expect(messages).toHaveLength(0);
    });

    it('rejects a request with no signature header', async () => {
      const payload = inboundPayload({ from: '12135550100', text: 'no sig', wamid: 'wamid.IN2' });
      const res = await postWebhook(payload);
      expect(res.status).toBe(401);
    });

    it('accepts a valid signature and matches the sender via parent_whatsapp', async () => {
      const seeded = await insertStudent(center.id, {
        first: 'Inbound',
        last: 'Match',
        parent_phone: '+12135559999',
        notify_channel: 'whatsapp',
        parent_whatsapp: '+12135550100',
      });

      const payload = inboundPayload({
        from: '12135550100',
        text: 'Running late for pickup',
        wamid: 'wamid.IN3',
      });
      const res = await postWebhook(payload, {
        signature: signPayload(payload, WA_ENV.WHATSAPP_APP_SECRET),
      });
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(1);

      const messages = await db.prepare('SELECT * FROM messages').all();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        student_id: seeded.id,
        direction: 'inbound',
        channel: 'whatsapp',
        body: 'Running late for pickup',
        wa_message_id: 'wamid.IN3',
      });
    });

    it('falls back to parent_phone matching and stores unmatched senders', async () => {
      const phoneOnly = await insertStudent(center.id, {
        first: 'Phone',
        last: 'Only',
        parent_phone: '(213) 555-0200',
      });

      const matched = inboundPayload({ from: '12135550200', text: 'same number', wamid: 'wamid.IN4' });
      const matchedRes = await postWebhook(matched, {
        signature: signPayload(matched, WA_ENV.WHATSAPP_APP_SECRET),
      });
      expect(matchedRes.status).toBe(200);

      const unknown = inboundPayload({ from: '12135550999', text: 'who dis', wamid: 'wamid.IN5' });
      const unknownRes = await postWebhook(unknown, {
        signature: signPayload(unknown, WA_ENV.WHATSAPP_APP_SECRET),
      });
      expect(unknownRes.status).toBe(200);

      const rows = await db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
      expect(rows).toHaveLength(2);
      expect(rows[0].student_id).toBe(phoneOnly.id);
      expect(rows[1].student_id).toBeNull();
    });

    it('deduplicates redelivered webhooks on wa_message_id', async () => {
      await insertStudent(center.id, {
        first: 'Dedup',
        last: 'Kid',
        notify_channel: 'whatsapp',
        parent_whatsapp: '+12135550300',
      });
      const payload = inboundPayload({ from: '12135550300', text: 'once', wamid: 'wamid.IN6' });
      const signature = signPayload(payload, WA_ENV.WHATSAPP_APP_SECRET);

      const first = await postWebhook(payload, { signature });
      expect(first.body.received).toBe(1);
      const second = await postWebhook(payload, { signature });
      expect(second.status).toBe(200);
      expect(second.body.received).toBe(0);

      const messages = await db.prepare('SELECT * FROM messages').all();
      expect(messages).toHaveLength(1);
    });

    it('applies delivery-status updates to the outbound row', async () => {
      const seeded = await insertStudent(center.id, {
        first: 'Status',
        last: 'Track',
        notify_channel: 'whatsapp',
        parent_whatsapp: '+12135550400',
      });
      const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(seeded.id);
      await enqueueNotification({ id: null }, student, 'checked_in', '2026-07-31T19:00:00.000Z');

      const payload = statusPayload({ wamid: 'wamid.OUTBOUND1', status: 'delivered' });
      const res = await postWebhook(payload, {
        signature: signPayload(payload, WA_ENV.WHATSAPP_APP_SECRET),
      });
      expect(res.status).toBe(200);
      expect(res.body.statuses).toBe(1);

      const message = await db
        .prepare(`SELECT * FROM messages WHERE wa_message_id = 'wamid.OUTBOUND1'`)
        .get();
      expect(message.status).toBe('delivered');
    });
  });

  describe('student channel preference API', () => {
    it('accepts notify_channel and parent_whatsapp on PATCH /students/:id', async () => {
      const seeded = await insertStudent(center.id, { first: 'Pref', last: 'Edit' });

      const res = await request(app)
        .patch(`/api/students/${seeded.id}`)
        .set('Cookie', cookie)
        .send({ notify_channel: 'whatsapp', parent_whatsapp: '+12135550500' });
      expect(res.status).toBe(200);
      expect(res.body.notify_channel).toBe('whatsapp');
      expect(res.body.parent_whatsapp).toBe('+12135550500');
    });

    it('rejects an invalid notify_channel', async () => {
      const seeded = await insertStudent(center.id, { first: 'Bad', last: 'Channel' });

      const res = await request(app)
        .patch(`/api/students/${seeded.id}`)
        .set('Cookie', cookie)
        .send({ notify_channel: 'carrier-pigeon' });
      expect(res.status).toBe(400);
    });
  });
});
