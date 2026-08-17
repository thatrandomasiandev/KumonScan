import { Chip } from '@mui/material';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import { md3Colors } from '../theme';

/**
 * Connection + pending-sync indicator for the desk.
 * Reuses existing tones only: the amber secondaryContainer (the theme's
 * warning container) for offline, neutral surfaceVariant otherwise.
 */
export default function OfflineStatusChip({ online, pendingCount, syncing }) {
  let icon;
  let label;
  let colors;

  if (!online) {
    icon = <CloudOffOutlinedIcon />;
    label = pendingCount > 0 ? `Offline · ${pendingCount} pending` : 'Offline';
    colors = { bgcolor: md3Colors.secondaryContainer, color: md3Colors.onSecondaryContainer };
  } else if (pendingCount > 0) {
    icon = <SyncOutlinedIcon />;
    label = syncing
      ? `Syncing ${pendingCount}…`
      : `${pendingCount} pending sync`;
    colors = { bgcolor: md3Colors.secondaryContainer, color: md3Colors.onSecondaryContainer };
  } else {
    icon = <CloudDoneOutlinedIcon />;
    label = 'Online';
    colors = { bgcolor: md3Colors.surfaceVariant, color: md3Colors.onSurfaceVariant };
  }

  return (
    <Chip
      size="small"
      icon={icon}
      label={label}
      role="status"
      aria-live="polite"
      sx={{
        ...colors,
        fontWeight: 500,
        '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
      }}
    />
  );
}
