import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { enqueueNotification } from '../services/smsQueueService.js';
import { sendOutboundMessage } from '../services/messagingService.js';
import { computeTwilioSignature, isTwilioConfigured, sendTwilioSms } from '../services/twilioService.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

const TEST_IP = '198.51.100.60';

const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: 'ACtestaccountsid00000000000000',
  TWILIO_AUTH_TOKEN: 'test-auth-token',
  TWILIO_FROM_NUMBER: '+15005550006',
};

function stubTwilioEnv(overrides = {}) {
  for (const [key, value] of Object.entries({ ...TWILIO_ENV, ...overrides })) {
    if (value === undefined) {
      vi.stubEnv(key, '');
    } else {
      vi.stubEnv(key, value);
    }
  }
}

/**
 * Intercept only Twilio API calls; everything else (Neon driver, timeapi.io)
 * passes through to the real fetch.
 */
const realFetch = globalThis.fetch;
let twilioCalls = [];
let twilioResponder = null;

function defaultTwilioResponse() {
  return new Response(JSON.stringify({ sid: 'SM_OUTBOUND1', status: 'queued' }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

function webhookUrl(path = '/api/webhooks/sms') {
  return `http://127.0.0.1${path}`;
}

function postWebhook(params, { signature, url = webhookUrl() } = {}) {
  const req = request(app)
    .post('/api/webhooks/sms')
    .set('X-Forwarded-For', TEST_IP)
    .set('Host', '127.0.0.1')
    .type('form');
  if (signature !== undefined) req.set('X-Twilio-Signature', signature);
  return req.send(params);
}

describe('Twilio SMS channel', () => {
  let cookie;
  let center;

  beforeAll(async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input?.url ?? String(input));
      if (url.includes('api.twilio.com')) {
        twilioCalls.push({ url, init });
        return Promise.resolve(twilioResponder ? twilioResponder() : defaultTwilioResponse());
      }
      return realFetch(input, init);
    });

    cookie = await loginCookie();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  beforeEach(async () => {
    center = await defaultCenter();
    twilioCalls = [];
    twilioResponder = null;
    stubTwilioEnv();
    await wipeCenterData(center.id);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('configuration gate', () => {
    it('isTwilioConfigured() false short-circuits sends without any network call', async () => {
      stubTwilioEnv({ TWILIO_ACCOUNT_SID: undefined });
      expect(isTwilioConfigured()).toBe(false);

      const result = await sendTwilioSms('+12135550100', 'hi');
      expect(result).toEqual({ sent: false, reason: 'not_configured' });
      expect(twilioCalls).toHaveLength(0);
    });

    it('leaves sms_queue rows pending (for the Android gateway phone) when unconfigured', async () => {
      stubTwilioEnv({ TWILIO_ACCOUNT_SID: undefined });
      const seeded = await insertStudent(center.id, {
        first: 'No',
        last: 'Twilio',
        parent_phone: '+12135550100',
      });
      const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(seeded.id);

      const result = await enqueueNotification({ id: null }, student, 'checked_in', '2026-07-31T19:00:00.000Z');
      expect(result.enqueued).toBe(true);
      expect(twilioCalls).toHaveLength(0);

      const queueRows = await db.prepare('SELECT * FROM sms_queue').all();
      expect(queueRows).toHaveLength(1);
      expect(queueRows[0].status).toBe('pending');
    });
  });

  describe('attendance notification dispatch', () => {
    it('sends immediately via Twilio and marks the sms_queue row sent', async () => {
      const seeded = await insertStudent(center.id, {
        first: 'Twilio',
        last: 'Kid',
        parent_phone: '+12135550100',
      });
      const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(seeded.id);

      const result = await enqueueNotification({ id: null }, student, 'checked_in', '2026-07-31T19:00:00.000Z');
      expect(result.enqueued).toBe(true);

      expect(twilioCalls).toHaveLength(1);
      expect(twilioCalls[0].url).toBe(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ENV.TWILIO_ACCOUNT_SID}/Messages.json`
      );
      const params = new URLSearchParams(twilioCalls[0].init.body);
      expect(params.get('To')).toBe('+12135550100');
      expect(params.get('From')).toBe(TWILIO_ENV.TWILIO_FROM_NUMBER);

      const queueRows = await db.prepare('SELECT * FROM sms_queue').all();
      expect(queueRows).toHaveLength(1);
      expect(queueRows[0]).toMatchObject({ status: 'sent', attempts: 1 });
      expect(queueRows[0].sent_at).not.toBeNull();
    });

    it('marks the row failed (not retried by the gateway phone) on a Twilio API error', async () => {
      twilioResponder = () =>
        new Response(JSON.stringify({ message: 'The number is unverified' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });

      const seeded = await insertStudent(center.id, {
        first: 'Fail',
        last: 'Send',
        parent_phone: '+12135550101',
      });
      const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(seeded.id);

      const result = await enqueueNotification({ id: null }, student, 'checked_out', '2026-07-31T20:00:00.000Z');
      expect(result.enqueued).toBe(true);

      const queueRows = await db.prepare('SELECT * FROM sms_queue').all();
      expect(queueRows[0]).toMatchObject({ status: 'failed', attempts: 1 });
      expect(queueRows[0].last_error).toContain('unverified');
    });

    it('does not propagate a Twilio failure to the check-in response', async () => {
      twilioResponder = () => {
        throw new Error('ECONNRESET');
      };
      const seeded = await insertStudent(center.id, {
        first: 'Net',
        last: 'Down',
        parent_phone: '+12135550102',
      });

      const res = await request(app)
        .post('/api/check-in')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', TEST_IP)
        .send({ student_id: seeded.id, subjects: 'math' });
      expect(res.status).toBe(201);
      expect(res.body.action).toBe('checked_in');
    });
  });

  describe('staff -> parent messages (Messages panel)', () => {
    it('sends a staff-composed message immediately via Twilio', async () => {
      const seeded = await insertStudent(center.id, {
        first: 'Panel',
        last: 'Send',
        parent_phone: '+12135550200',
      });

      const message = await sendOutboundMessage(center.id, {
        student_id: seeded.id,
        body: 'Reminder: bring your worksheet tomorrow.',
      });
      expect(message.status).toBe('sent');

      expect(twilioCalls).toHaveLength(1);
      const params = new URLSearchParams(twilioCalls[0].init.body);
      expect(params.get('Body')).toBe('Reminder: bring your worksheet tomorrow.');

      const queueRows = await db.prepare('SELECT * FROM sms_queue').all();
      expect(queueRows[0].status).toBe('sent');
    });
  });

  describe('POST /api/webhooks/sms (signature verification)', () => {
    it('returns 503 when TWILIO_AUTH_TOKEN is unset', async () => {
      stubTwilioEnv({ TWILIO_AUTH_TOKEN: undefined });
      const res = await postWebhook(
        { From: '+12135550100', Body: 'hi' },
        { signature: 'anything' }
      );
      expect(res.status).toBe(503);
    });

    it('rejects a forged signature and records nothing', async () => {
      const res = await postWebhook(
        { From: '+12135550100', Body: 'forged' },
        { signature: 'not-a-valid-signature' }
      );
      expect(res.status).toBe(401);

      const messages = await db.prepare('SELECT * FROM messages').all();
      expect(messages).toHaveLength(0);
    });

    it('rejects a request with no signature header', async () => {
      const res = await postWebhook({ From: '+12135550100', Body: 'no sig' });
      expect(res.status).toBe(401);
    });

    it('accepts a valid signature and matches the sender via parent_phone', async () => {
      const seeded = await insertStudent(center.id, {
        first: 'Inbound',
        last: 'Match',
        parent_phone: '+12135550300',
      });

      const params = { From: '+12135550300', Body: 'Running late for pickup' };
      const signature = computeTwilioSignature(webhookUrl(), params, TWILIO_ENV.TWILIO_AUTH_TOKEN);
      const res = await postWebhook(params, { signature });
      expect(res.status).toBe(200);

      const messages = await db.prepare('SELECT * FROM messages').all();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        student_id: seeded.id,
        direction: 'inbound',
        body: 'Running late for pickup',
      });
    });

    it('stores unmatched senders instead of dropping them', async () => {
      const params = { From: '+12135550999', Body: 'who dis' };
      const signature = computeTwilioSignature(webhookUrl(), params, TWILIO_ENV.TWILIO_AUTH_TOKEN);
      const res = await postWebhook(params, { signature });
      expect(res.status).toBe(200);

      const messages = await db.prepare('SELECT * FROM messages').all();
      expect(messages).toHaveLength(1);
      expect(messages[0].student_id).toBeNull();
    });
  });
});
