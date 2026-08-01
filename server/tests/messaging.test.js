import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import {
  MESSAGES_LAST_VIEWED_KEY,
  ensureMessagingTables,
  normalizePhoneE164,
} from '../services/messagingService.js';
import {
  defaultCenter,
  insertStudent,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

const GATEWAY_KEY = 'test-gateway-key'; // set in tests/env-setup.js

function gatewayInbound(payload) {
  return request(app)
    .post('/api/gateway/inbound')
    .set('Authorization', `Bearer ${GATEWAY_KEY}`)
    .send(payload);
}

describe('normalizePhoneE164', () => {
  it('normalizes US phone format variants to the same E.164 number', () => {
    expect(normalizePhoneE164('(555) 123-4567')).toBe('+15551234567');
    expect(normalizePhoneE164('5551234567')).toBe('+15551234567');
    expect(normalizePhoneE164('+15551234567')).toBe('+15551234567');
    expect(normalizePhoneE164('1-555-123-4567')).toBe('+15551234567');
    expect(normalizePhoneE164('555.123.4567')).toBe('+15551234567');
  });

  it('keeps explicit international numbers as entered', () => {
    expect(normalizePhoneE164('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('returns null for unnormalizable input', () => {
    expect(normalizePhoneE164('')).toBeNull();
    expect(normalizePhoneE164('   ')).toBeNull();
    expect(normalizePhoneE164('12345')).toBeNull();
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164(42)).toBeNull();
  });
});

describe('messaging API', () => {
  let cookie;
  let center;

  // Login once per file: /api/auth/login is rate-limited to 10/minute and the
  // admin session cookie is valid for the whole run.
  beforeAll(async () => {
    await ensureMessagingTables();
    cookie = await loginCookie();
  });

  beforeEach(async () => {
    center = await defaultCenter();
    await wipeCenterData(center.id);
    await db
      .prepare('DELETE FROM settings WHERE center_id = ? AND key = ?')
      .run(center.id, MESSAGES_LAST_VIEWED_KEY);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('gateway auth on /api/gateway/inbound', () => {
    it('rejects requests without a bearer token', async () => {
      const res = await request(app)
        .post('/api/gateway/inbound')
        .send({ from_phone: '+15551234567', body: 'hello' });
      expect(res.status).toBe(401);
    });

    it('rejects requests with the wrong token', async () => {
      const res = await request(app)
        .post('/api/gateway/inbound')
        .set('Authorization', 'Bearer wrong-key')
        .send({ from_phone: '+15551234567', body: 'hello' });
      expect(res.status).toBe(401);
    });
  });

  describe('inbound matching', () => {
    it.each([
      ['(555) 200-4567', '+15552004567'],
      ['+15552014567', '(555) 201-4567'],
      ['5552024567', '1-555-202-4567'],
    ])(
      'links inbound to the right student (stored "%s", inbound "%s")',
      async (storedPhone, inboundPhone) => {
        const decoy = await insertStudent(center.id, {
          first: 'Decoy',
          last: 'Student',
          parent_phone: '(555) 999-0000',
        });
        const student = await insertStudent(center.id, {
          first: 'Match',
          last: 'Target',
          parent_phone: storedPhone,
        });

        const res = await gatewayInbound({
          from_phone: inboundPhone,
          body: 'Running 10 minutes late for pickup',
          received_at: '2026-07-31T20:00:00.000Z',
        });
        expect(res.status).toBe(201);
        expect(res.body.matched).toBe(true);
        expect(res.body.student_id).toBe(student.id);

        const thread = await request(app)
          .get(`/api/messages/${student.id}`)
          .set('Cookie', cookie);
        expect(thread.status).toBe(200);
        expect(thread.body.messages).toHaveLength(1);
        expect(thread.body.messages[0].direction).toBe('inbound');
        expect(thread.body.messages[0].body).toBe('Running 10 minutes late for pickup');

        const decoyThread = await request(app)
          .get(`/api/messages/${decoy.id}`)
          .set('Cookie', cookie);
        expect(decoyThread.body.messages).toHaveLength(0);
      }
    );

    it('stores an unmatched inbound message instead of dropping it', async () => {
      await insertStudent(center.id, {
        first: 'Known',
        last: 'Parent',
        parent_phone: '(555) 123-4567',
      });

      const res = await gatewayInbound({
        from_phone: '+15559998888',
        body: 'Is the center open today?',
      });
      expect(res.status).toBe(201);
      expect(res.body.matched).toBe(false);
      expect(res.body.student_id).toBeNull();

      const unmatched = await request(app)
        .get('/api/messages/unmatched')
        .set('Cookie', cookie);
      expect(unmatched.status).toBe(200);
      expect(unmatched.body.messages).toHaveLength(1);
      expect(unmatched.body.messages[0].from_phone).toBe('+15559998888');
      expect(unmatched.body.messages[0].body).toBe('Is the center open today?');
    });

    it('stores inbound even when the phone cannot be normalized (e.g. shortcode)', async () => {
      const res = await gatewayInbound({ from_phone: '88555', body: 'STOP' });
      expect(res.status).toBe(201);
      expect(res.body.matched).toBe(false);

      const unmatched = await request(app)
        .get('/api/messages/unmatched')
        .set('Cookie', cookie);
      expect(unmatched.body.messages).toHaveLength(1);
      expect(unmatched.body.messages[0].from_phone).toBe('88555');
    });
  });

  describe('outbound send path', () => {
    it('produces exactly one sms_queue row through the shared gateway queue', async () => {
      const student = await insertStudent(center.id, {
        first: 'Out',
        last: 'Bound',
        parent_phone: '(555) 123-4567',
      });

      const res = await request(app)
        .post('/api/messages')
        .set('Cookie', cookie)
        .send({ student_id: student.id, body: 'Please bring the June packet tomorrow.' });
      expect(res.status).toBe(201);
      expect(res.body.message.direction).toBe('outbound');
      expect(res.body.message.student_id).toBe(student.id);

      const queueRows = await db.prepare('SELECT * FROM sms_queue').all();
      expect(queueRows).toHaveLength(1);
      expect(queueRows[0].student_id).toBe(student.id);
      expect(queueRows[0].parent_phone).toBe('(555) 123-4567');
      expect(queueRows[0].message).toBe('Please bring the June packet tomorrow.');
      expect(queueRows[0].status).toBe('pending');

      const thread = await request(app)
        .get(`/api/messages/${student.id}`)
        .set('Cookie', cookie);
      expect(thread.body.messages).toHaveLength(1);
      expect(thread.body.messages[0].direction).toBe('outbound');
    });

    it('rejects sends to a student without a parent phone and enqueues nothing', async () => {
      const student = await insertStudent(center.id, { first: 'No', last: 'Phone' });

      const res = await request(app)
        .post('/api/messages')
        .set('Cookie', cookie)
        .send({ student_id: student.id, body: 'hello' });
      expect(res.status).toBe(422);

      const queueRows = await db.prepare('SELECT * FROM sms_queue').all();
      expect(queueRows).toHaveLength(0);
      const messageRows = await db.prepare('SELECT * FROM messages').all();
      expect(messageRows).toHaveLength(0);
    });

    it('requires staff auth', async () => {
      const res = await request(app)
        .post('/api/messages')
        .send({ student_id: 1, body: 'hello' });
      expect(res.status).toBe(401);
    });
  });

  describe('thread ordering', () => {
    it('returns the full thread chronologically', async () => {
      const student = await insertStudent(center.id, {
        first: 'Thread',
        last: 'Order',
        parent_phone: '(555) 300-1111',
      });

      // Past-dated first message; the reply and follow-up use server "now",
      // with id as the tiebreak if two rows land in the same millisecond.
      await gatewayInbound({
        from_phone: '5553001111',
        body: 'First inbound',
        received_at: '2026-07-30T18:00:00.000Z',
      });
      await request(app)
        .post('/api/messages')
        .set('Cookie', cookie)
        .send({ student_id: student.id, body: 'Staff reply' });
      await gatewayInbound({
        from_phone: '+15553001111',
        body: 'Parent follow-up',
      });

      const thread = await request(app)
        .get(`/api/messages/${student.id}`)
        .set('Cookie', cookie);
      const bodies = thread.body.messages.map((m) => m.body);
      expect(bodies).toEqual(['First inbound', 'Staff reply', 'Parent follow-up']);
    });
  });

  describe('unmatched linking', () => {
    it('links a message to a student and saves the phone when requested', async () => {
      const student = await insertStudent(center.id, { first: 'Link', last: 'Me' });

      const inbound = await gatewayInbound({
        from_phone: '(555) 400-2222',
        body: 'This is Link Me’s parent',
      });
      const messageId = inbound.body.id;

      const link = await request(app)
        .post(`/api/messages/${messageId}/link`)
        .set('Cookie', cookie)
        .send({ student_id: student.id, save_phone: true });
      expect(link.status).toBe(200);
      expect(link.body.message.student_id).toBe(student.id);

      const unmatched = await request(app)
        .get('/api/messages/unmatched')
        .set('Cookie', cookie);
      expect(unmatched.body.messages).toHaveLength(0);

      const row = await db
        .prepare('SELECT parent_phone FROM students WHERE id = ?')
        .get(student.id);
      expect(row.parent_phone).toBe('+15554002222');

      // Future inbound from the same number now matches automatically.
      const followUp = await gatewayInbound({
        from_phone: '5554002222',
        body: 'Second message',
      });
      expect(followUp.body.matched).toBe(true);
      expect(followUp.body.student_id).toBe(student.id);
    });

    it('refuses to link an already-linked message', async () => {
      const student = await insertStudent(center.id, {
        first: 'Already',
        last: 'Linked',
        parent_phone: '(555) 500-3333',
      });
      const inbound = await gatewayInbound({
        from_phone: '5555003333',
        body: 'Matched on arrival',
      });
      expect(inbound.body.matched).toBe(true);

      const link = await request(app)
        .post(`/api/messages/${inbound.body.id}/link`)
        .set('Cookie', cookie)
        .send({ student_id: student.id });
      expect(link.status).toBe(422);
    });
  });

  describe('unread count', () => {
    it('counts inbound since last view and resets on mark-viewed', async () => {
      await insertStudent(center.id, {
        first: 'Unread',
        last: 'Counter',
        parent_phone: '(555) 600-4444',
      });

      await gatewayInbound({ from_phone: '5556004444', body: 'One' });
      await gatewayInbound({ from_phone: '+15559990000', body: 'Two (unmatched)' });

      const before = await request(app)
        .get('/api/messages/unread-count')
        .set('Cookie', cookie);
      expect(before.body.count).toBe(2);

      const viewed = await request(app)
        .post('/api/messages/mark-viewed')
        .set('Cookie', cookie);
      expect(viewed.status).toBe(200);

      const after = await request(app)
        .get('/api/messages/unread-count')
        .set('Cookie', cookie);
      expect(after.body.count).toBe(0);
    });
  });
});
