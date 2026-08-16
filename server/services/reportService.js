import ExcelJS from 'exceljs';
import db from '../db.js';
import {
  getCenterTimezone,
  getDateInTimezone,
  monthBounds,
  rollingAnnualBounds,
} from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import { allowanceForSubjects } from '../sessionRules.js';

/** Builds an XLSX workbook (single sheet) and returns it as a Buffer. */
async function rowsToXlsxBuffer(columns, rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  worksheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 }));
  for (const row of rows) worksheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

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

const ATTENDANCE_XLSX_COLUMNS = [
  { header: 'Student ID', key: 'id' },
  { header: 'First Name', key: 'first_name' },
  { header: 'Last Name', key: 'last_name' },
  { header: 'Name', key: 'name' },
  { header: 'Active', key: 'active' },
  { header: 'Visits', key: 'visits' },
  { header: 'Total Minutes', key: 'total_minutes' },
  { header: 'Overtime Count', key: 'overtime_count' },
];

export function attendanceReportToXlsx(report) {
  return rowsToXlsxBuffer(
    ATTENDANCE_XLSX_COLUMNS,
    report.students.map((row) => ({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      name: row.name,
      active: row.active ? 1 : 0,
      visits: row.visits,
      total_minutes: row.total_minutes,
      overtime_count: row.overtime_count,
    }))
  );
}

const PAYROLL_XLSX_COLUMNS = [
  { header: 'Staff ID', key: 'id' },
  { header: 'Name', key: 'name' },
  { header: 'Role', key: 'role' },
  { header: 'Shifts', key: 'shifts' },
  { header: 'Total Hours', key: 'total_hours' },
  { header: 'Hourly Rate', key: 'hourly_rate' },
  { header: 'Gross Pay', key: 'gross_pay' },
];

export function payrollReportToXlsx(report) {
  return rowsToXlsxBuffer(
    PAYROLL_XLSX_COLUMNS,
    report.staff.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role || '',
      shifts: row.shifts,
      total_hours: row.total_hours,
      hourly_rate: row.hourly_rate ?? '',
      gross_pay: row.gross_pay ?? '',
    }))
  );
}

/**
 * Documents the columns importRosterFromContent (server/rosterImport.js)
 * actually accepts: first/last name required, subjects/days/active/phone
 * optional. Used for the "download sample roster" links in Admin.
 */
const ROSTER_TEMPLATE_ROWS = [
  {
    'first name': 'Alex',
    'last name': 'Kim',
    subjects: 'both',
    days: 'Mon Wed Fri',
    active: 'true',
    phone: '+15551234567',
  },
  {
    'first name': 'Jordan',
    'last name': 'Lee',
    subjects: 'math',
    days: 'Tue Thu',
    active: 'true',
    phone: '',
  },
  {
    'first name': 'Sam',
    'last name': 'Patel',
    subjects: 'reading',
    days: '',
    active: 'true',
    phone: '',
  },
];

export function buildRosterTemplateCsv() {
  const header = ['first name', 'last name', 'subjects', 'days', 'active', 'phone'];
  const lines = [header.join(',')];
  for (const row of ROSTER_TEMPLATE_ROWS) {
    lines.push(header.map((key) => csvEscape(row[key])).join(','));
  }
  return lines.join('\n') + '\n';
}

export function buildRosterTemplateXlsx() {
  const columns = [
    { header: 'First Name', key: 'first name' },
    { header: 'Last Name', key: 'last name' },
    { header: 'Subjects', key: 'subjects' },
    { header: 'Days', key: 'days' },
    { header: 'Active', key: 'active' },
    { header: 'Phone', key: 'phone' },
  ];
  return rowsToXlsxBuffer(columns, ROSTER_TEMPLATE_ROWS);
}
