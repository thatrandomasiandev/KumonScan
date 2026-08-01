import { fetchAuthoritativeTime } from '../timeService.js';

/** Scan/check-in/out policy: no authoritative external time, no state change. */
export async function getAuthoritativeTimeOr503(res) {
  try {
    return await fetchAuthoritativeTime();
  } catch {
    res.status(503).json({
      error: 'Cannot verify time — check internet connection',
    });
    return null;
  }
}
