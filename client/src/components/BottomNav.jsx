import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import QrCodeScannerOutlinedIcon from '@mui/icons-material/QrCodeScannerOutlined';
import DeskOutlinedIcon from '@mui/icons-material/DeskOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import { md3Colors, getElevatedSurface, shape } from '../theme';
import { centerPath, pagePath } from '../centerPath';

const navItems = [
  { path: '/', label: 'Scan', icon: QrCodeScannerOutlinedIcon },
  { path: '/desk', label: 'Desk', icon: DeskOutlinedIcon },
  { path: '/dashboard', label: 'Dashboard', icon: BarChartOutlinedIcon },
  { path: '/messages', label: 'Messages', icon: ForumOutlinedIcon }, // agent-1-messaging
  { path: '/admin', label: 'Admin', icon: SettingsOutlinedIcon },
];

function NavItem({ path, label, icon: Icon, active, onClick }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.25,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        py: 1,
        minWidth: 64,
        minHeight: 56,
        position: 'relative',
      }}
    >
      <Box
        sx={{
          width: 64,
          height: 32,
          borderRadius: shape.full,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: active ? md3Colors.primaryContainer : 'transparent',
          transition: 'background-color 100ms cubic-bezier(0.05, 0.7, 0.1, 1.0)',
        }}
      >
        <Icon
          sx={{
            fontSize: 24,
            color: active ? md3Colors.primary : md3Colors.onSurfaceVariant,
          }}
        />
      </Box>
      <Typography
        variant="labelMedium"
        sx={{
          color: active ? md3Colors.primary : md3Colors.onSurfaceVariant,
          fontSize: '11px',
          lineHeight: '16px',
          fontWeight: active ? 500 : 400,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

export default function BottomNav({ centerSlug }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPage = pagePath(location.pathname);

  if (currentPage === '/register') return null;

  return (
    <Box
      component="nav"
      aria-label="Mobile navigation"
      sx={{
        display: { xs: 'flex', md: 'none' },
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        bgcolor: getElevatedSurface(2),
        borderTop: `1px solid ${md3Colors.outlineVariant}`,
        zIndex: 1100,
        px: 1,
        py: 0.5,
        pb: 'max(8px, env(safe-area-inset-bottom))',
      }}
    >
      {navItems.map(({ path, label, icon }) => (
        <NavItem
          key={path}
          path={path}
          label={label}
          icon={icon}
          active={currentPage === path}
          onClick={() => navigate(centerPath(centerSlug, path))}
        />
      ))}
    </Box>
  );
}
