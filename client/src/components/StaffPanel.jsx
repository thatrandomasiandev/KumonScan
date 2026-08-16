import { useCallback, useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { api, formatDuration, formatTime } from '../api';
import { useSnackbar } from '../components/SnackbarProvider';
import { md3Colors, getElevatedSurface, shape } from '../theme';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthDefaults() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
  };
}

function initials(name) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function SectionCard({ title, subtitle, children }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: `${shape.large}px`,
        bgcolor: getElevatedSurface(1),
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <Typography variant="titleMedium" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography
          variant="bodySmall"
          sx={{ color: md3Colors.onSurfaceVariant, mb: 2, display: 'block' }}
        >
          {subtitle}
        </Typography>
      )}
      {children}
    </Paper>
  );
}

function StaffEditDialog({ staff, onClose, onSaved }) {
  const { showSnackbar } = useSnackbar();
  const [role, setRole] = useState(staff.role || '');
  const [rate, setRate] = useState(staff.hourly_rate != null ? String(staff.hourly_rate) : '');
  const [permissionRole, setPermissionRole] = useState(staff.permission_role || 'front_desk');
  const [email, setEmail] = useState(staff.email || '');
  const [saving, setSaving] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState(null);

  async function handleSave(fields) {
    setSaving(true);
    try {
      await api.updateStaff(staff.id, fields);
      onSaved();
      onClose();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateOrResetLogin() {
    if (!staff.has_login && !email.trim()) {
      showSnackbar('Enter an email first');
      return;
    }
    setLoginBusy(true);
    try {
      const result = staff.has_login
        ? await api.resetStaffPassword(staff.id)
        : await api.createStaffLogin(staff.id, email.trim());
      setTempPassword(result.temp_password);
      onSaved();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setLoginBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} PaperProps={{ sx: { borderRadius: `${shape.extraLarge}px`, width: 360 } }}>
      <DialogTitle>{staff.name}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <TextField
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g. Grader, Assistant"
          fullWidth
          size="small"
        />
        <TextField
          label="Hourly rate ($)"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="e.g. 17.50"
          fullWidth
          size="small"
          inputProps={{ inputMode: 'decimal' }}
          helperText="Used for gross pay on the payroll report"
        />

        <Divider />

        <Typography variant="titleSmall">Permission level</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={permissionRole}
          onChange={(_e, value) => {
            if (!value) return;
            setPermissionRole(value);
            handleSave({ permission_role: value });
          }}
        >
          <ToggleButton value="front_desk">Front desk</ToggleButton>
          <ToggleButton value="manager">Manager</ToggleButton>
        </ToggleButtonGroup>

        <Typography variant="titleSmall">Login</Typography>
        {!staff.has_login && (
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            size="small"
          />
        )}
        {staff.has_login && (
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
            {staff.email}
            {staff.must_change_password ? ' · hasn’t set a permanent password yet' : ''}
          </Typography>
        )}
        <Button
          variant="outlined"
          size="small"
          disabled={loginBusy}
          onClick={handleCreateOrResetLogin}
          sx={{ alignSelf: 'flex-start' }}
        >
          {loginBusy ? 'Working…' : staff.has_login ? 'Reset password' : 'Create login'}
        </Button>
        {tempPassword && (
          <Box
            sx={{
              p: 1.5,
              borderRadius: `${shape.medium}px`,
              bgcolor: md3Colors.tertiaryContainer,
            }}
          >
            <Typography variant="bodySmall" sx={{ color: md3Colors.onTertiaryContainer }}>
              Temporary password — share this with {staff.first_name} now, it won&rsquo;t be shown again:
            </Typography>
            <Typography variant="titleMedium" sx={{ color: md3Colors.onTertiaryContainer, fontFamily: 'monospace' }}>
              {tempPassword}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button
          variant="text"
          disabled={saving}
          onClick={() => handleSave({ active: staff.active ? 0 : 1 })}
          sx={{ color: staff.active ? md3Colors.error : md3Colors.primary }}
        >
          {staff.active ? 'Deactivate' : 'Reactivate'}
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={saving}
            onClick={() =>
              handleSave({
                role: role.trim() || null,
                hourly_rate: rate.trim() === '' ? null : rate.trim(),
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}

export default function StaffPanel({ timezone }) {
  const { showSnackbar } = useSnackbar();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newRate, setNewRate] = useState('');
  const [adding, setAdding] = useState(false);

  const [payrollRange, setPayrollRange] = useState(monthDefaults);
  const [payrollReport, setPayrollReport] = useState(null);
  const [payrollBusy, setPayrollBusy] = useState(false);

  const [capacity, setCapacity] = useState(null);
  const [capacitySaving, setCapacitySaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [staffData, capacityData] = await Promise.all([api.getStaff(), api.getCapacity()]);
      setData(staffData);
      setCapacity((prev) => prev ?? capacityData.capacity ?? {});
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setLoading(false);
    }
  }, [showSnackbar]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleClock(staff) {
    setBusyId(staff.id);
    try {
      if (staff.on_duty) {
        const result = await api.clockOutStaff(staff.id);
        showSnackbar(
          `${staff.name} clocked out — ${formatDuration(result.shift?.duration_minutes)}`
        );
      } else {
        await api.clockInStaff(staff.id);
        showSnackbar(`${staff.name} clocked in`);
      }
      await load();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!newFirst.trim() || !newLast.trim()) return;
    setAdding(true);
    try {
      const created = await api.createStaff({
        first_name: newFirst.trim(),
        last_name: newLast.trim(),
        role: newRole.trim() || undefined,
        hourly_rate: newRate.trim() === '' ? undefined : newRate.trim(),
      });
      showSnackbar(`${created.name} added to staff`);
      setNewFirst('');
      setNewLast('');
      setNewRole('');
      setNewRate('');
      await load();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handlePayrollView() {
    setPayrollBusy(true);
    try {
      setPayrollReport(await api.getPayrollReport(payrollRange));
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setPayrollBusy(false);
    }
  }

  async function handlePayrollDownload() {
    setPayrollBusy(true);
    try {
      const { blob, filename } = await api.downloadPayrollCsv(payrollRange);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setPayrollBusy(false);
    }
  }

  async function handlePayrollDownloadXlsx() {
    setPayrollBusy(true);
    try {
      const { blob, filename } = await api.downloadPayrollXlsx(payrollRange);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setPayrollBusy(false);
    }
  }

  async function handleCapacitySave() {
    setCapacitySaving(true);
    try {
      const result = await api.updateCapacity(capacity);
      setCapacity(result.capacity);
      showSnackbar('Weekday capacity saved');
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setCapacitySaving(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  const staff = data?.staff || [];
  const activeStaff = staff.filter((s) => s.active);
  const inactiveStaff = staff.filter((s) => !s.active);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <SectionCard
        title="Staff time clock"
        subtitle="Clock shifts in and out; hours feed the payroll report below"
      >
        {staff.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <BadgeOutlinedIcon sx={{ fontSize: 40, color: md3Colors.outline, mb: 1 }} />
            <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
              No staff yet — add your first staff member below
            </Typography>
          </Box>
        )}

        {[...activeStaff, ...inactiveStaff].map((member, i, list) => (
          <Box
            key={member.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1.5,
              py: 1.5,
              opacity: member.active ? 1 : 0.55,
              borderBottom: i < list.length - 1 ? `1px solid ${md3Colors.outlineVariant}` : 'none',
            }}
          >
            <Avatar
              sx={{
                bgcolor: member.on_duty ? md3Colors.tertiaryContainer : md3Colors.surfaceVariant,
                color: member.on_duty ? md3Colors.tertiary : md3Colors.onSurfaceVariant,
                width: 40,
                height: 40,
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              {initials(member.name)}
            </Avatar>
            <Box
              component="button"
              type="button"
              onClick={() => setEditTarget(member)}
              sx={{
                flex: 1,
                minWidth: 140,
                textAlign: 'left',
                border: 'none',
                background: 'none',
                p: 0,
                cursor: 'pointer',
                '&:focus-visible': { outline: `3px solid ${md3Colors.primary}66`, outlineOffset: 2 },
              }}
              aria-label={`Edit ${member.name}`}
            >
              <Typography variant="titleSmall" noWrap>
                {member.name}
                {!member.active ? ' (inactive)' : ''}
              </Typography>
              <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }} noWrap>
                {[member.role, member.hourly_rate != null ? `$${member.hourly_rate}/hr` : null]
                  .filter(Boolean)
                  .join(' · ') || 'Tap to set role and rate'}
              </Typography>
            </Box>
            {member.on_duty && (
              <Chip
                size="small"
                label={`On duty · ${formatDuration(member.open_shift?.elapsed_minutes)}`}
                title={`In since ${formatTime(member.open_shift?.clock_in_time, timezone)}`}
                sx={{
                  bgcolor: md3Colors.tertiaryContainer,
                  color: md3Colors.tertiary,
                  fontWeight: 500,
                }}
              />
            )}
            {member.active && (
              <Button
                variant={member.on_duty ? 'outlined' : 'contained'}
                onClick={() => handleClock(member)}
                disabled={busyId === member.id}
                sx={{ minWidth: 112 }}
              >
                {busyId === member.id ? '…' : member.on_duty ? 'Clock out' : 'Clock in'}
              </Button>
            )}
          </Box>
        ))}

        <Divider sx={{ my: 2.5, borderColor: md3Colors.outlineVariant }} />

        <Typography variant="titleSmall" sx={{ mb: 1.5 }}>
          Add staff member
        </Typography>
        <Box
          component="form"
          onSubmit={handleAdd}
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start' }}
        >
          <TextField
            label="First name"
            value={newFirst}
            onChange={(e) => setNewFirst(e.target.value)}
            required
            size="small"
            sx={{ flex: '1 1 140px' }}
          />
          <TextField
            label="Last name"
            value={newLast}
            onChange={(e) => setNewLast(e.target.value)}
            required
            size="small"
            sx={{ flex: '1 1 140px' }}
          />
          <TextField
            label="Role"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            size="small"
            sx={{ flex: '1 1 120px' }}
          />
          <TextField
            label="Rate ($/hr)"
            value={newRate}
            onChange={(e) => setNewRate(e.target.value)}
            size="small"
            inputProps={{ inputMode: 'decimal' }}
            sx={{ flex: '1 1 100px' }}
          />
          <Button type="submit" variant="contained" disabled={adding} sx={{ minHeight: 44 }}>
            {adding ? 'Adding…' : 'Add'}
          </Button>
        </Box>
      </SectionCard>

      <SectionCard
        title="Payroll hours"
        subtitle="Completed shifts in the date range; gross pay uses each member's hourly rate"
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', mb: 2 }}>
          <TextField
            label="Start"
            type="date"
            value={payrollRange.start}
            onChange={(e) => setPayrollRange((r) => ({ ...r, start: e.target.value }))}
            size="small"
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="End"
            type="date"
            value={payrollRange.end}
            onChange={(e) => setPayrollRange((r) => ({ ...r, end: e.target.value }))}
            size="small"
            InputLabelProps={{ shrink: true }}
          />
          <Button variant="outlined" onClick={handlePayrollView} disabled={payrollBusy}>
            View totals
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadOutlinedIcon />}
            onClick={handlePayrollDownload}
            disabled={payrollBusy}
          >
            Download CSV
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadOutlinedIcon />}
            onClick={handlePayrollDownloadXlsx}
            disabled={payrollBusy}
          >
            Download XLSX
          </Button>
        </Box>

        {payrollReport && (
          <Box
            sx={{
              border: `1px solid ${md3Colors.outlineVariant}`,
              borderRadius: `${shape.medium}px`,
              overflow: 'hidden',
            }}
          >
            {payrollReport.staff.map((row, i) => (
              <Box
                key={row.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2,
                  py: 1.25,
                  borderBottom:
                    i < payrollReport.staff.length - 1
                      ? `1px solid ${md3Colors.outlineVariant}`
                      : 'none',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="bodySmall" noWrap>
                    {row.name}
                    {row.role ? ` · ${row.role}` : ''}
                  </Typography>
                </Box>
                <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                  {row.shifts} shift{row.shifts !== 1 ? 's' : ''} · {row.total_hours}h
                  {row.gross_pay != null ? ` · $${row.gross_pay.toFixed(2)}` : ''}
                </Typography>
              </Box>
            ))}
            <Box sx={{ px: 2, py: 1.25, bgcolor: md3Colors.surfaceVariant }}>
              <Typography variant="bodySmall" sx={{ fontWeight: 500 }}>
                Total: {payrollReport.summary.total_hours}h across{' '}
                {payrollReport.summary.total_shifts} shifts
                {payrollReport.summary.total_gross_pay > 0
                  ? ` · $${payrollReport.summary.total_gross_pay.toFixed(2)} gross`
                  : ''}
              </Typography>
            </Box>
          </Box>
        )}
      </SectionCard>

      <SectionCard
        title="Weekday capacity"
        subtitle="Seats available per weekday. The Desk shows expected students against this limit; leave a day blank for no limit"
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          {WEEKDAYS.map((day) => (
            <TextField
              key={day}
              label={day}
              value={capacity?.[day] ?? ''}
              onChange={(e) =>
                setCapacity((prev) => ({ ...prev, [day]: e.target.value.replace(/\D/g, '') }))
              }
              size="small"
              inputProps={{ inputMode: 'numeric', 'aria-label': `${day} capacity` }}
              sx={{ width: 84 }}
            />
          ))}
        </Box>
        <Button variant="contained" onClick={handleCapacitySave} disabled={capacitySaving}>
          {capacitySaving ? 'Saving…' : 'Save capacity'}
        </Button>
      </SectionCard>

      {editTarget && (
        <StaffEditDialog
          staff={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={load}
        />
      )}
    </Box>
  );
}
