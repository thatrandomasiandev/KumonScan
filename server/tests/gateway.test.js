import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db, { sqlNow } from '../db.js';
import { enqueueNotification } from '../services/smsQueueService.js';
import { defaultCenter, insertStudent, loginCookie, wipeCenterData } from './helpers.js';

const KEY = 'test-gateway-key';

async function enqueueRow(centerId, studentId, message = 'test message') {
  const result = await db
    .prepare(
      `INSERT INTO sms_queue (center_id, student_id, parent_phone, message, created_at)
       VALUES (?, ?, '+12135550100', ?, ?)`
    )
    .run(centerId, studentId, message, sqlNow());
  return result.lastInsertRowid;
}

describe('SMS gateway endpoints', () => {
  let center;
  let student;

  beforeEach(async () => {
    center = await defaultCenter();
    await wipeCenterData(center.id);
    student = await insertStudent(center.id, {
      first: 'Queue',
      last: 'Kid',
      parent_phone: '+12135550100',
    });
  });

  it('rejects requests without the bearer key', async () => {
    const none = await request(app).get('/api/gateway/pending');
    expect(none.status).toBe(401);

    const wrong = await request(app)
      .get('/api/gateway/pending')
      .set('Authorization', 'Bearer wrong-key');
    expect(wrong.status).toBe(401);
  });

  it('enqueueNotification inserts a pending row and skips students without a phone', async () => {
    const row = await db.prepare('SELECT * FROM students WHERE id = ?').get(student.id);

    const withPhone = await enqueueNotification(
      { id: null },
      row,
      'checked_in',
      '2026-07-30T19:00:00.000Z'
    );
    expect(withPhone.enqueued).toBe(true);

    const noPhone = await enqueueNotification(
      { id: null },
      { ...row, parent_phone: null },
      'checked_out',
      '2026-07-30T19:00:00.000Z'
    );
    expect(noPhone).toEqual({ enqueued: false, reason: 'no_parent_phone' });

    const rows = await db.prepare(`SELECT * FROM sms_queue WHERE status = 'pending'`).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toMatch(/checked in at Kumon/);
  });

  it('poll claims rows atomically: concurrent polls never hand out the same row', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await enqueueRow(center.id, student.id, `message ${i}`));
    }

    const [pollA, pollB] = await Promise.all([
      request(app).get('/api/gateway/pending').set('Authorization', `Bearer ${KEY}`),
      request(app).get('/api/gateway/pending').set('Authorization', `Bearer ${KEY}`),
    ]);

    expect(pollA.status).toBe(200);
    expect(pollB.status).toBe(200);

    const idsA = pollA.body.messages.map((m) => m.id);
    const idsB = pollB.body.messages.map((m) => m.id);
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toEqual([]);
    expect([...idsA, ...idsB].sort((a, b) => a - b)).toEqual(ids);

    const sending = await db
      .prepare(`SELECT COUNT(*) AS count FROM sms_queue WHERE status = 'sending'`)
      .get();
    expect(sending.count).toBe(5);

    // A third poll finds nothing left to claim.
    const pollC = await request(app)
      .get('/api/gateway/pending')
      .set('Authorization', `Bearer ${KEY}`);
    expect(pollC.body.messages).toEqual([]);
  });

  it('ack success marks sent; ack failure retries then lands on failed after 3 attempts', async () => {
    const id = await enqueueRow(center.id, student.id);

    // Claim, then ack success.
    await request(app).get('/api/gateway/pending').set('Authorization', `Bearer ${KEY}`);
    const okAck = await request(app)
      .post(`/api/gateway/${id}/ack`)
      .set('Authorization', `Bearer ${KEY}`)
      .send({ success: true });
    expect(okAck.status).toBe(200);
    expect(okAck.body.status).toBe('sent');

    const sentRow = await db.prepare('SELECT * FROM sms_queue WHERE id = ?').get(id);
    expect(sentRow.status).toBe('sent');
    expect(sentRow.sent_at).toBeTruthy();

    // Failure path: three failed attempts end in 'failed', not endless retry.
    const failId = await enqueueRow(center.id, student.id, 'will fail');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const poll = await request(app)
        .get('/api/gateway/pending')
        .set('Authorization', `Bearer ${KEY}`);
      expect(poll.body.messages.map((m) => m.id)).toContain(failId);

      const ack = await request(app)
        .post(`/api/gateway/${failId}/ack`)
        .set('Authorization', `Bearer ${KEY}`)
        .send({ success: false, error: 'radio off' });
      expect(ack.status).toBe(200);
      expect(ack.body.status).toBe(attempt < 3 ? 'pending' : 'failed');
    }

    const failedRow = await db.prepare('SELECT * FROM sms_queue WHERE id = ?').get(failId);
    expect(failedRow.status).toBe('failed');
    expect(failedRow.attempts).toBe(3);
    expect(failedRow.last_error).toBe('radio off');

    // Failed rows are not offered again.
    const finalPoll = await request(app)
      .get('/api/gateway/pending')
      .set('Authorization', `Bearer ${KEY}`);
    expect(finalPoll.body.messages).toEqual([]);
  });

  it('heartbeat stores last_seen and admin gateway-status reports queue depth', async () => {
    const beat = await request(app)
      .post('/api/gateway/heartbeat')
      .set('Authorization', `Bearer ${KEY}`)
      .send({});
    expect(beat.status).toBe(200);

    await enqueueRow(center.id, student.id);

    const cookie = await loginCookie();

    const status = await request(app)
      .get('/api/admin/gateway-status')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.40');

    expect(status.status).toBe(200);
    expect(status.body.configured).toBe(true);
    expect(status.body.gateway_configured).toBe(true);
    expect(status.body.last_seen_at).toBeTruthy();
    expect(status.body.seconds_since_seen).toBeGreaterThanOrEqual(0);
    expect(status.body.pending).toBe(1);
    expect(status.body.failed).toBe(0);
  });
});
