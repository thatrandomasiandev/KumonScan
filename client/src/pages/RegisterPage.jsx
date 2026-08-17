import { useState } from 'react';
import { Box, Button, Paper, TextField, Typography, AppBar, Toolbar } from '@mui/material';
import PersonAddOutlinedIcon from '@mui/icons-material/PersonAddOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import LanguageSelector from '../i18n/LanguageSelector';
import { md3Colors, getElevatedSurface, shape } from '../theme';

function RegistrationConfirmation({ registration, onReset }) {
  const { t } = useTranslation();

  return (
    <Paper
      elevation={0}
      className="cross-fade"
      sx={{
        maxWidth: 400,
        width: '100%',
        mx: 'auto',
        p: 3,
        borderRadius: `${shape.extraLarge}px`,
        bgcolor: getElevatedSurface(1),
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          bgcolor: md3Colors.successContainer,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mx: 'auto',
          mb: 3,
        }}
      >
        <CheckCircleOutlinedIcon sx={{ fontSize: 40, color: md3Colors.success }} />
      </Box>

      <Typography variant="titleLarge" sx={{ mb: 3 }}>
        {registration.first_name} {registration.last_name}
      </Typography>

      <Typography variant="bodyMedium" sx={{ mb: 3 }}>
        {registration.is_new ? t('register.newStudentInfo') : t('register.returningStudentInfo')}
      </Typography>

      <Button variant="text" onClick={onReset} sx={{ color: md3Colors.onSurfaceVariant }}>
        {t('register.backNotYou')}
      </Button>
    </Paper>
  );
}

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [registration, setRegistration] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const data = await api.register(firstName, lastName, i18n.resolvedLanguage);
      setRegistration(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setRegistration(null);
    setFirstName('');
    setLastName('');
    setError(null);
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: md3Colors.background, display: 'flex', flexDirection: 'column' }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{ bgcolor: getElevatedSurface(2), color: md3Colors.onSurface }}
      >
        <Toolbar sx={{ maxWidth: 480, mx: 'auto', width: '100%' }}>
          <Typography variant="titleLarge" sx={{ flex: 1, textAlign: 'center' }}>
            {t('register.title')}
          </Typography>
          <LanguageSelector />
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
          py: 4,
        }}
      >
        {!registration ? (
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
              <PersonAddOutlinedIcon sx={{ fontSize: 40, color: md3Colors.primary }} />
            </Box>

            <Typography variant="displaySmall" sx={{ textAlign: 'center', mb: 1 }}>
              {t('register.heading')}
            </Typography>
            <Typography
              variant="bodyMedium"
              sx={{ textAlign: 'center', color: md3Colors.onSurfaceVariant, mb: 3 }}
            >
              {t('register.subheading')}
            </Typography>

            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                id="first-name"
                label={t('register.firstNameLabel')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
                fullWidth
              />
              <TextField
                id="last-name"
                label={t('register.lastNameLabel')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
                fullWidth
                error={Boolean(error)}
                helperText={error || ' '}
              />
              <Button type="submit" variant="contained" fullWidth disabled={submitting}>
                {submitting ? t('register.submitting') : t('register.submit')}
              </Button>
            </Box>
          </Paper>
        ) : (
          <RegistrationConfirmation registration={registration} onReset={handleReset} />
        )}
      </Box>
    </Box>
  );
}
