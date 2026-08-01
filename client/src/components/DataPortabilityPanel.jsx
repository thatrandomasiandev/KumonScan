import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { api } from '../api';
import { useSnackbar } from './SnackbarProvider';
import { md3Colors, getElevatedSurface, shape } from '../theme';

const DEFAULT_EVENT_TYPES = [
  'student.registered',
  'student.checked_in',
  'student.checked_out',
];

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

function SecretDialog({ secret, onClose }) {
  const { showSnackbar } = useSnackbar();

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      showSnackbar('Secret copied', 'success');
    } catch {
      showSnackbar('Could not copy — select the secret manually', 'error');
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Webhook secret (shown once)</DialogTitle>
      <DialogContent>
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 2, display: 'block' }}>
          Store this HMAC secret now. It cannot be retrieved later — create a new
          subscription if you lose it.
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1.5,
            borderRadius: `${shape.medium}px`,
            bgcolor: md3Colors.surfaceVariant,
            fontFamily: 'Roboto Mono, Roboto, monospace',
            wordBreak: 'break-all',
          }}
        >
          <Typography variant="bodySmall" sx={{ flex: 1, fontFamily: 'inherit' }}>
            {secret}
          </Typography>
          <IconButton aria-label="Copy secret" onClick={copySecret} size="small">
            <ContentCopyOutlinedIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * agent-10-data-portability: full ZIP export + outbound webhook subscription
 * management. Mounted under Admin → Staff & center; one flagged settings
 * section, no redesign of Admin itself.
 */
export default function DataPortabilityPanel() {
  const { showSnackbar } = useSnackbar();
  const [subscriptions, setSubscriptions] = useState([]);
  const [eventTypes, setEventTypes] = useState(DEFAULT_EVENT_TYPES);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState([...DEFAULT_EVENT_TYPES]);
  const [adding, setAdding] = useState(false);
  const [freshSecret, setFreshSecret] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listWebhooks();
      setSubscriptions(data.subscriptions || []);
      if (Array.isArray(data.event_types) && data.event_types.length > 0) {
        setEventTypes(data.event_types);
      }
    } catch (err) {
      showSnackbar(err.message || 'Failed to load webhooks', 'error');
    } finally {
      setLoading(false);
    }
  }, [showSnackbar]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleExport() {
    setExporting(true);
    try {
      const { blob, filename } = await api.downloadFullExport();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(href);
      showSnackbar('Export downloaded', 'success');
    } catch (err) {
      showSnackbar(err.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  function toggleEvent(eventType) {
    setSelectedEvents((prev) =>
      prev.includes(eventType)
        ? prev.filter((e) => e !== eventType)
        : [...prev, eventType]
    );
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!url.trim()) {
      showSnackbar('URL is required', 'error');
      return;
    }
    if (selectedEvents.length === 0) {
      showSnackbar('Select at least one event type', 'error');
      return;
    }
    setAdding(true);
    try {
      const created = await api.createWebhook({
        url: url.trim(),
        event_types: selectedEvents,
      });
      setUrl('');
      setSelectedEvents([...eventTypes]);
      if (created.secret) setFreshSecret(created.secret);
      showSnackbar('Webhook subscription added', 'success');
      await load();
    } catch (err) {
      showSnackbar(err.message || 'Could not create subscription', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteWebhook(id);
      showSnackbar('Subscription removed', 'success');
      await load();
    } catch (err) {
      showSnackbar(err.message || 'Could not delete subscription', 'error');
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2.5 }}>
      {/* agent-10-data-portability */}
      <SectionCard
        title="Data export"
        subtitle="Download every table for this center as CSV files in one ZIP. Your data is never locked in."
      >
        <Button
          variant="contained"
          startIcon={<DownloadOutlinedIcon />}
          onClick={handleExport}
          disabled={exporting}
          sx={{ minHeight: 44 }}
        >
          {exporting ? 'Preparing…' : 'Download full export'}
        </Button>
      </SectionCard>

      {/* agent-10-data-portability */}
      <SectionCard
        title="Outbound webhooks"
        subtitle="POST real-time events to any URL you control. Payloads are HMAC-SHA256 signed; delivery is best-effort (3s timeout, one retry) and never blocks check-in."
      >
        <Box
          component="form"
          onSubmit={handleAdd}
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2.5 }}
        >
          <TextField
            label="Endpoint URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hooks/kumonscan"
            size="small"
            fullWidth
            inputProps={{ 'aria-label': 'Webhook endpoint URL' }}
          />
          <FormGroup row sx={{ gap: 0.5 }}>
            {eventTypes.map((eventType) => (
              <FormControlLabel
                key={eventType}
                control={
                  <Checkbox
                    checked={selectedEvents.includes(eventType)}
                    onChange={() => toggleEvent(eventType)}
                    size="small"
                  />
                }
                label={
                  <Typography variant="bodySmall" component="span">
                    {eventType}
                  </Typography>
                }
              />
            ))}
          </FormGroup>
          <Button
            type="submit"
            variant="contained"
            disabled={adding}
            sx={{ alignSelf: 'flex-start', minHeight: 44 }}
          >
            {adding ? 'Adding…' : 'Add subscription'}
          </Button>
        </Box>

        {subscriptions.length === 0 ? (
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
            No webhook subscriptions yet.
          </Typography>
        ) : (
          <Box
            sx={{
              border: `1px solid ${md3Colors.outlineVariant}`,
              borderRadius: `${shape.medium}px`,
              overflow: 'hidden',
            }}
          >
            {subscriptions.map((sub, i) => (
              <Box
                key={sub.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2,
                  py: 1.25,
                  minHeight: 44,
                  borderBottom:
                    i < subscriptions.length - 1
                      ? `1px solid ${md3Colors.outlineVariant}`
                      : 'none',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="bodySmall" noWrap title={sub.url}>
                    {sub.url}
                  </Typography>
                  <Typography
                    variant="bodySmall"
                    sx={{ color: md3Colors.onSurfaceVariant, display: 'block' }}
                  >
                    {(sub.event_types || []).join(', ')}
                    {sub.active ? '' : ' · inactive'}
                  </Typography>
                </Box>
                <IconButton
                  aria-label={`Remove webhook ${sub.id}`}
                  onClick={() => handleDelete(sub.id)}
                  size="small"
                  sx={{ minWidth: 44, minHeight: 44 }}
                >
                  <DeleteOutlineOutlinedIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}
      </SectionCard>

      {freshSecret && (
        <SecretDialog secret={freshSecret} onClose={() => setFreshSecret(null)} />
      )}
    </Box>
  );
}
