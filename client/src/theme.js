import { createTheme, alpha } from '@mui/material/styles';

const md3Colors = {
  primary: '#1B6EF3',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D8E6FF',
  onPrimaryContainer: '#001946',
  secondary: '#F59E0B',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#FFECC2',
  onSecondaryContainer: '#241A00',
  tertiary: '#6B4EFF',
  tertiaryContainer: '#E8DDFF',
  onTertiaryContainer: '#1E0060',
  surface: '#F8F9FF',
  surfaceVariant: '#E1E2EC',
  onSurface: '#1A1B22',
  onSurfaceVariant: '#44464F',
  error: '#BA1A1A',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  background: '#F8F9FF',
  surfaceBright: '#FFFFFF',
  outline: '#74767F',
  outlineVariant: '#C4C6D0',
  inverseSurface: '#313033',
  inverseOnSurface: '#F3EFF4',
  scrim: 'rgba(0,0,0,0.32)',
  elevation1: 'rgba(27, 110, 243, 0.05)',
  elevation2: 'rgba(27, 110, 243, 0.08)',
  elevation3: 'rgba(27, 110, 243, 0.11)',
  elevation4: 'rgba(27, 110, 243, 0.12)',
  elevation5: 'rgba(27, 110, 243, 0.14)',
  scanDark: '#1A1B22',
  success: '#2E7D32',
  successContainer: '#C8E6C9',
};

export { md3Colors };

export const motion = {
  emphasizedDecelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1.0)',
  emphasizedAccelerate: 'cubic-bezier(0.3, 0.0, 0.8, 0.15)',
  short1: '50ms',
  short2: '100ms',
  medium1: '200ms',
  medium2: '300ms',
  long1: '400ms',
};

export const shape = {
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  full: 9999,
};

function surfaceWithElevation(level) {
  const tints = [
    md3Colors.surface,
    `color-mix(in srgb, ${md3Colors.surface} 95%, ${md3Colors.primary} 5%)`,
    `color-mix(in srgb, ${md3Colors.surface} 92%, ${md3Colors.primary} 8%)`,
    `color-mix(in srgb, ${md3Colors.surface} 89%, ${md3Colors.primary} 11%)`,
    `color-mix(in srgb, ${md3Colors.surface} 88%, ${md3Colors.primary} 12%)`,
    `color-mix(in srgb, ${md3Colors.surface} 86%, ${md3Colors.primary} 14%)`,
  ];
  return tints[level] || tints[0];
}

export function getElevatedSurface(level) {
  return surfaceWithElevation(level);
}

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: md3Colors.primary,
      contrastText: md3Colors.onPrimary,
      light: md3Colors.primaryContainer,
      dark: md3Colors.onPrimaryContainer,
    },
    secondary: {
      main: md3Colors.secondary,
      contrastText: md3Colors.onSecondary,
      light: md3Colors.secondaryContainer,
    },
    error: {
      main: md3Colors.error,
      light: md3Colors.errorContainer,
    },
    background: {
      default: md3Colors.background,
      paper: md3Colors.surface,
    },
    text: {
      primary: md3Colors.onSurface,
      secondary: md3Colors.onSurfaceVariant,
    },
    divider: md3Colors.outlineVariant,
  },
  shape: {
    borderRadius: shape.medium,
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    displayLarge: {
      fontSize: '57px',
      lineHeight: '64px',
      fontWeight: 400,
      letterSpacing: '-0.25px',
    },
    displayMedium: {
      fontSize: '45px',
      lineHeight: '52px',
      fontWeight: 400,
    },
    displaySmall: {
      fontSize: '36px',
      lineHeight: '44px',
      fontWeight: 400,
    },
    headlineLarge: {
      fontSize: '32px',
      lineHeight: '40px',
      fontWeight: 400,
    },
    headlineMedium: {
      fontSize: '28px',
      lineHeight: '36px',
      fontWeight: 400,
    },
    headlineSmall: {
      fontSize: '24px',
      lineHeight: '32px',
      fontWeight: 400,
    },
    titleLarge: {
      fontSize: '22px',
      lineHeight: '28px',
      fontWeight: 500,
    },
    titleMedium: {
      fontSize: '16px',
      lineHeight: '24px',
      fontWeight: 500,
      letterSpacing: '0.15px',
    },
    titleSmall: {
      fontSize: '14px',
      lineHeight: '20px',
      fontWeight: 500,
      letterSpacing: '0.1px',
    },
    bodyLarge: {
      fontSize: '16px',
      lineHeight: '24px',
      fontWeight: 400,
      letterSpacing: '0.5px',
    },
    bodyMedium: {
      fontSize: '14px',
      lineHeight: '20px',
      fontWeight: 400,
      letterSpacing: '0.25px',
    },
    bodySmall: {
      fontSize: '12px',
      lineHeight: '16px',
      fontWeight: 400,
      letterSpacing: '0.4px',
    },
    labelLarge: {
      fontSize: '14px',
      lineHeight: '20px',
      fontWeight: 500,
      letterSpacing: '0.1px',
    },
    labelMedium: {
      fontSize: '12px',
      lineHeight: '16px',
      fontWeight: 500,
      letterSpacing: '0.5px',
    },
    labelSmall: {
      fontSize: '11px',
      lineHeight: '16px',
      fontWeight: 500,
      letterSpacing: '0.5px',
    },
  },
  components: {
    MuiTypography: {
      defaultProps: {
        variantMapping: {
          displayLarge: 'h1',
          displayMedium: 'h1',
          displaySmall: 'h1',
          headlineLarge: 'h2',
          headlineMedium: 'h2',
          headlineSmall: 'h2',
          titleLarge: 'h3',
          titleMedium: 'h4',
          titleSmall: 'h5',
          bodyLarge: 'p',
          bodyMedium: 'p',
          bodySmall: 'p',
          labelLarge: 'span',
          labelMedium: 'span',
          labelSmall: 'span',
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: md3Colors.background,
          color: md3Colors.onSurface,
        },
        '::selection': {
          backgroundColor: alpha(md3Colors.primary, 0.15),
          color: md3Colors.onPrimaryContainer,
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: shape.full,
          textTransform: 'none',
          fontWeight: 500,
          fontSize: '14px',
          lineHeight: '20px',
          letterSpacing: '0.1px',
          padding: '10px 24px',
          minHeight: 44,
          transition: `background-color ${motion.short2} ${motion.emphasizedDecelerate}`,
          '&:focus-visible': {
            outline: `3px solid ${alpha(md3Colors.primary, 0.4)}`,
            outlineOffset: 2,
          },
        },
        contained: {
          backgroundColor: md3Colors.primary,
          color: md3Colors.onPrimary,
          '&:hover': {
            backgroundColor: md3Colors.primary,
            boxShadow: 'none',
            backgroundImage: `linear-gradient(${alpha(md3Colors.onPrimary, 0.08)}, ${alpha(md3Colors.onPrimary, 0.08)})`,
          },
        },
        containedSecondary: {
          backgroundColor: md3Colors.primaryContainer,
          color: md3Colors.onPrimaryContainer,
          '&:hover': {
            backgroundColor: md3Colors.primaryContainer,
            backgroundImage: `linear-gradient(${alpha(md3Colors.onPrimaryContainer, 0.08)}, ${alpha(md3Colors.onPrimaryContainer, 0.08)})`,
          },
        },
        outlined: {
          borderColor: md3Colors.outline,
          color: md3Colors.primary,
          '&:hover': {
            backgroundColor: alpha(md3Colors.primary, 0.08),
            borderColor: md3Colors.outline,
          },
        },
        text: {
          color: md3Colors.primary,
          '&:hover': {
            backgroundColor: alpha(md3Colors.primary, 0.08),
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'filled',
      },
    },
    MuiFilledInput: {
      styleOverrides: {
        root: {
          backgroundColor: md3Colors.surfaceVariant,
          borderRadius: `${shape.small}px ${shape.small}px 0 0`,
          '&:before': {
            borderBottom: `1px solid ${md3Colors.outline}`,
          },
          '&:hover:not(.Mui-disabled):before': {
            borderBottom: `1px solid ${md3Colors.outline}`,
          },
          '&.Mui-focused:after': {
            borderBottom: `2px solid ${md3Colors.primary}`,
          },
          '&.Mui-error:after': {
            borderBottom: `2px solid ${md3Colors.error}`,
          },
        },
        input: {
          minHeight: 56,
          padding: '24px 16px 8px',
          fontSize: '16px',
          lineHeight: '24px',
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '16px',
          '&.Mui-focused': {
            color: md3Colors.primary,
          },
          '&.Mui-error': {
            color: md3Colors.error,
          },
        },
        filled: {
          transform: 'translate(16px, 18px) scale(1)',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(16px, 8px) scale(0.75)',
            fontSize: '11px',
            letterSpacing: '0.5px',
            fontWeight: 500,
          },
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          fontSize: '12px',
          lineHeight: '16px',
          letterSpacing: '0.4px',
          color: md3Colors.onSurfaceVariant,
          marginLeft: 16,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: shape.extraLarge,
          backgroundColor: getElevatedSurface(4),
          boxShadow: '0 4px 32px rgba(0,0,0,0.12)',
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: '24px',
          lineHeight: '32px',
          fontWeight: 400,
          padding: '24px 24px 16px',
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          fontSize: '14px',
          lineHeight: '20px',
          letterSpacing: '0.25px',
          padding: '0 24px 8px',
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: '16px 16px 16px 8px',
          justifyContent: 'flex-end',
        },
      },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: {
          backgroundColor: md3Colors.inverseSurface,
          color: md3Colors.inverseOnSurface,
          borderRadius: shape.extraSmall,
          fontSize: '14px',
          lineHeight: '20px',
          letterSpacing: '0.25px',
          boxShadow: 'none',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: shape.full,
          fontSize: '12px',
          fontWeight: 500,
          letterSpacing: '0.5px',
          minHeight: 36,
        },
        filled: {
          backgroundColor: md3Colors.primaryContainer,
          color: md3Colors.onPrimaryContainer,
        },
        outlined: {
          backgroundColor: md3Colors.surface,
          borderColor: md3Colors.outline,
        },
      },
    },
    MuiFab: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          textTransform: 'none',
        },
        primary: {
          backgroundColor: md3Colors.primaryContainer,
          color: md3Colors.onPrimaryContainer,
          '&:hover': {
            backgroundColor: md3Colors.primaryContainer,
            backgroundImage: `linear-gradient(${alpha(md3Colors.onPrimaryContainer, 0.08)}, ${alpha(md3Colors.onPrimaryContainer, 0.08)})`,
          },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          backgroundColor: alpha(md3Colors.primary, 0.12),
          borderRadius: shape.full,
        },
        bar: {
          backgroundColor: md3Colors.primary,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: shape.full,
          minHeight: 48,
          '&:hover': {
            backgroundColor: alpha(md3Colors.onSurface, 0.08),
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: shape.full,
          minWidth: 44,
          minHeight: 44,
          '&:hover': {
            backgroundColor: alpha(md3Colors.onSurface, 0.08),
          },
          '&:focus-visible': {
            outline: `3px solid ${alpha(md3Colors.primary, 0.4)}`,
            outlineOffset: 2,
          },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          minHeight: 44,
          px: 2,
        },
      },
    },
  },
});

export default theme;
