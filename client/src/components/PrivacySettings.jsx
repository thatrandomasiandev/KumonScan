import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { api, formatTime } from '../api';
import { useSnackbar } from '../components/SnackbarProvider';
import { md3Colors, getElevatedSurface, shape } from '../theme';

/**
 * Admin privacy controls: opt-in retention windows, staff-triggered purge,
 * and the queryable audit trail. Deliberately plain: this screen configures
 * permanent deletion of children's records and must read as exactly that.
 */

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All entities' },
  { value: 'student', label: 'Students' },
  { value: 'session', label: 'Sessions' },
];

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function RetentionPolicyRow({ entry, policy, onSaved }) {
  const { showSnackbar } = useSnackbar();
  const [days, setDays] = useState(policy ? String(policy.retain_days) : '');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDays(policy ? String(policy.retain_days) : '');
  }, [policy]);

  const parsedDays = Number(days);
  const validDays = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 3650;

  async function applyPolicy() {
    setBusy(true);
    try {
      await api.setRetentionPolicy({ table: entry.table, retain_days: parsedDays });
      showSnackbar(`Retention set: ${entry.table} records purge after ${parsedDays} days`);
      setConfirmOpen(false);
      onSaved();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearPolicy() {
    setBusy(true);
    try {
      await api.clearRetentionPolicy(entry.table);
      showSnackbar(`Retention cleared for ${entry.table} — records are kept indefinitely`);
      onSaved();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1.5,
        py: 1.5,
        borderBottom: `1px solid ${md3Colors.outlineVariant}`,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 220 }}>
        <Typography variant="titleSmall" sx={{ fontFamily: 'monospace' }}>
          {entry.table}
        </Typography>
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
          {entry.description}
        </Typography>
      </Box>

      <Chip
        size="small"
        label={policy ? `Purges after ${policy.retain_days} days` : 'Retained indefinitely'}
        sx={{
          bgcolor: policy ? md3Colors.errorContainer : md3Colors.surfaceVariant,
          color: policy ? md3Colors.onErrorContainer : md3Colors.onSurfaceVariant,
          fontWeight: 500,
        }}
      />

      <TextField
        value={days}
        onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
        size="small"
        placeholder="days"
        inputProps={{ inputMode: 'numeric', 'aria-label': `Retention days for ${entry.table}` }}
        sx={{ width: 100 }}
      />
      <Button
        variant="outlined"
        size="small"
        disabled={!validDays || busy}
        onClick={() => setConfirmOpen(true)}
      >
        Set window
      </Button>
      {policy && (
        <Button variant="text" size="small" disabled={busy} onClick={clearPolicy}>
          Clear
        </Button>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        PaperProps={{ sx: { borderRadius: `${shape.extraLarge}px` } }}
      >
        <DialogTitle>Set retention window for {entry.table}?</DialogTitle>
        <DialogContent>
          <Typography variant="bodyMedium" sx={{ mb: 1 }}>
            When a purge runs, every row in <code>{entry.table}</code> older than{' '}
            {parsedDays} days will be permanently deleted. There is no undo and no
            recycle bin.
          </Typography>
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
            Purges only run when staff triggers one from this screen. Clearing the
            window later stops future purges but does not restore deleted records.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="text" onClick={applyPolicy} disabled={busy} sx={{ color: md3Colors.error }}>
            {busy ? 'Saving…' : `Set ${parsedDays}-day window`}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function AuditLogViewer() {
  const { showSnackbar } = useSnackbar();
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api.getAuditLog({
        entity_type: entityType || undefined,
        entity_id: entityId.trim() || undefined,
        start: startDate || undefined,
        end: endDate ? `${endDate}T23:59:59.999Z` : undefined,
        limit: 200,
      });
      setEntries(data.entries);
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box>
      <Typography variant="titleMedium" sx={{ mb: 0.5 }}>
        Audit log
      </Typography>
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 1.5, display: 'block' }}>
        Every write to student and session records, every export, and every purge, with
        actor and timestamp. Use it to answer &ldquo;who accessed this student&rsquo;s
        data&rdquo; from records rather than memory.
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
        <TextField
          select
          size="small"
          label="Entity"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          sx={{ width: 160 }}
        >
          {ENTITY_TYPE_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Entity ID"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          sx={{ width: 120 }}
        />
        <TextField
          size="small"
          label="From"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          size="small"
          label="To"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <Button variant="contained" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Load entries'}
        </Button>
      </Box>

      {entries !== null && entries.length === 0 && (
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, py: 1 }}>
          No audit entries match these filters.
        </Typography>
      )}

      {entries !== null && entries.length > 0 && (
        <Box
          sx={{
            border: `1px solid ${md3Colors.outlineVariant}`,
            borderRadius: `${shape.medium}px`,
            overflow: 'auto',
            maxHeight: 420,
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>When (UTC)</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Entity</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatTime(entry.occurred_at, 'UTC')}
                  </TableCell>
                  <TableCell>
                    {entry.actor_type}
                    {entry.actor_id ? ` (${entry.actor_id})` : ''}
                  </TableCell>
                  <TableCell>{entry.action}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {entry.entity_type}
                    {entry.entity_id ? ` #${entry.entity_id}` : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
}

export default function PrivacySettings() {
  const { showSnackbar } = useSnackbar();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [purging, setPurging] = useState(false);
  const [lastPurge, setLastPurge] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getRetentionSettings();
      setSettings(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runPurge() {
    setPurging(true);
    try {
      const result = await api.purgeExpiredData();
      setLastPurge(result);
      const summary = Object.entries(result.deleted)
        .map(([table, count]) => `${table}: ${count}`)
        .join(', ');
      showSnackbar(`Purge complete — ${summary || 'nothing to delete'}`);
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setPurging(false);
    }
  }

  const policies = settings?.policies ?? [];
  const purgeableTables = settings?.purgeable_tables ?? [];

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
      <Typography variant="titleLarge" sx={{ mb: 0.5 }}>
        Privacy &amp; data handling
      </Typography>
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 2, display: 'block' }}>
        Technical controls for student data: retention windows, audit history, and
        per-student export or deletion (in each student&rsquo;s detail view). These are
        operational tools; they are not a legal compliance certification.
      </Typography>

      {error && (
        <Typography variant="bodyMedium" sx={{ color: md3Colors.error, mb: 2 }}>
          {error}
        </Typography>
      )}

      <Typography variant="titleMedium" sx={{ mb: 0.5 }}>
        Retention
      </Typography>
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 1, display: 'block' }}>
        Default is to keep every record indefinitely. Setting a window schedules
        permanent deletion of older records the next time staff runs a purge.
      </Typography>

      {settings === null && !error && (
        <Box sx={{ py: 2 }}>
          <CircularProgress size={20} />
        </Box>
      )}

      {purgeableTables.map((entry) => (
        <RetentionPolicyRow
          key={entry.table}
          entry={entry}
          policy={policies.find((p) => p.table === entry.table) || null}
          onSaved={load}
        />
      ))}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          disabled={purging || policies.length === 0}
          onClick={runPurge}
          sx={{
            color: md3Colors.error,
            borderColor: md3Colors.error,
            '&:hover': { bgcolor: 'rgba(186,26,26,0.08)', borderColor: md3Colors.error },
          }}
        >
          {purging ? 'Purging…' : 'Run purge now'}
        </Button>
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
          {policies.length === 0
            ? 'Disabled until a retention window is set.'
            : 'Deletes records older than the configured windows. Irreversible.'}
        </Typography>
      </Box>

      {lastPurge && (
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mt: 1, display: 'block' }}>
          Last purge ({formatTime(lastPurge.ran_at, 'UTC')} UTC):{' '}
          {Object.entries(lastPurge.deleted)
            .map(([table, count]) => `${count} from ${table}`)
            .join(', ') || 'nothing deleted'}
        </Typography>
      )}

      <Divider sx={{ my: 3, borderColor: md3Colors.outlineVariant }} />

      <AuditLogViewer />
    </Paper>
  );
}

/**
 * Per-student privacy actions rendered inside the Admin student detail view:
 * the parent-contact consent flag, single-student data export, and the
 * irreversible hard delete (retype-the-name confirmation).
 */
export function StudentPrivacyActions({ student, onConsentSaved, onPurged }) {
  const { showSnackbar } = useSnackbar();
  const [consentBusy, setConsentBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const consentOnFile = Boolean(student.contact_consent_on_file);

  async function toggleConsent(event) {
    const next = event.target.checked;
    setConsentBusy(true);
    try {
      await api.setStudentConsent(student.id, next);
      showSnackbar(
        next
          ? 'Marked: parent contact consent on file'
          : 'Marked: no parent contact consent on file'
      );
      onConsentSaved?.({ ...student, contact_consent_on_file: next ? 1 : 0 });
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setConsentBusy(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { blob, filename } = await api.downloadStudentDataExport(student.id);
      saveBlob(blob, filename);
      showSnackbar('Export downloaded. The export was recorded in the audit log.');
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await api.purgeStudent(student.id, confirmName);
      showSnackbar(`${result.name} permanently deleted`);
      setDeleteOpen(false);
      onPurged?.(student.id);
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="titleMedium" sx={{ mb: 0.5 }}>
        Privacy
      </Typography>

      <FormControlLabel
        control={
          <Checkbox
            checked={consentOnFile}
            onChange={toggleConsent}
            disabled={consentBusy}
          />
        }
        label={
          <Typography variant="bodyMedium">
            Parent contact consent on file
          </Typography>
        }
      />
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, display: 'block', mb: 2 }}>
        Check only when a signed consent form for parent contact is physically or
        digitally on file at the center. This records the flag; it does not store the
        form.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <Button variant="outlined" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export this student’s data'}
        </Button>
        <Button
          variant="outlined"
          onClick={() => {
            setConfirmName('');
            setDeleteOpen(true);
          }}
          sx={{
            color: md3Colors.error,
            borderColor: md3Colors.error,
            '&:hover': { bgcolor: 'rgba(186,26,26,0.08)', borderColor: md3Colors.error },
          }}
        >
          Delete permanently
        </Button>
      </Box>
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mt: 1, display: 'block' }}>
        Export covers every table referencing this student, for responding to a
        parent&rsquo;s data request. Permanent deletion removes all of it and cannot be
        undone; use Deactivate instead to keep history.
      </Typography>

      <Dialog
        open={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
        PaperProps={{ sx: { borderRadius: `${shape.extraLarge}px` } }}
      >
        <DialogTitle>Permanently delete {student.name}?</DialogTitle>
        <DialogContent>
          <Typography variant="bodyMedium" sx={{ mb: 2 }}>
            This deletes the student and every attendance record that references them.
            It is irreversible and is recorded in the audit log. To confirm, type the
            student&rsquo;s full name.
          </Typography>
          <TextField
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={student.name}
            fullWidth
            size="small"
            autoFocus
            inputProps={{ 'aria-label': 'Type the student full name to confirm deletion' }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeleteOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="text"
            onClick={handleDelete}
            disabled={
              deleting ||
              confirmName.replace(/\s+/g, ' ').trim().toLowerCase() !==
                student.name.replace(/\s+/g, ' ').trim().toLowerCase()
            }
            sx={{ color: md3Colors.error }}
          >
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
