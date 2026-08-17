import { idbCount, idbDelete, idbGetAll, idbPut } from './idb.js';

/**
 * Persistent queue of desk actions awaiting delivery.
 *
 * The action id doubles as the Idempotency-Key sent to the server. It is
 * generated here, at creation time, never at send time: the whole point is
 * that every retry of one action carries the same key, so the server can
 * collapse replays into the first execution's stored response.
 */

export function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Non-secure contexts (plain-http LAN kiosk) lack randomUUID; the key only
  // needs uniqueness, not unpredictability, so this fallback is fine.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * @param {'check-in' | 'check-out'} type
 * @param {object} payload arguments for the matching api.js call
 * @param {string} label human-readable summary for sync-result snackbars
 */
export async function enqueueAction(type, payload, label) {
  const action = {
    id: generateIdempotencyKey(),
    type,
    payload,
    label,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  await idbPut(action);
  return action;
}

/** All pending actions, oldest first (delivery must be FIFO: a check-in queued before its check-out must land first). */
export async function listActions() {
  const actions = await idbGetAll();
  return actions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function removeAction(id) {
  return idbDelete(id);
}

export async function recordAttempt(action, errorMessage) {
  await idbPut({
    ...action,
    attempts: (action.attempts || 0) + 1,
    lastError: errorMessage || null,
  });
}

export function pendingCount() {
  return idbCount();
}
