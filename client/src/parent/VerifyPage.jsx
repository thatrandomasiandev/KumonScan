import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import LinkOffOutlinedIcon from '@mui/icons-material/LinkOffOutlined';
import { parentApi } from './parentApi';
import { useParentSession } from './ParentApp';
import { md3Colors, getElevatedSurface, shape } from '../theme';

export default function VerifyPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setStudent, setStatus } = useParentSession();
  const [error, setError] = useState(null);
  const startedRef = useRef(false);

  const token = searchParams.get('token');

  useEffect(() => {
    // React 18 StrictMode double-invokes effects; the token is single-use,
    // so exactly one verification request may ever be sent. No cancellation
    // flag: the ref guard means the second (StrictMode) invocation is a
    // no-op, and the single in-flight result must always be applied.
    if (startedRef.current) return;
    startedRef.current = true;

    if (!token) {
      setError('This link is missing its sign-in code. Request a new one.');
      return;
    }

    (async () => {
      try {
        const result = await parentApi.verifyToken(token);
        setStudent(result.student);
        setStatus('authenticated');
        navigate('/family/home', { replace: true });
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [token, navigate, setStudent, setStatus]);

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
        {error ? (
          <>
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                bgcolor: md3Colors.errorContainer,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 3,
              }}
            >
              <LinkOffOutlinedIcon sx={{ fontSize: 40, color: md3Colors.error }} />
            </Box>
            <Typography variant="headlineSmall" sx={{ mb: 1 }}>
              Link didn&apos;t work
            </Typography>
            <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant, mb: 3 }}>
              {error}
            </Typography>
            <Button
              component={Link}
              to="/family"
              variant="contained"
              fullWidth
              sx={{ minHeight: 44 }}
            >
              Request a new link
            </Button>
          </>
        ) : (
          <>
            <CircularProgress sx={{ mb: 3 }} aria-label="Signing in" />
            <Typography variant="headlineSmall" sx={{ mb: 1 }}>
              Signing you in…
            </Typography>
            <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
              Checking your sign-in link.
            </Typography>
          </>
        )}
      </Paper>
    </Box>
  );
}
