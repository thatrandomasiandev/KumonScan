import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { parentApi } from './parentApi';
import { setupFamilyPwa } from './pwa';
import { md3Colors } from '../theme';
import RequestAccessPage from './RequestAccessPage';
import VerifyPage from './VerifyPage';
import HomePage from './HomePage';

const ParentSessionContext = createContext(null);

export function useParentSession() {
  return useContext(ParentSessionContext);
}

function FullPageSpinner() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: md3Colors.background,
      }}
    >
      <CircularProgress aria-label="Loading" />
    </Box>
  );
}

export default function ParentApp() {
  const [status, setStatus] = useState('loading');
  const [student, setStudent] = useState(null);

  useEffect(() => {
    setupFamilyPwa();
    document.title = 'KumonScan Family';
  }, []);

  const refresh = useCallback(async () => {
    try {
      const session = await parentApi.getSession();
      if (session.authenticated) {
        setStudent(session.student);
        setStatus('authenticated');
      } else {
        setStudent(null);
        setStatus('anonymous');
      }
    } catch {
      setStudent(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await parentApi.logout();
    } finally {
      setStudent(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(
    () => ({ status, student, refresh, signOut, setStudent, setStatus }),
    [status, student, refresh, signOut]
  );

  if (status === 'loading') {
    return <FullPageSpinner />;
  }

  return (
    <ParentSessionContext.Provider value={value}>
      <Routes>
        <Route
          index
          element={
            status === 'authenticated' ? <Navigate to="home" replace /> : <RequestAccessPage />
          }
        />
        <Route path="verify" element={<VerifyPage />} />
        <Route
          path="home"
          element={status === 'authenticated' ? <HomePage /> : <Navigate to="/family" replace />}
        />
        <Route path="*" element={<Navigate to="/family" replace />} />
      </Routes>
    </ParentSessionContext.Provider>
  );
}
