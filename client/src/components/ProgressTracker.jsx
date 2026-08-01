import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import { curriculumApi } from '../curriculumApi';
import { formatDate } from '../api';
import { useSnackbar } from './SnackbarProvider';
import { md3Colors, shape } from '../theme';

const SUBJECTS = [
  { value: 'math', label: 'Math' },
  { value: 'reading', label: 'Reading' },
];

const PAGES_PER_LEVEL = 200;

function subjectDefault(enrolled) {
  return enrolled === 'reading' ? 'reading' : 'math';
}

function CurrentLevelLine({ subject, entry }) {
  const label = SUBJECTS.find((s) => s.value === subject)?.label || subject;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="labelLarge" sx={{ width: 72, color: md3Colors.onSurfaceVariant }}>
        {label}
      </Typography>
      {entry ? (
        <Typography variant="bodyMedium" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          Level <strong>{entry.level_code}</strong> · page {entry.current_page ?? '—'} of{' '}
          {entry.pages_per_level || PAGES_PER_LEVEL}
        </Typography>
      ) : (
        <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
          No level set yet
        </Typography>
      )}
    </Box>
  );
}

/**
 * Worksheet progress for one student: current Kumon level/page per subject,
 * recent completion history, and a form to log a completion. Changing the
 * level is always an explicit choice in the level picker — never inferred
 * from page numbers.
 */
export default function ProgressTracker({ student }) {
  const { showSnackbar } = useSnackbar();
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState(null);
  const [levels, setLevels] = useState(null);
  const [loading, setLoading] = useState(false);

  const [subject, setSubject] = useState(() => subjectDefault(student.enrolled_subjects));
  const [levelCode, setLevelCode] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const [accuracy, setAccuracy] = useState('');
  const [saving, setSaving] = useState(false);

  const currentBySubject = useMemo(() => {
    const map = {};
    for (const entry of data?.progress || []) map[entry.subject] = entry;
    return map;
  }, [data]);

  const subjectLevels = useMemo(
    () => (levels || []).filter((l) => l.subject === subject),
    [levels, subject]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [progressData, levelsData] = await Promise.all([
        curriculumApi.getStudentProgress(student.id),
        levels ? Promise.resolve({ levels }) : curriculumApi.getLevels(),
      ]);
      setData(progressData);
      setLevels(levelsData.levels);
    } catch (err) {
      showSnackbar(err.message);
      setData({ progress: [], history: [] });
    } finally {
      setLoading(false);
    }
  }, [student.id, levels, showSnackbar]);

  // Reset when the selected student changes.
  useEffect(() => {
    setExpanded(false);
    setData(null);
    setSubject(subjectDefault(student.enrolled_subjects));
    setLevelCode('');
    setPageNumber('');
    setAccuracy('');
  }, [student.id, student.enrolled_subjects]);

  // Prefill the form from the current position for the chosen subject.
  useEffect(() => {
    const current = currentBySubject[subject];
    setLevelCode(current?.level_code || '');
    if (current?.current_page && current.current_page < PAGES_PER_LEVEL) {
      setPageNumber(String(current.current_page + 1));
    } else {
      setPageNumber('');
    }
  }, [subject, currentBySubject]);

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && data === null) load();
  }

  async function handleLog(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await curriculumApi.logCompletion(student.id, {
        subject,
        page_number: Number(pageNumber),
        accuracy_pct: accuracy === '' ? null : Number(accuracy),
        level_code: levelCode || null,
      });
      setData(result);
      setAccuracy('');
      showSnackbar(
        `Logged ${result.completion.level_code} page ${result.completion.page_number} · ${
          SUBJECTS.find((s) => s.value === subject)?.label
        }`
      );
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Box
        component="button"
        type="button"
        onClick={handleToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          width: '100%',
          border: 'none',
          background: 'none',
          p: 0,
          cursor: 'pointer',
          mb: expanded ? 1.5 : 0,
        }}
        aria-expanded={expanded}
      >
        <MenuBookOutlinedIcon sx={{ fontSize: 18, color: md3Colors.onSurfaceVariant }} />
        <Typography variant="titleSmall" sx={{ flex: 1, textAlign: 'left', color: md3Colors.onSurface }}>
          Worksheet progress
        </Typography>
        {data !== null && (
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
            {data.history.length} logged
          </Typography>
        )}
        <Typography variant="bodySmall" sx={{ color: md3Colors.primary, ml: 0.5 }}>
          {expanded ? 'Hide' : 'Show'}
        </Typography>
      </Box>

      {expanded && (
        <Box>
          {loading && (
            <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, py: 2 }}>
              Loading…
            </Typography>
          )}

          {!loading && data !== null && (
            <>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.75,
                  p: 1.5,
                  mb: 2,
                  borderRadius: `${shape.medium}px`,
                  bgcolor: md3Colors.surfaceVariant,
                }}
              >
                <CurrentLevelLine subject="math" entry={currentBySubject.math} />
                <CurrentLevelLine subject="reading" entry={currentBySubject.reading} />
              </Box>

              <Box component="form" onSubmit={handleLog} sx={{ mb: 2 }}>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={subject}
                  onChange={(_e, next) => {
                    if (next) setSubject(next);
                  }}
                  aria-label="Subject of the completed worksheet"
                  sx={{ mb: 1.5 }}
                >
                  {SUBJECTS.map((opt) => (
                    <ToggleButton key={opt.value} value={opt.value} sx={{ textTransform: 'none', px: 2 }}>
                      {opt.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>

                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  <TextField
                    select
                    size="small"
                    label="Level"
                    value={levelCode}
                    onChange={(e) => setLevelCode(e.target.value)}
                    required
                    sx={{ width: 110 }}
                    helperText={
                      currentBySubject[subject] &&
                      levelCode &&
                      levelCode !== currentBySubject[subject].level_code
                        ? 'Level change'
                        : ' '
                    }
                  >
                    {subjectLevels.map((level) => (
                      <MenuItem key={level.id} value={level.level_code}>
                        {level.level_code}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    label="Page"
                    value={pageNumber}
                    onChange={(e) => setPageNumber(e.target.value)}
                    required
                    inputProps={{ inputMode: 'numeric', min: 1, max: PAGES_PER_LEVEL, type: 'number' }}
                    sx={{ width: 100 }}
                    helperText={`1–${PAGES_PER_LEVEL}`}
                  />
                  <TextField
                    size="small"
                    label="Accuracy %"
                    value={accuracy}
                    onChange={(e) => setAccuracy(e.target.value)}
                    inputProps={{ inputMode: 'numeric', min: 0, max: 100, type: 'number' }}
                    sx={{ width: 110 }}
                    helperText="Optional"
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={saving || !levelCode || pageNumber === ''}
                    sx={{ alignSelf: 'flex-start', minHeight: 40 }}
                  >
                    {saving ? 'Logging…' : 'Log page'}
                  </Button>
                </Box>
              </Box>

              {data.history.length === 0 ? (
                <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant, py: 1 }}>
                  No worksheets logged yet.
                </Typography>
              ) : (
                <Box
                  sx={{
                    border: `1px solid ${md3Colors.outlineVariant}`,
                    borderRadius: `${shape.medium}px`,
                    overflow: 'hidden',
                  }}
                >
                  {data.history.map((entry, i) => (
                    <Box
                      key={entry.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 2,
                        py: 1,
                        borderBottom:
                          i < data.history.length - 1 ? `1px solid ${md3Colors.outlineVariant}` : 'none',
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="bodySmall">
                          {SUBJECTS.find((s) => s.value === entry.subject)?.label || entry.subject}{' '}
                          {entry.level_code} · page {entry.page_number}
                        </Typography>
                        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                          {formatDate(entry.completed_at)}
                        </Typography>
                      </Box>
                      {entry.accuracy_pct != null && (
                        <Chip
                          size="small"
                          label={`${entry.accuracy_pct}%`}
                          sx={{
                            bgcolor: md3Colors.surfaceVariant,
                            color: md3Colors.onSurfaceVariant,
                            fontWeight: 500,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        />
                      )}
                    </Box>
                  ))}
                </Box>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
