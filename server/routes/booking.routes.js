import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { getTodayInTimezone, getCenterTimezone } from '../timeService.js';
import {
  BookingError,
  listBookingsForDate,
} from '../services/bookingService.js';

/**
 * Staff admin bookings view. Public parent self-scheduling endpoints were removed.
 */
const router = Router();

function handleBookingError(res, err, context) {
  if (err instanceof BookingError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`${context} error:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

/** Staff view of who is expected from bookings, alongside the absent list. */
router.get('/admin/bookings', requireAdmin, async (req, res) => {
  try {
    const date =
      typeof req.query.date === 'string' && req.query.date
        ? req.query.date
        : getTodayInTimezone();
    res.json({
      ...(await listBookingsForDate(req.center.id, date)),
      timezone: getCenterTimezone(),
    });
  } catch (err) {
    handleBookingError(res, err, 'List bookings');
  }
});

export default router;
