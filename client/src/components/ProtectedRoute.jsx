import { useEffect, useState } from 'react';
import { Box, Button, TextField, Typography, Paper } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { api } from '../api';
import LoadingScreen from './LoadingScreen';
import { md3Colors, getElevatedSurface, shape } from '../theme';

export default function ProtectedRoute({ children }) {
  const [status, setStatus] = useState({
    loading: true,
    authenticated: false,
    protectionEnabled: false,
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function checkAuth() {
    try {
      const data = await api.getAuthStatus();
      setStatus({
        loading: false,
        authenticated: data.authenticated,
        protectionEnabled: data.protectionEnabled,
      });
    } catch {
      setStatus({ loading: false, authenticated: false, protectionEnabled: true });
    }
  }

  useEffect(() => {
    checkAuth();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await api.login(password);
      setPassword('');
      await checkAuth();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (status.loading) return <LoadingScreen message="Checking access..." />;

  if (status.authenticated) return children;

  return (
    <Box
      sx={{
        maxWidth: 960,
        mx: 'auto',
        px: 2,
        py: 4,
        pb: { xs: 12, md: 4 },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
      }}
    >
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
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              bgcolor: md3Colors.primaryContainer,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LockOutlinedIcon sx={{ fontSize: 40, color: md3Colors.primary }} />
          </Box>
        </Box>

        <Typography variant="headlineSmall" sx={{ textAlign: 'center', mb: 0.5 }}>
          Sign in
        </Typography>
        <Typography
          variant="bodyMedium"
          sx={{ textAlign: 'center', color: md3Colors.onSurfaceVariant, mb: 3 }}
        >
          Enter the admin password to view this page.
        </Typography>

        <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            id="admin-password"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            fullWidth
            error={Boolean(error)}
            helperText={error || ' '}
          />

          <Button type="submit" variant="contained" fullWidth disabled={submitting}>
            {submitting ? 'Signing in...' : 'Continue'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
