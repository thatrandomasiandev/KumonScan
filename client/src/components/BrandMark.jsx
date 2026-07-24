import { Box, Typography } from '@mui/material';
import { md3Colors, shape } from '../theme';

export default function BrandMark({ subtitle, compact = false, variant = 'onDark' }) {
  const isOnDark = variant === 'onDark';
  const titleColor = isOnDark ? md3Colors.onPrimary : md3Colors.onSurface;
  const subtitleColor = isOnDark ? 'rgba(255,255,255,0.7)' : md3Colors.onSurfaceVariant;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      <Box
        sx={{
          width: compact ? 32 : 36,
          height: compact ? 32 : 36,
          borderRadius: `${shape.small}px`,
          bgcolor: md3Colors.primaryContainer,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Typography
          sx={{
            color: md3Colors.primary,
            fontWeight: 700,
            fontSize: compact ? '14px' : '16px',
            lineHeight: 1,
          }}
        >
          K
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant={compact ? 'titleMedium' : 'titleLarge'}
          sx={{ color: titleColor, fontWeight: 500, lineHeight: 1.2 }}
        >
          KumonScan
        </Typography>
        {subtitle && (
          <Typography
            variant="bodySmall"
            sx={{ color: subtitleColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
