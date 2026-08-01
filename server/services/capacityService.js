import db from '../db.js';
import { parseScheduleDays } from '../timeService.js';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const CAPACITY_SETTING_KEY = 'weekday_capacity';

export async function getWeekdayCapacity(centerId) {
  const row = await db
    .prepare('SELECT value FROM settings WHERE center_id = ? AND key = ?')
    .get(centerId, CAPACITY_SETTING_KEY);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function countExpectedForWeekday(centerId, weekday) {
  const activeStudents = await db
    .prepare('SELECT schedule_days FROM students WHERE center_id = ? AND active = 1')
    .all(centerId);
  return activeStudents.filter((s) => parseScheduleDays(s.schedule_days).includes(weekday))
    .length;
}
