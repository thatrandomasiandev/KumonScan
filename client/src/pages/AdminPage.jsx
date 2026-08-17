import { useEffect, useCallback, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Paper,
  Button,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Fab,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  InputAdornment,
  IconButton,
  CircularProgress,
  Tabs,
  Tab,
  MenuItem,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ClearOutlinedIcon from '@mui/icons-material/ClearOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import { api, formatTime, formatDuration } from '../api';
import PageHeader from '../components/PageHeader';
import LoadingScreen from '../components/LoadingScreen';
import StaffPanel from '../components/StaffPanel';
import DataPortabilityPanel from '../components/DataPortabilityPanel'; // agent-10-data-portability
import ResourceInventory from '../components/ResourceInventory'; // agent-5-resources
import CaregiverManager from '../components/CaregiverManager'; // agent-2-pickup-auth
import { useSnackbar } from '../components/SnackbarProvider';
import { DEFAULT_LANGUAGE, getLanguageOptions } from '../i18n';
import { md3Colors, getElevatedSurface, shape } from '../theme';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SUBJECT_OPTIONS = [
  { value: 'math', label: 'Math' },
  { value: 'reading', label: 'Reading' },
  { value: 'both', label: 'Both' },
];

function subjectLabel(value) {
  return SUBJECT_OPTIONS.find((o) => o.value === value)?.label || 'Both';
}

// Session correction inputs use the browser's local time (the front-desk
// device is physically at the center, so local time is center time).
function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function elapsedMinutes(checkInTime, nowMs = Date.now()) {
  return Math.max(0, Math.round((nowMs - new Date(checkInTime).getTime()) / 60000));
}

function StudentInitials({ name }) {
  const parts = name.split(' ');
  const initials = ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase();

  return (
    <Avatar
      sx={{
        bgcolor: md3Colors.primaryContainer,
        color: md3Colors.onPrimaryContainer,
        width: 40,
        height: 40,
        fontSize: '14px',
        fontWeight: 500,
      }}
    >
      {initials}
    </Avatar>
  );
}

function CurrentlyHere({ present, timezone }) {
  const { students, count, overtime_count: overtimeCount = 0, clock_iso: clockIso } = present;
  const clockSkewMs = clockIso ? new Date(clockIso).getTime() - Date.now() : 0;
  const nowMs = Date.now() + (Number.isFinite(clockSkewMs) ? clockSkewMs : 0);

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
            Currently here
          </Typography>
          <Typography
            variant="bodySmall"
            sx={{
              color: overtimeCount > 0 ? md3Colors.onErrorContainer : md3Colors.onSurfaceVariant,
              mt: 0.25,
            }}
          >
            Open sessions on the floor
            {overtimeCount > 0 ? ` · ${overtimeCount} over time` : ''}
          </Typography>
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
            {count}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ p: 2 }}>
        {students.length === 0 ? (
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
              Floor is clear — no open check-ins
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {students.map((student, i) => {
              const overtime = Boolean(student.is_overtime);
              const elapsed = student.elapsed_minutes ?? elapsedMinutes(student.check_in_time, nowMs);
              return (
                <Box
                  key={student.session_id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1.5,
                    borderRadius: `${shape.medium}px`,
                    bgcolor: overtime ? md3Colors.errorContainer : 'transparent',
                    borderBottom:
                      i < students.length - 1 ? `1px solid ${md3Colors.outlineVariant}` : 'none',
                    '&:hover': {
                      bgcolor: overtime
                        ? 'color-mix(in srgb, #FFDAD6 85%, #BA1A1A 15%)'
                        : 'rgba(26,27,34,0.04)',
                    },
                  }}
                >
                  <Avatar
                    sx={{
                      bgcolor: overtime ? md3Colors.error : md3Colors.tertiaryContainer,
                      color: overtime ? md3Colors.onPrimary : md3Colors.tertiary,
                      width: 40,
                      height: 40,
                      fontSize: '14px',
                      fontWeight: 500,
                    }}
                  >
                    {student.name
                      .split(' ')
                      .map((p) => p[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="titleSmall"
                      noWrap
                      sx={{ color: overtime ? md3Colors.onErrorContainer : 'inherit' }}
                    >
                      {student.name}
                    </Typography>
                    <Typography
                      variant="bodySmall"
                      sx={{
                        color: overtime ? md3Colors.onErrorContainer : md3Colors.onSurfaceVariant,
                        opacity: overtime ? 0.85 : 1,
                      }}
                    >
                      {(student.subjects_label || 'Session') + ' · '}
                      In since {formatTime(student.check_in_time, timezone)}
                    </Typography>
                  </Box>
                  <Chip
                    label={
                      overtime
                        ? `${formatDuration(elapsed)} (+${student.overtime_minutes})`
                        : formatDuration(elapsed)
                    }
                    size="small"
                    sx={{
                      bgcolor: overtime ? md3Colors.error : md3Colors.tertiaryContainer,
                      color: overtime ? md3Colors.onPrimary : md3Colors.tertiary,
                      fontWeight: 500,
                    }}
                  />
                </Box>
              );
            })}
          </List>
        )}
      </Box>
    </Paper>
  );
}

function StudentScheduleEditor({ student, onSaved }) {
  const { showSnackbar } = useSnackbar();
  const [enrolled, setEnrolled] = useState(student.enrolled_subjects || 'both');
  const [days, setDays] = useState(() => student.schedule_days || []);
  const [phone, setPhone] = useState(student.parent_phone || '');
  const [notifyChannel, setNotifyChannel] = useState(student.notify_channel || 'sms');
  const [whatsapp, setWhatsapp] = useState(student.parent_whatsapp || '');
  const [language, setLanguage] = useState(student.preferred_language || DEFAULT_LANGUAGE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnrolled(student.enrolled_subjects || 'both');
    setDays(student.schedule_days || []);
    setPhone(student.parent_phone || '');
    setNotifyChannel(student.notify_channel || 'sms');
    setWhatsapp(student.parent_whatsapp || '');
    setLanguage(student.preferred_language || DEFAULT_LANGUAGE);
  }, [
    student.id,
    student.enrolled_subjects,
    student.schedule_days,
    student.parent_phone,
    student.notify_channel,
    student.parent_whatsapp,
    student.preferred_language,
  ]);

  const dirty =
    enrolled !== (student.enrolled_subjects || 'both') ||
    JSON.stringify([...(days || [])].sort()) !==
      JSON.stringify([...(student.schedule_days || [])].sort()) ||
    phone.trim() !== (student.parent_phone || '') ||
    notifyChannel !== (student.notify_channel || 'sms') ||
    whatsapp.trim() !== (student.parent_whatsapp || '') ||
    language !== (student.preferred_language || DEFAULT_LANGUAGE);

  function toggleDay(day) {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateStudent(student.id, {
        enrolled_subjects: enrolled,
        schedule_days: days,
        parent_phone: phone.trim() || null,
        notify_channel: notifyChannel,
        parent_whatsapp: whatsapp.trim() || null,
        preferred_language: language,
      });
      showSnackbar(`Saved for ${updated.name}`);
      onSaved?.(updated);
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!student.active) return null;

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="titleMedium" sx={{ mb: 1 }}>
        Enrollment
      </Typography>
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 1.5, display: 'block' }}>
        Subjects and expected days drive desk defaults and the absence list
      </Typography>

      <ToggleButtonGroup
        exclusive
        fullWidth
        value={enrolled}
        onChange={(_e, next) => {
          if (next) setEnrolled(next);
        }}
        aria-label="Enrolled subjects"
        sx={{
          mb: 2.5,
          gap: 1,
          '& .MuiToggleButtonGroup-grouped': {
            border: `1px solid ${md3Colors.outlineVariant} !important`,
            borderRadius: `${shape.medium}px !important`,
            flex: 1,
            textTransform: 'none',
            py: 1,
            color: md3Colors.onSurfaceVariant,
            '&.Mui-selected': {
              bgcolor: md3Colors.primaryContainer,
              color: md3Colors.onPrimaryContainer,
              borderColor: `${md3Colors.primary} !important`,
            },
          },
        }}
      >
        {SUBJECT_OPTIONS.map((opt) => (
          <ToggleButton key={opt.value} value={opt.value}>
            {opt.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Typography variant="labelLarge" sx={{ display: 'block', mb: 1, color: md3Colors.onSurfaceVariant }}>
        Scheduled days
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        {WEEKDAYS.map((day) => {
          const selected = days.includes(day);
          return (
            <Chip
              key={day}
              label={day}
              clickable
              onClick={() => toggleDay(day)}
              aria-pressed={selected}
              sx={{
                minWidth: 52,
                minHeight: 44,
                fontWeight: 500,
                bgcolor: selected ? md3Colors.primaryContainer : md3Colors.surfaceVariant,
                color: selected ? md3Colors.onPrimaryContainer : md3Colors.onSurfaceVariant,
                border: selected ? `1px solid ${md3Colors.primary}` : `1px solid transparent`,
              }}
            />
          );
        })}
      </Box>

      <Typography variant="labelLarge" sx={{ display: 'block', mb: 1, color: md3Colors.onSurfaceVariant }}>
        Parent / guardian phone
      </Typography>
      <TextField
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="e.g. +1 213 555 0100"
        fullWidth
        size="small"
        inputProps={{ inputMode: 'tel' }}
        InputProps={{
          startAdornment: (
            <PhoneOutlinedIcon sx={{ fontSize: 18, color: md3Colors.onSurfaceVariant, mr: 1 }} />
          ),
        }}
        helperText="Used for SMS check-in/check-out notifications and staff messages."
        sx={{ mb: 2.5 }}
      />

      <Typography variant="labelLarge" sx={{ display: 'block', mb: 1, color: md3Colors.onSurfaceVariant }}>
        Notification channel
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        value={notifyChannel}
        onChange={(_e, next) => {
          if (next) setNotifyChannel(next);
        }}
        aria-label="Notification channel"
        sx={{
          mb: 2.5,
          gap: 1,
          '& .MuiToggleButtonGroup-grouped': {
            border: `1px solid ${md3Colors.outlineVariant} !important`,
            borderRadius: `${shape.medium}px !important`,
            flex: 1,
            textTransform: 'none',
            py: 1,
            color: md3Colors.onSurfaceVariant,
            '&.Mui-selected': {
              bgcolor: md3Colors.primaryContainer,
              color: md3Colors.onPrimaryContainer,
              borderColor: `${md3Colors.primary} !important`,
            },
          },
        }}
      >
        <ToggleButton value="sms">SMS</ToggleButton>
        <ToggleButton value="whatsapp">WhatsApp</ToggleButton>
      </ToggleButtonGroup>

      {notifyChannel === 'whatsapp' && (
        <TextField
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="e.g. +1 213 555 0100"
          fullWidth
          size="small"
          inputProps={{ inputMode: 'tel' }}
          InputProps={{
            startAdornment: (
              <WhatsAppIcon sx={{ fontSize: 18, color: md3Colors.onSurfaceVariant, mr: 1 }} />
            ),
          }}
          helperText="WhatsApp number (may differ from the phone above). If empty, notifications fall back to SMS."
          sx={{ mb: 2.5 }}
        />
      )}

      <Typography variant="labelLarge" sx={{ display: 'block', mb: 1, color: md3Colors.onSurfaceVariant }}>
        Family language
      </Typography>
      <TextField
        select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        fullWidth
        size="small"
        InputProps={{
          startAdornment: (
            <LanguageOutlinedIcon sx={{ fontSize: 18, color: md3Colors.onSurfaceVariant, mr: 1 }} />
          ),
        }}
        helperText="Language for parent notifications (pickup texts) and the registration page."
        sx={{ mb: 3 }}
      >
        {getLanguageOptions().map((opt) => (
          <MenuItem key={opt.code} value={opt.code}>
            {opt.nativeName}
          </MenuItem>
        ))}
      </TextField>

      <Button variant="contained" onClick={handleSave} disabled={!dirty || saving} sx={{ mt: 0.5 }}>
        {saving ? 'Saving…' : 'Save enrollment'}
      </Button>
    </Box>
  );
}

function StudentSessionHistory({ student }) {
  const { showSnackbar } = useSnackbar();
  const [sessions, setSessions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    if (sessions !== null) return;
    setLoading(true);
    try {
      const data = await api.getStudentSessions(student.id);
      setSessions(data.sessions || []);
    } catch (err) {
      showSnackbar(err.message);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [student.id, sessions, showSnackbar]);

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next) load();
  }

  function openEdit(session) {
    setEditingSession(session);
    setEditCheckIn(toDatetimeLocalValue(session.check_in_time));
    setEditCheckOut(toDatetimeLocalValue(session.check_out_time));
  }

  function closeEdit() {
    setEditingSession(null);
  }

  async function saveEdit() {
    const check_in_time = fromDatetimeLocalValue(editCheckIn);
    if (!check_in_time) {
      showSnackbar('Check-in time is required');
      return;
    }
    const wasOpen = !editingSession.check_out_time;
    const check_out_time = wasOpen ? undefined : fromDatetimeLocalValue(editCheckOut);
    if (!wasOpen && !check_out_time) {
      showSnackbar('Check-out time is required');
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await api.updateSession(student.id, editingSession.id, {
        check_in_time,
        check_out_time,
      });
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      showSnackbar('Session updated');
      setEditingSession(null);
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  // Reset when student changes.
  useEffect(() => {
    setSessions(null);
    setExpanded(false);
  }, [student.id]);

  const timezone = 'America/Los_Angeles';

  return (
    <Box sx={{ mt: 3 }}>
      <Box
        component="button"
        type="button"
        onClick={handleToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          width: '100%',
          border: 'none',
          background: 'none',
          p: 1,
          mx: -1,
          minHeight: 44,
          cursor: 'pointer',
          borderRadius: `${shape.small}px`,
          mb: expanded ? 1.5 : 0,
          '&:focus-visible': {
            outline: `3px solid ${md3Colors.primary}66`,
            outlineOffset: 2,
          },
        }}
        aria-expanded={expanded}
      >
        <HistoryOutlinedIcon sx={{ fontSize: 18, color: md3Colors.onSurfaceVariant }} />
        <Typography variant="titleSmall" sx={{ flex: 1, textAlign: 'left', color: md3Colors.onSurface }}>
          Session history
        </Typography>
        {sessions !== null && (
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          </Typography>
        )}
        <Typography variant="bodySmall" sx={{ color: md3Colors.primary, ml: 0.5 }}>
          {expanded ? 'Hide' : 'Show'}
        </Typography>
      </Box>

      {expanded && (
        <Box>
          {loading && (
            <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, py: 2 }}>
              Loading…
            </Typography>
          )}
          {!loading && sessions !== null && sessions.length === 0 && (
            <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, py: 2 }}>
              No sessions recorded yet.
            </Typography>
          )}
          {!loading && sessions && sessions.length > 0 && (
            <Box
              sx={{
                border: `1px solid ${md3Colors.outlineVariant}`,
                borderRadius: `${shape.medium}px`,
                overflow: 'hidden',
              }}
            >
              {sessions.slice(0, 50).map((session, i) => {
                const isOvertime =
                  session.duration_minutes != null &&
                  session.allowance_minutes != null &&
                  session.duration_minutes > session.allowance_minutes;
                const overtimeMin = isOvertime
                  ? Math.round(session.duration_minutes - session.allowance_minutes)
                  : 0;
                const isOpen = !session.check_out_time;

                return (
                  <Box
                    key={session.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 2,
                      py: 1.25,
                      borderBottom:
                        i < Math.min(sessions.length, 50) - 1
                          ? `1px solid ${md3Colors.outlineVariant}`
                          : 'none',
                      bgcolor: isOpen ? md3Colors.tertiaryContainer : 'transparent',
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="bodySmall" noWrap>
                        {formatTime(session.check_in_time, timezone)}
                      </Typography>
                      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                        {session.subjects_label || session.subjects || 'Session'}
                        {session.check_out_time
                          ? ` → ${new Date(session.check_out_time).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })}`
                          : ' · open'}
                      </Typography>
                    </Box>
                    {isOpen ? (
                      <Chip
                        size="small"
                        label="Open"
                        sx={{ bgcolor: md3Colors.tertiaryContainer, color: md3Colors.tertiary, fontWeight: 500 }}
                      />
                    ) : (
                      <Chip
                        size="small"
                        icon={isOvertime ? <WarningAmberOutlinedIcon /> : undefined}
                        label={
                          isOvertime
                            ? `${formatDuration(session.duration_minutes)} (+${overtimeMin}m)`
                            : formatDuration(session.duration_minutes)
                        }
                        sx={{
                          bgcolor: isOvertime ? md3Colors.errorContainer : md3Colors.surfaceVariant,
                          color: isOvertime ? md3Colors.onErrorContainer : md3Colors.onSurfaceVariant,
                          fontWeight: 500,
                          '& .MuiChip-icon': { color: 'inherit' },
                        }}
                      />
                    )}
                    <IconButton
                      size="small"
                      aria-label="Correct this session's time"
                      onClick={() => openEdit(session)}
                      sx={{ color: md3Colors.onSurfaceVariant }}
                    >
                      <EditOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Box>
                );
              })}
              {sessions.length > 50 && (
                <Box sx={{ px: 2, py: 1, bgcolor: md3Colors.surfaceVariant }}>
                  <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                    Showing 50 of {sessions.length} sessions. Export CSV from Dashboard for full history.
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}

      <Dialog open={Boolean(editingSession)} onClose={closeEdit} fullWidth maxWidth="xs">
        <DialogTitle>Correct session time</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Check-in"
              type="datetime-local"
              value={editCheckIn}
              onChange={(e) => setEditCheckIn(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            {editingSession && !editingSession.check_out_time ? (
              <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                This session is still open — only the check-in time can be corrected here.
              </Typography>
            ) : (
              <TextField
                label="Check-out"
                type="datetime-local"
                value={editCheckOut}
                onChange={(e) => setEditCheckOut(e.target.value)}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEdit} disabled={savingEdit}>
            Cancel
          </Button>
          <Button onClick={saveEdit} variant="contained" disabled={savingEdit}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const DIGEST_STATUS_STYLES = {
  sent: { label: 'Sent', bgcolor: md3Colors.tertiaryContainer, color: md3Colors.tertiary },
  pending: { label: 'Awaiting channel', bgcolor: md3Colors.surfaceVariant, color: md3Colors.onSurfaceVariant },
  failed: { label: 'Failed', bgcolor: md3Colors.errorContainer, color: md3Colors.onErrorContainer },
  skipped_no_contact: { label: 'No contact', bgcolor: 'transparent', color: md3Colors.onSurfaceVariant },
};

function DigestStatusChip({ status }) {
  const style = DIGEST_STATUS_STYLES[status] || {
    label: status,
    bgcolor: md3Colors.surfaceVariant,
    color: md3Colors.onSurfaceVariant,
  };
  return (
    <Chip
      size="small"
      label={style.label}
      variant={status === 'skipped_no_contact' ? 'outlined' : 'filled'}
      sx={{ bgcolor: style.bgcolor, color: style.color, fontWeight: 500 }}
    />
  );
}

function ProgressDigestsSection({ timezone }) {
  const { showSnackbar } = useSnackbar();
  const [digests, setDigests] = useState(null);
  const [filter, setFilter] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getDigests();
      setDigests(data.digests || []);
    } catch (err) {
      showSnackbar(err.message);
      setDigests([]);
    }
  }, [showSnackbar]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSendNow() {
    setSending(true);
    try {
      const result = await api.sendDigestsNow();
      const c = result.counts || {};
      showSnackbar(
        `Digests for ${result.period_start} to ${result.period_end}: ` +
          `${c.sent || 0} sent, ${c.pending_no_channel || 0} awaiting channel, ` +
          `${c.skipped_no_contact || 0} no contact, ${c.skipped_duplicate || 0} already generated, ` +
          `${c.failed || 0} failed`
      );
      await load();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setSending(false);
    }
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!digests) return [];
    if (!q) return digests;
    return digests.filter((d) => d.student_name.toLowerCase().includes(q));
  }, [digests, filter]);

  const awaitingChannel = useMemo(
    () => (digests || []).some((d) => d.status === 'pending'),
    [digests]
  );

  return (
    <Paper
      elevation={0}
      sx={{
        mt: 3,
        p: 3,
        borderRadius: `${shape.large}px`,
        bgcolor: getElevatedSurface(1),
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="titleMedium" sx={{ flex: 1, minWidth: 200 }}>
          Progress Digests
        </Typography>
        <Button
          variant="contained"
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendOutlinedIcon />}
          onClick={handleSendNow}
          disabled={sending}
        >
          {sending ? 'Sending…' : 'Send now'}
        </Button>
      </Box>
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 2, display: 'block' }}>
        Weekly attendance summaries for parents, generated every Monday for the completed
        Mon–Sun week. Re-running a week never double-sends.
        {awaitingChannel &&
          ' Delivery is blocked until an SMS or WhatsApp channel is installed; digests are generated and logged in the meantime.'}
      </Typography>

      <TextField
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by student name"
        size="small"
        fullWidth
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchOutlinedIcon sx={{ fontSize: 20, color: md3Colors.onSurfaceVariant }} />
            </InputAdornment>
          ),
        }}
      />

      {digests === null ? (
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, py: 2 }}>
          Loading…
        </Typography>
      ) : visible.length === 0 ? (
        <Box
          sx={{
            textAlign: 'center',
            py: 4,
            px: 2,
            borderRadius: `${shape.medium}px`,
            bgcolor: md3Colors.surfaceVariant,
          }}
        >
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
            {digests.length === 0
              ? 'No digests yet. The Monday cron or the Send now button creates the first batch.'
              : `No digests match “${filter.trim()}”`}
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            border: `1px solid ${md3Colors.outlineVariant}`,
            borderRadius: `${shape.medium}px`,
            overflow: 'hidden',
          }}
        >
          {visible.map((digest, i) => (
            <Box
              key={digest.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1.25,
                borderBottom: i < visible.length - 1 ? `1px solid ${md3Colors.outlineVariant}` : 'none',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="titleSmall" noWrap>
                  {digest.student_name}
                </Typography>
                <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                  Week {digest.period_start} to {digest.period_end}
                  {digest.status === 'sent' && digest.sent_at
                    ? ` · sent ${formatTime(digest.sent_at, timezone)} via ${digest.channel}`
                    : ''}
                </Typography>
              </Box>
              <DigestStatusChip status={digest.status} />
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}

export default function AdminPage() {
  const [students, setStudents] = useState([]);
  const [present, setPresent] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [newStudent, setNewStudent] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [rosterQuery, setRosterQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [rosterImporting, setRosterImporting] = useState(false);
  const [rosterImportResult, setRosterImportResult] = useState(null);
  const [rosterImportError, setRosterImportError] = useState('');
  const [rosterMode, setRosterMode] = useState('merge');
  const [rosterReplaceConfirmed, setRosterReplaceConfirmed] = useState(false);
  const [scheduleBulkDays, setScheduleBulkDays] = useState(['Mon', 'Wed', 'Fri']);
  const [scheduleBulkScope, setScheduleBulkScope] = useState('missing');
  const [scheduleBulkBusy, setScheduleBulkBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('students');
  const { showSnackbar } = useSnackbar();

  async function loadData() {
    try {
      const [studentsData, presentData] = await Promise.all([
        api.getStudents(),
        api.getPresent(),
      ]);
      setStudents(studentsData);
      setPresent(presentData);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const filteredStudents = useMemo(() => {
    const q = rosterQuery.trim().toLowerCase();
    return students.filter((student) => {
      if (!showInactive && !student.active) return false;
      if (!q) return true;
      return (
        student.name.toLowerCase().includes(q) ||
        student.first_name?.toLowerCase().includes(q) ||
        student.last_name?.toLowerCase().includes(q) ||
        String(student.student_number ?? '').includes(q)
      );
    });
  }, [students, rosterQuery, showInactive]);

  const inactiveCount = useMemo(
    () => students.filter((s) => !s.active).length,
    [students]
  );

  function selectStudent(student) {
    setSelectedStudent(student);
    setShowAddPanel(false);
  }

  function handleRosterSearchKeyDown(e) {
    if (e.key !== 'Enter' || filteredStudents.length === 0) return;
    e.preventDefault();
    selectStudent(filteredStudents[0]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const student = await api.createStudent(firstName.trim(), lastName.trim());
      setNewStudent(student);
      setSelectedStudent(student);
      setFirstName('');
      setLastName('');
      setShowAddPanel(false);
      setRosterQuery(`${student.first_name} ${student.last_name}`.trim());
      showSnackbar(`${student.name} added successfully`);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(id) {
    try {
      await api.deactivateStudent(id);
      setDeactivateTarget(null);
      if (selectedStudent?.id === id) setSelectedStudent(null);
      showSnackbar('Student deactivated');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRosterFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (rosterMode === 'replace' && !rosterReplaceConfirmed) {
      setRosterImportError('Check the confirmation box before replacing the entire roster.');
      return;
    }

    const maxBytes = 8 * 1024 * 1024;
    if (file.size > maxBytes) {
      setRosterImportError('File is too large. Maximum size is 8MB.');
      setRosterImportResult(null);
      return;
    }

    setRosterImporting(true);
    setRosterImportError('');
    setRosterImportResult(null);

    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const content = isXlsx ? await fileToBase64(file) : await file.text();
      const result = await api.importRoster({
        filename: file.name,
        content,
        format: isXlsx ? 'xlsx' : 'text',
        mode: rosterMode,
        confirm_replace: rosterMode === 'replace',
      });
      setRosterImportResult(result);
      const deactivatedNote = result.deactivated ? `, ${result.deactivated} deactivated` : '';
      showSnackbar(
        `Roster imported: ${result.created} created, ${result.updated} updated${deactivatedNote}, ${result.skipped + result.errored} anomalies`
      );
      setRosterReplaceConfirmed(false);
      await loadData();
    } catch (err) {
      const message = err.message || 'Roster import failed';
      setRosterImportError(message);
      showSnackbar(message);
    } finally {
      setRosterImporting(false);
    }
  }

  async function handleDownloadRosterTemplate(format) {
    try {
      const { blob, filename } = await api.downloadRosterTemplate(format);
      downloadBlob(blob, filename);
    } catch (err) {
      showSnackbar(err.message);
    }
  }

  async function handleScheduleBulkApply() {
    if (!scheduleBulkDays.length) {
      showSnackbar('Pick at least one weekday');
      return;
    }
    setScheduleBulkBusy(true);
    try {
      const result = await api.applyScheduleBulk({
        days: scheduleBulkDays,
        scope: scheduleBulkScope,
      });
      showSnackbar(
        `Schedules updated for ${result.updated} student${result.updated === 1 ? '' : 's'} (${result.days.join(', ')})`
      );
      await loadData();
    } catch (err) {
      showSnackbar(err.message || 'Bulk schedule failed');
    } finally {
      setScheduleBulkBusy(false);
    }
  }

  if (loading) return <LoadingScreen message="Loading admin panel..." />;

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', px: 2, py: 4, pb: { xs: 12, md: 4 }, position: 'relative' }}>
      <PageHeader title="Admin" subtitle="Manage students, staff, and live attendance" />

      <Tabs
        value={activeTab}
        onChange={(_e, next) => setActiveTab(next)}
        sx={{
          mb: 2.5,
          minHeight: 44,
          '& .MuiTab-root': { minHeight: 44, textTransform: 'none', fontWeight: 500 },
        }}
      >
        <Tab label="Students" value="students" />
        <Tab label="Staff & center" value="staff" />
      </Tabs>

      {activeTab === 'staff' && (
        <>
          <StaffPanel timezone={present?.timezone} />
          {/* agent-5-resources */}
          <ResourceInventory />
          {/* agent-10-data-portability */}
          <DataPortabilityPanel />
        </>
      )}

      {activeTab === 'students' && present && (
        <CurrentlyHere present={present} timezone={present.timezone} />
      )}

      {activeTab === 'students' && error && (
        <Typography variant="bodyMedium" sx={{ color: md3Colors.error, mb: 2 }}>
          {error}
        </Typography>
      )}

      <Box
        sx={{
          display: activeTab === 'students' ? 'flex' : 'none',
          gap: 2,
          alignItems: 'stretch',
          minHeight: { md: 'min(70vh, 720px)' },
          height: { md: 'min(70vh, 720px)' },
        }}
      >
        {/* Left pane — student list */}
        <Paper
          elevation={0}
          sx={{
            width: { xs: '100%', md: 360 },
            flexShrink: 0,
            borderRadius: `${shape.large}px`,
            bgcolor: getElevatedSurface(1),
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            overflow: 'hidden',
            display: { xs: selectedStudent ? 'none' : 'flex', md: 'flex' },
            flexDirection: 'column',
            minHeight: { xs: 360, md: 0 },
            maxHeight: { xs: 'none', md: 'none' },
            flex: { xs: 1, md: 'unset' },
          }}
        >
          <Box
            sx={{
              p: 2,
              borderBottom: `1px solid ${md3Colors.outlineVariant}`,
              flexShrink: 0,
              position: { xs: 'sticky', md: 'static' },
              top: 0,
              zIndex: 1,
              bgcolor: getElevatedSurface(1),
            }}
          >
            <Typography variant="titleMedium" sx={{ mb: 1.5 }}>
              Students
              <Typography component="span" variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, ml: 1 }}>
                {rosterQuery.trim() || showInactive
                  ? `${filteredStudents.length} of ${students.length}`
                  : students.length}
              </Typography>
            </Typography>

            <TextField
              value={rosterQuery}
              onChange={(e) => setRosterQuery(e.target.value)}
              onKeyDown={handleRosterSearchKeyDown}
              placeholder="Search name or student number"
              fullWidth
              size="small"
              autoFocus
              inputProps={{ 'aria-label': 'Search students' }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlinedIcon sx={{ fontSize: 20, color: md3Colors.onSurfaceVariant }} />
                  </InputAdornment>
                ),
                endAdornment: rosterQuery ? (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="Clear search"
                      size="small"
                      onClick={() => setRosterQuery('')}
                      edge="end"
                    >
                      <ClearOutlinedIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
              helperText="Press Enter to open the top match"
              sx={{ mb: inactiveCount > 0 ? 1.25 : 0 }}
            />

            {inactiveCount > 0 && (
              <Chip
                size="small"
                clickable
                label={showInactive ? `Hide inactive (${inactiveCount})` : `Show inactive (${inactiveCount})`}
                onClick={() => setShowInactive((v) => !v)}
                aria-pressed={showInactive}
                sx={{
                  bgcolor: showInactive ? md3Colors.primaryContainer : md3Colors.surfaceVariant,
                  color: showInactive ? md3Colors.onPrimaryContainer : md3Colors.onSurfaceVariant,
                }}
              />
            )}
          </Box>

          <List disablePadding sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {filteredStudents.map((student) => (
              <ListItemButton
                key={student.id}
                selected={selectedStudent?.id === student.id}
                onClick={() => selectStudent(student)}
                sx={{
                  minHeight: 64,
                  opacity: student.active ? 1 : 0.5,
                  '&.Mui-selected': {
                    bgcolor: md3Colors.primaryContainer,
                    '&:hover': { bgcolor: md3Colors.primaryContainer },
                  },
                }}
              >
                <ListItemAvatar>
                  <StudentInitials name={student.name} />
                </ListItemAvatar>
                <ListItemText
                  primary={student.name}
                  secondary={
                    <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }} noWrap>
                      {student.student_number ? `#${student.student_number}` : ''}
                      {!student.active ? ' · inactive' : ''}
                    </Typography>
                  }
                />
              </ListItemButton>
            ))}
            {students.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 6 }}>
                <PersonOutlinedIcon sx={{ fontSize: 48, color: md3Colors.surfaceVariant, mb: 1 }} />
                <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
                  No students yet
                </Typography>
              </Box>
            )}
            {students.length > 0 && filteredStudents.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
                <SearchOutlinedIcon sx={{ fontSize: 40, color: md3Colors.outline, mb: 1 }} />
                <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
                  No students match “{rosterQuery.trim()}”
                </Typography>
                <Button variant="text" onClick={() => setRosterQuery('')} sx={{ mt: 1 }}>
                  Clear search
                </Button>
              </Box>
            )}
          </List>
        </Paper>

        {/* Right pane — detail / add */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: 'auto',
            display: { xs: selectedStudent || showAddPanel ? 'block' : 'none', md: 'block' },
          }}
        >
          {showAddPanel || !selectedStudent ? (
            <Paper
              elevation={0}
              sx={{
                p: 3,
                borderRadius: `${shape.large}px`,
                bgcolor: getElevatedSurface(1),
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <Typography variant="titleMedium" sx={{ mb: 1 }}>
                Import Roster
              </Typography>
              <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 1.5 }}>
                After Personal Orientations, export students from the Kumon CRM and upload here. This is the
                roster sync path (CRM has no public API). Name match updates existing students; new names are
                added. The standard CRM export has no schedule-day column — set days below after import.
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                  Sample file:
                </Typography>
                <Button size="small" onClick={() => handleDownloadRosterTemplate('csv')}>
                  Download CSV
                </Button>
                <Button size="small" onClick={() => handleDownloadRosterTemplate('xlsx')}>
                  Download XLSX
                </Button>
              </Box>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={rosterMode}
                onChange={(_e, value) => {
                  if (!value) return;
                  setRosterMode(value);
                  setRosterReplaceConfirmed(false);
                }}
                sx={{ mb: rosterMode === 'replace' ? 1 : 1.5 }}
              >
                <ToggleButton value="merge">Merge with existing roster</ToggleButton>
                <ToggleButton value="replace">Replace entire roster</ToggleButton>
              </ToggleButtonGroup>
              {rosterMode === 'replace' && (
                <Box
                  sx={{
                    mb: 1.5,
                    p: 1.5,
                    borderRadius: `${shape.medium}px`,
                    bgcolor: md3Colors.errorContainer,
                  }}
                >
                  <Typography variant="bodySmall" sx={{ color: md3Colors.onErrorContainer, mb: 0.5 }}>
                    Every active student not in this file will be deactivated. This cannot be undone.
                  </Typography>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={rosterReplaceConfirmed}
                        onChange={(e) => setRosterReplaceConfirmed(e.target.checked)}
                        size="small"
                      />
                    }
                    label="I understand — replace the entire roster"
                  />
                </Box>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
                <Button
                  variant="contained"
                  component="label"
                  startIcon={rosterImporting ? <CircularProgress size={16} color="inherit" /> : <UploadFileOutlinedIcon />}
                  disabled={rosterImporting || (rosterMode === 'replace' && !rosterReplaceConfirmed)}
                  sx={{ minWidth: 200 }}
                >
                  {rosterImporting ? 'Importing…' : 'Upload roster file'}
                  <input
                    hidden
                    type="file"
                    accept=".tsv,.csv,.xlsx,text/tab-separated-values,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleRosterFileSelected}
                  />
                </Button>
                <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                  Max 8MB
                </Typography>
              </Box>
              {rosterImportError && (
                <Typography variant="bodySmall" sx={{ color: md3Colors.error, mb: 1.5 }}>
                  {rosterImportError}
                </Typography>
              )}
              {rosterImportResult && (
                <Box
                  sx={{
                    mb: 2.5,
                    p: 1.5,
                    borderRadius: `${shape.medium}px`,
                    bgcolor: md3Colors.surfaceVariant,
                  }}
                >
                  <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                    {`Detected ${rosterImportResult.delimiter}. Processed ${rosterImportResult.rows_processed} rows: ${rosterImportResult.created} created, ${rosterImportResult.updated} updated${rosterImportResult.deactivated ? `, ${rosterImportResult.deactivated} deactivated` : ''}, ${rosterImportResult.skipped} skipped, ${rosterImportResult.errored} errored.`}
                  </Typography>
                </Box>
              )}

              <Typography variant="titleMedium" sx={{ mb: 1 }}>
                Bulk schedule days
              </Typography>
              <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 1.5, display: 'block' }}>
                Required for Desk absences. Apply a weekday pattern to students missing schedules (or overwrite
                all active).
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                {[
                  { label: 'MWF', days: ['Mon', 'Wed', 'Fri'] },
                  { label: 'TTh', days: ['Tue', 'Thu'] },
                  { label: 'Mon–Fri', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
                ].map((preset) => (
                  <Chip
                    key={preset.label}
                    label={preset.label}
                    onClick={() => setScheduleBulkDays(preset.days)}
                    color={
                      JSON.stringify(scheduleBulkDays) === JSON.stringify(preset.days) ? 'primary' : 'default'
                    }
                    variant={
                      JSON.stringify(scheduleBulkDays) === JSON.stringify(preset.days) ? 'filled' : 'outlined'
                    }
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Box>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={scheduleBulkScope}
                onChange={(_e, next) => {
                  if (next) setScheduleBulkScope(next);
                }}
                sx={{ mb: 1.5, flexWrap: 'wrap' }}
              >
                <ToggleButton value="missing">Only missing schedules</ToggleButton>
                <ToggleButton value="all_active">All active students</ToggleButton>
              </ToggleButtonGroup>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
                {WEEKDAYS.map((day) => {
                  const selected = scheduleBulkDays.includes(day);
                  return (
                    <Chip
                      key={day}
                      label={day}
                      onClick={() =>
                        setScheduleBulkDays((prev) =>
                          selected ? prev.filter((d) => d !== day) : [...prev, day]
                        )
                      }
                      color={selected ? 'primary' : 'default'}
                      variant={selected ? 'filled' : 'outlined'}
                      sx={{ cursor: 'pointer' }}
                    />
                  );
                })}
              </Box>
              <Button
                variant="contained"
                onClick={handleScheduleBulkApply}
                disabled={scheduleBulkBusy || scheduleBulkDays.length === 0}
                sx={{ mb: 2.5 }}
              >
                {scheduleBulkBusy ? 'Applying…' : 'Apply schedule'}
              </Button>

              <Divider sx={{ mb: 3, borderColor: md3Colors.outlineVariant }} />

              <Typography variant="titleMedium" sx={{ mb: 1 }}>
                Add New Student
              </Typography>
              <Divider sx={{ mb: 3, borderColor: md3Colors.outlineVariant }} />

              <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  fullWidth
                />
                <TextField
                  label="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  fullWidth
                />

                <Button type="submit" variant="contained" disabled={submitting}>
                  {submitting ? 'Adding...' : 'Add Student'}
                </Button>
              </Box>

              {newStudent && (
                <Typography variant="bodyMedium" sx={{ color: md3Colors.primary, mt: 2 }}>
                  {newStudent.name} added to the roster
                </Typography>
              )}
            </Paper>
          ) : (
            <Paper
              elevation={0}
              sx={{
                p: 3,
                borderRadius: `${shape.large}px`,
                bgcolor: getElevatedSurface(1),
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Button
                  variant="text"
                  sx={{
                    display: { md: 'none' },
                    minWidth: 44,
                    minHeight: 44,
                    px: 1.5,
                    flexShrink: 0,
                  }}
                  onClick={() => setSelectedStudent(null)}
                  aria-label="Back to student list"
                >
                  ← Back
                </Button>
                <StudentInitials name={selectedStudent.name} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="titleLarge">{selectedStudent.name}</Typography>
                  {selectedStudent.student_number && (
                    <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                      {`Student #${selectedStudent.student_number}`}
                    </Typography>
                  )}
                </Box>
                {!selectedStudent.active && (
                  <Chip label="Inactive" size="small" variant="outlined" />
                )}
              </Box>

              <Divider sx={{ mb: 3, borderColor: md3Colors.outlineVariant }} />

              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                {selectedStudent.active && (
                  <>
                    <Button
                      variant="outlined"
                      onClick={() => setDeactivateTarget(selectedStudent)}
                      sx={{
                        color: md3Colors.error,
                        borderColor: md3Colors.error,
                        '&:hover': { bgcolor: 'rgba(186,26,26,0.08)', borderColor: md3Colors.error },
                      }}
                    >
                      Deactivate
                    </Button>
                  </>
                )}
              </Box>

              <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Chip
                  size="small"
                  label={subjectLabel(selectedStudent.enrolled_subjects)}
                  sx={{ bgcolor: md3Colors.surfaceVariant }}
                />
                {(selectedStudent.schedule_days || []).length > 0 ? (
                  <Chip
                    size="small"
                    label={(selectedStudent.schedule_days || []).join(' · ')}
                    sx={{ bgcolor: md3Colors.surfaceVariant }}
                  />
                ) : (
                  <Chip
                    size="small"
                    label="No schedule set"
                    variant="outlined"
                    sx={{ borderColor: md3Colors.outlineVariant }}
                  />
                )}
              </Box>

              <StudentScheduleEditor
                student={selectedStudent}
                onSaved={(updated) => {
                  setSelectedStudent(updated);
                  setStudents((prev) =>
                    prev.map((s) => (s.id === updated.id ? { ...s, ...updated, stats: s.stats } : s))
                  );
                }}
              />

              <Divider sx={{ my: 2, borderColor: md3Colors.outlineVariant }} />

              {/* agent-2-pickup-auth */}
              <CaregiverManager student={selectedStudent} />

              <Divider sx={{ my: 2, borderColor: md3Colors.outlineVariant }} />

              <StudentSessionHistory student={selectedStudent} />
            </Paper>
          )}
        </Box>
      </Box>

      <ProgressDigestsSection timezone={present?.timezone} />

      <Fab
        color="primary"
        aria-label="Add student"
        onClick={() => {
          setShowAddPanel(true);
          setSelectedStudent(null);
        }}
        sx={{
          display: activeTab === 'students' ? 'flex' : 'none',
          position: 'fixed',
          bottom: {
            xs: 'calc(88px + env(safe-area-inset-bottom))',
            md: 24,
          },
          right: 24,
          width: 56,
          height: 56,
          borderRadius: `${shape.large}px`,
          bgcolor: md3Colors.primaryContainer,
          color: md3Colors.onPrimaryContainer,
          '&:hover': { bgcolor: md3Colors.primaryContainer },
        }}
      >
        <AddOutlinedIcon />
      </Fab>

      <Dialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        PaperProps={{ sx: { borderRadius: `${shape.extraLarge}px` } }}
      >
        <DialogTitle>Deactivate student?</DialogTitle>
        <DialogContent>
          <Typography variant="bodyMedium">
            Deactivate {deactivateTarget?.name}? They'll no longer be checked in at Desk.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeactivateTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="text"
            onClick={() => handleDeactivate(deactivateTarget.id)}
            sx={{ color: md3Colors.error }}
          >
            Deactivate
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
