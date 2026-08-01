import { useTranslation } from 'react-i18next';
import { MenuItem, Select } from '@mui/material';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import { getLanguageOptions, setLanguage } from './index';
import { md3Colors, shape } from '../theme';

/**
 * Compact language switcher for parent-facing pages. Options come from the
 * locale files on disk (native names from each file's _meta.nativeName), so
 * a new language appears here automatically.
 */
export default function LanguageSelector({ sx = {} }) {
  const { t, i18n } = useTranslation();
  const options = getLanguageOptions();

  return (
    <Select
      value={i18n.resolvedLanguage || i18n.language}
      onChange={(e) => setLanguage(e.target.value)}
      size="small"
      variant="outlined"
      inputProps={{ 'aria-label': t('language.selectorLabel') }}
      renderValue={(code) =>
        options.find((opt) => opt.code === code)?.nativeName || code.toUpperCase()
      }
      startAdornment={
        <LanguageOutlinedIcon
          sx={{ fontSize: 18, color: md3Colors.onSurfaceVariant, mr: 0.75 }}
        />
      }
      sx={{
        minHeight: 44,
        borderRadius: `${shape.medium}px`,
        typography: 'labelLarge',
        color: md3Colors.onSurface,
        '& .MuiOutlinedInput-notchedOutline': { borderColor: md3Colors.outlineVariant },
        ...sx,
      }}
    >
      {options.map((opt) => (
        <MenuItem key={opt.code} value={opt.code} sx={{ minHeight: 44 }}>
          {opt.nativeName}
        </MenuItem>
      ))}
    </Select>
  );
}
