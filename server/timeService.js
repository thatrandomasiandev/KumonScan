import dotenv from 'dotenv';

dotenv.config();

const CENTER_TIMEZONE = process.env.CENTER_TIMEZONE || 'America/Los_Angeles';

export async function fetchAuthoritativeTime() {
  const url = `https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(CENTER_TIMEZONE)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Time API returned ${response.status}`);
  }

  const data = await response.json();
  const dateTime = data.dateTime;

  if (!dateTime) {
    throw new Error('Time API response missing dateTime');
  }

  return {
    iso: dateTime,
    timezone: CENTER_TIMEZONE,
  };
}

export function getCenterTimezone() {
  return CENTER_TIMEZONE;
}

export function formatInTimezone(isoString, options = {}) {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    timeZone: CENTER_TIMEZONE,
    ...options,
  });
}

export function getDateInTimezone(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-CA', { timeZone: CENTER_TIMEZONE });
}

export function getTodayInTimezone() {
  return new Date().toLocaleDateString('en-CA', { timeZone: CENTER_TIMEZONE });
}

export function isWithinPastDays(isoString, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return new Date(isoString) >= cutoff;
}

export function groupSessionsByDate(sessions) {
  const counts = {};
  for (const session of sessions) {
    const date = getDateInTimezone(session.check_in_time);
    counts[date] = (counts[date] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function calculateDurationMinutes(checkIn, checkOut) {
  const start = new Date(checkIn).getTime();
  const end = new Date(checkOut).getTime();
  return Math.round(((end - start) / 60000) * 10) / 10;
}

/** Weekday shorts matching Admin schedule chips (en-US). */
export const WEEKDAY_SHORTS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Weekday short name for a calendar date (YYYY-MM-DD) in the center timezone.
 */
export function getWeekdayShortForDate(dateYmd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    throw new Error('date must be YYYY-MM-DD');
  }

  const [y, m, d] = dateYmd.split('-').map(Number);
  // Scan a 48h window so DST and zone offsets still land on the civil date.
  for (let hour = 0; hour < 48; hour++) {
    const instant = new Date(Date.UTC(y, m - 1, d - 1, hour, 30, 0));
    const localYmd = instant.toLocaleDateString('en-CA', { timeZone: CENTER_TIMEZONE });
    if (localYmd === dateYmd) {
      return instant.toLocaleDateString('en-US', {
        timeZone: CENTER_TIMEZONE,
        weekday: 'short',
      });
    }
  }

  const fallback = new Date(Date.UTC(y, m - 1, d, 20, 0, 0));
  return fallback.toLocaleDateString('en-US', {
    timeZone: CENTER_TIMEZONE,
    weekday: 'short',
  });
}

export function parseScheduleDays(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.filter((d) => WEEKDAY_SHORTS.includes(d));
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d) => WEEKDAY_SHORTS.includes(d));
  } catch {
    return [];
  }
}

/** Validate and normalize schedule_days. Returns null for clear, array, or throws on bad input. */
export function normalizeScheduleDaysInput(days) {
  if (days === null) return null;
  if (!Array.isArray(days)) {
    throw new Error('schedule_days must be an array or null');
  }
  const unique = [];
  for (const day of days) {
    const value = String(day).trim();
    if (!WEEKDAY_SHORTS.includes(value)) {
      throw new Error(`Invalid schedule day: ${day}`);
    }
    if (!unique.includes(value)) unique.push(value);
  }
  return unique;
}
