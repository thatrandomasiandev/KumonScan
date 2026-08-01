import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
} from '@mui/material';
import QrCode2OutlinedIcon from '@mui/icons-material/QrCode2Outlined';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import { useTranslation } from 'react-i18next';
import { api, formatTime } from '../api';
import LanguageSelector from '../i18n/LanguageSelector';
import { centerPath } from '../centerPath';
import { md3Colors, getElevatedSurface, shape } from '../theme';

const QR_OPTIONS = {
  width: 280,
  margin: 2,
  color: { dark: '#1B6EF3', light: '#ffffff' },
};

function CheckInResult({ result }) {
  const { t } = useTranslation();
  const isCheckIn = result.action === 'checked_in';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        p: 2,
        borderRadius: `${shape.small}px`,
        bgcolor: isCheckIn ? md3Colors.successContainer : md3Colors.secondaryContainer,
        mb: 2,
      }}
    >
      <CheckCircleOutlinedIcon
        sx={{ color: isCheckIn ? md3Colors.success : md3Colors.secondary, mt: 0.25 }}
      />
      <Box>
        <Typography variant="titleSmall">
          {isCheckIn ? t('register.checkedInSuccess') : t('register.checkedOutSuccess')}
        </Typography>
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, mt: 0.5 }}>
          {formatTime(result.timestamp, result.timezone)}
        </Typography>
      </Box>
    </Box>
  );
}

function QRResult({ registration, onReset, centerSlug }) {
  const { t, i18n } = useTranslation();
  const canvasRef = useRef(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState(null);
  const [checkInResult, setCheckInResult] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function renderQr() {
      const dataUrl = await QRCode.toDataURL(registration.qr_code_value, QR_OPTIONS);
      if (cancelled) return;

      setQrDataUrl(dataUrl);

      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, registration.qr_code_value, QR_OPTIONS);
      }
    }

    renderQr();

    return () => {
      cancelled = true;
    };
  }, [registration.qr_code_value]);

  async function handleCheckIn() {
    setCheckingIn(true);
    setCheckInError(null);

    const isCheckout = checkInResult?.action === 'checked_in';

    try {
      const data = await api.scan(registration.qr_code_value, { force: isCheckout });
      setCheckInResult(data);
    } catch (err) {
      setCheckInError(err.message);
    } finally {
      setCheckingIn(false);
    }
  }

  function downloadQr() {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.download = `${registration.first_name}_${registration.last_name}_QR.png`;
    link.href = qrDataUrl;
    link.click();
  }

  function printQr() {
    if (!qrDataUrl) return;
    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) return;

    const fullName = `${registration.first_name} ${registration.last_name}`;
    printWindow.document.write(`<!DOCTYPE html>
<html lang="${i18n.resolvedLanguage || 'en'}"><head><meta charset="UTF-8" /><title>${fullName} - Kumon QR</title>
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Roboto,sans-serif;color:#1A1B22}
img{width:280px;height:280px}h1{margin:24px 0 8px;font-size:28px;font-weight:500}p{margin:0;color:#44464F;font-size:14px}</style></head>
<body><img src="${qrDataUrl}" alt="QR code" /><h1>${fullName}</h1><p>${t('register.printQrCaption')}</p></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => printWindow.print();
  }

  const isCheckedIn = checkInResult?.action === 'checked_in';

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
      <Typography variant="titleLarge" sx={{ mb: 3 }}>
        {registration.first_name} {registration.last_name}
      </Typography>

      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: `${shape.large}px`,
          borderColor: md3Colors.outlineVariant,
          bgcolor: md3Colors.surface,
          display: 'inline-block',
          mb: 3,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ minWidth: 250, minHeight: 250, display: 'block' }}
          aria-label={t('register.qrAria', { name: registration.first_name })}
        />
      </Paper>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
          p: 2,
          borderRadius: `${shape.small}px`,
          bgcolor: md3Colors.surfaceVariant,
          mb: 3,
          textAlign: 'left',
        }}
      >
        <InfoOutlinedIcon sx={{ color: md3Colors.primary, mt: 0.25 }} />
        <Typography variant="bodyMedium">
          {registration.is_new
            ? t('register.newStudentInfo')
            : t('register.returningStudentInfo')}
        </Typography>
      </Box>

      <Button
        variant="contained"
        fullWidth
        onClick={handleCheckIn}
        disabled={checkingIn}
        sx={{
          mb: 2,
          ...(isCheckedIn && {
            bgcolor: md3Colors.secondary,
            '&:hover': { bgcolor: md3Colors.secondary },
          }),
        }}
      >
        {checkingIn
          ? t('register.processing')
          : isCheckedIn
            ? t('register.checkOut')
            : t('register.checkInNow')}
      </Button>

      {checkInResult && <CheckInResult result={checkInResult} />}
      {checkInError && (
        <Typography variant="bodySmall" sx={{ color: md3Colors.error, mb: 2 }}>
          {checkInError}
        </Typography>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 3 }}>
        <Button
          variant="contained"
          onClick={downloadQr}
          disabled={!qrDataUrl}
          sx={{ bgcolor: md3Colors.primaryContainer, color: md3Colors.onPrimaryContainer, '&:hover': { bgcolor: md3Colors.primaryContainer } }}
        >
          {t('register.downloadPng')}
        </Button>
        <Button
          variant="contained"
          onClick={printQr}
          disabled={!qrDataUrl}
          sx={{ bgcolor: md3Colors.primaryContainer, color: md3Colors.onPrimaryContainer, '&:hover': { bgcolor: md3Colors.primaryContainer } }}
        >
          {t('register.print')}
        </Button>
      </Box>

      <Box sx={{ borderTop: `1px solid ${md3Colors.outlineVariant}`, pt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Button component={Link} to={centerPath(centerSlug)} variant="outlined" fullWidth>
          {t('register.openScanner')}
        </Button>
        <Button variant="text" onClick={onReset} sx={{ color: md3Colors.onSurfaceVariant }}>
          {t('register.backNotYou')}
        </Button>
      </Box>
    </Paper>
  );
}

export default function RegisterPage() {
  const { centerSlug } = useParams();
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
          <IconButton
            component={Link}
            to={centerPath(centerSlug)}
            edge="start"
            aria-label={t('register.backToScanAria')}
          >
            <ArrowBackOutlinedIcon />
          </IconButton>
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
              <QrCode2OutlinedIcon sx={{ fontSize: 40, color: md3Colors.primary }} />
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

            <Button
              component={Link}
              to={centerPath(centerSlug)}
              variant="outlined"
              fullWidth
              sx={{ mt: 2 }}
            >
              {t('register.goToScanner')}
            </Button>
          </Paper>
        ) : (
          <QRResult
            registration={registration}
            onReset={handleReset}
            centerSlug={centerSlug}
          />
        )}
      </Box>
    </Box>
  );
}
