import { useEffect, useMemo, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  ButtonBase,
  Paper,
  Skeleton,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { getCenterSlug } from '../api';
import { md3Colors, getElevatedSurface, shape } from '../theme';

const DAYS_SHOWN = 14;

const SUBJECT_OPTIONS = [
  { value: 'math', label: 'Math' },
  { value: 'reading', label: 'Reading' },
  { value: 'both', label: 'Both' },
];

async function bookingRequest(path, options = {}) {
  const response = await fetch(`/api/c/${getCenterSlug()}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

/** Next N calendar days with pre-built labels (avoids YYYY-MM-DD reparsing). */
function buildUpcomingDays() {
  const days = [];
  for (let n = 1; n <= DAYS_SHOWN; n += 1) {
    const dateObj = new Date(Date.now() + n * 86_400_000);
    days.push({
      date: dateObj.toLocaleDateString('en-CA'),
      weekdayLabel: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
      dayLabel: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    });
  }
  return days;
}

/** "Wed, Aug 5" from a YYYY-MM-DD date (UTC parse avoids off-by-one). */
function formatBookingDate(dateYmd) {
  return new Date(`${dateYmd}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function remainingLabel(availability) {
  if (!availability) return '—';
  if (availability.remaining == null) return 'Open';
  if (availability.remaining <= 0) return 'Full';
  return `${availability.remaining} left`;
}

function DayButton({ day, availability, selected, onSelect }) {
  const full = availability?.remaining === 0;

  return (
    <ButtonBase
      onClick={() => onSelect(day.date)}
      disabled={full || !availability}
      aria-label={`${day.weekdayLabel} ${day.dayLabel}, ${remainingLabel(availability)}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        minHeight: 76,
        borderRadius: `${shape.medium}px`,
        border: `1px solid ${selected ? md3Colors.primary : md3Colors.outlineVariant}`,
        bgcolor: selected
          ? md3Colors.primaryContainer
          : full
            ? md3Colors.surfaceVariant
            : md3Colors.surfaceBright,
        color: selected ? md3Colors.onPrimaryContainer : md3Colors.onSurface,
        opacity: full ? 0.6 : 1,
        px: 1,
        py: 1.25,
        transition: 'background-color 100ms, border-color 100ms',
      }}
    >
      <Typography variant="labelLarge" component="span">
        {day.weekdayLabel}
      </Typography>
      <Typography variant="bodyMedium" component="span">
        {day.dayLabel}
      </Typography>
      <Typography
        variant="bodySmall"
        component="span"
        sx={{
          color: full
            ? md3Colors.error
            : selected
              ? md3Colors.onPrimaryContainer
              : md3Colors.onSurfaceVariant,
        }}
      >
        {remainingLabel(availability)}
      </Typography>
    </ButtonBase>
  );
}

function BookingConfirmation({ booking, phone, onCancelled, onReset }) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const cancelled = booking.status === 'cancelled';

  async function handleCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const data = await bookingRequest(
        `/booking/${booking.id}?phone=${encodeURIComponent(phone)}`,
        { method: 'DELETE' }
      );
      onCancelled(data.booking);
    } catch (err) {
      setCancelError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Paper
      elevation={0}
      className="cross-fade"
      sx={{
        maxWidth: 440,
        width: '100%',
        mx: 'auto',
        p: 3,
        borderRadius: `${shape.extraLarge}px`,
        bgcolor: getElevatedSurface(1),
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
          p: 2,
          borderRadius: `${shape.small}px`,
          bgcolor: cancelled ? md3Colors.errorContainer : md3Colors.successContainer,
          mb: 3,
        }}
      >
        <CheckCircleOutlinedIcon
          sx={{ color: cancelled ? md3Colors.error : md3Colors.success, mt: 0.25 }}
        />
        <Box>
          <Typography variant="titleSmall" component="p">
            {cancelled ? 'Booking cancelled' : 'Visit booked!'}
          </Typography>
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mt: 0.5 }}>
            Reference #{booking.id}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', rowGap: 1.5, mb: 3 }}>
        {[
          ['Day', formatBookingDate(booking.booking_date)],
          ['Name', booking.requester_name],
          ['Subjects', SUBJECT_OPTIONS.find((s) => s.value === booking.subjects)?.label || 'Both'],
        ].map(([label, value]) => (
          <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
              {label}
            </Typography>
            <Typography variant="bodyMedium" sx={{ textAlign: 'right' }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>

      {!cancelled && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.5,
            p: 2,
            borderRadius: `${shape.small}px`,
            bgcolor: md3Colors.surfaceVariant,
            mb: 3,
          }}
        >
          <InfoOutlinedIcon sx={{ color: md3Colors.primary, mt: 0.25 }} />
          <Typography variant="bodyMedium">
            A booking reserves space for the day, not a check-in. Staff will check the
            student in at the front desk when you arrive.
          </Typography>
        </Box>
      )}

      {cancelError && (
        <Typography variant="bodySmall" sx={{ color: md3Colors.error, mb: 2 }}>
          {cancelError}
        </Typography>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {!cancelled && (
          <Button
            variant="outlined"
            fullWidth
            onClick={handleCancel}
            disabled={cancelling}
            sx={{ minHeight: 48, color: md3Colors.error, borderColor: md3Colors.error }}
          >
            {cancelling ? 'Cancelling...' : 'Cancel This Booking'}
          </Button>
        )}
        <Button variant="text" fullWidth onClick={onReset} sx={{ minHeight: 48 }}>
          Book Another Day
        </Button>
      </Box>
    </Paper>
  );
}

export default function BookingPage() {
  const days = useMemo(buildUpcomingDays, []);
  const [availability, setAvailability] = useState({});
  const [loadingDays, setLoadingDays] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [subjects, setSubjects] = useState('both');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAvailability() {
      setLoadingDays(true);
      const results = await Promise.allSettled(
        days.map((day) =>
          bookingRequest(`/booking/availability?date=${encodeURIComponent(day.date)}`)
        )
      );
      if (cancelled) return;

      const map = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          map[days[index].date] = result.value;
        }
      });
      setAvailability(map);
      setLoadingDays(false);
    }

    loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [days, booking]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedDate) {
      setError('Pick a day first');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const data = await bookingRequest('/booking', {
        method: 'POST',
        body: JSON.stringify({
          requester_name: name,
          requester_phone: phone,
          booking_date: selectedDate,
          subjects,
        }),
      });
      setBooking(data.booking);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setBooking(null);
    setSelectedDate(null);
    setError(null);
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: md3Colors.background,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AppBar
        position="sticky"
        elevation={0}
        sx={{ bgcolor: getElevatedSurface(2), color: md3Colors.onSurface }}
      >
        <Toolbar sx={{ maxWidth: 480, mx: 'auto', width: '100%', justifyContent: 'center' }}>
          <Typography variant="titleLarge">Book a Visit</Typography>
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          px: 2,
          py: 4,
        }}
      >
        {booking ? (
          <BookingConfirmation
            booking={booking}
            phone={phone}
            onCancelled={setBooking}
            onReset={handleReset}
          />
        ) : (
          <Paper
            elevation={0}
            sx={{
              maxWidth: 440,
              width: '100%',
              p: 3,
              borderRadius: `${shape.extraLarge}px`,
              bgcolor: getElevatedSurface(1),
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                bgcolor: md3Colors.primaryContainer,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 3,
              }}
            >
              <EventAvailableOutlinedIcon sx={{ fontSize: 40, color: md3Colors.primary }} />
            </Box>

            <Typography variant="displaySmall" sx={{ textAlign: 'center', mb: 1 }}>
              Reserve a Visit Day
            </Typography>
            <Typography
              variant="bodyMedium"
              sx={{ textAlign: 'center', color: md3Colors.onSurfaceVariant, mb: 3 }}
            >
              Pick an open day, leave your name and phone number, and staff will expect you.
              No account needed.
            </Typography>

            <Box component="form" onSubmit={handleSubmit}>
              <Typography variant="labelLarge" component="p" sx={{ mb: 1 }}>
                1. Pick a day
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
                  gap: 1,
                  mb: 3,
                }}
              >
                {loadingDays
                  ? Array.from({ length: DAYS_SHOWN }, (_, i) => (
                      <Skeleton
                        key={i}
                        variant="rounded"
                        height={76}
                        sx={{ borderRadius: `${shape.medium}px` }}
                      />
                    ))
                  : days.map((day) => (
                      <DayButton
                        key={day.date}
                        day={day}
                        availability={availability[day.date]}
                        selected={selectedDate === day.date}
                        onSelect={setSelectedDate}
                      />
                    ))}
              </Box>

              <Typography variant="labelLarge" component="p" sx={{ mb: 1 }}>
                2. Who is visiting?
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
                <TextField
                  id="booking-name"
                  label="Student or Family Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  fullWidth
                />
                <TextField
                  id="booking-phone"
                  label="Phone Number"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  helperText="Used only to confirm or cancel this booking"
                  required
                  fullWidth
                />
              </Box>

              <Typography variant="labelLarge" component="p" sx={{ mb: 1 }}>
                3. Subjects
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, mb: 3 }}>
                {SUBJECT_OPTIONS.map((option) => {
                  const active = subjects === option.value;
                  return (
                    <Button
                      key={option.value}
                      onClick={() => setSubjects(option.value)}
                      variant={active ? 'contained' : 'outlined'}
                      aria-pressed={active}
                      sx={{
                        minHeight: 48,
                        ...(active
                          ? {
                              bgcolor: md3Colors.primaryContainer,
                              color: md3Colors.onPrimaryContainer,
                              '&:hover': { bgcolor: md3Colors.primaryContainer },
                            }
                          : { color: md3Colors.onSurfaceVariant }),
                      }}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </Box>

              {error && (
                <Typography variant="bodySmall" sx={{ color: md3Colors.error, mb: 2 }}>
                  {error}
                </Typography>
              )}

              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={submitting || !selectedDate}
                sx={{ minHeight: 48 }}
              >
                {submitting ? 'Booking...' : 'Confirm Booking'}
              </Button>
            </Box>
          </Paper>
        )}
      </Box>
    </Box>
  );
}
