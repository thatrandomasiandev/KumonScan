import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAdmin } from '../middleware/auth.js';
import { getTodayInTimezone, getCenterTimezone } from '../timeService.js';
import {
  BookingError,
  cancelBooking,
  createBooking,
  getAvailability,
  listBookingsForDate,
} from '../services/bookingService.js';

/**
 * Parent self-scheduling. Everything except /admin/bookings is public and
 * reachable without a staff login, so every input is validated server-side
 * and writes are rate-limited (same pattern as /register). Center scope
 * comes from the path middleware (req.center.id).
 */
const router = Router();

const bookingWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking requests. Please try again in a minute.' },
});

const availabilityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many availability checks. Please try again in a minute.' },
});

function handleBookingError(res, err, context) {
  if (err instanceof BookingError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`${context} error:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/booking/availability', availabilityLimiter, async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    res.json(await getAvailability(req.center.id, date));
  } catch (err) {
    handleBookingError(res, err, 'Booking availability');
  }
});

router.post('/booking', bookingWriteLimiter, async (req, res) => {
  try {
    const booking = await createBooking(req.center.id, {
      requester_name: req.body?.requester_name,
      requester_phone: req.body?.requester_phone,
      booking_date: req.body?.booking_date,
      subjects: req.body?.subjects,
      student_id: req.body?.student_id,
    });
    res.status(201).json({ booking, timezone: getCenterTimezone() });
  } catch (err) {
    handleBookingError(res, err, 'Create booking');
  }
});

/**
 * Cancellation requires the phone number that created the booking
 * (?phone=...). Casual ownership protection, not real auth.
 */
router.delete('/booking/:id', bookingWriteLimiter, async (req, res) => {
  try {
    const booking = await cancelBooking(req.center.id, req.params.id, req.query.phone);
    res.json({ booking });
  } catch (err) {
    handleBookingError(res, err, 'Cancel booking');
  }
});

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
