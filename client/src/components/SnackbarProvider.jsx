import { createContext, useCallback, useContext, useState } from 'react';
import { Snackbar, Button } from '@mui/material';
import { md3Colors } from '../theme';

const SnackbarContext = createContext(null);

export function useSnackbar() {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error('useSnackbar must be used within SnackbarProvider');
  return ctx;
}

export default function SnackbarProvider({ children }) {
  const [state, setState] = useState({
    open: false,
    message: '',
    action: null,
  });

  const showSnackbar = useCallback((message, options = {}) => {
    setState({
      open: true,
      message,
      action: options.action || null,
    });
  }, []);

  const hideSnackbar = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  return (
    <SnackbarContext.Provider value={{ showSnackbar, hideSnackbar }}>
      {children}
      <Snackbar
        open={state.open}
        autoHideDuration={4000}
        onClose={hideSnackbar}
        message={state.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        action={
          state.action ? (
            <Button
              color="secondary"
              size="small"
              onClick={() => {
                state.action.onClick?.();
                hideSnackbar();
              }}
              sx={{ color: md3Colors.secondary, fontWeight: 500 }}
            >
              {state.action.label}
            </Button>
          ) : undefined
        }
        sx={{
          bottom: {
            xs: 'calc(72px + env(safe-area-inset-bottom))',
            md: 24,
          },
          '& .MuiSnackbarContent-root': {
            bgcolor: md3Colors.inverseSurface,
            color: md3Colors.inverseOnSurface,
            borderRadius: '4px',
            minWidth: { xs: 'auto', sm: 288 },
            maxWidth: 'calc(100vw - 32px)',
          },
        }}
      />
    </SnackbarContext.Provider>
  );
}
