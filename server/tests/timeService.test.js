import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TIME_API_TIMEOUT_MS,
  fetchAuthoritativeTime,
  getWeekdayShortForDate,
  monthBounds,
  rollingAnnualBounds,
} from '../timeService.js';

describe('timeService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('getWeekdayShortForDate is DST-safe for America/Los_Angeles spring forward', () => {
    // 2026-03-08 is the US spring-forward Sunday in Pacific time.
    expect(getWeekdayShortForDate('2026-03-08')).toBe('Sun');
    expect(getWeekdayShortForDate('2026-03-09')).toBe('Mon');
    // Fall back weekend 2026-11-01.
    expect(getWeekdayShortForDate('2026-11-01')).toBe('Sun');
    expect(getWeekdayShortForDate('2026-11-02')).toBe('Mon');
  });

  it('monthBounds and rollingAnnualBounds at year boundaries', () => {
    expect(monthBounds('2026-01')).toEqual({ start: '2026-01-01', end: '2026-01-31' });
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(rollingAnnualBounds('2026-01')).toEqual({
      start: '2025-02-01',
      end: '2026-01-31',
    });
    expect(rollingAnnualBounds('2026-12')).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });

  it('fetchAuthoritativeTime rejects within ~5s when the response hangs', async () => {
    vi.stubGlobal('fetch', (_url, options = {}) => {
      return new Promise((_resolve, reject) => {
        const signal = options.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        });
      });
    });

    const start = Date.now();
    await expect(fetchAuthoritativeTime()).rejects.toThrow(/timed out/i);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(TIME_API_TIMEOUT_MS - 200);
    expect(elapsed).toBeLessThan(TIME_API_TIMEOUT_MS + 1500);
  });
});
