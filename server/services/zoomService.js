import db, { exec, sqlNow } from '../db.js';
import { insertCheckIn } from './studentService.js';

/**
 * Hybrid / remote (Zoom) attendance.
 *
 * A remote session is a normal `sessions` row with `mode = 'remote'`. It flows
 * through the same check-in/check-out, allowance, overtime, and report pipeline
 * as an in-person session; `mode` never affects timing math.
 *
 * Two layers:
 * - Layer 1 (shipped): staff manually start a remote session from the desk
 *   check-in flow. No external dependencies.
 * - Layer 2 (stub): automatic tracking from Zoom participant-joined/left
 *   webhooks. Requires ZOOM_WEBHOOK_SECRET (and a Zoom app); neither exists in
 *   this environment, so the provider below is the manual fallback and
 *   POST /api/webhooks/zoom answers 503. See getZoomProvider().
 */

export const SESSION_MODES = new Set(['in_person', 'remote']);

/**
 * Normalize a client-supplied session mode.
 * Absent/empty means the historical default ('in_person'); anything else must
 * be a known mode. Returns null for unrecognized values so callers can 400.
 */
export function normalizeMode(raw) {
  if (raw == null || raw === '') return 'in_person';
  const value = String(raw).trim().toLowerCase().replace(/-/g, '_');
  return SESSION_MODES.has(value) ? value : null;
}

let schemaPromise = null;

/**
 * Idempotent schema for remote attendance. Lives here (not db.js) so this
 * feature's migration ships with its own module; safe to run on every cold
 * start because every statement is IF NOT EXISTS.
 */
export async function ensureRemoteAttendanceSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await exec(
        `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'in_person'`
      );
      await exec(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS zoom_meeting_id TEXT`);
      // Maps a Zoom meeting to a student once the webhook layer is live.
      // zoom_meeting_id stays globally unique (Zoom assigns it); center_id
      // scopes lookups so one center never resolves another's mapping.
      await exec(`
        CREATE TABLE IF NOT EXISTS zoom_meetings (
          id SERIAL PRIMARY KEY,
          center_id INTEGER NOT NULL REFERENCES centers(id),
          zoom_meeting_id TEXT NOT NULL UNIQUE,
          student_id INTEGER REFERENCES students(id),
          created_at TEXT NOT NULL
        )
      `);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

/**
 * Start a remote session. Reuses insertCheckIn (same allowance calculation and
 * one-open-session-per-student enforcement), then tags the row as remote.
 * `zoomMeetingId` stays null for manual desk check-ins; only the webhook layer
 * sets it.
 */
export async function startRemoteSession(centerId, studentId, iso, subjects, zoomMeetingId = null) {
  const session = await insertCheckIn(centerId, studentId, iso, subjects);
  await db
    .prepare(
      `UPDATE sessions SET mode = 'remote', zoom_meeting_id = ? WHERE id = ? AND center_id = ?`
    )
    .run(zoomMeetingId, session.id, centerId);
  return db
    .prepare('SELECT * FROM sessions WHERE id = ? AND center_id = ?')
    .get(session.id, centerId);
}

/** Open remote sessions, for the desk roster's mode indicator. */
export async function getOpenRemoteSessionIds(centerId) {
  const rows = await db
    .prepare(
      `SELECT id FROM sessions
       WHERE center_id = ? AND check_out_time IS NULL AND mode = 'remote'`
    )
    .all(centerId);
  return rows.map((r) => r.id);
}

/** Record the meeting → student mapping used by the webhook layer. */
export async function recordZoomMeeting(centerId, zoomMeetingId, studentId) {
  await db
    .prepare(
      `INSERT INTO zoom_meetings (center_id, zoom_meeting_id, student_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (zoom_meeting_id) DO UPDATE SET student_id = EXCLUDED.student_id`
    )
    .run(centerId, zoomMeetingId, studentId, sqlNow());
}

/**
 * @typedef {Object} ZoomProvider
 * @property {(meetingId: string, participantName: string) => Promise<void>} handleParticipantJoined
 * @property {(meetingId: string, participantName: string) => Promise<void>} handleParticipantLeft
 */

/** True once a Zoom webhook secret is configured for signature verification. */
export function isZoomWebhookConfigured() {
  return Boolean(process.env.ZOOM_WEBHOOK_SECRET);
}

function zoomNotConfiguredError() {
  const error = new Error(
    'Zoom webhook integration is not configured (ZOOM_WEBHOOK_SECRET is unset)'
  );
  error.code = 'ZOOM_NOT_CONFIGURED';
  return error;
}

/**
 * Manual-fallback provider. Automatic participant tracking is intentionally
 * not implemented: no Zoom credentials exist in this environment, and shipping
 * an unverifiable integration would be worse than none. Staff use the desk
 * "Remote" toggle instead.
 *
 * TODO(zoom): when ZOOM_WEBHOOK_SECRET (and a Zoom Marketplace app) exist,
 * replace this with a webhook-backed provider:
 * - handleParticipantJoined: exact case-insensitive first+last name match
 *   against the students roster (same discipline as rosterImport.js — never
 *   guess on ambiguous/partial matches; unmatched names are logged and
 *   dropped, never auto-registered), then insertCheckIn with mode='remote'
 *   and zoom_meeting_id set, and recordZoomMeeting for the mapping.
 * - handleParticipantLeft: look up the open remote session by
 *   zoom_meeting_id and call completeCheckOut.
 * Signature verification happens in the route, not here.
 */
const manualFallbackProvider = {
  async handleParticipantJoined() {
    throw zoomNotConfiguredError();
  },
  async handleParticipantLeft() {
    throw zoomNotConfiguredError();
  },
};

/** @returns {ZoomProvider} */
export function getZoomProvider() {
  // TODO(zoom): return the webhook-backed provider once credentials exist.
  return manualFallbackProvider;
}
