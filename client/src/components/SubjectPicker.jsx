import { Box, ToggleButton, Typography } from '@mui/material';
import { md3Colors, shape } from '../theme';
import {
  ATOMIC_SUBJECTS,
  TWO_SUBJECTS_VALUE,
  allowanceForSubjects,
  encodeSubjects,
  isTwoSubjects,
  labelForSubjects,
  parseSubjectList,
  toggleSubjectSelection,
} from '../subjects';

const cubeSx = {
  flex: 1,
  minWidth: 0,
  px: 0.35,
  py: 0.65,
  textTransform: 'none',
  border: `1px solid ${md3Colors.outlineVariant} !important`,
  borderRadius: `${shape.medium}px !important`,
  color: md3Colors.onSurfaceVariant,
  '&.Mui-selected': {
    bgcolor: md3Colors.primaryContainer,
    color: md3Colors.onPrimaryContainer,
    borderColor: `${md3Colors.primary} !important`,
    '&:hover': { bgcolor: md3Colors.primaryContainer },
  },
};

/**
 * Math / Reading / EFL cubes plus a Two subjects shortcut (60 min / math+reading).
 * Same control on Desk check-in and Admin enrollment.
 */
export default function SubjectPicker({
  value,
  onChange,
  disabled = false,
  ariaLabel = 'Subjects (pick one, or Two subjects)',
  showHint = true,
}) {
  const selected = parseSubjectList(value);
  const allowance = allowanceForSubjects(selected);
  const twoOn = isTwoSubjects(value);

  function selectAtomic(subjectValue) {
    onChange(encodeSubjects(toggleSubjectSelection(selected, subjectValue)) || '');
  }

  function selectTwoSubjects() {
    if (twoOn) {
      // Drop back to a single subject (first of the pair) so check-in stays valid.
      onChange(selected[0] || '');
      return;
    }
    onChange(TWO_SUBJECTS_VALUE);
  }

  return (
    <Box>
      <Box
        role="group"
        aria-label={ariaLabel}
        sx={{
          display: 'flex',
          gap: 0.5,
          width: '100%',
        }}
      >
        {ATOMIC_SUBJECTS.map((opt) => {
          const isOn = selected.includes(opt.value);
          return (
            <ToggleButton
              key={opt.value}
              value={opt.value}
              selected={isOn}
              disabled={disabled}
              aria-pressed={isOn}
              aria-label={opt.label}
              onClick={() => selectAtomic(opt.value)}
              sx={cubeSx}
            >
              <Typography
                variant="labelLarge"
                component="span"
                sx={{ fontSize: '0.75rem', lineHeight: 1.15 }}
              >
                {opt.label}
              </Typography>
            </ToggleButton>
          );
        })}
        <ToggleButton
          value="two"
          selected={twoOn}
          disabled={disabled}
          aria-pressed={twoOn}
          aria-label="Two subjects, 60 minutes"
          onClick={selectTwoSubjects}
          sx={cubeSx}
        >
          <Typography
            variant="labelLarge"
            component="span"
            sx={{
              fontSize: '0.7rem',
              lineHeight: 1.1,
              display: 'block',
              whiteSpace: 'normal',
            }}
          >
            Two subjects
          </Typography>
        </ToggleButton>
      </Box>
      {showHint && (
        <Typography
          variant="bodySmall"
          sx={{ mt: 0.75, color: md3Colors.onSurfaceVariant, display: 'block' }}
        >
          {selected.length === 0
            ? 'Pick a subject or Two subjects'
            : `${twoOn ? 'Two subjects' : labelForSubjects(selected)} · ${allowance} min`}
        </Typography>
      )}
    </Box>
  );
}
