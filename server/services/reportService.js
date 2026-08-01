import db from '../db.js';
import {
  getCenterTimezone,
  getDateInTimezone,
  monthBounds,
  rollingAnnualBounds,
} from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import { allowanceForSubjects } from '../sessionRules.js';

export function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function buildAttendanceReport({ centerId, period, month }) {
  const bounds =
    period === 'annual' ? rollingAnnualBounds(month) : monthBounds(month);

  const students = await db
    .prepare('SELECT * FROM students WHERE center_id = ? ORDER BY first_name ASC, last_name ASC')
    .all(centerId);

  const rows = await Promise.all(
    students.map(async (student) => {
      const sessions = (await db
        .prepare(
          `SELECT check_in_time, duration_minutes, subjects, allowance_minutes, mode
           FROM sessions
           WHERE center_id = ? AND student_id = ? AND check_out_time IS NOT NULL`
        )
        .all(centerId, student.id))
        .filter((s) => {
          const d = getDateInTimezone(s.check_in_time);
          return d >= bounds.start && d <= bounds.end;
        });

      const visits = sessions.length;
      // agent-4-hybrid-attendance: additive remote/in-person breakout;
      // rows predating the mode column count as in-person.
      const remoteVisits = sessions.filter((s) => s.mode === 'remote').length;
      const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
      const overtimeCount = sessions.filter((s) => {
        const allowance = s.allowance_minutes ?? allowanceForSubjects(s.subjects || 'both');
        return (s.duration_minutes || 0) > allowance;
      }).length;

      return {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        name: formatFullName(student),
        active: Boolean(student.active),
        visits,
        remote_visits: remoteVisits,
        in_person_visits: visits - remoteVisits,
        total_minutes: Math.round(totalMinutes * 10) / 10,
        overtime_count: overtimeCount,
      };
    })
  );

  return {
    period,
    month,
    start_date: bounds.start,
    end_date: bounds.end,
    timezone: getCenterTimezone(),
    students: rows,
    summary: {
      student_count: rows.length,
      total_visits: rows.reduce((s, r) => s + r.visits, 0),
      remote_visits: rows.reduce((s, r) => s + r.remote_visits, 0),
      in_person_visits: rows.reduce((s, r) => s + r.in_person_visits, 0),
      total_minutes: Math.round(rows.reduce((s, r) => s + r.total_minutes, 0) * 10) / 10,
      overtime_sessions: rows.reduce((s, r) => s + r.overtime_count, 0),
    },
  };
}

export function attendanceReportToCsv(report) {
  const header = [
    'student_id',
    'first_name',
    'last_name',
    'name',
    'active',
    'visits',
    'total_minutes',
    'overtime_count',
  ];
  const lines = [header.join(',')];
  for (const row of report.students) {
    lines.push(
      [
        row.id,
        csvEscape(row.first_name),
        csvEscape(row.last_name),
        csvEscape(row.name),
        row.active ? 1 : 0,
        row.visits,
        row.total_minutes,
        row.overtime_count,
      ].join(',')
    );
  }
  return lines.join('\n') + '\n';
}

export function payrollReportToCsv(report) {
  const header = ['staff_id', 'name', 'role', 'shifts', 'total_hours', 'hourly_rate', 'gross_pay'];
  const lines = [header.join(',')];
  for (const row of report.staff) {
    lines.push(
      [
        row.id,
        csvEscape(row.name),
        csvEscape(row.role || ''),
        row.shifts,
        row.total_hours,
        row.hourly_rate ?? '',
        row.gross_pay ?? '',
      ].join(',')
    );
  }
  return lines.join('\n') + '\n';
}
