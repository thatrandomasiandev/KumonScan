import { useEffect, useState } from 'react';
import { Box, Button, Paper, TextField, Typography } from '@mui/material';
import PersonAddOutlinedIcon from '@mui/icons-material/PersonAddOutlined';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { md3Colors, shape } from '../theme';

/**
 * Staff registration form embedded on the front desk. Creates or finds a
 * student by name, then hands the result to the parent so check-in can
 * continue without leaving Desk.
 */
export default function RegisterPanel({
  onRegistered,
  initialFirstName = '',
  initialLastName = '',
  submitLabel,
  submittingLabel,
  autoFocusFirstName = false,
}) {
  const { t, i18n } = useTranslation();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setFirstName(initialFirstName);
    setLastName(initialLastName);
  }, [initialFirstName, initialLastName]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const data = await api.register(firstName, lastName, i18n.resolvedLanguage);
      setFirstName('');
      setLastName('');
      onRegistered?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper
      component="form"
      onSubmit={handleSubmit}
      elevation={0}
      id="desk-register-panel"
      sx={{
        p: 3,
        mb: 3,
        borderRadius: `${shape.extraLarge}px`,
        bgcolor: md3Colors.surfaceBright,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: `${shape.medium}px`,
            bgcolor: md3Colors.primaryContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PersonAddOutlinedIcon sx={{ fontSize: 22, color: md3Colors.primary }} />
        </Box>
        <Box>
          <Typography variant="titleMedium">{t('register.deskHeading')}</Typography>
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
            {t('register.deskSubheading')}
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 2,
          alignItems: { sm: 'flex-start' },
        }}
      >
        <TextField
          id="desk-register-first-name"
          label={t('register.firstNameLabel')}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          autoComplete="given-name"
          required
          fullWidth
          disabled={submitting}
          autoFocus={autoFocusFirstName}
        />
        <TextField
          id="desk-register-last-name"
          label={t('register.lastNameLabel')}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          autoComplete="family-name"
          required
          fullWidth
          disabled={submitting}
          error={Boolean(error)}
          helperText={error || ' '}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={submitting}
          startIcon={<PersonAddOutlinedIcon />}
          sx={{
            minHeight: 56,
            flexShrink: 0,
            px: 2.5,
            whiteSpace: 'nowrap',
            alignSelf: { xs: 'stretch', sm: 'flex-start' },
          }}
        >
          {submitting
            ? submittingLabel || t('register.deskSubmitting')
            : submitLabel || t('register.deskSubmit')}
        </Button>
      </Box>
    </Paper>
  );
}

/** Split a free-text desk search into first/last name hints for registration. */
export function parseNameHint(input) {
  const trimmed = (input || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { firstName: '', lastName: '' };

  // Ignore pure numeric / ID searches — staff still get an empty form.
  if (/^\d+$/.test(trimmed)) return { firstName: '', lastName: '' };

  if (trimmed.includes(',')) {
    const [last, ...rest] = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
    return { firstName: rest.join(' '), lastName: last || '' };
  }

  const parts = trimmed.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
