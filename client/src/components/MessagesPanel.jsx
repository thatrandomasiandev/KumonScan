import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import PageHeader from './PageHeader';
import { formatTime } from '../api';
import { useSnackbar } from './SnackbarProvider';
import { md3Colors, getElevatedSurface, shape } from '../theme';

const THREAD_POLL_MS = 20_000;

/**
 * Messaging endpoints are called directly here (instead of extending
 * src/api.js) so this workstream's only shared-file edits are the nav entry
 * and route registration.
 */
async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

const messagesApi = {
  getStudents: () => request('/students'),
  getThread: (studentId) => request(`/messages/${studentId}`),
  send: (student_id, body) =>
    request('/messages', { method: 'POST', body: JSON.stringify({ student_id, body }) }),
  getUnmatched: () => request('/messages/unmatched'),
  linkMessage: (id, student_id, save_phone) =>
    request(`/messages/${id}/link`, {
      method: 'POST',
      body: JSON.stringify({ student_id, save_phone }),
    }),
  markViewed: () => request('/messages/mark-viewed', { method: 'POST' }),
};

function SectionCard({ title, subtitle, children, sx }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: `${shape.large}px`,
        bgcolor: getElevatedSurface(1),
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        ...sx,
      }}
    >
      {title && (
        <Typography variant="titleMedium" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
      )}
      {subtitle && (
        <Typography
          variant="bodySmall"
          sx={{ color: md3Colors.onSurfaceVariant, mb: 2, display: 'block' }}
        >
          {subtitle}
        </Typography>
      )}
      {children}
    </Paper>
  );
}

function MessageBubble({ message, timezone }) {
  const outbound = message.direction === 'outbound';
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: outbound ? 'flex-end' : 'flex-start',
      }}
    >
      <Box
        sx={{
          maxWidth: '75%',
          px: 2,
          py: 1.25,
          borderRadius: `${shape.large}px`,
          bgcolor: outbound ? md3Colors.primaryContainer : md3Colors.surfaceVariant,
        }}
      >
        <Typography
          variant="bodyMedium"
          sx={{
            color: outbound ? md3Colors.onPrimaryContainer : md3Colors.onSurface,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.body}
        </Typography>
        <Typography
          variant="bodySmall"
          sx={{ color: md3Colors.onSurfaceVariant, display: 'block', mt: 0.5 }}
        >
          {formatTime(message.created_at, timezone)}
          {message.status === 'failed' && (
            <Box component="span" sx={{ color: md3Colors.error, ml: 1 }}>
              Failed to queue
            </Box>
          )}
        </Typography>
      </Box>
    </Box>
  );
}

function LinkMessageDialog({ message, students, onClose, onLinked }) {
  const { showSnackbar } = useSnackbar();
  const [studentId, setStudentId] = useState('');
  const [savePhone, setSavePhone] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = students.find((s) => s.id === Number(studentId));

  async function handleLink() {
    setSaving(true);
    try {
      await messagesApi.linkMessage(message.id, Number(studentId), savePhone);
      onLinked(Number(studentId));
      onClose();
    } catch (err) {
      showSnackbar(err.message);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      PaperProps={{ sx: { borderRadius: `${shape.extraLarge}px`, width: 400 } }}
    >
      <DialogTitle>Link message to a student</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
          From {message.from_phone}: “{message.body}”
        </Typography>
        {/* Native select: long rosters scroll better and it stays keyboard/touch reliable. */}
        <TextField
          select
          label="Student"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          fullWidth
          size="small"
          SelectProps={{ native: true }}
          InputLabelProps={{ shrink: true }}
        >
          <option value="" disabled>
            Choose a student
          </option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.parent_phone ? '' : ' (no phone on file)'}
            </option>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Checkbox
              checked={savePhone}
              onChange={(e) => setSavePhone(e.target.checked)}
              disabled={Boolean(selected?.parent_phone)}
            />
          }
          label={
            selected?.parent_phone
              ? 'Student already has a phone on file'
              : 'Save this number as the student’s parent phone'
          }
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleLink} disabled={!studentId || saving}>
          {saving ? 'Linking…' : 'Link'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MessagesPanel({ timezone }) {
  const { showSnackbar } = useSnackbar();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [unmatched, setUnmatched] = useState([]);
  const [linkTarget, setLinkTarget] = useState(null);
  const threadEndRef = useRef(null);

  const selectedStudent = students.find((s) => s.id === selectedId);

  const loadUnmatched = useCallback(async () => {
    try {
      const data = await messagesApi.getUnmatched();
      setUnmatched(data.messages);
    } catch (err) {
      showSnackbar(err.message);
    }
  }, [showSnackbar]);

  const loadThread = useCallback(
    async (studentId, { silent = false } = {}) => {
      if (!silent) setThreadLoading(true);
      try {
        const data = await messagesApi.getThread(studentId);
        setThread(data.messages);
      } catch (err) {
        showSnackbar(err.message);
      } finally {
        if (!silent) setThreadLoading(false);
      }
    },
    [showSnackbar]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [studentList] = await Promise.all([
          messagesApi.getStudents(),
          messagesApi.markViewed().catch(() => null),
        ]);
        if (cancelled) return;
        setStudents(studentList.filter((s) => s.active));
        await loadUnmatched();
      } catch (err) {
        if (!cancelled) showSnackbar(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadUnmatched, showSnackbar]);

  useEffect(() => {
    if (!selectedId) return undefined;
    loadThread(selectedId);
    const interval = setInterval(() => {
      loadThread(selectedId, { silent: true });
      loadUnmatched();
    }, THREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [selectedId, loadThread, loadUnmatched]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [thread]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || !selectedId) return;
    setSending(true);
    try {
      await messagesApi.send(selectedId, body);
      setDraft('');
      await loadThread(selectedId, { silent: true });
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setSending(false);
    }
  }

  function handleLinked(studentId) {
    loadUnmatched();
    if (studentId === selectedId) loadThread(studentId, { silent: true });
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  return (
    <Box>
      <PageHeader
        title="Messages"
        subtitle="Two-way texting with parents through the center's gateway phone."
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '280px 1fr' },
          gap: 2,
          alignItems: 'start',
          mb: 2,
        }}
      >
        <SectionCard title="Students" sx={{ p: 2 }}>
          <Box sx={{ maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {students.map((student) => (
              <Box
                key={student.id}
                component="button"
                onClick={() => setSelectedId(student.id)}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 0.25,
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  px: 1.5,
                  py: 1.25,
                  minHeight: 44,
                  borderRadius: `${shape.medium}px`,
                  bgcolor:
                    student.id === selectedId ? md3Colors.primaryContainer : 'transparent',
                  '&:hover': {
                    bgcolor:
                      student.id === selectedId
                        ? md3Colors.primaryContainer
                        : 'rgba(26,27,34,0.08)',
                  },
                }}
              >
                <Typography
                  variant="labelLarge"
                  sx={{
                    color:
                      student.id === selectedId
                        ? md3Colors.onPrimaryContainer
                        : md3Colors.onSurface,
                  }}
                >
                  {student.name}
                </Typography>
                <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                  {student.parent_phone || 'No parent phone'}
                </Typography>
              </Box>
            ))}
            {students.length === 0 && (
              <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant, p: 1.5 }}>
                No active students.
              </Typography>
            )}
          </Box>
        </SectionCard>

        <SectionCard
          title={selectedStudent ? selectedStudent.name : 'Thread'}
          subtitle={
            selectedStudent
              ? selectedStudent.parent_phone || 'No parent phone on file — sending is disabled'
              : 'Select a student to view their conversation'
          }
        >
          {!selectedStudent ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                py: 6,
                color: md3Colors.onSurfaceVariant,
              }}
            >
              <ForumOutlinedIcon sx={{ fontSize: 40 }} />
              <Typography variant="bodyMedium">
                Messages with each family appear here.
              </Typography>
            </Box>
          ) : (
            <>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  maxHeight: 400,
                  overflowY: 'auto',
                  pr: 0.5,
                  mb: 2,
                }}
              >
                {threadLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : thread.length === 0 ? (
                  <Typography
                    variant="bodyMedium"
                    sx={{ color: md3Colors.onSurfaceVariant, py: 4, textAlign: 'center' }}
                  >
                    No messages yet.
                  </Typography>
                ) : (
                  thread.map((message) => (
                    <MessageBubble key={message.id} message={message} timezone={timezone} />
                  ))
                )}
                <Box ref={threadEndRef} />
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                <TextField
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    selectedStudent.parent_phone
                      ? 'Message the parent…'
                      : 'Add a parent phone in Admin to enable sending'
                  }
                  fullWidth
                  size="small"
                  multiline
                  maxRows={4}
                  disabled={!selectedStudent.parent_phone || sending}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <Button
                  variant="contained"
                  onClick={handleSend}
                  disabled={!draft.trim() || !selectedStudent.parent_phone || sending}
                  startIcon={<SendOutlinedIcon />}
                  sx={{ flexShrink: 0, minHeight: 44 }}
                >
                  {sending ? 'Sending…' : 'Send'}
                </Button>
              </Box>
            </>
          )}
        </SectionCard>
      </Box>

      <SectionCard
        title="Unmatched inbound"
        subtitle="Texts from numbers that don't match any student's parent phone. Link them so replies land in the right thread."
      >
        {unmatched.length === 0 ? (
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
            Nothing to triage.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {unmatched.map((message) => (
              <Box
                key={message.id}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 1.5,
                  p: 1.5,
                  borderRadius: `${shape.medium}px`,
                  border: `1px solid ${md3Colors.outlineVariant}`,
                }}
              >
                <Chip label={message.from_phone} size="small" />
                <Typography variant="bodyMedium" sx={{ flex: 1, minWidth: 200 }}>
                  {message.body}
                </Typography>
                <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
                  {formatTime(message.created_at, timezone)}
                </Typography>
                <Button variant="outlined" size="small" onClick={() => setLinkTarget(message)}>
                  Link to student
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </SectionCard>

      {linkTarget && (
        <LinkMessageDialog
          message={linkTarget}
          students={students}
          onClose={() => setLinkTarget(null)}
          onLinked={handleLinked}
        />
      )}
    </Box>
  );
}
