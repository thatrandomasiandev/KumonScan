import { useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Box,
  IconButton,
  Toolbar,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/MenuOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import BrandMark from './BrandMark';
import { md3Colors, getElevatedSurface, motion } from '../theme';

export default function TopAppBar({ onMenuClick, scrolled = false }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();
  const isScanPage = location.pathname === '/';

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: isScanPage ? 'transparent' : getElevatedSurface(2),
        color: md3Colors.onSurface,
        boxShadow: scrolled ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
        borderBottom: isScanPage ? 'none' : `1px solid ${md3Colors.outlineVariant}`,
        transition: `box-shadow ${motion.medium1} ${motion.emphasizedDecelerate}`,
        backgroundImage: isScanPage ? 'none' : undefined,
      }}
    >
      <Toolbar
        sx={{
          minHeight: { xs: 64, md: 56 },
          px: { xs: 1, md: 2 },
          justifyContent: isMobile ? 'center' : 'flex-start',
          gap: 1,
        }}
      >
        {isMobile && !isScanPage && (
          <IconButton
            edge="start"
            aria-label="Open navigation"
            onClick={onMenuClick}
            sx={{ position: 'absolute', left: 8, color: md3Colors.onSurface }}
          >
            <MenuIcon />
          </IconButton>
        )}

        <Box
          sx={{
            flex: isMobile ? 1 : 'unset',
            display: 'flex',
            justifyContent: isMobile ? 'center' : 'flex-start',
            pl: isMobile && !isScanPage ? 5 : 0,
            pr: isMobile ? 5 : 0,
          }}
        >
          <BrandMark compact variant={isScanPage ? 'onDark' : 'light'} />
        </Box>

        {!isMobile && <Box sx={{ flex: 1 }} />}

        <Box
          sx={{
            display: 'flex',
            gap: 0.5,
            position: isMobile ? 'absolute' : 'relative',
            right: isMobile ? 8 : 'auto',
          }}
        >
          <IconButton
            aria-label="Dashboard"
            onClick={() => navigate('/dashboard')}
            sx={{
              color:
                location.pathname === '/dashboard'
                  ? md3Colors.primary
                  : isScanPage
                    ? 'rgba(255,255,255,0.7)'
                    : md3Colors.onSurfaceVariant,
            }}
          >
            <BarChartOutlinedIcon />
          </IconButton>
          <IconButton
            aria-label="Admin"
            onClick={() => navigate('/admin')}
            sx={{
              color:
                location.pathname === '/admin'
                  ? md3Colors.primary
                  : isScanPage
                    ? 'rgba(255,255,255,0.7)'
                    : md3Colors.onSurfaceVariant,
            }}
          >
            <SettingsOutlinedIcon />
          </IconButton>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
