import { Router } from 'express';
import db, { isUniqueViolation, sqlNow } from '../db.js';
import { calculateDurationMinutes } from '../timeService.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import { formatFullName, normalizeName, validateNameField } from '../utils/names.js';
import { serializeStaff } from '../services/staffService.js';
import { generateTempPassword, hashPassword } from '../utils/passwords.js';
import { getAuthoritativeTimeOr503 } from './shared.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = Router();

router.get('/staff', requireAdmin, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT s.*, ss.id AS open_shift_id, ss.clock_in_time AS open_clock_in
       FROM staff s
       LEFT JOIN staff_sessions ss
         ON ss.staff_id = s.id AND ss.center_id = s.center_id AND ss.clock_out_time IS NULL
       WHERE s.center_id = ?
       ORDER BY s.active DESC, s.first_name ASC, s.last_name ASC`
    )
    .all(req.center.id);

  const nowMs = Date.now();
  res.json({
    staff: rows.map((row) => serializeStaff(row, nowMs)),
    on_duty_count: rows.filter((r) => r.open_shift_id).length,
  });
});

router.post('/staff', requireAdmin, requireRole('manager'), async (req, res) => {
  const firstNameError = validateNameField(req.body?.first_name, 'First name');
  if (firstNameError) return res.status(400).json({ error: firstNameError });

  const lastNameError = validateNameField(req.body?.last_name, 'Last name');
  if (lastNameError) return res.status(400).json({ error: lastNameError });

  const { first_name, last_name } = normalizeName(req.body.first_name, req.body.last_name);

  const role = typeof req.body?.role === 'string' && req.body.role.trim()
    ? req.body.role.trim()
    : null;

  let hourlyRate = null;
  if (req.body?.hourly_rate != null && req.body.hourly_rate !== '') {
    hourlyRate = Number(req.body.hourly_rate);
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
      return res.status(400).json({ error: 'hourly_rate must be a non-negative number' });
    }
  }

  try {
    const result = await db
      .prepare(
        `INSERT INTO staff (center_id, first_name, last_name, role, hourly_rate, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(req.center.id, first_name, last_name, role, hourlyRate, sqlNow());

    const staff = await db
      .prepare('SELECT * FROM staff WHERE id = ? AND center_id = ?')
      .get(result.lastInsertRowid, req.center.id);
    res.status(201).json(serializeStaff(staff));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'A staff member with that name already exists' });
    }
    console.error('Create staff error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/staff/:id', requireAdmin, requireRole('manager'), async (req, res) => {
  const staff = await db
    .prepare('SELECT * FROM staff WHERE id = ? AND center_id = ?')
    .get(req.params.id, req.center.id);
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });

  const updates = [];
  const values = [];

  if (req.body.role !== undefined) {
    const role = req.body.role;
    if (role !== null && typeof role !== 'string') {
      return res.status(400).json({ error: 'role must be a string or null' });
    }
    updates.push('role = ?');
    values.push(role == null || role.trim() === '' ? null : role.trim());
  }

  if (req.body.permission_role !== undefined) {
    if (req.body.permission_role !== 'manager' && req.body.permission_role !== 'front_desk') {
      return res.status(400).json({ error: "permission_role must be 'manager' or 'front_desk'" });
    }
    updates.push('permission_role = ?');
    values.push(req.body.permission_role);
  }

  if (req.body.hourly_rate !== undefined) {
    if (req.body.hourly_rate === null || req.body.hourly_rate === '') {
      updates.push('hourly_rate = ?');
      values.push(null);
    } else {
      const rate = Number(req.body.hourly_rate);
      if (!Number.isFinite(rate) || rate < 0) {
        return res.status(400).json({ error: 'hourly_rate must be a non-negative number' });
      }
      updates.push('hourly_rate = ?');
      values.push(rate);
    }
  }

  if (req.body.active !== undefined) {
    updates.push('active = ?');
    values.push(req.body.active ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(staff.id, req.center.id);
  await db
    .prepare(`UPDATE staff SET ${updates.join(', ')} WHERE id = ? AND center_id = ?`)
    .run(...values);

  const updated = await db
    .prepare('SELECT * FROM staff WHERE id = ? AND center_id = ?')
    .get(staff.id, req.center.id);
  res.json(serializeStaff(updated));
});

/**
 * Create (or replace) an individual login for a staff member: sets their
 * email and a fresh one-time temporary password. The password is returned
 * exactly once in this response — like the shared center password, it's
 * relayed to the staff member directly by the manager, not emailed (this
 * deployment has no outbound-email infrastructure). must_change_password
 * forces a password-set screen on their first successful login.
 */
router.post('/staff/:id/login', requireAdmin, requireRole('manager'), async (req, res) => {
  const staff = await db
    .prepare('SELECT * FROM staff WHERE id = ? AND center_id = ?')
    .get(req.params.id, req.center.id);
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  const tempPassword = generateTempPassword();

  try {
    await db
      .prepare(
        `UPDATE staff SET email = ?, password_hash = ?, must_change_password = 1
         WHERE id = ? AND center_id = ?`
      )
      .run(email, hashPassword(tempPassword), staff.id, req.center.id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Another staff member already uses that email' });
    }
    console.error('Create staff login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  res.status(201).json({ email, temp_password: tempPassword });
});

/** Manager-issued password reset — same one-time-temp-password pattern as creating a login. */
router.post('/staff/:id/reset-password', requireAdmin, requireRole('manager'), async (req, res) => {
  const staff = await db
    .prepare('SELECT * FROM staff WHERE id = ? AND center_id = ?')
    .get(req.params.id, req.center.id);
  if (!staff) return res.status(404).json({ error: 'Staff member not found' });
  if (!staff.email) {
    return res.status(400).json({ error: 'This staff member has no login to reset' });
  }

  const tempPassword = generateTempPassword();
  await db
    .prepare(
      `UPDATE staff SET password_hash = ?, must_change_password = 1
       WHERE id = ? AND center_id = ?`
    )
    .run(hashPassword(tempPassword), staff.id, req.center.id);

  res.json({ email: staff.email, temp_password: tempPassword });
});

router.post('/staff/:id/clock-in', requireAdmin, async (req, res) => {
  try {
    const staff = await db
      .prepare('SELECT * FROM staff WHERE id = ? AND center_id = ? AND active = 1')
      .get(req.params.id, req.center.id);
    if (!staff) return res.status(404).json({ error: 'Staff member not found or inactive' });

    const authoritativeTime = await getAuthoritativeTimeOr503(res);
    if (!authoritativeTime) return;

    const open = await db
      .prepare(
        `SELECT * FROM staff_sessions
         WHERE center_id = ? AND staff_id = ? AND clock_out_time IS NULL`
      )
      .get(req.center.id, staff.id);
    if (open) {
      return res.status(409).json({ error: 'Already clocked in', shift: open });
    }

    const result = await db
      .prepare('INSERT INTO staff_sessions (center_id, staff_id, clock_in_time) VALUES (?, ?, ?)')
      .run(req.center.id, staff.id, authoritativeTime.iso);

    const shift = await db
      .prepare('SELECT * FROM staff_sessions WHERE id = ? AND center_id = ?')
      .get(result.lastInsertRowid, req.center.id);

    res.status(201).json({
      action: 'clocked_in',
      staff: { id: staff.id, name: formatFullName(staff) },
      shift,
      timestamp: authoritativeTime.iso,
      timezone: authoritativeTime.timezone,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Already clocked in' });
    }
    console.error('Staff clock-in error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/staff/:id/clock-out', requireAdmin, async (req, res) => {
  try {
    const staff = await db
      .prepare('SELECT * FROM staff WHERE id = ? AND center_id = ?')
      .get(req.params.id, req.center.id);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });

    const authoritativeTime = await getAuthoritativeTimeOr503(res);
    if (!authoritativeTime) return;

    const open = await db
      .prepare(
        `SELECT * FROM staff_sessions
         WHERE center_id = ? AND staff_id = ? AND clock_out_time IS NULL`
      )
      .get(req.center.id, staff.id);
    if (!open) return res.status(404).json({ error: 'No open shift to clock out' });

    const duration = calculateDurationMinutes(open.clock_in_time, authoritativeTime.iso);
    await db
      .prepare(
        `UPDATE staff_sessions SET clock_out_time = ?, duration_minutes = ?
         WHERE id = ? AND center_id = ?`
      )
      .run(authoritativeTime.iso, duration, open.id, req.center.id);

    const shift = await db
      .prepare('SELECT * FROM staff_sessions WHERE id = ? AND center_id = ?')
      .get(open.id, req.center.id);

    res.json({
      action: 'clocked_out',
      staff: { id: staff.id, name: formatFullName(staff) },
      shift,
      timestamp: authoritativeTime.iso,
      timezone: authoritativeTime.timezone,
    });
  } catch (err) {
    console.error('Staff clock-out error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
