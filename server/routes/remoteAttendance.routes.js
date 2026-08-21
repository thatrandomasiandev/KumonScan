import { Router } from 'express';
import db from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { formatFullName } from '../utils/names.js';
import { enrichOpenSession, normalizeSubjects } from '../sessionRules.js';
import { getOpenSession } from '../services/studentService.js';
import { enqueueNotification } from '../services/smsQueueService.js';
import { emit as emitWebhookEvent } from '../services/webhookService.js';
import { getAuthoritativeTimeOr503 } from './shared.js';
import {
  ensureRemoteAttendanceSchema,
  getOpenRemoteSessionIds,
  isZoomWebhookConfigured,
  normalizeMode,
  startRemoteSession,
} from '../services/zoomService.js';

/**
 * Remote (Zoom) attendance routes. Mounted BEFORE the legacy /check-in handler
 * so the existing endpoint gains an optional `mode` field without editing it:
 * remote check-ins are handled here; everything else falls through unchanged
 * (the sessions.mode column default keeps those rows 'in_person').
 */
const router = Router();

// Sessions mode columns must exist before any handler (including reports)
// reads them. Memoized, so this is a no-op after the first request.
router.use(async (req, res, next) => {
  try {
    await ensureRemoteAttendanceSchema();
    next();
  } catch (err) {
    next(err);
  }
});

router.post('/check-in', requireAdmin, async (req, res, next) => {
  try {
    const mode = normalizeMode(req.body?.mode);
    if (mode === null) {
      return res.status(400).json({ error: "mode must be 'in_person' or 'remote'" });
    }
    if (mode !== 'remote') return next();

    const studentId = Number(req.body.student_id);
    if (!Number.isInteger(studentId) || studentId < 1) {
      return res.status(400).json({ error: 'student_id is required' });
    }

    const subjects = normalizeSubjects(req.body.subjects);
    if (!subjects) {
      return res.status(400).json({
        error: 'subjects is required (math, reading, efl, or a pair like math+reading)',
      });
    }

    const authoritativeTime = await getAuthoritativeTimeOr503(res);
    if (!authoritativeTime) return;

    const student = await db
      .prepare('SELECT * FROM students WHERE id = ? AND center_id = ? AND active = 1')
      .get(studentId, req.center.id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found or inactive' });
    }

    const openSession = await getOpenSession(req.center.id, student.id);
    if (openSession) {
      return res.status(409).json({
        error: 'Student is already checked in',
        session: enrichOpenSession(openSession, new Date(authoritativeTime.iso).getTime()),
      });
    }

    const session = await startRemoteSession(
      req.center.id,
      student.id,
      authoritativeTime.iso,
      subjects
    );

    // Same parent notification as an in-person desk check-in. Check-outs go
    // through the shared /check-out handler, which already notifies.
    await enqueueNotification(session, student, 'checked_in', authoritativeTime.iso);

    // agent-10: fire-and-forget on purpose — a slow subscriber must not delay check-in.
    void emitWebhookEvent(req.center.id, 'student.checked_in', {
      student: { id: student.id, first_name: student.first_name, last_name: student.last_name, name: formatFullName(student) },
      session: { id: session.id, check_in_time: session.check_in_time, subjects: session.subjects, mode: 'remote' },
    });

    res.status(201).json({
      action: 'checked_in',
      student: {
        id: student.id,
        name: formatFullName(student),
        first_name: student.first_name,
        last_name: student.last_name,
      },
      session: enrichOpenSession(session, new Date(authoritativeTime.iso).getTime()),
      timestamp: authoritativeTime.iso,
      timezone: authoritativeTime.timezone,
    });
  } catch (err) {
    if (err?.code === 'ALREADY_CHECKED_IN') {
      return res.status(409).json({
        error: 'Student is already checked in',
        session: err.openSession ? enrichOpenSession(err.openSession) : undefined,
      });
    }
    console.error('Remote check-in error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Open remote session ids, so the desk roster can render its mode chip. */
router.get('/remote-attendance/open-sessions', requireAdmin, async (req, res) => {
  try {
    res.json({ session_ids: await getOpenRemoteSessionIds(req.center.id) });
  } catch (err) {
    console.error('Open remote sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Zoom webhook receiver — Layer 2 stub.
 *
 * No Zoom credentials exist in this environment, so this endpoint refuses all
 * traffic rather than pretending to track joins/leaves. Manual remote
 * check-ins (mode='remote' on /check-in) are the supported path today.
 *
 * TODO(zoom): real implementation, gated on ZOOM_WEBHOOK_SECRET:
 * 1. Verify Zoom's signature on the raw body before touching any state:
 *    x-zm-signature === 'v0=' + HMAC_SHA256(`v0:${x-zm-request-timestamp}:${rawBody}`,
 *    ZOOM_WEBHOOK_SECRET), rejecting stale timestamps. Requires the raw body
 *    (express.raw or a verify hook), not the parsed JSON.
 * 2. Answer the endpoint.url_validation challenge (plainToken →
 *    HMAC-signed encryptedToken).
 * 3. Route meeting.participant_joined / meeting.participant_left to
 *    getZoomProvider().handleParticipantJoined/Left(meetingId, participantName).
 *    Unrecognized participant names are dropped with a 200 (Zoom retries on
 *    non-2xx) — never auto-create students from webhook payloads.
 */
router.post('/webhooks/zoom', async (req, res) => {
  if (!isZoomWebhookConfigured()) {
    return res.status(503).json({
      error:
        'Zoom webhook integration is not configured (ZOOM_WEBHOOK_SECRET is unset). ' +
        'Use the desk Remote check-in instead.',
    });
  }
  // Unreachable until the TODO above lands; refuse rather than fake-accept.
  return res.status(501).json({ error: 'Zoom webhook handling is not implemented yet' });
});

export default router;
