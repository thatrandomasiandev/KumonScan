import { Router } from 'express';
import db from '../db.js';
import {
  getCenterTimezone,
  getDateInTimezone,
  getTodayInTimezone,
  getWeekdayShortForDate,
  groupSessionsByDate,
  isWithinPastDays,
  monthBounds,
  parseScheduleDays,
} from '../timeService.js';
import { requireAdmin } from '../middleware/auth.js';
import { attendanceReportToPdf } from '../attendancePdf.js';
import { serializeStudent, getStudentStats } from '../services/studentService.js';
import {
  buildAttendanceReport,
  attendanceReportToCsv,
  payrollReportToCsv,
} from '../services/reportService.js';
import { buildPayrollReport } from '../services/staffService.js';
import { getWeekdayCapacity, WEEKDAYS } from '../services/capacityService.js';

const router = Router();

router.get('/dashboard', requireAdmin, async (req, res) => {
  const students = await db
    .prepare(
      `SELECT * FROM students
       WHERE center_id = ? AND active = 1 ORDER BY first_name ASC, last_name ASC`
    )
    .all(req.center.id);

  const enriched = await Promise.all(
    students.map(async (student) => {
      const stats = await getStudentStats(req.center.id, student.id);
      const studentSessions = (await db
        .prepare(
          `SELECT check_in_time FROM sessions
           WHERE center_id = ? AND student_id = ? ORDER BY check_in_time ASC`
        )
        .all(req.center.id, student.id))
        .filter((s) => isWithinPastDays(s.check_in_time, 30));

      const dailySessions = groupSessionsByDate(studentSessions);

      return { ...serializeStudent(student), stats, dailySessions };
    })
  );

  const today = getTodayInTimezone();
  const allTodaySessions = (await db
    .prepare('SELECT check_in_time FROM sessions WHERE center_id = ?')
    .all(req.center.id))
    .filter((s) => getDateInTimezone(s.check_in_time) === today);

  const activeNow = (await db
    .prepare(
      `SELECT COUNT(*) as count FROM sessions WHERE center_id = ? AND check_out_time IS NULL`
    )
    .get(req.center.id)).count;

  res.json({
    students: enriched,
    summary: {
      totalActiveStudents: students.length,
      totalSessionsToday: allTodaySessions.length,
      currentlyCheckedIn: activeNow,
    },
    timezone: getCenterTimezone(),
  });
});

/**
 * Attendance report: ?period=monthly|annual&month=YYYY-MM&format=json|csv|pdf
 * Annual = rolling 12 months ending in `month`.
 */
router.get('/reports/attendance', requireAdmin, async (req, res) => {
  const period = req.query.period === 'annual' ? 'annual' : 'monthly';
  const now = getTodayInTimezone();
  const month = req.query.month || now.slice(0, 7);
  const format =
    req.query.format === 'csv' ? 'csv' : req.query.format === 'pdf' ? 'pdf' : 'json';

  let report;
  try {
    report = await buildAttendanceReport({ centerId: req.center.id, period, month });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (format === 'csv') {
    const filename = `kumonscan-attendance-${period}-${month}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(attendanceReportToCsv(report));
  }

  if (format === 'pdf') {
    try {
      const pdf = await attendanceReportToPdf(report);
      const filename = `kumonscan-attendance-${period}-${month}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdf);
    } catch (err) {
      console.error('Attendance PDF error:', err);
      return res.status(500).json({ error: 'Failed to generate PDF' });
    }
  }

  res.json(report);
});

/**
 * Payroll hours: completed shifts grouped by staff member.
 * Query: ?start=YYYY-MM-DD&end=YYYY-MM-DD&format=json|csv
 * Defaults to the current calendar month in the center timezone.
 */
router.get('/reports/payroll', requireAdmin, async (req, res) => {
  const defaults = monthBounds(getTodayInTimezone().slice(0, 7));
  const start = req.query.start || defaults.start;
  const end = req.query.end || defaults.end;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' });
  }
  if (start > end) {
    return res.status(400).json({ error: 'start must be on or before end' });
  }

  const report = await buildPayrollReport({ centerId: req.center.id, start, end });

  if (req.query.format === 'csv') {
    const filename = `kumonscan-payroll-${start}-to-${end}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(payrollReportToCsv(report));
  }

  res.json(report);
});

/**
 * Weekday utilization over the past 28 days:
 * average check-ins per weekday vs scheduled students vs capacity.
 */
router.get('/reports/utilization', requireAdmin, async (req, res) => {
  const WINDOW_DAYS = 28;
  const today = getTodayInTimezone();

  const dates = [];
  let cursor = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  const startDate = dates[dates.length - 1];

  const occurrences = {};
  for (const date of dates) {
    const wd = getWeekdayShortForDate(date);
    occurrences[wd] = (occurrences[wd] || 0) + 1;
  }

  const sessions = await db
    .prepare('SELECT check_in_time FROM sessions WHERE center_id = ?')
    .all(req.center.id);
  const checkinsByWeekday = {};
  for (const s of sessions) {
    const d = getDateInTimezone(s.check_in_time);
    if (d < startDate || d > today) continue;
    const wd = getWeekdayShortForDate(d);
    checkinsByWeekday[wd] = (checkinsByWeekday[wd] || 0) + 1;
  }

  const capacityMap = await getWeekdayCapacity(req.center.id);
  const activeStudents = await db
    .prepare('SELECT schedule_days FROM students WHERE center_id = ? AND active = 1')
    .all(req.center.id);

  const weekdays = WEEKDAYS.map((day) => {
    const occ = occurrences[day] || 0;
    const total = checkinsByWeekday[day] || 0;
    const avg = occ > 0 ? Math.round((total / occ) * 10) / 10 : 0;
    const expected = activeStudents.filter((s) =>
      parseScheduleDays(s.schedule_days).includes(day)
    ).length;
    const capacity = Number.isFinite(Number(capacityMap[day]))
      ? Number(capacityMap[day])
      : null;
    return {
      weekday: day,
      occurrences: occ,
      total_checkins: total,
      avg_checkins: avg,
      expected,
      capacity,
      utilization_pct:
        capacity && capacity > 0 ? Math.round((avg / capacity) * 100) : null,
    };
  });

  res.json({
    window_days: WINDOW_DAYS,
    start_date: startDate,
    end_date: today,
    timezone: getCenterTimezone(),
    weekdays,
  });
});

export default router;
