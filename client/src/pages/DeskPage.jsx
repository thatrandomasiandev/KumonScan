import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import LoginOutlinedIcon from '@mui/icons-material/LoginOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import { api, formatDuration, formatTime } from '../api';
import { resourcesApi } from '../resourcesApi'; // agent-5-resources
import { caregiversApi } from '../caregiversApi'; // agent-2-pickup-auth
import PageHeader from '../components/PageHeader';
import LoadingScreen from '../components/LoadingScreen';
import { useSnackbar } from '../components/SnackbarProvider';
// agent-offline: check-ins/outs go through a persistent IndexedDB queue so a
// dropped connection delays them instead of failing them (see client/src/offline/).
import OfflineStatusChip from '../offline/OfflineStatusChip';
import { useOfflineQueue } from '../offline/useOfflineQueue';
import { md3Colors, getElevatedSurface, motion, shape } from '../theme';

const SUBJECT_OPTIONS = [
  { value: 'math', label: 'Math', allowance: 30 },
  { value: 'reading', label: 'Reading', allowance: 30 },
  { value: 'both', label: 'Both', allowance: 60 },
];

const toggleGroupSx = {
  gap: 1,
  '& .MuiToggleButtonGroup-grouped': {
    border: `1px solid ${md3Colors.outlineVariant} !important`,
    borderRadius: `${shape.medium}px !important`,
    flex: 1,
    py: 1.25,
    textTransform: 'none',
    color: md3Colors.onSurfaceVariant,
    '&.Mui-selected': {
      bgcolor: md3Colors.primaryContainer,
      color: md3Colors.onPrimaryContainer,
      borderColor: `${md3Colors.primary} !important`,
      '&:hover': { bgcolor: md3Colors.primaryContainer },
    },
  },
};

function formatClock(date, timezone, { compact = false } = {}) {
  if (compact) {
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone || 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  return date.toLocaleString('en-US', {
    timeZone: timezone || 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatShortTime(isoString, timezone) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('en-US', {
    timeZone: timezone || 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function LiveClock({ timezone }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: { xs: 1.5, sm: 2 },
        py: 1,
        borderRadius: `${shape.medium}px`,
        bgcolor: md3Colors.surfaceVariant,
        fontFamily: '"Roboto Mono", Roboto, monospace',
        maxWidth: '100%',
      }}
      aria-live="polite"
      aria-atomic="true"
    >
      <AccessTimeOutlinedIcon
        sx={{ fontSize: 20, color: md3Colors.onSurfaceVariant, flexShrink: 0 }}
      />
      <Typography
        variant="titleMedium"
        sx={{
          color: md3Colors.onSurface,
          fontFamily: 'inherit',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0,
          fontSize: { xs: '16px', sm: '22px' },
          lineHeight: { xs: '24px', sm: '28px' },
          whiteSpace: 'nowrap',
        }}
      >
        <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
          {formatClock(now, timezone, { compact: true })}
        </Box>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
          {formatClock(now, timezone)}
        </Box>
      </Typography>
    </Box>
  );
}

function SubjectToggle({ value, onChange, disabled }) {
  return (
    <ToggleButtonGroup
      exclusive
      fullWidth
      value={value}
      onChange={(_e, next) => {
        if (next) onChange(next);
      }}
      disabled={disabled}
      aria-label="Subject for today's visit"
      sx={toggleGroupSx}
    >
      {SUBJECT_OPTIONS.map((opt) => (
        <ToggleButton key={opt.value} value={opt.value} aria-label={`${opt.label}, ${opt.allowance} minutes`}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="labelLarge" component="span" sx={{ display: 'block' }}>
              {opt.label}
            </Typography>
            <Typography variant="bodySmall" component="span" sx={{ opacity: 0.8 }}>
              {opt.allowance} min
            </Typography>
          </Box>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function ModeToggle({ value, onChange, disabled }) {
  return (
    <ToggleButtonGroup
      exclusive
      fullWidth
      value={value}
      onChange={(_e, next) => {
        if (next) onChange(next);
      }}
      disabled={disabled}
      aria-label="Session mode"
      sx={toggleGroupSx}
    >
      <ToggleButton value="in_person" aria-label="In-person session">
        <Typography variant="labelLarge" component="span">
          In-person
        </Typography>
      </ToggleButton>
      <ToggleButton value="remote" aria-label="Remote session over Zoom">
        <VideocamOutlinedIcon sx={{ fontSize: 18, mr: 0.75 }} />
        <Typography variant="labelLarge" component="span">
          Remote
        </Typography>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

function PresentStudentRow({ student, timezone, onCheckOut, checkingOut }) {
  const overtime = student.is_overtime;

  return (
    <Box
      component="button"
      type="button"
      onClick={() => onCheckOut(student)}
      disabled={checkingOut}
      aria-label={`Check out ${student.name}${student.is_remote ? ', remote session' : ''}${overtime ? `, overtime plus ${student.overtime_minutes} minutes` : ''}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        p: 1.5,
        border: 'none',
        borderRadius: `${shape.medium}px`,
        textAlign: 'left',
        cursor: checkingOut ? 'wait' : 'pointer',
        bgcolor: overtime ? md3Colors.errorContainer : 'transparent',
        color: overtime ? md3Colors.onErrorContainer : md3Colors.onSurface,
        transition: `background-color ${motion.short2} ${motion.emphasizedDecelerate}`,
        '&:hover': {
          bgcolor: overtime ? 'color-mix(in srgb, #FFDAD6 85%, #BA1A1A 15%)' : 'rgba(26,27,34,0.04)',
        },
        '&:focus-visible': {
          outline: `2px solid ${md3Colors.primary}`,
          outlineOffset: 2,
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
        },
      }}
    >
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: `${shape.medium}px`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: overtime ? md3Colors.error : md3Colors.tertiaryContainer,
          color: overtime ? md3Colors.onPrimary : md3Colors.tertiary,
          fontWeight: 500,
          fontSize: 14,
        }}
      >
        {student.name
          .split(' ')
          .map((p) => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="titleSmall" noWrap sx={{ color: 'inherit' }}>
          {student.name}
        </Typography>
        <Typography
          variant="bodySmall"
          sx={{ color: overtime ? 'inherit' : md3Colors.onSurfaceVariant, opacity: overtime ? 0.85 : 1 }}
        >
          {student.subjects_label} · in {formatShortTime(student.check_in_time, timezone)}
        </Typography>
      </Box>

      {student.is_remote && (
        <Chip
          size="small"
          icon={<VideocamOutlinedIcon />}
          label="Remote"
          sx={{
            height: 22,
            flexShrink: 0,
            fontWeight: 500,
            // Neutral on purpose: color in this list is reserved for overtime.
            bgcolor: 'rgba(26,27,34,0.08)',
            color: 'inherit',
            '& .MuiChip-icon': { color: 'inherit', fontSize: 15 },
          }}
        />
      )}

      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography
          variant="titleSmall"
          sx={{
            fontFamily: '"Roboto Mono", Roboto, monospace',
            fontVariantNumeric: 'tabular-nums',
            color: 'inherit',
          }}
        >
          {formatDuration(student.elapsed_minutes)}
        </Typography>
        {overtime ? (
          <Typography
            variant="labelMedium"
            sx={{
              display: 'block',
              color: md3Colors.error,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            +{student.overtime_minutes} min
          </Typography>
        ) : (
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
            / {student.allowance_minutes}m
          </Typography>
        )}
      </Box>

      <LogoutOutlinedIcon sx={{ fontSize: 20, opacity: 0.7, flexShrink: 0 }} />
    </Box>
  );
}

export default function DeskPage() {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [students, setStudents] = useState([]);
  const [present, setPresent] = useState({ students: [], count: 0, overtime_count: 0, timezone: 'America/Los_Angeles' });
  const [completed, setCompleted] = useState({ students: [], count: 0 });
  const [selected, setSelected] = useState(null);
  const [subjects, setSubjects] = useState('both');
  const [mode, setMode] = useState('in_person');
  const [remoteSessionIds, setRemoteSessionIds] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  // agent-5-resources: optional materials logging at check-out. null = catalog
  // not fetched yet; [] = fetched but empty/unavailable (input stays hidden).
  const [materialsCatalog, setMaterialsCatalog] = useState(null);
  const [materialsUsed, setMaterialsUsed] = useState([]);
  // agent-2-pickup-auth
  const [pickupCaregivers, setPickupCaregivers] = useState([]);
  const [pickedUpBy, setPickedUpBy] = useState('');
  const [tick, setTick] = useState(0);
  const [absent, setAbsent] = useState(null);
  const [absentLoading, setAbsentLoading] = useState(false);
  const [clockSkewMs, setClockSkewMs] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const timezone = present.timezone || 'America/Los_Angeles';

  const activeRoster = useMemo(() => {
    // Recompute elapsed between polls using skew-corrected clock (aligned to timeapi via /present).
    void tick;
    const now = Date.now() + clockSkewMs;
    return (present.students || []).map((s) => {
      const elapsed = Math.max(0, Math.floor((now - new Date(s.check_in_time).getTime()) / 60000));
      const allowance = s.allowance_minutes ?? (s.subjects === 'both' ? 60 : 30);
      const isOvertime = elapsed > allowance;
      return {
        ...s,
        elapsed_minutes: elapsed,
        is_overtime: isOvertime,
        overtime_minutes: isOvertime ? elapsed - allowance : 0,
        is_remote: remoteSessionIds.has(s.session_id),
      };
    }).sort((a, b) => {
      if (a.is_overtime !== b.is_overtime) return a.is_overtime ? -1 : 1;
      return b.elapsed_minutes - a.elapsed_minutes;
    });
  }, [present.students, tick, clockSkewMs, remoteSessionIds]);

  const overtimeCount = activeRoster.filter((s) => s.is_overtime).length;

  const rosterOptions = useMemo(
    () =>
      students
        .filter((s) => s.active)
        .filter((s) => !activeRoster.some((p) => p.id === s.id)),
    [students, activeRoster]
  );

  const loadData = useCallback(async () => {
    try {
      const [studentsData, presentData, completedData, remoteData] = await Promise.all([
        api.getStudents(),
        api.getPresent(),
        api.getCompletedToday(),
        // Mode indicator only; never block the desk if this lookup fails.
        api.getOpenRemoteSessions().catch(() => ({ session_ids: [] })),
      ]);
      setStudents(studentsData);
      setPresent(presentData);
      setCompleted(completedData);
      setRemoteSessionIds(new Set(remoteData.session_ids || []));
      if (presentData?.clock_iso) {
        const serverMs = new Date(presentData.clock_iso).getTime();
        if (!Number.isNaN(serverMs)) {
          setClockSkewMs(serverMs - Date.now());
        }
      }
      setError(null);
      setLastSyncedAt(new Date());
    } catch (err) {
      // agent-offline: a network drop must not blank the roster or raise an
      // error banner; the last-known state stays up, marked stale, and the
      // offline chip explains why. Real HTTP errors still surface.
      if (err?.status != null) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSyncResult = useCallback(
    (outcome) => {
      const label = outcome.action?.label || 'Queued action';
      if (outcome.status === 'delivered') {
        showSnackbar(`${label} synced`);
      } else {
        showSnackbar(`${label} could not sync: ${outcome.error?.message || 'rejected'}`);
      }
      void loadData();
    },
    [showSnackbar, loadData]
  );

  const { online, pendingCount, syncing, submitCheckIn, submitCheckOut } = useOfflineQueue({
    onSyncResult: handleSyncResult,
  });

  useEffect(() => {
    loadData();
    const poll = setInterval(loadData, 15000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [loadData]);

  // agent-5-resources
  useEffect(() => {
    if (!checkoutTarget) return;
    setMaterialsUsed([]);
    if (materialsCatalog === null) {
      resourcesApi
        .getResources()
        .then((data) => setMaterialsCatalog(data.resources || []))
        .catch(() => setMaterialsCatalog([]));
    }
  }, [checkoutTarget, materialsCatalog]);

  // agent-2-pickup-auth: load approved caregivers when the check-out dialog
  // opens. Failures fall back to an empty list — logging a pickup is optional
  // and must never block the check-out itself.
  useEffect(() => {
    setPickedUpBy('');
    if (!checkoutTarget) {
      setPickupCaregivers([]);
      return undefined;
    }
    let cancelled = false;
    caregiversApi
      .list(checkoutTarget.id)
      .then((data) => {
        if (!cancelled) setPickupCaregivers(data.caregivers || []);
      })
      .catch(() => {
        if (!cancelled) setPickupCaregivers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [checkoutTarget]);

  useEffect(() => {
    if (!selected) return;
    const enrolled = selected.enrolled_subjects;
    if (enrolled === 'math' || enrolled === 'reading' || enrolled === 'both') {
      setSubjects(enrolled);
    }
  }, [selected]);

  async function handleCheckIn(e) {
    e.preventDefault();
    if (!selected || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const subjectLabel = SUBJECT_OPTIONS.find((o) => o.value === subjects)?.label;
      const outcome = await submitCheckIn(
        { student_id: selected.id, subjects, mode },
        `${selected.name} check-in`
      );
      if (outcome.status === 'rejected') {
        setError(outcome.error.message);
        showSnackbar(outcome.error.message);
        return;
      }
      if (outcome.status === 'delivered') {
        showSnackbar(
          `${outcome.result.student.name} checked in · ${subjectLabel}${mode === 'remote' ? ' · Remote' : ''}`
        );
      } else {
        showSnackbar(`${selected.name} saved — checks in when connection returns`);
      }
      setSelected(null);
      setMode('in_person');
      await loadData();
    } catch (err) {
      setError(err.message);
      showSnackbar(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCheckOut() {
    if (!checkoutTarget) return;
    setCheckingOut(true);
    try {
      // agent-5-resources: materials logging is best-effort and independent
      // of the checkout's own delivery — it fires now regardless of whether
      // the checkout below is delivered immediately or queued for reconnect,
      // since it never blocks or reverts the check-out either way.
      let materialsNote = '';
      if (materialsUsed.length > 0) {
        const outcomes = await Promise.allSettled(
          materialsUsed.map((resource) =>
            resourcesApi.useResource(resource.id, {
              student_id: checkoutTarget.id,
              session_id: checkoutTarget.session_id,
              quantity: 1,
            })
          )
        );
        const failed = outcomes.filter((o) => o.status === 'rejected');
        materialsNote =
          failed.length > 0
            ? ` · ${failed.length} material log${failed.length === 1 ? '' : 's'} failed`
            : ` · ${materialsUsed.length} material${materialsUsed.length === 1 ? '' : 's'} logged`;
      }

      // agent-2-pickup-auth: optional picked_up_by on the same check-out call,
      // carried through the offline queue (see sendAction in offline/sync.js).
      const outcome = await submitCheckOut(
        { session_id: checkoutTarget.session_id, picked_up_by: pickedUpBy || undefined },
        `${checkoutTarget.name} check-out`
      );
      if (outcome.status === 'rejected') {
        showSnackbar(outcome.error.message);
      } else if (outcome.status === 'delivered') {
        const result = outcome.result;
        const mins = Math.round(result.session.duration_minutes || 0);
        const over =
          result.session.is_overtime && result.session.overtime_minutes > 0
            ? ` (+${result.session.overtime_minutes} over)`
            : '';
        showSnackbar(`${result.student.name} checked out · ${mins} min${over}${materialsNote}`);
      } else {
        showSnackbar(`${checkoutTarget.name} saved — checks out when connection returns${materialsNote}`);
      }
      setCheckoutTarget(null);
      setMaterialsUsed([]);
      setMaterialsCatalog(null);
      setPickedUpBy('');
      setPickupCaregivers([]);
      await loadData();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setCheckingOut(false);
    }
  }

  async function handleGenerateAbsences() {
    setAbsentLoading(true);
    try {
      const data = await api.getAbsent();
      setAbsent(data);
      if (data.expected_count === 0) {
        showSnackbar(
          data.unchecked_schedule_count > 0
            ? 'No schedules for today — set scheduled days in Admin'
            : 'No students scheduled for today'
        );
      } else {
        showSnackbar(
          data.count === 0
            ? `All ${data.expected_count} expected students checked in`
            : `${data.count} absent of ${data.expected_count} expected`
        );
      }
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setAbsentLoading(false);
    }
  }

  if (loading) return <LoadingScreen message="Loading front desk..." />;

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', px: 2, py: 4, pb: { xs: 12, md: 4 } }}>
      <PageHeader
        title="Front desk"
        subtitle="Search the roster, check in by subject, and watch session timers"
        action={
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <OfflineStatusChip online={online} pendingCount={pendingCount} syncing={syncing} />
            <LiveClock timezone={timezone} />
          </Box>
        }
      />

      {error && (
        <Typography variant="bodyMedium" role="alert" sx={{ color: md3Colors.error, mb: 2 }}>
          {error}
        </Typography>
      )}

      <Paper
        component="form"
        onSubmit={handleCheckIn}
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          borderRadius: `${shape.extraLarge}px`,
          bgcolor: md3Colors.surfaceBright,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
        }}
      >
        <Typography variant="titleMedium" sx={{ mb: 2 }}>
          Check in
        </Typography>

        <Autocomplete
          options={rosterOptions}
          value={selected}
          onChange={(_e, value) => setSelected(value)}
          getOptionLabel={(option) => option.name || ''}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterOptions={(options, { inputValue }) => {
            const q = inputValue.trim().toLowerCase();
            if (!q) return options;
            return options.filter(
              (s) =>
                s.first_name.toLowerCase().includes(q) ||
                s.last_name.toLowerCase().includes(q) ||
                s.name.toLowerCase().includes(q) ||
                String(s.student_number ?? '').includes(q)
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Student name or number"
              placeholder="Search first or last name, or student number"
              autoFocus
            />
          )}
          sx={{ mb: 2.5 }}
          noOptionsText="No matching students on roster"
        />

        <Typography variant="labelLarge" sx={{ display: 'block', mb: 1, color: md3Colors.onSurfaceVariant }}>
          Here for today
        </Typography>
        <SubjectToggle value={subjects} onChange={setSubjects} disabled={submitting} />

        <Typography
          variant="labelLarge"
          sx={{ display: 'block', mt: 2, mb: 1, color: md3Colors.onSurfaceVariant }}
        >
          Attending
        </Typography>
        <ModeToggle value={mode} onChange={setMode} disabled={submitting} />

        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={!selected || submitting}
          startIcon={<LoginOutlinedIcon />}
          sx={{ mt: 2.5, minHeight: 48 }}
        >
          {submitting ? 'Checking in…' : 'Check in'}
        </Button>
      </Paper>

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
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            px: 3,
            py: 2.5,
            bgcolor: overtimeCount > 0 ? md3Colors.errorContainer : md3Colors.tertiaryContainer,
          }}
        >
          <Box>
            <Typography
              variant="titleLarge"
              sx={{ color: overtimeCount > 0 ? md3Colors.error : md3Colors.tertiary }}
            >
              On the floor
            </Typography>
            <Typography
              variant="bodySmall"
              sx={{
                color: overtimeCount > 0 ? md3Colors.onErrorContainer : md3Colors.onSurfaceVariant,
                mt: 0.25,
              }}
            >
              Tap a name to check out
              {overtimeCount > 0 ? ` · ${overtimeCount} over time` : ''}
            </Typography>
            {!online && (
              <Typography
                variant="bodySmall"
                sx={{
                  display: 'block',
                  mt: 0.25,
                  fontWeight: 600,
                  color: overtimeCount > 0 ? md3Colors.onErrorContainer : md3Colors.onSurfaceVariant,
                }}
              >
                Offline — roster as of{' '}
                {lastSyncedAt ? formatShortTime(lastSyncedAt.toISOString(), timezone) : '—'}, may be
                out of date
              </Typography>
            )}
            {(present.expected_today != null || present.capacity_today != null) && (
              <Typography
                variant="bodySmall"
                sx={{
                  display: 'block',
                  mt: 0.25,
                  fontWeight:
                    present.capacity_today != null && activeRoster.length > present.capacity_today
                      ? 600
                      : 400,
                  color:
                    present.capacity_today != null && activeRoster.length > present.capacity_today
                      ? md3Colors.error
                      : overtimeCount > 0
                        ? md3Colors.onErrorContainer
                        : md3Colors.onSurfaceVariant,
                }}
              >
                {[
                  present.expected_today != null ? `${present.expected_today} expected today` : null,
                  present.capacity_today != null ? `capacity ${present.capacity_today}` : null,
                  present.capacity_today != null && activeRoster.length > present.capacity_today
                    ? 'over capacity'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              minWidth: 56,
              height: 56,
              borderRadius: `${shape.large}px`,
              bgcolor: md3Colors.surfaceBright,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography
              variant="headlineMedium"
              sx={{
                color: overtimeCount > 0 ? md3Colors.error : md3Colors.tertiary,
                fontWeight: 500,
              }}
            >
              {activeRoster.length}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ p: 1.5 }}>
          {activeRoster.length === 0 ? (
            <Box
              sx={{
                textAlign: 'center',
                py: 5,
                px: 2,
                borderRadius: `${shape.large}px`,
                bgcolor: md3Colors.surfaceVariant,
              }}
            >
              <PersonOutlinedIcon sx={{ fontSize: 40, color: md3Colors.outline, mb: 1 }} />
              <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
                Floor is clear — check in the next student above
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {activeRoster.map((student) => (
                <PresentStudentRow
                  key={student.session_id}
                  student={student}
                  timezone={timezone}
                  onCheckOut={setCheckoutTarget}
                  checkingOut={checkingOut}
                />
              ))}
            </Box>
          )}
        </Box>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          borderRadius: `${shape.extraLarge}px`,
          bgcolor: getElevatedSurface(1),
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ px: 3, py: 2, borderBottom: `1px solid ${md3Colors.outlineVariant}` }}>
          <Typography variant="titleMedium">
            Completed today
            <Typography component="span" variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, ml: 1 }}>
              {completed.count}
            </Typography>
          </Typography>
        </Box>

        <Box sx={{ p: 1.5 }}>
          {(completed.students || []).length === 0 ? (
            <Typography
              variant="bodyMedium"
              sx={{ color: md3Colors.onSurfaceVariant, textAlign: 'center', py: 4 }}
            >
              No check-outs yet today
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {completed.students.map((student) => (
                <Box
                  key={student.session_id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1.5,
                    borderRadius: `${shape.medium}px`,
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="titleSmall" noWrap>
                      {student.name}
                    </Typography>
                    <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                      {formatShortTime(student.check_in_time, timezone)}
                      {' → '}
                      {formatShortTime(student.check_out_time, timezone)}
                      {' · '}
                      {student.subjects_label}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    icon={student.is_overtime ? <WarningAmberOutlinedIcon /> : undefined}
                    label={
                      student.is_overtime
                        ? `${formatDuration(student.duration_minutes)} (+${student.overtime_minutes})`
                        : formatDuration(student.duration_minutes)
                    }
                    sx={{
                      bgcolor: student.is_overtime ? md3Colors.errorContainer : md3Colors.surfaceVariant,
                      color: student.is_overtime ? md3Colors.onErrorContainer : md3Colors.onSurfaceVariant,
                      fontWeight: 500,
                      '& .MuiChip-icon': { color: 'inherit' },
                    }}
                  />
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          mt: 3,
          borderRadius: `${shape.extraLarge}px`,
          bgcolor: getElevatedSurface(1),
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
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
            px: 3,
            py: 2,
            borderBottom: `1px solid ${md3Colors.outlineVariant}`,
          }}
        >
          <Box>
            <Typography variant="titleMedium">Absences</Typography>
            <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, display: 'block', mt: 0.25 }}>
              Scheduled for today but never checked in
              {absent ? ` · ${absent.weekday} ${absent.date}` : ''}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            onClick={handleGenerateAbsences}
            disabled={absentLoading}
            startIcon={<PersonOffOutlinedIcon />}
            sx={{ minHeight: 44, flexShrink: 0 }}
          >
            {absentLoading ? 'Generating…' : 'Generate absences'}
          </Button>
        </Box>

        <Box sx={{ p: 1.5 }}>
          {!absent ? (
            <Typography
              variant="bodyMedium"
              sx={{ color: md3Colors.onSurfaceVariant, textAlign: 'center', py: 4 }}
            >
              Tap Generate when you want the absent list for today
            </Typography>
          ) : absent.expected_count === 0 ? (
            <Box
              sx={{
                textAlign: 'center',
                py: 4,
                px: 2,
                borderRadius: `${shape.large}px`,
                bgcolor: md3Colors.surfaceVariant,
              }}
            >
              <PersonOffOutlinedIcon sx={{ fontSize: 40, color: md3Colors.outline, mb: 1 }} />
              <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
                {absent.unchecked_schedule_count > 0
                  ? `No students scheduled for ${absent.weekday}. ${absent.unchecked_schedule_count} active students have no schedule days — set days in Admin (or re-upload a CRM export that includes days).`
                  : 'No students are scheduled for today.'}
              </Typography>
            </Box>
          ) : absent.count === 0 ? (
            <Typography
              variant="bodyMedium"
              sx={{ color: md3Colors.onSurfaceVariant, textAlign: 'center', py: 4 }}
            >
              Everyone expected today has checked in ({absent.expected_count})
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {absent.students.map((student) => (
                <Box
                  key={student.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1.5,
                    borderRadius: `${shape.medium}px`,
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="titleSmall" noWrap>
                      {student.name}
                    </Typography>
                    <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                      Enrolled · {student.enrolled_subjects_label}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label="Absent"
                    sx={{
                      bgcolor: md3Colors.errorContainer,
                      color: md3Colors.onErrorContainer,
                      fontWeight: 500,
                    }}
                  />
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Paper>

      <Dialog
        open={Boolean(checkoutTarget)}
        onClose={() => !checkingOut && setCheckoutTarget(null)}
        PaperProps={{ sx: { borderRadius: `${shape.extraLarge}px` } }}
      >
        <DialogTitle>Check out {checkoutTarget?.name}?</DialogTitle>
        <DialogContent>
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
            In since {checkoutTarget ? formatTime(checkoutTarget.check_in_time, timezone) : '—'}
            {checkoutTarget?.is_overtime
              ? ` · currently +${checkoutTarget.overtime_minutes} min over`
              : ''}
            . Session length is stamped from timeapi.io on check-out.
          </Typography>
          {/* agent-2-pickup-auth */}
          {pickupCaregivers.length > 0 && (
            <TextField
              select
              label="Picked up by — optional"
              value={pickedUpBy}
              onChange={(e) => setPickedUpBy(e.target.value)}
              fullWidth
              size="small"
              disabled={checkingOut}
              helperText="Leave unselected if nobody is logging the pickup"
              sx={{ mt: 2.5, '& .MuiInputBase-root': { minHeight: 44 } }}
            >
              <MenuItem value="" sx={{ minHeight: 44 }}>
                Not recorded
              </MenuItem>
              {pickupCaregivers.map((caregiver) => (
                <MenuItem key={caregiver.id} value={caregiver.id} sx={{ minHeight: 44 }}>
                  {caregiver.name}
                  {caregiver.relationship ? ` · ${caregiver.relationship}` : ''}
                  {caregiver.is_primary ? ' · primary' : ''}
                </MenuItem>
              ))}
            </TextField>
          )}
          {/* agent-5-resources */}
          {(materialsCatalog || []).some((r) => r.quantity_on_hand > 0) && (
            <Autocomplete
              multiple
              size="small"
              options={materialsCatalog.filter((r) => r.quantity_on_hand > 0)}
              value={materialsUsed}
              onChange={(_e, value) => setMaterialsUsed(value)}
              getOptionLabel={(option) => option.name || ''}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              disabled={checkingOut}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Materials used (optional)"
                  placeholder="e.g. worksheet pack, pencil"
                />
              )}
              sx={{ mt: 2.5, minWidth: { sm: 360 } }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setCheckoutTarget(null)} disabled={checkingOut}>
            Cancel
          </Button>
          <Button variant="contained" onClick={confirmCheckOut} disabled={checkingOut} autoFocus>
            {checkingOut ? 'Checking out…' : 'Check out'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
