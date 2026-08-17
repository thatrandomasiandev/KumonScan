import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import DeskOutlinedIcon from '@mui/icons-material/DeskOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import PersonAddOutlinedIcon from '@mui/icons-material/PersonAddOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import BrandMark from './BrandMark';
import { md3Colors, getElevatedSurface, shape } from '../theme';
import { centerPath, pagePath } from '../centerPath';

const railItems = [
  { path: '/desk', label: 'Desk', icon: DeskOutlinedIcon },
  { path: '/register', label: 'Register', icon: PersonAddOutlinedIcon },
  { path: '/dashboard', label: 'Dashboard', icon: BarChartOutlinedIcon },
  { path: '/messages', label: 'Messages', icon: ForumOutlinedIcon }, // agent-1-messaging
  { path: '/insights', label: 'Insights', icon: InsightsOutlinedIcon }, // agent-7-insights
  { path: '/admin', label: 'Admin', icon: SettingsOutlinedIcon },
];

function RailItem({ path, label, icon: Icon, active, onClick }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        py: 1,
        px: 0.5,
        width: '100%',
        position: 'relative',
        '&:hover .rail-indicator': {
          bgcolor: active ? md3Colors.primaryContainer : 'rgba(26,27,34,0.08)',
        },
      }}
    >
      <Box
        className="rail-indicator"
        sx={{
          width: 56,
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
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

export default function NavigationRail({ centerSlug }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPage = pagePath(location.pathname);

  return (
    <Box
      component="nav"
      aria-label="Main navigation"
      sx={{
        width: 80,
        flexShrink: 0,
        bgcolor: getElevatedSurface(1),
        borderRight: `1px solid ${md3Colors.outlineVariant}`,
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        alignItems: 'center',
        py: 2,
        gap: 1,
        minHeight: '100vh',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
      }}
    >
      <Box sx={{ mb: 2, px: 1 }}>
        <BrandMark compact variant="light" />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, width: '100%', px: 1 }}>
        {railItems.map(({ path, label, icon }) => (
          <RailItem
            key={path}
            path={path}
            label={label}
            icon={icon}
            active={currentPage === path}
            onClick={() => navigate(centerPath(centerSlug, path))}
          />
        ))}
      </Box>
    </Box>
  );
}
