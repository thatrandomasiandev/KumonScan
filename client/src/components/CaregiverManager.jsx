import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import StarOutlinedIcon from '@mui/icons-material/StarOutlined';
import { caregiversApi } from '../caregiversApi';
import { useSnackbar } from './SnackbarProvider';
import { md3Colors, shape } from '../theme';

const RELATIONSHIP_OPTIONS = [
  { value: 'parent', label: 'Parent' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'babysitter', label: 'Babysitter' },
  { value: 'other', label: 'Other' },
];

const EMPTY_FORM = { name: '', phone: '', relationship: '', is_primary: false };

function relationshipLabel(value) {
  return RELATIONSHIP_OPTIONS.find((o) => o.value === value)?.label || null;
}

/**
 * Approved pickup caregivers for one student: add, edit, mark primary,
 * deactivate. Lives inside the Admin student detail view. Caregivers are
 * additive to the parent phone (which stays the messaging contact).
 */
export default function CaregiverManager({ student }) {
  const { showSnackbar } = useSnackbar();
  const [caregivers, setCaregivers] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await caregiversApi.list(student.id);
      setCaregivers(data.caregivers || []);
    } catch (err) {
      showSnackbar(err.message);
      setCaregivers([]);
    }
  }, [student.id, showSnackbar]);

  useEffect(() => {
    setCaregivers(null);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    load();
  }, [load]);

  function startAdd() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(caregiver) {
    setForm({
      name: caregiver.name || '',
      phone: caregiver.phone || '',
      relationship: caregiver.relationship || '',
      is_primary: Boolean(caregiver.is_primary),
    });
    setEditingId(caregiver.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || busy) return;

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      relationship: form.relationship || null,
      is_primary: form.is_primary,
    };

    setBusy(true);
    try {
      if (editingId) {
        await caregiversApi.update(student.id, editingId, payload);
        showSnackbar(`Caregiver updated for ${student.name}`);
      } else {
        await caregiversApi.add(student.id, payload);
        showSnackbar(`Caregiver added for ${student.name}`);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
      await load();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMakePrimary(caregiver) {
    if (busy) return;
    setBusy(true);
    try {
      // Explicitly demote the current primary first; the DB partial unique
      // index rejects two active primaries, so order matters.
      const current = (caregivers || []).find(
        (c) => c.is_primary && c.id !== caregiver.id
      );
      if (current) {
        await caregiversApi.update(student.id, current.id, { is_primary: false });
      }
      await caregiversApi.update(student.id, caregiver.id, { is_primary: true });
      showSnackbar(`${caregiver.name} is now the primary caregiver`);
      await load();
    } catch (err) {
      showSnackbar(err.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate() {
    if (!deactivateTarget || busy) return;
    setBusy(true);
    try {
      await caregiversApi.update(student.id, deactivateTarget.id, { active: false });
      showSnackbar(
        `${deactivateTarget.name} removed from pickup list (past pickups keep their record)`
      );
      setDeactivateTarget(null);
      await load();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!student.active) return null;

  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <GroupOutlinedIcon sx={{ fontSize: 18, color: md3Colors.onSurfaceVariant }} />
        <Typography variant="titleMedium" sx={{ flex: 1 }}>
          Approved caregivers
        </Typography>
        {!showForm && (
          <Button variant="text" onClick={startAdd} sx={{ minHeight: 44 }}>
            Add caregiver
          </Button>
        )}
      </Box>
      <Typography
        variant="bodySmall"
        sx={{ color: md3Colors.onSurfaceVariant, display: 'block', mb: 1.5 }}
      >
        Who may pick this student up. The desk can log the pickup person at
        check-out; it stays optional there.
      </Typography>

      {caregivers === null ? (
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, py: 1 }}>
          Loading…
        </Typography>
      ) : caregivers.length === 0 && !showForm ? (
        <Box
          sx={{
            textAlign: 'center',
            py: 3,
            px: 2,
            borderRadius: `${shape.large}px`,
            bgcolor: md3Colors.surfaceVariant,
            mb: 1.5,
          }}
        >
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
            No caregivers on file — add the adults approved for pickup
          </Typography>
        </Box>
      ) : (
        caregivers.length > 0 && (
          <Box
            sx={{
              border: `1px solid ${md3Colors.outlineVariant}`,
              borderRadius: `${shape.medium}px`,
              overflow: 'hidden',
              mb: 1.5,
            }}
          >
            {caregivers.map((caregiver, i) => (
              <Box
                key={caregiver.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1,
                  px: 2,
                  py: 1.25,
                  minHeight: 44,
                  borderBottom:
                    i < caregivers.length - 1
                      ? `1px solid ${md3Colors.outlineVariant}`
                      : 'none',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 160 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography variant="titleSmall" noWrap>
                      {caregiver.name}
                    </Typography>
                    {Boolean(caregiver.is_primary) && (
                      <Chip
                        size="small"
                        icon={<StarOutlinedIcon />}
                        label="Primary"
                        sx={{
                          bgcolor: md3Colors.primaryContainer,
                          color: md3Colors.onPrimaryContainer,
                          fontWeight: 500,
                          '& .MuiChip-icon': { color: 'inherit', fontSize: 14 },
                        }}
                      />
                    )}
                  </Box>
                  <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                    {[relationshipLabel(caregiver.relationship), caregiver.phone]
                      .filter(Boolean)
                      .join(' · ') || 'No details on file'}
                  </Typography>
                </Box>
                {!caregiver.is_primary && (
                  <Button
                    variant="text"
                    onClick={() => handleMakePrimary(caregiver)}
                    disabled={busy}
                    sx={{ minHeight: 44 }}
                  >
                    Make primary
                  </Button>
                )}
                <Button
                  variant="text"
                  onClick={() => startEdit(caregiver)}
                  disabled={busy}
                  sx={{ minHeight: 44 }}
                >
                  Edit
                </Button>
                <Button
                  variant="text"
                  onClick={() => setDeactivateTarget(caregiver)}
                  disabled={busy}
                  sx={{ minHeight: 44, color: md3Colors.error }}
                >
                  Remove
                </Button>
              </Box>
            ))}
          </Box>
        )
      )}

      {showForm && (
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            p: 2,
            borderRadius: `${shape.medium}px`,
            border: `1px solid ${md3Colors.outlineVariant}`,
            mb: 1.5,
          }}
        >
          <Typography variant="labelLarge" sx={{ color: md3Colors.onSurfaceVariant }}>
            {editingId ? 'Edit caregiver' : 'New caregiver'}
          </Typography>
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            fullWidth
            size="small"
            autoFocus
          />
          <TextField
            label="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="e.g. +1 213 555 0100"
            fullWidth
            size="small"
            inputProps={{ inputMode: 'tel' }}
            InputProps={{
              startAdornment: (
                <PhoneOutlinedIcon
                  sx={{ fontSize: 18, color: md3Colors.onSurfaceVariant, mr: 1 }}
                />
              ),
            }}
          />
          <TextField
            select
            label="Relationship (optional)"
            value={form.relationship}
            onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
            fullWidth
            size="small"
          >
            <MenuItem value="" sx={{ minHeight: 44 }}>
              Not specified
            </MenuItem>
            {RELATIONSHIP_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value} sx={{ minHeight: 44 }}>
                {opt.label}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Switch
                checked={form.is_primary}
                onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))}
              />
            }
            label={
              <Typography variant="bodyMedium">
                Primary caregiver (one per student)
              </Typography>
            }
          />
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={!form.name.trim() || busy}
              sx={{ minHeight: 44 }}
            >
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add caregiver'}
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setForm(EMPTY_FORM);
              }}
              disabled={busy}
              sx={{ minHeight: 44 }}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      )}

      <Dialog
        open={Boolean(deactivateTarget)}
        onClose={() => !busy && setDeactivateTarget(null)}
        PaperProps={{ sx: { borderRadius: `${shape.extraLarge}px` } }}
      >
        <DialogTitle>Remove {deactivateTarget?.name} from pickup list?</DialogTitle>
        <DialogContent>
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
            They will no longer appear when logging pickups. Past pickup records
            that name them are kept.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeactivateTarget(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="text"
            onClick={handleDeactivate}
            disabled={busy}
            sx={{ color: md3Colors.error }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
