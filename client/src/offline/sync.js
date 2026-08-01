import { api } from '../api';
import {
  enqueueAction,
  generateIdempotencyKey,
  listActions,
  pendingCount,
  recordAttempt,
  removeAction,
} from './queue.js';

/**
 * Offline sync engine for the front desk.
 *
 * Strategy choice: `online`/`offline` events plus a retry loop, NOT a service
 * worker. Reasons:
 * - The failure mode this guards against is a front-desk tablet dropping
 *   wifi for seconds-to-minutes with the desk tab open the whole time. An
 *   in-page queue covers that completely; Background Sync's one advantage
 *   (replaying after the tab is closed) does not apply to a kiosk tab that
 *   stays open all day.
 * - The Background Sync API is Chromium-only; Safari (iPad kiosks) would
 *   need this fallback path anyway, so the fallback IS the implementation.
 * - A service worker adds an update/cache-invalidation lifecycle to the
 *   deploy story for no additional coverage here.
 * The queue itself lives in IndexedDB, so even a tab crash while offline
 * loses nothing: pending actions replay when the desk page next loads.
 *
 * Delivery rules (see flush):
 * - FIFO, one at a time.
 * - Success or any 4xx removes the action. A 4xx (409 already checked in,
 *   404 no open session) is deterministic; retrying cannot change it, so it
 *   is surfaced to staff once and dropped.
 * - Network errors and 5xx (including 503 when timeapi.io is unreachable)
 *   keep the action and stop the pass; the retry timer or the next `online`
 *   event tries again with the same idempotency key.
 */

const RETRY_INTERVAL_MS = 15_000;

const state = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  syncing: false,
};

const stateListeners = new Set();
const resultListeners = new Set();

export function getOfflineState() {
  return { ...state };
}

/** Subscribe to {online, pending, syncing}; fires immediately and on change. */
export function subscribeState(listener) {
  stateListeners.add(listener);
  listener(getOfflineState());
  return () => stateListeners.delete(listener);
}

/**
 * Subscribe to per-action outcomes:
 * { status: 'delivered', action, result } or { status: 'rejected', action, error }.
 * Only emitted for actions resolved by a background flush (reconnect/timer);
 * submitAction reports its own action's outcome to its caller directly.
 */
export function subscribeResults(listener) {
  resultListeners.add(listener);
  return () => resultListeners.delete(listener);
}

function notifyState() {
  const snapshot = getOfflineState();
  for (const listener of stateListeners) listener(snapshot);
}

function emitResult(outcome) {
  for (const listener of resultListeners) listener(outcome);
}

async function refreshPending() {
  try {
    state.pending = await pendingCount();
  } catch {
    // IndexedDB unavailable (private mode quota, etc.); direct sends still work.
  }
  notifyState();
}

function sendAction(action) {
  const { type, payload } = action;
  if (type === 'check-in') {
    return api.checkIn(payload.student_id, payload.subjects, {
      mode: payload.mode,
      idempotencyKey: action.id,
    });
  }
  if (type === 'check-out') {
    return api.checkOut({
      student_id: payload.student_id,
      session_id: payload.session_id,
      idempotencyKey: action.id,
    });
  }
  return Promise.reject(new Error(`Unknown queued action type: ${type}`));
}

function isPermanentRejection(err) {
  return Number.isInteger(err?.status) && err.status >= 400 && err.status < 500;
}

let flushPromise = null;

/** Drain the queue FIFO. Returns Map<actionId, outcome>. Concurrent calls share one pass. */
export function flush() {
  if (!flushPromise) {
    flushPromise = drainQueue().finally(() => {
      flushPromise = null;
    });
  }
  return flushPromise;
}

async function drainQueue() {
  const outcomes = new Map();
  state.syncing = true;
  notifyState();

  try {
    const actions = await listActions();
    for (const action of actions) {
      try {
        const result = await sendAction(action);
        await removeAction(action.id);
        outcomes.set(action.id, { status: 'delivered', action, result });
        state.online = true;
      } catch (err) {
        if (isPermanentRejection(err)) {
          await removeAction(action.id);
          outcomes.set(action.id, { status: 'rejected', action, error: err });
        } else {
          await recordAttempt(action, err?.message);
          outcomes.set(action.id, { status: 'retrying', action, error: err });
          break; // Server unreachable; later actions would fail the same way.
        }
      }
    }
  } finally {
    state.syncing = false;
    await refreshPending();
  }

  return outcomes;
}

/**
 * Persist an action, then deliver it if possible. Resolves with this
 * action's outcome:
 * - { status: 'delivered', result }  sent and accepted now
 * - { status: 'rejected', error }    sent and deterministically refused (4xx)
 * - { status: 'queued' | 'retrying' } holding in the queue for reconnect
 * The action is written to IndexedDB before any network attempt, so a crash
 * or connection drop mid-send can only ever delay it, not lose it.
 */
export async function submitAction(type, payload, label) {
  let action;
  try {
    action = await enqueueAction(type, payload, label);
  } catch (enqueueErr) {
    // IndexedDB unavailable (private browsing, storage pressure): degrade to
    // a direct keyed send so the desk still works online; offline durability
    // is lost but nothing else is.
    console.warn('Offline queue unavailable, sending directly:', enqueueErr);
    try {
      const result = await sendAction({ id: generateIdempotencyKey(), type, payload });
      return { status: 'delivered', result };
    } catch (err) {
      if (isPermanentRejection(err)) return { status: 'rejected', error: err };
      throw err;
    }
  }
  await refreshPending();

  if (!state.online) return { status: 'queued', action };

  let outcome = (await flush()).get(action.id);
  if (!outcome) {
    // A flush that was already mid-pass may have listed the store before our
    // action landed; one fresh pass settles it.
    outcome = (await flush()).get(action.id);
  }
  return outcome || { status: 'queued', action };
}

export function submitCheckIn(payload, label) {
  return submitAction('check-in', payload, label);
}

export function submitCheckOut(payload, label) {
  return submitAction('check-out', payload, label);
}

let initialized = false;

/** Idempotent. Wires connectivity listeners, the retry timer, and replay of anything left over from a previous page load. */
export function initOfflineSync() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('online', () => {
    state.online = true;
    notifyState();
    void flushInBackground();
  });
  window.addEventListener('offline', () => {
    state.online = false;
    notifyState();
  });

  setInterval(() => {
    if (state.online && state.pending > 0 && !state.syncing) {
      void flushInBackground();
    }
  }, RETRY_INTERVAL_MS);

  void refreshPending().then(() => {
    if (state.online && state.pending > 0) void flushInBackground();
  });
}

/** Background flushes report outcomes through subscribeResults so the desk can toast late-synced actions. */
async function flushInBackground() {
  const outcomes = await flush();
  for (const outcome of outcomes.values()) {
    if (outcome.status === 'delivered' || outcome.status === 'rejected') {
      emitResult(outcome);
    }
  }
}
