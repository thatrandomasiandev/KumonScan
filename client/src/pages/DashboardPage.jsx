import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  Box,
  Typography,
  TextField,
  Paper,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Chip,
  Collapse,
  Divider,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import ExpandLessOutlinedIcon from '@mui/icons-material/ExpandLessOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { api, formatTime, formatDate, formatDuration } from '../api';
import PageHeader from '../components/PageHeader';
import LoadingScreen from '../components/LoadingScreen';
import { useSnackbar } from '../components/SnackbarProvider';
import { md3Colors, getElevatedSurface, shape } from '../theme';

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function AttendanceReports() {
  const { showSnackbar } = useSnackbar();
  const [period, setPeriod] = useState('monthly');
  const [month, setMonth] = useState(currentMonthValue);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function loadReport() {
    setLoading(true);
    try {
      const data = await api.getAttendanceReport({ period, month });
      setReport(data);
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const { blob, filename } = await api.downloadAttendanceCsv({ period, month });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      showSnackbar('CSV downloaded');
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    try {
      const { blob, filename } = await api.downloadAttendancePdf({ period, month });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      showSnackbar('PDF downloaded');
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setDownloadingPdf(false);
    }
  }

  const previewRows = (report?.students || []).filter((s) => s.visits > 0 || s.active);

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 3,
        borderRadius: `${shape.extraLarge}px`,
        bgcolor: md3Colors.surfaceBright,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ p: 3, borderBottom: `1px solid ${md3Colors.outlineVariant}` }}>
        <Typography variant="titleLarge" sx={{ mb: 0.5 }}>
          Attendance reports
        </Typography>
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 2, display: 'block' }}>
          Monthly or rolling 12-month export (CSV for Sheets, PDF for print)
        </Typography>

        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 2,
            alignItems: { sm: 'flex-end' },
            flexWrap: 'wrap',
          }}
        >
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={period}
            onChange={(_e, next) => {
              if (next) setPeriod(next);
            }}
            aria-label="Report period"
            sx={{
              gap: 1,
              width: { xs: '100%', sm: 'auto' },
              '& .MuiToggleButtonGroup-grouped': {
                border: `1px solid ${md3Colors.outlineVariant} !important`,
                borderRadius: `${shape.medium}px !important`,
                textTransform: 'none',
                px: 2,
                py: 1,
                minHeight: 44,
                color: md3Colors.onSurfaceVariant,
                '&.Mui-selected': {
                  bgcolor: md3Colors.primaryContainer,
                  color: md3Colors.onPrimaryContainer,
                  borderColor: `${md3Colors.primary} !important`,
                },
              },
            }}
          >
            <ToggleButton value="monthly" sx={{ flex: { xs: 1, sm: 'unset' } }}>
              Monthly
            </ToggleButton>
            <ToggleButton value="annual" sx={{ flex: { xs: 1, sm: 'unset' } }}>
              Annual (12 mo)
            </ToggleButton>
          </ToggleButtonGroup>

          <TextField
            label={period === 'annual' ? 'Ending month' : 'Month'}
            type="month"
            size="small"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ width: { xs: '100%', sm: 200 } }}
          />

          <Button
            variant="contained"
            fullWidth={false}
            onClick={loadReport}
            disabled={loading || !month}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {loading ? 'Loading…' : 'Preview'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadOutlinedIcon />}
            onClick={handleDownload}
            disabled={downloading || downloadingPdf || !month}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {downloading ? 'Downloading…' : 'Download CSV'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadOutlinedIcon />}
            onClick={handleDownloadPdf}
            disabled={downloading || downloadingPdf || !month}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {downloadingPdf ? 'Downloading…' : 'Download PDF'}
          </Button>
        </Box>
      </Box>

      {report && (
        <Box sx={{ p: 3 }}>
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant, mb: 2 }}>
            {report.start_date} → {report.end_date} · {report.summary.total_visits} visits ·{' '}
            {report.summary.total_minutes} min · {report.summary.overtime_sessions} overtime sessions
          </Typography>

          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Attendance report preview">
              <TableHead>
                <TableRow>
                  <TableCell>Student</TableCell>
                  <TableCell align="right">Visits</TableCell>
                  <TableCell align="right">Minutes</TableCell>
                  <TableCell align="right">Overtime</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {previewRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant, py: 2 }}>
                        No attendance in this range
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  previewRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        {row.name}
                        {!row.active && (
                          <Typography component="span" variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, ml: 1 }}>
                            (inactive)
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">{row.visits}</TableCell>
                      <TableCell align="right">{row.total_minutes}</TableCell>
                      <TableCell align="right">{row.overtime_count}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Box>
        </Box>
      )}
    </Paper>
  );
}

function WeekdayUtilization() {
  const [report, setReport] = useState(null);

  useEffect(() => {
    api.getUtilization().then(setReport).catch(() => setReport(null));
  }, []);

  if (!report) return null;

  const chartData = report.weekdays.map((d) => ({
    weekday: d.weekday,
    'Avg check-ins': d.avg_checkins,
    Scheduled: d.expected,
    capacity: d.capacity,
  }));

  const hasAnyData = report.weekdays.some((d) => d.total_checkins > 0 || d.expected > 0);
  if (!hasAnyData) return null;

  const capacityDays = report.weekdays.filter((d) => d.capacity != null);

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 3,
        borderRadius: `${shape.extraLarge}px`,
        bgcolor: md3Colors.surfaceBright,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ p: 3, pb: 2 }}>
        <Typography variant="titleLarge" sx={{ mb: 0.5 }}>
          Weekday utilization
        </Typography>
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, display: 'block', mb: 2 }}>
          Average check-ins vs scheduled students, past {report.window_days} days
          {capacityDays.length > 0
            ? ` · capacity ${capacityDays.map((d) => `${d.weekday} ${d.capacity}`).join(', ')}`
            : ' · set weekday capacity in Admin → Staff & center'}
        </Typography>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={md3Colors.outlineVariant} />
            <XAxis dataKey="weekday" tick={{ fontSize: 11, fill: md3Colors.onSurfaceVariant }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: md3Colors.onSurfaceVariant }} />
            <Tooltip />
            <Bar dataKey="Avg check-ins" fill={md3Colors.primary} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Scheduled" fill={md3Colors.outlineVariant} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}

function SessionChart({ dailySessions }) {
  const chartData = dailySessions.map((d) => ({
    date: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    sessions: d.count,
  }));

  if (chartData.length === 0) {
    return (
      <Box
        sx={{
          py: 4,
          textAlign: 'center',
          bgcolor: md3Colors.surfaceVariant,
          borderRadius: `${shape.medium}px`,
        }}
      >
        <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
          No sessions in the last 30 days
        </Typography>
      </Box>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={md3Colors.outlineVariant} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: md3Colors.onSurfaceVariant }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: md3Colors.onSurfaceVariant }} />
        <Tooltip />
        <Bar dataKey="sessions" fill={md3Colors.primary} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function StudentListItem({ student, timezone }) {
  const [expanded, setExpanded] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [loading, setLoading] = useState(false);
  const { stats } = student;

  async function toggle() {
    if (!expanded && !sessions) {
      setLoading(true);
      try {
        const data = await api.getStudentSessions(student.id);
        setSessions(data.sessions);
      } catch {
        setSessions([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  }

  const initials = student.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <ListItemButton
        onClick={toggle}
        sx={{
          minHeight: 72,
          px: 2,
          '&:hover': { bgcolor: 'rgba(26,27,34,0.08)' },
        }}
      >
        <ListItemAvatar>
          <Avatar
            sx={{
              bgcolor: stats.isCheckedIn ? md3Colors.tertiaryContainer : md3Colors.surfaceVariant,
              color: stats.isCheckedIn ? md3Colors.tertiary : md3Colors.onSurfaceVariant,
              width: 40,
              height: 40,
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            {initials}
          </Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="titleSmall">{student.name}</Typography>
              {stats.isCheckedIn && (
                <Chip
                  label="Here"
                  size="small"
                  sx={{
                    bgcolor: md3Colors.tertiaryContainer,
                    color: md3Colors.tertiary,
                    height: 24,
                    fontSize: '11px',
                  }}
                />
              )}
              {stats.isRegular && (
                <Chip
                  label="Regular"
                  size="small"
                  sx={{
                    bgcolor: md3Colors.secondaryContainer,
                    color: md3Colors.onSecondaryContainer,
                    height: 24,
                    fontSize: '11px',
                  }}
                />
              )}
            </Box>
          }
          secondary={
            <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
              {stats.totalVisits} visits · avg {formatDuration(stats.avgDurationMinutes)} · last{' '}
              {stats.lastVisit ? formatDate(stats.lastVisit, timezone) : '—'}
            </Typography>
          }
        />
        {expanded ? (
          <ExpandLessOutlinedIcon sx={{ color: md3Colors.onSurfaceVariant }} />
        ) : (
          <ExpandMoreOutlinedIcon sx={{ color: md3Colors.onSurfaceVariant }} />
        )}
      </ListItemButton>
      <Collapse in={expanded}>
        <Box sx={{ px: 2, pb: 2, bgcolor: getElevatedSurface(1) }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { md: '1fr 1fr' }, gap: 3, pt: 2 }}>
            <Box>
              <Typography variant="titleMedium" sx={{ mb: 1.5 }}>
                Session History
              </Typography>
              {loading ? (
                <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
                  Loading...
                </Typography>
              ) : sessions?.length === 0 ? (
                <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
                  No sessions yet
                </Typography>
              ) : (
                <List disablePadding dense>
                  {sessions?.map((s) => (
                    <Box
                      key={s.id}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        py: 1,
                        px: 1.5,
                        borderRadius: `${shape.small}px`,
                        '&:hover': { bgcolor: 'rgba(26,27,34,0.04)' },
                      }}
                    >
                      <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
                        {formatTime(s.check_in_time, timezone)}
                      </Typography>
                      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                        {s.check_out_time ? formatDuration(s.duration_minutes) : 'In progress'}
                      </Typography>
                    </Box>
                  ))}
                </List>
              )}
            </Box>
            <Box>
              <Typography variant="titleMedium" sx={{ mb: 1.5 }}>
                Sessions, Last 30 Days
              </Typography>
              <SessionChart dailySessions={student.dailySessions || []} />
            </Box>
          </Box>
        </Box>
      </Collapse>
      <Divider sx={{ ml: 2, borderColor: md3Colors.outlineVariant }} />
    </>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getDashboard()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = data?.students.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <LoadingScreen message="Loading dashboard..." />;

  if (error) {
    return (
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: 2, py: 4, display: 'flex', justifyContent: 'center' }}>
        <Typography variant="bodyMedium" sx={{ color: md3Colors.error }}>
          {error}
        </Typography>
      </Box>
    );
  }

  const { summary, timezone } = data;

  const stats = [
    { label: 'Active students', value: summary.totalActiveStudents },
    { label: 'Sessions today', value: summary.totalSessionsToday },
    { label: 'Currently here', value: summary.currentlyCheckedIn },
  ];

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 3 }, py: { xs: 3, md: 4 }, pb: { xs: 12, md: 4 } }}>
      <PageHeader title="Dashboard" subtitle={`Attendance overview · ${timezone}`} />

      <AttendanceReports />

      <WeekdayUtilization />

      <Paper
        elevation={0}
        className="card-stagger"
        sx={{
          mb: 3,
          borderRadius: `${shape.extraLarge}px`,
          bgcolor: md3Colors.primaryContainer,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          }}
        >
          {stats.map((stat, i) => (
            <Box
              key={stat.label}
              sx={{
                px: 3,
                py: 2.5,
                borderBottom: {
                  xs: i < stats.length - 1 ? `1px solid ${md3Colors.outlineVariant}` : 'none',
                  sm: 'none',
                },
                borderRight: {
                  xs: 'none',
                  sm: i < stats.length - 1 ? `1px solid rgba(0, 25, 70, 0.12)` : 'none',
                },
              }}
            >
              <Typography
                variant="bodySmall"
                sx={{ color: md3Colors.onPrimaryContainer, opacity: 0.72, display: 'block', mb: 0.5 }}
              >
                {stat.label}
              </Typography>
              <Typography
                variant="displaySmall"
                sx={{ color: md3Colors.onPrimaryContainer, fontWeight: 500, lineHeight: 1.1 }}
              >
                {stat.value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          borderRadius: `${shape.extraLarge}px`,
          bgcolor: md3Colors.surfaceBright,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { sm: 'center' },
            justifyContent: 'space-between',
            gap: 2,
            p: 3,
            pb: 2,
            borderBottom: `1px solid ${md3Colors.outlineVariant}`,
          }}
        >
          <Box>
            <Typography variant="titleLarge">All students</Typography>
            <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mt: 0.5 }}>
              {filtered?.length ?? 0} shown
            </Typography>
          </Box>
          <TextField
            placeholder="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            sx={{ width: { xs: '100%', sm: 280 } }}
            inputProps={{ 'aria-label': 'Search students' }}
          />
        </Box>

        {filtered?.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
            <BarChartOutlinedIcon
              sx={{ fontSize: 64, color: md3Colors.outlineVariant, mb: 2 }}
            />
            <Typography variant="bodyLarge" sx={{ color: md3Colors.onSurfaceVariant, mb: 3 }}>
              No students match that search
            </Typography>
            <Button variant="contained" color="secondary" onClick={() => setSearch('')}>
              Clear search
            </Button>
          </Box>
        ) : (
          <List disablePadding>
            {filtered?.map((student) => (
              <StudentListItem key={student.id} student={student} timezone={timezone} />
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );
}
