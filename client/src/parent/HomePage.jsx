import { useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  Toolbar,
  Typography,
} from '@mui/material';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import { parentApi } from './parentApi';
import { useParentSession } from './ParentApp';
import { formatDate, formatDuration } from '../api';
import { md3Colors, getElevatedSurface, shape } from '../theme';

const VISIBLE_SESSIONS = 15;

function formatClock(iso, timezone) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: timezone || 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function SectionCard({ icon, title, children }) {
  return (
    <Paper
      elevation={0}
      component="section"
      sx={{
        p: 2.5,
        borderRadius: `${shape.extraLarge}px`,
        bgcolor: getElevatedSurface(1),
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            bgcolor: md3Colors.primaryContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Typography variant="titleMedium" component="h2">
          {title}
        </Typography>
      </Box>
      {children}
    </Paper>
  );
}

function EmptyRow({ label }) {
  return (
    <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
      {label}
    </Typography>
  );
}

function StatStrip({ stats }) {
  const items = [
    { label: 'This week', value: stats.visitsThisWeek },
    { label: 'Total visits', value: stats.totalVisits },
    { label: 'Avg visit', value: formatDuration(stats.avgDurationMinutes) },
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        bgcolor: md3Colors.primaryContainer,
        borderRadius: `${shape.large}px`,
        py: 1.5,
        mb: 2,
      }}
    >
      {items.map((item, index) => (
        <Box
          key={item.label}
          sx={{
            textAlign: 'center',
            px: 1,
            borderLeft: index > 0 ? `1px solid ${md3Colors.outlineVariant}` : 'none',
          }}
        >
          <Typography variant="titleLarge" sx={{ color: md3Colors.onPrimaryContainer }}>
            {item.value}
          </Typography>
          <Typography variant="bodySmall" sx={{ color: md3Colors.onPrimaryContainer }}>
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function AttendanceSection() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  async function load() {
    setState({ loading: true, error: null, data: null });
    try {
      const data = await parentApi.getAttendance();
      setState({ loading: false, error: null, data });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (state.loading) {
    return (
      <SectionCard
        icon={<HistoryOutlinedIcon sx={{ color: md3Colors.primary }} />}
        title="Attendance"
      >
        <Skeleton variant="rounded" height={72} sx={{ mb: 2, borderRadius: `${shape.large}px` }} />
        <Skeleton variant="rounded" height={48} sx={{ mb: 1 }} />
        <Skeleton variant="rounded" height={48} />
      </SectionCard>
    );
  }

  if (state.error) {
    return (
      <SectionCard
        icon={<HistoryOutlinedIcon sx={{ color: md3Colors.primary }} />}
        title="Attendance"
      >
        <Typography variant="bodyMedium" sx={{ color: md3Colors.error, mb: 2 }}>
          {state.error}
        </Typography>
        <Button variant="outlined" onClick={load} sx={{ minHeight: 44 }}>
          Try again
        </Button>
      </SectionCard>
    );
  }

  const { sessions, stats, timezone } = state.data;
  const visible = sessions.slice(0, VISIBLE_SESSIONS);

  return (
    <SectionCard
      icon={<HistoryOutlinedIcon sx={{ color: md3Colors.primary }} />}
      title="Attendance"
    >
      {stats.isCheckedIn && (
        <Chip
          label="At the center now"
          sx={{
            bgcolor: md3Colors.successContainer,
            color: md3Colors.success,
            fontWeight: 500,
            mb: 2,
          }}
        />
      )}

      <StatStrip stats={stats} />

      {visible.length === 0 ? (
        <EmptyRow label="No visits recorded yet." />
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {visible.map((session, index) => (
            <Box component="li" key={session.id}>
              {index > 0 && <Divider sx={{ borderColor: md3Colors.outlineVariant }} />}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  py: 1.5,
                  minHeight: 44,
                }}
              >
                <Box>
                  <Typography variant="bodyMedium">
                    {formatDate(session.check_in_time, timezone)}
                  </Typography>
                  <Typography
                    variant="bodySmall"
                    sx={{ color: md3Colors.onSurfaceVariant, fontFamily: '"Roboto Mono", monospace' }}
                  >
                    {formatClock(session.check_in_time, timezone)}
                    {' – '}
                    {session.check_out_time
                      ? formatClock(session.check_out_time, timezone)
                      : 'in progress'}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                  <Typography variant="labelLarge" component="p">
                    {session.check_out_time ? formatDuration(session.duration_minutes) : '·'}
                  </Typography>
                  <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                    {session.subjects_label}
                  </Typography>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {sessions.length > VISIBLE_SESSIONS && (
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mt: 1 }}>
          Showing the {VISIBLE_SESSIONS} most recent visits.
        </Typography>
      )}
    </SectionCard>
  );
}

/**
 * Optional sections: their backing features may not exist on this server
 * yet. The API answers NOT_AVAILABLE in that case and the section renders
 * nothing at all.
 */
function useOptionalSection(section) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    parentApi
      .getSection(section)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setResult({ available: false, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  return result;
}

function formatWhen(value) {
  // Date-only values (YYYY-MM-DD) must not shift across timezones.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return formatDate(value);
}

function bookingWhen(booking) {
  const when = booking.booking_date || booking.date || booking.start_time;
  if (!when) return 'Scheduled';
  const label = formatWhen(when);
  const time = booking.start_time && booking.start_time !== when
    ? ` · ${booking.start_time}`
    : '';
  return `${label}${time}`;
}

function BookingsSection() {
  const result = useOptionalSection('bookings');
  if (!result?.available) return null;

  const bookings = result.data.bookings;

  return (
    <SectionCard
      icon={<EventAvailableOutlinedIcon sx={{ color: md3Colors.primary }} />}
      title="Bookings"
    >
      {bookings.length === 0 ? (
        <EmptyRow label="No bookings yet." />
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {bookings.map((booking, index) => (
            <Box component="li" key={booking.id ?? index}>
              {index > 0 && <Divider sx={{ borderColor: md3Colors.outlineVariant }} />}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  py: 1.5,
                  minHeight: 44,
                }}
              >
                <Box>
                  <Typography variant="bodyMedium">{bookingWhen(booking)}</Typography>
                  {booking.notes && (
                    <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                      {booking.notes}
                    </Typography>
                  )}
                </Box>
                {booking.status && (
                  <Chip
                    size="small"
                    label={booking.status}
                    sx={{ bgcolor: md3Colors.surfaceVariant, color: md3Colors.onSurfaceVariant }}
                  />
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SectionCard>
  );
}

function MessagesSection() {
  const result = useOptionalSection('messages');
  if (!result?.available) return null;

  const messages = result.data.messages.slice(0, 20);

  return (
    <SectionCard
      icon={<ForumOutlinedIcon sx={{ color: md3Colors.primary }} />}
      title="Messages"
    >
      {messages.length === 0 ? (
        <EmptyRow label="No messages yet." />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {messages.map((message, index) => {
            const fromCenter = message.direction !== 'inbound';
            return (
              <Box
                key={message.id ?? index}
                sx={{
                  alignSelf: fromCenter ? 'flex-start' : 'flex-end',
                  maxWidth: '85%',
                  px: 2,
                  py: 1.25,
                  borderRadius: `${shape.large}px`,
                  bgcolor: fromCenter ? md3Colors.surfaceVariant : md3Colors.primaryContainer,
                  color: fromCenter ? md3Colors.onSurface : md3Colors.onPrimaryContainer,
                }}
              >
                <Typography variant="bodyMedium">{message.body}</Typography>
                {message.created_at && (
                  <Typography
                    variant="bodySmall"
                    sx={{ color: md3Colors.onSurfaceVariant, mt: 0.5 }}
                  >
                    {formatDate(message.created_at)}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </SectionCard>
  );
}

function progressLabel(row) {
  const level = row.level_name || row.level;
  const worksheet = row.worksheet_number ?? row.worksheet;
  const parts = [];
  if (level != null) parts.push(`Level ${level}`);
  if (worksheet != null) parts.push(`Worksheet ${worksheet}`);
  return parts.join(' · ') || 'In progress';
}

function ProgressSection() {
  const result = useOptionalSection('progress');
  if (!result?.available) return null;

  const progress = result.data.progress;

  return (
    <SectionCard
      icon={<TrendingUpOutlinedIcon sx={{ color: md3Colors.primary }} />}
      title="Progress"
    >
      {progress.length === 0 ? (
        <EmptyRow label="No progress recorded yet." />
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {progress.map((row, index) => (
            <Box component="li" key={row.id ?? index}>
              {index > 0 && <Divider sx={{ borderColor: md3Colors.outlineVariant }} />}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  py: 1.5,
                  minHeight: 44,
                }}
              >
                <Box>
                  <Typography variant="bodyMedium">
                    {row.subject ? row.subject.charAt(0).toUpperCase() + row.subject.slice(1) : 'Subject'}
                  </Typography>
                  <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                    {progressLabel(row)}
                  </Typography>
                </Box>
                {row.status && (
                  <Chip
                    size="small"
                    label={row.status}
                    sx={{ bgcolor: md3Colors.surfaceVariant, color: md3Colors.onSurfaceVariant }}
                  />
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SectionCard>
  );
}

export default function HomePage() {
  const { student, signOut } = useParentSession();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: md3Colors.background, pb: 6 }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{ bgcolor: getElevatedSurface(2), color: md3Colors.onSurface }}
      >
        <Toolbar sx={{ maxWidth: 480, mx: 'auto', width: '100%' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="titleLarge" component="h1">
              {student.first_name} {student.last_name}
            </Typography>
            <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
              KumonScan Family · view only
            </Typography>
          </Box>
          <IconButton onClick={signOut} aria-label="Sign out" sx={{ width: 44, height: 44 }}>
            <LogoutOutlinedIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{
          maxWidth: 480,
          mx: 'auto',
          px: 2,
          pt: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <AttendanceSection />
        <BookingsSection />
        <MessagesSection />
        <ProgressSection />

        <Typography
          variant="bodySmall"
          sx={{ textAlign: 'center', color: md3Colors.onSurfaceVariant, mt: 1 }}
        >
          Questions about anything here? Contact your Kumon center directly.
        </Typography>
      </Box>
    </Box>
  );
}
