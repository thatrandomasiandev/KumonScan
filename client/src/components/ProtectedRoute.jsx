import { useEffect, useState } from 'react';
import { Box, Button, TextField, Typography, Paper } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { api } from '../api';
import LoadingScreen from './LoadingScreen';
import { md3Colors, getElevatedSurface, shape } from '../theme';

function AuthCard({ children }) {
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
        {children}
      </Paper>
    </Box>
  );
}

function SetPasswordScreen({ forced, onDone }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.staffChangePassword({
        current_password: forced ? undefined : currentPassword,
        new_password: newPassword,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard>
      <Typography variant="headlineSmall" sx={{ textAlign: 'center', mb: 0.5 }}>
        Set your password
      </Typography>
      <Typography
        variant="bodyMedium"
        sx={{ textAlign: 'center', color: md3Colors.onSurfaceVariant, mb: 3 }}
      >
        {forced
          ? 'Choose a permanent password to replace your temporary one.'
          : 'Enter your current password and a new one.'}
      </Typography>

      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!forced && (
          <TextField
            label="Current password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
            fullWidth
          />
        )}
        <TextField
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
          fullWidth
          helperText={error || 'At least 8 characters'}
          error={Boolean(error)}
        />
        <Button type="submit" variant="contained" fullWidth disabled={submitting}>
          {submitting ? 'Saving…' : 'Save password'}
        </Button>
      </Box>
    </AuthCard>
  );
}

export default function ProtectedRoute({ children }) {
  const [status, setStatus] = useState({
    loading: true,
    authenticated: false,
    protectionEnabled: false,
    staff: null,
  });
  const [useCenterPassword, setUseCenterPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [justChangedPassword, setJustChangedPassword] = useState(false);

  async function checkAuth() {
    try {
      const data = await api.getAuthStatus();
      setStatus({
        loading: false,
        authenticated: data.authenticated,
        protectionEnabled: data.protectionEnabled,
        staff: data.staff || null,
      });
    } catch {
      setStatus({ loading: false, authenticated: false, protectionEnabled: true, staff: null });
    }
  }

  useEffect(() => {
    checkAuth();
  }, []);

  async function handleStaffLogin(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.staffLogin(email, password);
      setPassword('');
      await checkAuth();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCenterLogin(e) {
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

  if (status.authenticated && status.staff?.must_change_password && !justChangedPassword) {
    return (
      <SetPasswordScreen
        forced
        onDone={() => {
          setJustChangedPassword(true);
          checkAuth();
        }}
      />
    );
  }

  if (status.authenticated) return children;

  return (
    <AuthCard>
      <Typography variant="headlineSmall" sx={{ textAlign: 'center', mb: 0.5 }}>
        Sign in
      </Typography>
      <Typography
        variant="bodyMedium"
        sx={{ textAlign: 'center', color: md3Colors.onSurfaceVariant, mb: 3 }}
      >
        {useCenterPassword
          ? 'Enter the center password to view this page.'
          : 'Sign in with your staff email and password.'}
      </Typography>

      {useCenterPassword ? (
        <Box component="form" onSubmit={handleCenterLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            id="admin-password"
            label="Center password"
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
          <Button
            type="button"
            variant="text"
            onClick={() => {
              setUseCenterPassword(false);
              setError(null);
              setPassword('');
            }}
          >
            Use staff login instead
          </Button>
        </Box>
      ) : (
        <Box component="form" onSubmit={handleStaffLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            fullWidth
          />
          <TextField
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
          <Button
            type="button"
            variant="text"
            onClick={() => {
              setUseCenterPassword(true);
              setError(null);
              setPassword('');
            }}
          >
            Use center password instead
          </Button>
        </Box>
      )}
    </AuthCard>
  );
}
