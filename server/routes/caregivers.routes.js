import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  getCenterTimezone,
  getDateInTimezone,
  getTodayInTimezone,
} from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import {
  createCaregiver,
  getPickupLogRows,
  listCaregivers,
  updateCaregiver,
} from '../services/caregiverService.js';

/**
 * Caregiver registry + pickup log. All routes are staff-only: caregiver lists
 * are pickup-safety data and must never be readable from the unauthenticated
 * kiosk surface.
 */

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PICKUP_LOG_DEFAULT_DAYS = 30;

function sendServiceError(res, err) {
  if (err?.status) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

router.get('/students/:id/caregivers', requireAdmin, async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === '1';
    const caregivers = await listCaregivers(req.center.id, req.params.id, { includeInactive });
    res.json({ caregivers, count: caregivers.length });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('List caregivers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/students/:id/caregivers', requireAdmin, async (req, res) => {
  try {
    const caregiver = await createCaregiver(req.center.id, req.params.id, {
      name: req.body?.name,
      phone: req.body?.phone,
      relationship: req.body?.relationship,
      is_primary: req.body?.is_primary,
    });
    res.status(201).json(caregiver);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('Create caregiver error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/students/:id/caregivers/:caregiverId', requireAdmin, async (req, res) => {
  try {
    const caregiver = await updateCaregiver(
      req.center.id,
      req.params.id,
      req.params.caregiverId,
      {
        name: req.body?.name,
        phone: req.body?.phone,
        relationship: req.body?.relationship,
        is_primary: req.body?.is_primary,
        active: req.body?.active,
      }
    );
    res.json(caregiver);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('Update caregiver error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Who picked up which student, per completed session, for a date range.
 * Query: ?start=YYYY-MM-DD&end=YYYY-MM-DD (defaults: end = center today,
 * start = 30 days before end, matching the dashboard's 30-day window).
 */
router.get('/reports/pickup-log', requireAdmin, async (req, res) => {
  try {
    const end = req.query.end || getTodayInTimezone();
    if (!DATE_RE.test(end)) {
      return res.status(400).json({ error: 'end must be YYYY-MM-DD' });
    }

    let start = req.query.start;
    if (start == null || start === '') {
      const endMs = new Date(`${end}T00:00:00Z`).getTime();
      start = new Date(endMs - PICKUP_LOG_DEFAULT_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    if (!DATE_RE.test(start)) {
      return res.status(400).json({ error: 'start must be YYYY-MM-DD' });
    }
    if (start > end) {
      return res.status(400).json({ error: 'start must be on or before end' });
    }

    const rows = (await getPickupLogRows(req.center.id)).filter((row) => {
      const date = getDateInTimezone(row.check_out_time);
      return date >= start && date <= end;
    });

    const pickups = rows.map((row) => ({
      session_id: row.session_id,
      student_id: row.student_id,
      student_name: formatFullName(row),
      caregiver_id: row.caregiver_id,
      caregiver_name: row.caregiver_name,
      caregiver_relationship: row.caregiver_relationship,
      caregiver_phone: row.caregiver_phone,
      caregiver_active: Boolean(row.caregiver_active),
      check_in_time: row.check_in_time,
      check_out_time: row.check_out_time,
      subjects: row.subjects,
    }));

    res.json({
      start,
      end,
      timezone: getCenterTimezone(),
      pickups,
      count: pickups.length,
    });
  } catch (err) {
    console.error('Pickup log error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
