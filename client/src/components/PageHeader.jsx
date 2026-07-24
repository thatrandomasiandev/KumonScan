import { Box, Typography } from '@mui/material';
import { md3Colors } from '../theme';

export default function PageHeader({ title, subtitle, action }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { sm: 'flex-end' },
        justifyContent: 'space-between',
        gap: 2,
        mb: 3,
      }}
    >
      <Box>
        <Typography
          variant="labelMedium"
          sx={{
            color: md3Colors.primary,
            mb: 0.75,
            display: 'block',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          KumonScan
        </Typography>
        <Typography variant="headlineMedium" sx={{ color: md3Colors.onSurface }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant, mt: 0.75, maxWidth: 480 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
    </Box>
  );
}
