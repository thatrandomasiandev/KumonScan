// agent-7-insights: owner analytics derived from existing tables only.
// No billing/pricing data exists in this schema, so nothing here claims revenue;
// every metric traces to sessions, students, staff, staff_sessions, settings,
// or (when present) a sibling agent's bookings table.
import db from '../db.js';
import {
  getCenterTimezone,
  getDateInTimezone,
  getTodayInTimezone,
  getWeekdayShortForDate,
} from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import { getWeekdayCapacity, WEEKDAYS } from './capacityService.js';

export const DEFAULT_SUMMARY_WINDOW_DAYS = 90;
export const DEFAULT_AT_RISK_THRESHOLD = 0.5;
/** At-risk compares the trailing 4 weeks against the 4 weeks before that. */
export const AT_RISK_WINDOW_DAYS = 28;
/** Headroom mirrors /reports/utilization's 28-day weekday-average window. */
export const CAPACITY_WINDOW_DAYS = 28;

function cutoffMs(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

/** YYYY-MM-DD in the center timezone, n days before today. */
function ymdDaysAgo(n) {
  const today = getTodayInTimezone();
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - n * 86_400_000).toISOString().slice(0, 10);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

async function activeStudents(centerId) {
  return db
    .prepare(
      `SELECT id, first_name, last_name FROM students
       WHERE center_id = ? AND active = 1 ORDER BY first_name ASC, last_name ASC`
    )
    .all(centerId);
}

async function allCheckIns(centerId) {
  return db
    .prepare('SELECT student_id, check_in_time FROM sessions WHERE center_id = ?')
    .all(centerId);
}

/** Check-ins per student in [olderCutoffMs, newerCutoffMs). newerCutoffMs=null means now. */
function countByStudent(sessions, olderCutoffMs, newerCutoffMs = null) {
  const counts = new Map();
  for (const s of sessions) {
    const t = new Date(s.check_in_time).getTime();
    if (!Number.isFinite(t) || t < olderCutoffMs) continue;
    if (newerCutoffMs != null && t >= newerCutoffMs) continue;
    counts.set(s.student_id, (counts.get(s.student_id) || 0) + 1);
  }
  return counts;
}

/**
 * Students whose check-in count over the trailing 4 weeks dropped by more than
 * `threshold` (fraction, strict >) versus the 4 weeks before that. Only
 * students with at least one prior-window visit can qualify; a student with no
 * baseline has nothing to drop from.
 */
export async function getAtRiskStudents({ centerId, threshold = DEFAULT_AT_RISK_THRESHOLD } = {}) {
  const students = await activeStudents(centerId);
  const sessions = await allCheckIns(centerId);
  const recentStart = cutoffMs(AT_RISK_WINDOW_DAYS);
  const priorStart = cutoffMs(AT_RISK_WINDOW_DAYS * 2);

  const recent = countByStudent(sessions, recentStart);
  const prior = countByStudent(sessions, priorStart, recentStart);

  const atRisk = [];
  for (const student of students) {
    const priorVisits = prior.get(student.id) || 0;
    if (priorVisits === 0) continue;
    const recentVisits = recent.get(student.id) || 0;
    const drop = (priorVisits - recentVisits) / priorVisits;
    if (drop > threshold) {
      atRisk.push({
        id: student.id,
        name: formatFullName(student),
        recent_visits: recentVisits,
        prior_visits: priorVisits,
        drop_pct: Math.round(drop * 100),
      });
    }
  }

  atRisk.sort(
    (a, b) =>
      b.drop_pct - a.drop_pct ||
      b.prior_visits - a.prior_visits ||
      a.name.localeCompare(b.name)
  );
  return atRisk;
}

/**
 * Regulars (3+ check-ins in the past 7 days, same rule as getStudentStats)
 * versus lapsed regulars: 3+ check-ins in days 8-14 but fewer than 3 in the
 * past 7 days.
 */
export async function getRegularsBreakdown(centerId) {
  const students = await activeStudents(centerId);
  const sessions = await allCheckIns(centerId);
  const weekStart = cutoffMs(7);
  const priorWeekStart = cutoffMs(14);

  const thisWeek = countByStudent(sessions, weekStart);
  const priorWeek = countByStudent(sessions, priorWeekStart, weekStart);

  let regularCount = 0;
  const lapsed = [];
  for (const student of students) {
    const now = thisWeek.get(student.id) || 0;
    const before = priorWeek.get(student.id) || 0;
    if (now >= 3) {
      regularCount += 1;
    } else if (before >= 3) {
      lapsed.push({
        id: student.id,
        name: formatFullName(student),
        visits_this_week: now,
        visits_prior_week: before,
      });
    }
  }

  lapsed.sort((a, b) => a.visits_this_week - b.visits_this_week || a.name.localeCompare(b.name));
  return {
    available: true,
    regular_count: regularCount,
    lapsed_count: lapsed.length,
    lapsed_students: lapsed,
  };
}

/**
 * Payroll cost (staff.hourly_rate x completed shift hours) divided by completed
 * visits over the window. Rough operational indicator only: it cannot
 * attribute which staff member served which student.
 */
export async function getStaffEfficiency({ centerId, windowDays = DEFAULT_SUMMARY_WINDOW_DAYS } = {}) {
  const start = ymdDaysAgo(windowDays - 1);
  const end = getTodayInTimezone();

  const staffRows = await db
    .prepare('SELECT id, hourly_rate FROM staff WHERE center_id = ?')
    .all(centerId);
  const rateById = new Map(staffRows.map((s) => [s.id, s.hourly_rate]));

  const shifts = (await db
    .prepare(
      `SELECT staff_id, clock_in_time, duration_minutes
       FROM staff_sessions WHERE center_id = ? AND clock_out_time IS NOT NULL`
    )
    .all(centerId))
    .filter((s) => {
      const d = getDateInTimezone(s.clock_in_time);
      return d >= start && d <= end;
    });

  let totalMinutes = 0;
  let totalCost = 0;
  const staffMissingRate = new Set();
  for (const shift of shifts) {
    const minutes = shift.duration_minutes || 0;
    totalMinutes += minutes;
    const rate = rateById.get(shift.staff_id);
    if (rate == null) {
      staffMissingRate.add(shift.staff_id);
    } else {
      totalCost += (minutes / 60) * rate;
    }
  }

  const totalVisits = (await db
    .prepare(
      'SELECT check_in_time FROM sessions WHERE center_id = ? AND check_out_time IS NOT NULL'
    )
    .all(centerId))
    .filter((s) => {
      const d = getDateInTimezone(s.check_in_time);
      return d >= start && d <= end;
    }).length;

  return {
    available: true,
    start_date: start,
    end_date: end,
    total_payroll_cost: round2(totalCost),
    total_staff_hours: round2(totalMinutes / 60),
    total_visits: totalVisits,
    cost_per_visit: totalVisits > 0 && shifts.length > 0 ? round2(totalCost / totalVisits) : null,
    staff_missing_rate: staffMissingRate.size,
  };
}

/**
 * Fraction of confirmed bookings on fully elapsed days (booking_date strictly
 * before today) that produced a check-in for that student on that date.
 * Future-dated bookings are excluded entirely: they have not had the chance to
 * convert. Requires a sibling agent's bookings(student_id, booking_date,
 * status) table; reports unavailable when it is absent.
 */
export async function getBookingConversion({ centerId, windowDays = DEFAULT_SUMMARY_WINDOW_DAYS } = {}) {
  const columns = (await db
    .prepare(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'bookings'`
    )
    .all())
    .map((r) => r.column_name);

  if (columns.length === 0) {
    return { available: false, reason: 'Bookings feature is not installed' };
  }
  // center_id is required: a bookings table that cannot be tenant-scoped must
  // not be read at all, or one center's conversion would include another's.
  const required = ['student_id', 'booking_date', 'status', 'center_id'];
  if (!required.every((c) => columns.includes(c))) {
    return { available: false, reason: 'Bookings table has an unsupported schema' };
  }

  const today = getTodayInTimezone();
  const start = ymdDaysAgo(windowDays - 1);

  const bookings = await db
    .prepare('SELECT student_id, booking_date, status FROM bookings WHERE center_id = ?')
    .all(centerId);
  const confirmedPast = bookings.filter(
    (b) =>
      String(b.status || '').toLowerCase() === 'confirmed' &&
      b.booking_date >= start &&
      b.booking_date < today
  );

  const sessions = await allCheckIns(centerId);
  const visitKeys = new Set(
    sessions.map((s) => `${s.student_id}|${getDateInTimezone(s.check_in_time)}`)
  );
  const converted = confirmedPast.filter((b) =>
    visitKeys.has(`${b.student_id}|${b.booking_date}`)
  ).length;

  return {
    available: true,
    start_date: start,
    end_date: today,
    confirmed_bookings: confirmedPast.length,
    converted_bookings: converted,
    conversion_pct:
      confirmedPast.length > 0 ? Math.round((converted / confirmedPast.length) * 100) : null,
  };
}

/**
 * Weekday capacity (settings) minus average check-ins per weekday over the past
 * 28 days: "room for N more students on Tuesdays". Unavailable until a weekday
 * capacity is configured in Admin.
 */
export async function getCapacityHeadroom(centerId) {
  const capacityMap = await getWeekdayCapacity(centerId);
  const hasCapacity = WEEKDAYS.some((day) => Number.isFinite(Number(capacityMap[day])));
  if (!hasCapacity) {
    return { available: false, reason: 'No weekday capacity configured in Admin' };
  }

  const today = getTodayInTimezone();
  const dates = [];
  let cursor = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < CAPACITY_WINDOW_DAYS; i += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  const startDate = dates[dates.length - 1];

  const occurrences = {};
  for (const date of dates) {
    const wd = getWeekdayShortForDate(date);
    occurrences[wd] = (occurrences[wd] || 0) + 1;
  }

  const sessions = await allCheckIns(centerId);
  const checkinsByWeekday = {};
  for (const s of sessions) {
    const d = getDateInTimezone(s.check_in_time);
    if (d < startDate || d > today) continue;
    const wd = getWeekdayShortForDate(d);
    checkinsByWeekday[wd] = (checkinsByWeekday[wd] || 0) + 1;
  }

  const weekdays = WEEKDAYS.map((day) => {
    const occ = occurrences[day] || 0;
    const avg = occ > 0 ? Math.round(((checkinsByWeekday[day] || 0) / occ) * 10) / 10 : 0;
    const capacity = Number.isFinite(Number(capacityMap[day])) ? Number(capacityMap[day]) : null;
    return {
      weekday: day,
      capacity,
      avg_checkins: avg,
      headroom: capacity != null ? Math.max(0, capacity - Math.round(avg)) : null,
    };
  });

  return {
    available: true,
    window_days: CAPACITY_WINDOW_DAYS,
    weekdays,
  };
}

/** A metric that throws (e.g. optional table dropped mid-read) degrades to unavailable. */
async function safeMetric(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Insights metric "${name}" failed:`, err?.message || err);
    return { available: false, reason: 'Metric could not be computed' };
  }
}

export const AT_RISK_SUMMARY_LIMIT = 10;

export async function buildInsightsSummary({
  centerId,
  windowDays = DEFAULT_SUMMARY_WINDOW_DAYS,
  atRiskThreshold = DEFAULT_AT_RISK_THRESHOLD,
} = {}) {
  const [atRisk, regulars, staffEfficiency, bookingConversion, capacityHeadroom] =
    await Promise.all([
      safeMetric('at-risk', async () => {
        const students = await getAtRiskStudents({ centerId, threshold: atRiskThreshold });
        return {
          available: true,
          threshold_pct: Math.round(atRiskThreshold * 100),
          window_days: AT_RISK_WINDOW_DAYS,
          total: students.length,
          students: students.slice(0, AT_RISK_SUMMARY_LIMIT),
        };
      }),
      safeMetric('regulars', () => getRegularsBreakdown(centerId)),
      safeMetric('staff-efficiency', () => getStaffEfficiency({ centerId, windowDays })),
      safeMetric('booking-conversion', () => getBookingConversion({ centerId, windowDays })),
      safeMetric('capacity-headroom', () => getCapacityHeadroom(centerId)),
    ]);

  return {
    window_days: windowDays,
    start_date: ymdDaysAgo(windowDays - 1),
    end_date: getTodayInTimezone(),
    timezone: getCenterTimezone(),
    at_risk: atRisk,
    regulars,
    staff_efficiency: staffEfficiency,
    booking_conversion: bookingConversion,
    capacity_headroom: capacityHeadroom,
  };
}
