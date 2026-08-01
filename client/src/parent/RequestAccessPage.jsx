import { useState } from 'react';
import { Box, Button, Paper, TextField, Typography } from '@mui/material';
import FamilyRestroomOutlinedIcon from '@mui/icons-material/FamilyRestroomOutlined';
import MarkChatReadOutlinedIcon from '@mui/icons-material/MarkChatReadOutlined';
import { parentApi } from './parentApi';
import { md3Colors, getElevatedSurface, shape } from '../theme';

function CheckYourTexts({ onStartOver }) {
  return (
    <Paper
      elevation={0}
      sx={{
        maxWidth: 400,
        width: '100%',
        p: 3,
        borderRadius: `${shape.extraLarge}px`,
        bgcolor: getElevatedSurface(1),
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          bgcolor: md3Colors.tertiaryContainer,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mx: 'auto',
          mb: 3,
        }}
      >
        <MarkChatReadOutlinedIcon sx={{ fontSize: 40, color: md3Colors.tertiary }} />
      </Box>

      <Typography variant="headlineSmall" sx={{ mb: 1 }}>
        Check your texts
      </Typography>
      <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant, mb: 1 }}>
        If this number is on file, you&apos;ll receive a sign-in link shortly.
      </Typography>
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mb: 3 }}>
        The link works for 15 minutes and can be used once.
      </Typography>

      <Button variant="text" onClick={onStartOver} sx={{ minHeight: 44 }}>
        Use a different number
      </Button>
    </Paper>
  );
}

export default function RequestAccessPage() {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [requested, setRequested] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await parentApi.requestLink(phone);
      setRequested(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: md3Colors.background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 4,
      }}
    >
      {requested ? (
        <CheckYourTexts
          onStartOver={() => {
            setRequested(false);
            setPhone('');
          }}
        />
      ) : (
        <Paper
          elevation={0}
          sx={{
            maxWidth: 400,
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
            <FamilyRestroomOutlinedIcon sx={{ fontSize: 40, color: md3Colors.primary }} />
          </Box>

          <Typography variant="headlineSmall" sx={{ textAlign: 'center', mb: 1 }}>
            KumonScan Family
          </Typography>
          <Typography
            variant="bodyMedium"
            sx={{ textAlign: 'center', color: md3Colors.onSurfaceVariant, mb: 3 }}
          >
            See your student&apos;s attendance and progress. Enter the phone number your
            center has on file and we&apos;ll text you a sign-in link. No password needed.
          </Typography>

          <Box
            component="form"
            onSubmit={handleSubmit}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <TextField
              id="parent-phone"
              label="Phone number"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              inputMode="tel"
              placeholder="(555) 123-4567"
              required
              fullWidth
              error={Boolean(error)}
              helperText={error || ' '}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={submitting || !phone.trim()}
              sx={{ minHeight: 44 }}
            >
              {submitting ? 'Sending…' : 'Text me a sign-in link'}
            </Button>
          </Box>

          <Typography
            variant="bodySmall"
            sx={{ textAlign: 'center', color: md3Colors.onSurfaceVariant, mt: 2 }}
          >
            This app is view-only. To update anything, contact your center.
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
