import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Typography,
  LinearProgress,
  Button,
  IconButton,
  TextField,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Autocomplete,
  CircularProgress,
} from '@mui/material';
import MenuOutlinedIcon from '@mui/icons-material/MenuOutlined';
import QrCodeScannerOutlinedIcon from '@mui/icons-material/QrCodeScannerOutlined';
import QrCode2OutlinedIcon from '@mui/icons-material/QrCode2Outlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import DeskOutlinedIcon from '@mui/icons-material/DeskOutlined';
import PersonAddOutlinedIcon from '@mui/icons-material/PersonAddOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { api } from '../api';
import BrandMark from '../components/BrandMark';
import { md3Colors, motion, shape } from '../theme';
import { centerPath } from '../centerPath';

const SCAN_COOLDOWN_MS = 3000;
const SUCCESS_DISMISS_MS = 4000;
const ERROR_DISMISS_MS = 5000;
const CAMERA_START_TIMEOUT_MS = 9000;

const GRID = 4;

/**
 * html5-qrcode's stop() throws synchronously (not just a rejected promise)
 * when called on a scanner that never reached the SCANNING state — e.g. the
 * camera was still starting when a manual-code or search check-in
 * succeeded. An uncaught throw here happens during a React effect cleanup,
 * which unmounts the whole tree with no error boundary — so every stop()
 * call site must go through this instead of calling it directly.
 */
async function safeStopScanner(scanner) {
  if (!scanner) return;
  try {
    await scanner.stop();
  } catch {
    // Not running/paused — nothing to stop.
  }
  try {
    await scanner.clear();
  } catch {
    // Already cleared, or never finished rendering.
  }
}

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
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }

    // Safari fallback for older MediaQueryList API.
    mq.addListener(handler);
    return () => mq.removeListener(handler);
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
        borderRadius: `${shape.extraSmall}px`,
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
            aspectRatio: '1 / 1',
            height: 'auto',
            maxHeight: { xs: 'min(280px, 55vw)', md: 280 },
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
          pb: 'max(40px, calc(16px + env(safe-area-inset-bottom)))',
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

function ScanMenuDrawer({ open, onClose, navigate, currentPath, centerSlug, onLock }) {
  const items = [
    { label: 'Scan', path: '/', icon: QrCodeScannerOutlinedIcon },
    { label: 'Desk', path: '/desk', icon: DeskOutlinedIcon },
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
                navigate(centerPath(centerSlug, path));
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
        <Divider />
        <List>
          <ListItemButton
            onClick={() => {
              onClose();
              onLock();
            }}
            sx={{ minHeight: 48 }}
          >
            <ListItemIcon>
              <LockOutlinedIcon sx={{ color: md3Colors.onSurfaceVariant }} />
            </ListItemIcon>
            <ListItemText primary="Lock kiosk" />
          </ListItemButton>
        </List>
      </Box>
    </Drawer>
  );
}

const KIOSK_LOCK_STORAGE_KEY = 'kumonscan_kiosk_locked';

function LockOverlay({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password.trim() || unlocking) return;
    setUnlocking(true);
    setError('');
    try {
      // Verify against the center's shared password, then immediately log
      // back out — the kiosk should never be left holding a live admin
      // session cookie on a public, shared device.
      await api.login(password);
      await api.logout().catch(() => {});
      onUnlock();
    } catch (err) {
      setError(err.message || 'Incorrect password');
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        bgcolor: md3Colors.background,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: 3,
      }}
    >
      <LockOutlinedIcon sx={{ fontSize: 40, color: md3Colors.onSurfaceVariant, mb: 2 }} />
      <Typography variant="headlineMedium" sx={{ mb: 1, textAlign: 'center' }}>
        Kiosk locked
      </Typography>
      <Typography
        variant="bodyMedium"
        sx={{ color: md3Colors.onSurfaceVariant, mb: 3, textAlign: 'center' }}
      >
        Enter the center password to unlock.
      </Typography>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <TextField
          type="password"
          label="Center password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          fullWidth
          error={Boolean(error)}
          helperText={error || ' '}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={!password.trim() || unlocking}
          startIcon={unlocking ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ minHeight: 48 }}
        >
          {unlocking ? 'Unlocking…' : 'Unlock'}
        </Button>
      </Box>
    </Box>
  );
}

export default function ScanPage() {
  const navigate = useNavigate();
  const { centerSlug } = useParams();
  const reducedMotion = useReducedMotion();
  const [result, setResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [scanning, setScanning] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraAttemptLabel, setCameraAttemptLabel] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [menuOpen, setMenuOpen] = useState(false);
  const [locked, setLocked] = useState(
    () => typeof window !== 'undefined' && sessionStorage.getItem(KIOSK_LOCK_STORAGE_KEY) === '1'
  );
  const [searchOptions, setSearchOptions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const scannerRef = useRef(null);
  const scanSessionRef = useRef(0);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ value: null, at: 0 });
  const searchDebounceRef = useRef(null);

  const resumeScanning = useCallback(() => {
    setResult(null);
    setScanError(null);
    setScanning(true);
    setCameraReady(false);
    setCameraError('');
    setCameraAttemptLabel('');
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
        const scanner = scannerRef.current;
        scannerRef.current = null;
        void safeStopScanner(scanner);
      }
    } catch {
      setScanError(true);
      setScanning(false);
      processingRef.current = false;

      if (scannerRef.current) {
        const scanner = scannerRef.current;
        scannerRef.current = null;
        void safeStopScanner(scanner);
      }
    }
  }, []);

  const handleManualSubmit = useCallback(
    (e) => {
      e.preventDefault();
      const code = manualCode.trim();
      if (!code || processingRef.current) return;
      setScanError(null);
      handleScan(code);
    },
    [manualCode, handleScan]
  );

  const handleLock = useCallback(() => {
    sessionStorage.setItem(KIOSK_LOCK_STORAGE_KEY, '1');
    setLocked(true);
  }, []);

  const handleUnlock = useCallback(() => {
    sessionStorage.removeItem(KIOSK_LOCK_STORAGE_KEY);
    setLocked(false);
  }, []);

  const handleSearchInputChange = useCallback((_e, value) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    const q = value.trim();
    if (!q) {
      setSearchOptions([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const data = await api.searchStudents(q);
        setSearchOptions(data.students || []);
      } catch {
        setSearchOptions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, []);

  const handleSearchSelect = useCallback(
    (_e, option) => {
      if (!option || processingRef.current) return;
      setScanError(null);
      setSearchOptions([]);
      handleScan(option.qr_code_value);
    },
    [handleScan]
  );

  useEffect(() => {
    if (!scanning) return;

    let cancelled = false;
    const sessionId = ++scanSessionRef.current;
    let scanner = null;
    let Html5QrcodeClass = null;
    setCameraReady(false);
    setCameraError('');
    setCameraAttemptLabel('Starting camera…');

    const startConfig = {
      fps: 10,
      qrbox: { width: 260, height: 260 },
      aspectRatio: 1,
      disableFlip: false,
      rememberLastUsedCamera: true,
    };

    const startProfiles = [
      { label: 'Rear camera', camera: { facingMode: { exact: 'environment' } } },
      { label: 'Rear camera (fallback)', camera: { facingMode: 'environment' } },
      { label: 'Front camera', camera: { facingMode: 'user' } },
    ];

    async function startWithTimeout(cameraConfig, label) {
      setCameraAttemptLabel(label);
      await Promise.race([
        scanner.start(cameraConfig, startConfig, handleScan, () => {}),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Camera startup timed out')), CAMERA_START_TIMEOUT_MS)
        ),
      ]);
    }

    async function bootScanner() {
      try {
        const module = await import('html5-qrcode');
        Html5QrcodeClass = module?.Html5Qrcode;
        if (!Html5QrcodeClass) {
          throw new Error('QR scanner library unavailable');
        }

        scanner = new Html5QrcodeClass('qr-reader', false);
        scannerRef.current = scanner;

        for (const profile of startProfiles) {
          if (cancelled || scanSessionRef.current !== sessionId) return;
          try {
            await startWithTimeout(profile.camera, profile.label);
            if (cancelled || scanSessionRef.current !== sessionId) return;
            setCameraReady(true);
            setCameraAttemptLabel('');
            return;
          } catch {
            // Continue to next profile.
          }
        }

        const cameras = await Html5QrcodeClass.getCameras();
        for (const camera of cameras) {
          if (cancelled || scanSessionRef.current !== sessionId) return;
          try {
            await startWithTimeout(camera.id, `Trying ${camera.label || 'another camera'}…`);
            if (cancelled || scanSessionRef.current !== sessionId) return;
            setCameraReady(true);
            setCameraAttemptLabel('');
            return;
          } catch {
            // Continue to next device.
          }
        }

        throw new Error('No camera configuration could be started');
      } catch (err) {
        if (cancelled || scanSessionRef.current !== sessionId) return;
        setCameraReady(false);
        setCameraError(
          'Camera unavailable right now. You can retry camera startup or type your code manually below.'
        );
        setCameraAttemptLabel('');
      }
    }

    bootScanner();

    const observer = new MutationObserver(() => {
      const video = document.querySelector('#qr-reader video');
      if (video && video.readyState >= 2) setCameraReady(true);
    });
    const el = document.getElementById('qr-reader');
    if (el) observer.observe(el, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (scannerRef.current === scanner && scanner) {
        scannerRef.current = null;
      }
      if (scanner) {
        void safeStopScanner(scanner);
      }
    };
  }, [scanning, handleScan]);

  useEffect(() => {
    api.getTime().then((t) => setTimezone(t.timezone)).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: md3Colors.background,
        overflow: 'auto',
        WebkitOverflowScrolling: 'touch',
        minHeight: 0,
      }}
    >
      <ScanTopAppBar timezone={timezone} onMenuOpen={() => setMenuOpen(true)} />
      <ScanMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        navigate={navigate}
        currentPath="/"
        centerSlug={centerSlug}
        onLock={handleLock}
      />
      {locked && <LockOverlay onUnlock={handleUnlock} />}

      <Box
        component="section"
        aria-label="QR scanner"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: { xs: 'flex-start', sm: 'center' },
          px: 2,
          pt: { xs: 2, sm: 0 },
          pb: { xs: 2, md: 2 },
          overflow: 'visible',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 384,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: { xs: GRID * 4, sm: GRID * 6 },
          }}
        >
          <Box sx={{ textAlign: 'center', px: 1 }}>
            <Typography
              variant="displaySmall"
              component="h2"
              sx={{
                color: md3Colors.onSurface,
                mb: 1,
                fontSize: { xs: '28px', sm: '36px' },
                lineHeight: { xs: '36px', sm: '44px' },
              }}
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

          {cameraAttemptLabel && !cameraReady && !cameraError && (
            <Typography
              variant="bodySmall"
              sx={{ color: md3Colors.onSurfaceVariant, textAlign: 'center', mt: -2 }}
            >
              {cameraAttemptLabel}
            </Typography>
          )}

          {cameraError && (
            <Box
              sx={{
                width: '100%',
                maxWidth: 384,
                p: 2,
                borderRadius: `${shape.large}px`,
                bgcolor: md3Colors.errorContainer,
                border: `1px solid ${md3Colors.error}`,
              }}
            >
              <Typography variant="titleSmall" sx={{ color: md3Colors.onErrorContainer, mb: 0.5 }}>
                Camera fallback
              </Typography>
              <Typography variant="bodySmall" sx={{ color: md3Colors.onErrorContainer, mb: 1.5 }}>
                {cameraError}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  onClick={resumeScanning}
                  sx={{
                    bgcolor: md3Colors.error,
                    color: md3Colors.onPrimary,
                    '&:hover': { bgcolor: md3Colors.error },
                  }}
                >
                  Retry camera
                </Button>
                <Button
                  variant="text"
                  onClick={() => navigate(centerPath(centerSlug, '/register'))}
                  sx={{ color: md3Colors.onErrorContainer }}
                >
                  Get a QR code
                </Button>
              </Box>
            </Box>
          )}

          <Box
            component="form"
            onSubmit={handleManualSubmit}
            sx={{
              width: '100%',
              maxWidth: 384,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
            }}
          >
            <TextField
              label="Enter code manually"
              placeholder="e.g. KUMON-17D66DCC"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              size="small"
              fullWidth
              inputProps={{ autoCapitalize: 'characters' }}
            />
            <Button type="submit" variant="outlined" disabled={!manualCode.trim() || processingRef.current}>
              Submit code
            </Button>
          </Box>

          <Box sx={{ width: '100%', maxWidth: 384 }}>
            <Typography
              variant="bodySmall"
              sx={{ color: md3Colors.onSurfaceVariant, textAlign: 'center', mb: 1 }}
            >
              Or find yourself by name or student number
            </Typography>
            <Autocomplete
              options={searchOptions}
              loading={searchLoading}
              filterOptions={(options) => options}
              getOptionLabel={(option) =>
                option.student_number
                  ? `${option.name} · #${option.student_number}`
                  : option.name || ''
              }
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onInputChange={handleSearchInputChange}
              onChange={handleSearchSelect}
              noOptionsText="No matching students"
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Search first or last name"
                  size="small"
                  fullWidth
                />
              )}
            />
          </Box>
        </Box>
      </Box>

      {result && <SuccessSheet result={result} onDismiss={dismissSheet} />}
      {scanError && (
        <ErrorSheet
          onDismiss={dismissSheet}
          onRegister={() => {
            setScanError(null);
            navigate(centerPath(centerSlug, '/register'));
          }}
        />
      )}
    </Box>
  );
}
