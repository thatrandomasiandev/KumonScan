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
