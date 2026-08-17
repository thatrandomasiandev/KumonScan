import { useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Box,
  IconButton,
  Toolbar,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import BrandMark from './BrandMark';
import { md3Colors, getElevatedSurface, motion } from '../theme';
import { centerPath, pagePath } from '../centerPath';

export default function TopAppBar({ scrolled = false, centerSlug }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();
  const currentPage = pagePath(location.pathname);

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: getElevatedSurface(2),
        color: md3Colors.onSurface,
        boxShadow: scrolled ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
        borderBottom: `1px solid ${md3Colors.outlineVariant}`,
        transition: `box-shadow ${motion.medium1} ${motion.emphasizedDecelerate}`,
        top: 0,
      }}
    >
      <Toolbar
        sx={{
          minHeight: { xs: 56, md: 56 },
          px: { xs: 1.5, md: 2 },
          justifyContent: isMobile ? 'center' : 'flex-start',
          gap: 1,
        }}
      >
        <Box
          sx={{
            flex: isMobile ? 1 : 'unset',
            display: 'flex',
            justifyContent: isMobile ? 'center' : 'flex-start',
          }}
        >
          <BrandMark compact variant="light" />
        </Box>

        {!isMobile && <Box sx={{ flex: 1 }} />}

        {/* Desktop-only shortcuts; mobile uses BottomNav */}
        {!isMobile && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <IconButton
              aria-label="Dashboard"
              onClick={() => navigate(centerPath(centerSlug, '/dashboard'))}
              sx={{
                color:
                  currentPage === '/dashboard'
                    ? md3Colors.primary
                    : md3Colors.onSurfaceVariant,
              }}
            >
              <BarChartOutlinedIcon />
            </IconButton>
            <IconButton
              aria-label="Admin"
              onClick={() => navigate(centerPath(centerSlug, '/admin'))}
              sx={{
                color:
                  currentPage === '/admin'
                    ? md3Colors.primary
                    : md3Colors.onSurfaceVariant,
              }}
            >
              <SettingsOutlinedIcon />
            </IconButton>
          </Box>
        )}
      </Toolbar>
    </AppBar>
  );
}
