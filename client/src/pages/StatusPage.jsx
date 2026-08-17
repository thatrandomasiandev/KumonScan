import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Chip, Paper, Typography } from '@mui/material';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import RemoveCircleOutlineOutlinedIcon from '@mui/icons-material/RemoveCircleOutlineOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { api, formatTime } from '../api';
import PageHeader from '../components/PageHeader';
import LoadingScreen from '../components/LoadingScreen';
import { md3Colors, shape } from '../theme';

const POLL_INTERVAL_MS = 30_000;

/**
 * Per the Attendance Color Rule discipline: every state renders color AND a
 * text label (plus icon), never color alone.
 */
const STATUS_PRESENTATION = {
  ok: {
    label: 'Operational',
    icon: CheckCircleOutlinedIcon,
    bgcolor: md3Colors.successContainer,
    color: md3Colors.success,
  },
  warn: {
    label: 'Degraded',
    icon: WarningAmberOutlinedIcon,
    bgcolor: md3Colors.secondaryContainer,
    color: md3Colors.onSecondaryContainer,
  },
  down: {
    label: 'Down',
    icon: CancelOutlinedIcon,
    bgcolor: md3Colors.errorContainer,
    color: md3Colors.onErrorContainer,
  },
  not_configured: {
    label: 'Not configured',
    icon: RemoveCircleOutlineOutlinedIcon,
    bgcolor: md3Colors.surfaceVariant,
    color: md3Colors.onSurfaceVariant,
  },
};

const CHECK_LABELS = {
  database: {
    title: 'Database',
    description: 'Neon Postgres reachability (trivial query with timeout)',
  },
  sms_gateway: {
    title: 'SMS',
    description: 'Twilio direct-send, or Android gateway heartbeat and queue depth',
  },
  webhooks: {
    title: 'Webhook delivery',
    description: 'Delivery failure rate over the last 24 hours',
  },
  errors: {
    title: 'Captured errors',
    description: 'Server errors recorded in the last 24 hours',
  },
};

function StatusChip({ status }) {
  const p = STATUS_PRESENTATION[status] || STATUS_PRESENTATION.down;
  const Icon = p.icon;
  return (
    <Chip
      size="small"
      icon={<Icon />}
      label={p.label}
      sx={{
        bgcolor: p.bgcolor,
        color: p.color,
        fontWeight: 500,
        '& .MuiChip-icon': { color: 'inherit' },
      }}
    />
  );
}

function CheckRow({ name, result }) {
  const labels = CHECK_LABELS[name] || { title: name, description: '' };
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        px: 3,
        py: 2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="titleMedium" sx={{ color: md3Colors.onSurface }}>
          {labels.title}
        </Typography>
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, display: 'block' }}>
          {labels.description}
        </Typography>
        {result.detail && (
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, display: 'block', mt: 0.5 }}>
            {result.detail}
            {typeof result.latency_ms === 'number' && ` · ${result.latency_ms}ms`}
            {result.queue && ` · queue: ${result.queue.pending} pending, ${result.queue.failed} failed`}
          </Typography>
        )}
      </Box>
      <Box sx={{ flexShrink: 0, pt: 0.25 }}>
        <StatusChip status={result.status} />
      </Box>
    </Box>
  );
}

export default function StatusPage() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setReport(await api.getSystemStatus());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!report && !error) {
    return <LoadingScreen message="Checking system health..." />;
  }

  const overall = report?.overall || 'down';
  const overallPresentation = STATUS_PRESENTATION[overall] || STATUS_PRESENTATION.down;

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto' }}>
      <PageHeader
        title="System status"
        subtitle="Live health of the app, database, SMS, and webhook delivery."
        action={
          <Button
            variant="outlined"
            startIcon={<RefreshOutlinedIcon />}
            onClick={load}
            disabled={refreshing}
          >
            Refresh
          </Button>
        }
      />

      {error && (
        <Paper
          elevation={0}
          sx={{
            mb: 2,
            px: 3,
            py: 2,
            borderRadius: `${shape.large}px`,
            bgcolor: md3Colors.errorContainer,
          }}
        >
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onErrorContainer }}>
            Status check failed: {error}
          </Typography>
        </Paper>
      )}

      {report && (
        <>
          <Paper
            elevation={0}
            sx={{
              mb: 2,
              px: 3,
              py: 2,
              borderRadius: `${shape.large}px`,
              bgcolor: overallPresentation.bgcolor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Typography variant="titleMedium" sx={{ color: overallPresentation.color }}>
              Overall: {overallPresentation.label}
            </Typography>
            <Typography variant="bodySmall" sx={{ color: overallPresentation.color }}>
              Checked {formatTime(report.generated_at)}
            </Typography>
          </Paper>

          <Paper
            elevation={0}
            sx={{
              borderRadius: `${shape.extraLarge}px`,
              bgcolor: md3Colors.surfaceBright,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
              overflow: 'hidden',
              '& > div + div': { borderTop: `1px solid ${md3Colors.outlineVariant}` },
            }}
          >
            {Object.entries(report.checks || {}).map(([name, result]) => (
              <CheckRow key={name} name={name} result={result} />
            ))}
          </Paper>
        </>
      )}
    </Box>
  );
}
