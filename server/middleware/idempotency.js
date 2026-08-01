import db, { sqlNow } from '../db.js';

/**
 * agent-offline: Idempotency-Key support for replayable mutations.
 *
 * The desk client queues check-in/check-out actions while offline and replays
 * them on reconnect. Each queued action carries a client-generated key that is
 * stable across retries, so a request whose response was lost in transit can
 * be re-sent without re-executing: the first completed execution's response is
 * stored and returned verbatim to every replay.
 *
 * This complements the one-open-session unique index. The index rejects
 * genuinely different duplicate check-ins (two keys, same student); this layer
 * only collapses retries of the *same* request (one key, sent twice).
 *
 * Storage rules:
 * - Requests without the header pass through untouched (fully additive).
 * - Only responses with status < 500 are stored. A 503 (timeapi.io down) or
 *   500 is transient; storing it would pin every future replay to the failure.
 * - Rows are scoped to the requesting center so a key can never surface
 *   another tenant's stored response.
 * - Two concurrent first-sends of one key can both miss the lookup and both
 *   execute; the sessions unique index still makes the outcome safe, and
 *   ON CONFLICT DO NOTHING keeps the first stored response authoritative.
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Stored responses older than this are dead weight; queued actions replay within minutes. */
const RETENTION_HOURS = 72;
const CLEANUP_PROBABILITY = 0.02;

function sweepExpiredKeys() {
  if (Math.random() >= CLEANUP_PROBABILITY) return;
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 3_600_000).toISOString();
  db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?')
    .run(cutoff)
    .catch((err) => console.error('Idempotency sweep failed:', err?.message || err));
}

/**
 * Express middleware. Mount after center resolution + auth so `req.center`
 * is set and unauthenticated requests can never read stored responses.
 */
export function idempotency() {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key) return next();

    if (!KEY_PATTERN.test(key)) {
      return res.status(400).json({
        error: 'Idempotency-Key must be 8-128 characters of letters, digits, hyphen, or underscore',
      });
    }

    try {
      const stored = await db
        .prepare(
          'SELECT response_body, status_code FROM idempotency_keys WHERE key = ? AND center_id = ?'
        )
        .get(key, req.center.id);
      if (stored) {
        res.set('Idempotency-Replayed', 'true');
        return res
          .status(stored.status_code)
          .type('application/json')
          .send(stored.response_body);
      }
    } catch (err) {
      // Fail open: losing replay protection for one request beats blocking
      // the desk. The one-open-session index still prevents double sessions.
      console.error('Idempotency lookup failed:', err?.message || err);
      return next();
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode;
      if (status >= 500 || body === undefined) return originalJson(body);

      // Store before sending: if the client received a response, a replay of
      // this key is guaranteed to find the stored row rather than re-execute.
      db.prepare(
        `INSERT INTO idempotency_keys (key, center_id, response_body, status_code, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key) DO NOTHING`
      )
        .run(key, req.center.id, JSON.stringify(body), status, sqlNow())
        .catch((err) => console.error('Idempotency store failed:', err?.message || err))
        .finally(() => {
          originalJson(body);
          sweepExpiredKeys();
        });
      return res;
    };

    next();
  };
}

export default idempotency;
