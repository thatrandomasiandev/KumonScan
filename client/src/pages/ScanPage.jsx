import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5QrcodeScanner } from 'html5-qrcode';
import {
  Box,
  Typography,
  LinearProgress,
  Button,
  IconButton,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import MenuOutlinedIcon from '@mui/icons-material/MenuOutlined';
import QrCodeScannerOutlinedIcon from '@mui/icons-material/QrCodeScannerOutlined';
import QrCode2OutlinedIcon from '@mui/icons-material/QrCode2Outlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import PersonAddOutlinedIcon from '@mui/icons-material/PersonAddOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { api } from '../api';
import BrandMark from '../components/BrandMark';
import { md3Colors, motion, shape } from '../theme';

const SCAN_COOLDOWN_MS = 3000;
const SUCCESS_DISMISS_MS = 4000;
const ERROR_DISMISS_MS = 5000;

const GRID = 4;

function formatTopBarClock(timezone) {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: timezone || 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}

function SheetDragHandle() {
  return (
    <Box
      aria-hidden
      sx={{
        width: 32,
        height: GRID,
        borderRadius: '2px',
        bgcolor: md3Colors.onSurfaceVariant,
        opacity: 0.4,
        mx: 'auto',
        mb: GRID * 8,
      }}
    />
  );
}

function ScanTopAppBar({ timezone, onMenuOpen }) {
  const [clock, setClock] = useState(null);

  useEffect(() => {
    setClock(formatTopBarClock(timezone));
    const id = setInterval(() => setClock(formatTopBarClock(timezone)), 1000);
    return () => clearInterval(id);
  }, [timezone]);

  return (
    <Box
      component="header"
      sx={{
        position: 'relative',
        flexShrink: 0,
        bgcolor: md3Colors.surfaceBright,
        borderBottom: `1px solid ${md3Colors.outlineVariant}`,
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          bgcolor: md3Colors.elevation2,
          pointerEvents: 'none',
        },
      }}
    >
      <Box
        sx={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: '48px 1fr auto',
          alignItems: 'center',
          minHeight: 56,
          px: 1,
        }}
      >
        <IconButton
          aria-label="Open menu"
          onClick={onMenuOpen}
          sx={{
            color: md3Colors.onSurface,
            width: 48,
            height: 48,
          }}
        >
          <MenuOutlinedIcon />
        </IconButton>

        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <BrandMark compact variant="light" />
        </Box>

        <Typography
          component="time"
          variant="bodyMedium"
          dateTime={clock || undefined}
          sx={{
            textAlign: 'right',
            color: md3Colors.onSurfaceVariant,
            fontSize: '14px',
            pr: 1,
            minWidth: 72,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {clock ?? '—'}
        </Typography>
      </Box>
    </Box>
  );
}

function ViewfinderCard({ children, cameraReady, reducedMotion }) {
  const bracketSize = 24;
  const bracketWidth = 3;

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 320,
        p: '20px',
        borderRadius: `${shape.extraLarge}px`,
        bgcolor: md3Colors.surfaceBright,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          bgcolor: md3Colors.elevation2,
          pointerEvents: 'none',
          borderRadius: 'inherit',
        },
      }}
    >
      <Box sx={{ position: 'relative' }}>
        <Box
          sx={{
            width: '100%',
            maxWidth: 280,
            height: 280,
            mx: 'auto',
            borderRadius: `${shape.large}px`,
            overflow: 'hidden',
            bgcolor: md3Colors.onSurface,
            position: 'relative',
          }}
        >
          {!cameraReady && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                zIndex: 2,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                bgcolor: md3Colors.surfaceVariant,
              }}
              aria-live="polite"
              aria-busy="true"
            >
              <QrCodeScannerOutlinedIcon sx={{ fontSize: 40, color: md3Colors.onSurfaceVariant }} />
              <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
                Starting camera…
              </Typography>
            </Box>
          )}

          {[
            { top: 12, left: 12, borderTop: true, borderLeft: true },
            { top: 12, right: 12, borderTop: true, borderRight: true },
            { bottom: 12, left: 12, borderBottom: true, borderLeft: true },
            { bottom: 12, right: 12, borderBottom: true, borderRight: true },
          ].map((pos, i) => (
            <Box
              key={i}
              sx={{
                position: 'absolute',
                width: bracketSize,
                height: bracketSize,
                ...pos,
                borderColor: md3Colors.primary,
                borderStyle: 'solid',
                borderWidth: 0,
                ...(pos.borderTop && { borderTopWidth: bracketWidth }),
                ...(pos.borderBottom && { borderBottomWidth: bracketWidth }),
                ...(pos.borderLeft && { borderLeftWidth: bracketWidth }),
                ...(pos.borderRight && { borderRightWidth: bracketWidth }),
                zIndex: 4,
                pointerEvents: 'none',
              }}
            />
          ))}

          {!reducedMotion && (
            <Box
              className="scan-line-md3"
              aria-hidden
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: '2px',
                background: `linear-gradient(90deg, transparent, ${md3Colors.primary}, transparent)`,
                opacity: 0.85,
                zIndex: 3,
                pointerEvents: 'none',
              }}
            />
          )}

          <Box sx={{ width: '100%', height: '100%', position: 'relative', zIndex: 1 }}>
            {children}
          </Box>
        </Box>

        <Divider sx={{ my: GRID * 4, borderColor: md3Colors.outlineVariant }} />

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: GRID }}>
          <QrCode2OutlinedIcon sx={{ fontSize: 28, color: md3Colors.primary }} aria-hidden />
          <Typography
            variant="bodySmall"
            component="p"
            sx={{ color: md3Colors.onSurfaceVariant, textAlign: 'center', m: 0 }}
          >
            Align code within the frame
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function BottomSheet({
  onDismiss,
  children,
  autoDismissMs,
  exiting,
  ariaLabelledBy,
  halfPage = false,
}) {
  useEffect(() => {
    if (!autoDismissMs || exiting) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss, exiting]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onDismiss();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <>
      <Box
        onClick={onDismiss}
        aria-hidden
        sx={{
          position: 'fixed',
          inset: 0,
          bgcolor: md3Colors.scrim,
          zIndex: 1200,
        }}
      />
      <Box
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1300,
          bgcolor: md3Colors.surfaceBright,
          borderTopLeftRadius: `${shape.extraLarge}px`,
          borderTopRightRadius: `${shape.extraLarge}px`,
          px: 3,
          pt: 2,
          pb: 5,
          maxWidth: halfPage ? '100%' : 480,
          mx: 'auto',
          ...(halfPage && {
            minHeight: '50dvh',
            display: 'flex',
            flexDirection: 'column',
          }),
          transform: exiting ? 'translateY(100%)' : 'translateY(0)',
          transition: exiting
            ? `transform 200ms ${motion.emphasizedAccelerate}`
            : `transform 400ms ${motion.emphasizedDecelerate}`,
        }}
      >
        {children}
      </Box>
    </>
  );
}

function useSheetDismiss(onComplete) {
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      onComplete();
      setExiting(false);
    }, 200);
  }, [onComplete]);

  return { dismiss, exiting };
}

function SuccessSheet({ result, onDismiss }) {
  const isCheckIn = result.action === 'checked_in';
  const [progress, setProgress] = useState(100);
  const { dismiss, exiting } = useSheetDismiss(onDismiss);
  const titleId = 'scan-success-title';
  const statusLabel = isCheckIn ? 'Checked in' : 'Checked out';

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / SUCCESS_DISMISS_MS) * 100);
      setProgress(pct);
      if (elapsed >= SUCCESS_DISMISS_MS) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <BottomSheet
      autoDismissMs={SUCCESS_DISMISS_MS}
      onDismiss={dismiss}
      exiting={exiting}
      ariaLabelledBy={titleId}
      halfPage
    >
      <LinearProgress
        variant="determinate"
        value={progress}
        aria-label="Closing automatically"
        sx={{
          height: 4,
          borderRadius: `${shape.extraSmall}px`,
          bgcolor: md3Colors.secondaryContainer,
          mb: 0,
          flexShrink: 0,
          '& .MuiLinearProgress-bar': {
            bgcolor: md3Colors.secondary,
            transition: 'none',
          },
        }}
      />

      <SheetDragHandle />

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          px: 2,
          pb: 2,
        }}
      >
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            bgcolor: isCheckIn ? md3Colors.tertiaryContainer : md3Colors.errorContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: 3,
          }}
        >
          {isCheckIn ? (
            <CheckCircleOutlinedIcon sx={{ fontSize: 40, color: md3Colors.tertiary }} />
          ) : (
            <LogoutOutlinedIcon sx={{ fontSize: 40, color: md3Colors.error }} />
          )}
        </Box>

        <Typography
          id={titleId}
          variant="headlineLarge"
          sx={{ color: md3Colors.onSurface, mb: 2 }}
        >
          {statusLabel}
        </Typography>

        <Typography
          variant="displaySmall"
          component="p"
          sx={{ color: md3Colors.onSurface, m: 0, textWrap: 'balance' }}
        >
          {result.student.name}
        </Typography>

        {!isCheckIn && result.session?.duration_minutes != null && (
          <Typography
            variant="bodyMedium"
            sx={{ color: md3Colors.onSurfaceVariant, mt: 2 }}
          >
            {Math.round(result.session.duration_minutes)} min session
          </Typography>
        )}
      </Box>
    </BottomSheet>
  );
}

function ErrorSheet({ onDismiss, onRegister }) {
  const { dismiss, exiting } = useSheetDismiss(onDismiss);
  const titleId = 'scan-error-title';

  return (
    <BottomSheet
      autoDismissMs={ERROR_DISMISS_MS}
      onDismiss={dismiss}
      exiting={exiting}
      ariaLabelledBy={titleId}
    >
      <SheetDragHandle />

      <Box sx={{ position: 'relative', width: 64, height: 64, mx: 'auto', mb: 2 }}>
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            bgcolor: md3Colors.errorContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <QrCode2OutlinedIcon sx={{ fontSize: 32, color: md3Colors.error }} />
        </Box>
        <ErrorOutlineOutlinedIcon
          sx={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            fontSize: 22,
            color: md3Colors.error,
            bgcolor: md3Colors.surfaceBright,
            borderRadius: '50%',
          }}
        />
      </Box>

      <Typography id={titleId} variant="headlineMedium" sx={{ textAlign: 'center', mb: 1 }}>
        Code not recognized
      </Typography>
      <Typography
        variant="bodyMedium"
        sx={{ textAlign: 'center', color: md3Colors.onSurfaceVariant, mb: 3 }}
      >
        Visit the front desk or register to get your personal QR code.
      </Typography>
      <Button variant="contained" fullWidth onClick={onRegister} sx={{ minHeight: 48 }}>
        Get a QR code
      </Button>
    </BottomSheet>
  );
}

function ScanMenuDrawer({ open, onClose, navigate, currentPath }) {
  const items = [
    { label: 'Scan', path: '/', icon: QrCodeScannerOutlinedIcon },
    { label: 'Register', path: '/register', icon: PersonAddOutlinedIcon },
    { label: 'Dashboard', path: '/dashboard', icon: BarChartOutlinedIcon },
    { label: 'Admin', path: '/admin', icon: SettingsOutlinedIcon },
  ];

  return (
    <Drawer anchor="left" open={open} onClose={onClose}>
      <Box sx={{ width: 280, pt: 1 }} role="navigation" aria-label="Main">
        <Typography variant="titleMedium" sx={{ px: 2, py: 1.5, color: md3Colors.onSurface }}>
          KumonScan
        </Typography>
        <Divider />
        <List>
          {items.map(({ label, path, icon: Icon }) => (
            <ListItemButton
              key={path}
              selected={currentPath === path}
              onClick={() => {
                navigate(path);
                onClose();
              }}
              sx={{ minHeight: 48 }}
            >
              <ListItemIcon>
                <Icon sx={{ color: md3Colors.onSurfaceVariant }} />
              </ListItemIcon>
              <ListItemText primary={label} />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Drawer>
  );
}

export default function ScanPage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const [result, setResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [scanning, setScanning] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [menuOpen, setMenuOpen] = useState(false);
  const scannerRef = useRef(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ value: null, at: 0 });

  const resumeScanning = useCallback(() => {
    setResult(null);
    setScanError(null);
    setScanning(true);
    setCameraReady(false);
    processingRef.current = false;
  }, []);

  const dismissSheet = useCallback(() => {
    resumeScanning();
  }, [resumeScanning]);

  const handleScan = useCallback(async (decodedText) => {
    const now = Date.now();
    const lastScan = lastScanRef.current;

    if (processingRef.current) return;
    if (lastScan.value === decodedText && now - lastScan.at < SCAN_COOLDOWN_MS) return;

    processingRef.current = true;
    setScanError(null);

    try {
      const data = await api.scan(decodedText);
      lastScanRef.current = { value: decodedText, at: Date.now() };
      setTimezone(data.timezone);
      setResult(data);
      setScanning(false);

      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
    } catch {
      setScanError(true);
      setScanning(false);
      processingRef.current = false;

      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!scanning) return;

    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1, showTorchButtonIfSupported: true },
      false
    );

    scannerRef.current = scanner;
    scanner.render((decodedText) => handleScan(decodedText), () => {});

    const observer = new MutationObserver(() => {
      const video = document.querySelector('#qr-reader video');
      if (video && video.readyState >= 2) setCameraReady(true);
    });
    const el = document.getElementById('qr-reader');
    if (el) observer.observe(el, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      scanner.clear().catch(() => {});
      scannerRef.current = null;
    };
  }, [scanning, handleScan]);

  useEffect(() => {
    api.getTime().then((t) => setTimezone(t.timezone)).catch(() => {});
  }, []);

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: md3Colors.background,
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <ScanTopAppBar timezone={timezone} onMenuOpen={() => setMenuOpen(true)} />
      <ScanMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        navigate={navigate}
        currentPath="/"
      />

      <Box
        component="section"
        aria-label="QR scanner"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
          pb: { xs: 12, md: 2 },
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 384,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: GRID * 6,
          }}
        >
          <Box sx={{ textAlign: 'center' }}>
            <Typography
              variant="displaySmall"
              component="h2"
              sx={{ color: md3Colors.onSurface, mb: 1 }}
            >
              Check in or out
            </Typography>
            <Typography variant="bodyLarge" sx={{ color: md3Colors.onSurfaceVariant, m: 0 }}>
              Scan your QR code to log your visit
            </Typography>
          </Box>

          <ViewfinderCard cameraReady={cameraReady} reducedMotion={reducedMotion}>
            <div id="qr-reader" />
          </ViewfinderCard>
        </Box>
      </Box>

      {result && <SuccessSheet result={result} onDismiss={dismissSheet} />}
      {scanError && (
        <ErrorSheet
          onDismiss={dismissSheet}
          onRegister={() => {
            setScanError(null);
            navigate('/register');
          }}
        />
      )}
    </Box>
  );
}
