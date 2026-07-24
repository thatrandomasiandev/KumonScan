import { Box, CircularProgress, Typography } from '@mui/material';
import { md3Colors } from '../theme';

export default function LoadingScreen({ message = 'Loading...' }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
        gap: 2,
      }}
    >
      <CircularProgress size={32} sx={{ color: md3Colors.primary }} />
      <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
        {message}
      </Typography>
    </Box>
  );
}
