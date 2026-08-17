import { useEffect, useState } from 'react';
import {
  getOfflineState,
  initOfflineSync,
  submitCheckIn,
  submitCheckOut,
  subscribeResults,
  subscribeState,
} from './sync.js';

/**
 * Desk-side view of the offline queue.
 *
 * @param {object} [options]
 * @param {(outcome) => void} [options.onSyncResult] called when a *queued*
 *   action later syncs in the background (reconnect or retry timer), so the
 *   page can announce "checked in (synced)" / "sync failed: already checked
 *   in". Pass a stable (useCallback) reference.
 */
export function useOfflineQueue({ onSyncResult } = {}) {
  const [{ online, pending, syncing }, setSnapshot] = useState(getOfflineState);

  useEffect(() => {
    initOfflineSync();
    return subscribeState(setSnapshot);
  }, []);

  useEffect(() => {
    if (!onSyncResult) return undefined;
    return subscribeResults(onSyncResult);
  }, [onSyncResult]);

  return {
    online,
    pendingCount: pending,
    syncing,
    submitCheckIn,
    submitCheckOut,
  };
}
