import crypto from 'crypto';
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  MAX_MESSAGE_LENGTH,
  getThread,
  getUnmatchedMessages,
  getUnreadInboundCount,
  linkMessageToStudent,
  markMessagesViewed,
  recordInboundMessage,
  sendOutboundMessage,
} from '../services/messagingService.js';

const router = Router();

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(len);
  const paddedB = Buffer.alloc(len);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

/**
 * Same static bearer-token auth as routes/gateway.routes.js (the middleware
 * there is module-private, so the check is repeated rather than exported
 * across workstream boundaries). Fails closed when GATEWAY_API_KEY is unset.
 */
function requireGateway(req, res, next) {
  const configured = process.env.GATEWAY_API_KEY;
  if (!configured) {
    return res
      .status(503)
      .json({ error: 'SMS gateway is not configured (GATEWAY_API_KEY is unset)' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqualString(token, configured)) {
    return res.status(401).json({ error: 'Invalid gateway credentials' });
  }

  next();
}

function validateBodyText(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return 'body (non-empty string) is required';
  }
  if (raw.trim().length > MAX_MESSAGE_LENGTH) {
    return `body must be at most ${MAX_MESSAGE_LENGTH} characters`;
  }
  return null;
}

function statusForCode(code) {
  switch (code) {
    case 'STUDENT_NOT_FOUND':
    case 'MESSAGE_NOT_FOUND':
      return 404;
    case 'NO_PARENT_PHONE':
    case 'NOT_LINKABLE':
      return 422;
    default:
      return 500;
  }
}

function handleError(res, err, context) {
  const status = statusForCode(err?.code);
  if (status === 500) {
    console.error(`${context}:`, err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res.status(status).json({ error: err.message });
}

/**
 * Called by the Android gateway app for every SMS its BroadcastReceiver sees.
 * Stores the message whether or not the sender matches a known parent_phone.
 */
router.post('/gateway/inbound', requireGateway, async (req, res) => {
  const { from_phone, body, received_at } = req.body ?? {};

  if (typeof from_phone !== 'string' || !from_phone.trim()) {
    return res.status(400).json({ error: 'from_phone (non-empty string) is required' });
  }
  const bodyError = validateBodyText(body);
  if (bodyError) return res.status(400).json({ error: bodyError });

  try {
    const result = await recordInboundMessage(req.center.id, {
      from_phone,
      body: body.trim(),
      received_at,
    });
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err, 'Inbound message error');
  }
});

/** Staff -> parent: one thread row plus one sms_queue row for the gateway. */
router.post('/messages', requireAdmin, async (req, res) => {
  const { student_id, body, staff_id } = req.body ?? {};

  const studentId = Number(student_id);
  if (!Number.isInteger(studentId) || studentId < 1) {
    return res.status(400).json({ error: 'student_id (positive integer) is required' });
  }
  const bodyError = validateBodyText(body);
  if (bodyError) return res.status(400).json({ error: bodyError });

  const staffId = staff_id == null ? null : Number(staff_id);
  if (staffId != null && (!Number.isInteger(staffId) || staffId < 1)) {
    return res.status(400).json({ error: 'staff_id must be a positive integer' });
  }

  try {
    const message = await sendOutboundMessage(req.center.id, {
      student_id: studentId,
      body: body.trim(),
      staff_id: staffId,
    });
    res.status(201).json({ message });
  } catch (err) {
    handleError(res, err, 'Send message error');
  }
});

// Static /messages paths must be registered before /messages/:studentId.

router.get('/messages/unread-count', requireAdmin, async (req, res) => {
  try {
    res.json({ count: await getUnreadInboundCount(req.center.id) });
  } catch (err) {
    handleError(res, err, 'Unread count error');
  }
});

router.get('/messages/unmatched', requireAdmin, async (req, res) => {
  try {
    res.json({ messages: await getUnmatchedMessages(req.center.id) });
  } catch (err) {
    handleError(res, err, 'Unmatched messages error');
  }
});

router.post('/messages/mark-viewed', requireAdmin, async (req, res) => {
  try {
    res.json({ viewed_at: await markMessagesViewed(req.center.id) });
  } catch (err) {
    handleError(res, err, 'Mark viewed error');
  }
});

/** Attach an unmatched inbound message to a student (manual triage). */
router.post('/messages/:id(\\d+)/link', requireAdmin, async (req, res) => {
  const { student_id, save_phone } = req.body ?? {};
  const studentId = Number(student_id);
  if (!Number.isInteger(studentId) || studentId < 1) {
    return res.status(400).json({ error: 'student_id (positive integer) is required' });
  }

  try {
    const message = await linkMessageToStudent(
      req.center.id,
      Number(req.params.id),
      studentId,
      { savePhone: Boolean(save_phone) }
    );
    res.json({ message });
  } catch (err) {
    handleError(res, err, 'Link message error');
  }
});

router.get('/messages/:studentId(\\d+)', requireAdmin, async (req, res) => {
  try {
    res.json({ messages: await getThread(req.center.id, Number(req.params.studentId)) });
  } catch (err) {
    handleError(res, err, 'Thread fetch error');
  }
});

export default router;
