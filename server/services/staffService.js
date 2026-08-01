import db from '../db.js';
import { getCenterTimezone, getDateInTimezone } from '../timeService.js';
import { formatFullName } from '../utils/names.js';

export function serializeStaff(row, nowMs = Date.now()) {
  const onDuty = Boolean(row.open_shift_id);
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    name: formatFullName(row),
    role: row.role || null,
    hourly_rate: row.hourly_rate ?? null,
    active: row.active,
    on_duty: onDuty,
    open_shift: onDuty
      ? {
          id: row.open_shift_id,
          clock_in_time: row.open_clock_in,
          elapsed_minutes: Math.max(
            0,
            Math.round(((nowMs - new Date(row.open_clock_in).getTime()) / 60000) * 10) / 10
          ),
        }
      : null,
  };
}

/** Completed shifts grouped by staff member over [start, end] (center TZ dates). */
export async function buildPayrollReport({ centerId, start, end }) {
  const staffRows = await db
    .prepare('SELECT * FROM staff WHERE center_id = ? ORDER BY first_name ASC, last_name ASC')
    .all(centerId);
  const shifts = await db
    .prepare(
      `SELECT staff_id, clock_in_time, clock_out_time, duration_minutes
       FROM staff_sessions WHERE center_id = ? AND clock_out_time IS NOT NULL`
    )
    .all(centerId);

  const inRange = shifts.filter((s) => {
    const d = getDateInTimezone(s.clock_in_time);
    return d >= start && d <= end;
  });

  const byStaff = new Map();
  for (const shift of inRange) {
    if (!byStaff.has(shift.staff_id)) byStaff.set(shift.staff_id, []);
    byStaff.get(shift.staff_id).push(shift);
  }

  const rows = staffRows.map((staff) => {
    const own = byStaff.get(staff.id) || [];
    const totalMinutes = own.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    const rate = staff.hourly_rate ?? null;
    return {
      id: staff.id,
      name: formatFullName(staff),
      role: staff.role || null,
      active: Boolean(staff.active),
      shifts: own.length,
      total_minutes: Math.round(totalMinutes * 10) / 10,
      total_hours: totalHours,
      hourly_rate: rate,
      gross_pay: rate != null ? Math.round(totalHours * rate * 100) / 100 : null,
    };
  });

  return {
    start_date: start,
    end_date: end,
    timezone: getCenterTimezone(),
    staff: rows,
    summary: {
      staff_count: rows.length,
      total_shifts: rows.reduce((s, r) => s + r.shifts, 0),
      total_hours: Math.round(rows.reduce((s, r) => s + r.total_hours, 0) * 100) / 100,
      total_gross_pay:
        Math.round(rows.reduce((s, r) => s + (r.gross_pay || 0), 0) * 100) / 100,
    },
  };
}
