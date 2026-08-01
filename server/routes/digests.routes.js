import crypto from 'crypto';
import { Router } from 'express';
import db from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { listDigestLog, runDigestBatch, weeklyPeriod } from '../services/digestService.js';

const router = Router();

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(len);
  const paddedB = Buffer.alloc(len);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

/**
 * Machine auth for Vercel Cron: `Authorization: Bearer ${CRON_SECRET}`.
 * Not staff-cookie auth; refuses to run at all when CRON_SECRET is unset so
 * the endpoint is never open by accident.
 */
function requireCronSecret(req, res, next) {
  if (!process.env.CRON_SECRET) {
    return res.status(503).json({ error: 'CRON_SECRET is not configured' });
  }

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!timingSafeEqualString(token, process.env.CRON_SECRET)) {
    return res.status(401).json({ error: 'Invalid cron credentials' });
  }

  next();
}

function parsePeriodOverride(body) {
  const { period_start, period_end } = body || {};
  if (period_start == null && period_end == null) {
    return { periodStart: undefined, periodEnd: undefined };
  }
  if (!YMD_PATTERN.test(String(period_start ?? '')) || !YMD_PATTERN.test(String(period_end ?? ''))) {
    throw new Error('period_start and period_end must both be YYYY-MM-DD');
  }
  if (period_start > period_end) {
    throw new Error('period_start must not be after period_end');
  }
  return { periodStart: period_start, periodEnd: period_end };
}

/** Recent send history, newest first. Query: ?student_id=&limit= */
router.get('/admin/digests', requireAdmin, async (req, res) => {
  try {
    let studentId = null;
    if (req.query.student_id != null && req.query.student_id !== '') {
      studentId = Number(req.query.student_id);
      if (!Number.isInteger(studentId) || studentId < 1) {
        return res.status(400).json({ error: 'student_id must be a positive integer' });
      }
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const digests = await listDigestLog({ studentId, limit });

    res.json({ digests, count: digests.length, current_period: weeklyPeriod() });
  } catch (err) {
    console.error('Digest history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Manual trigger for one student (body.student_id) or all active students.
 * Optional body.period_start / body.period_end override the default weekly
 * period for ad-hoc use; re-running any period is safe (unique index).
 */
router.post('/admin/digests/send-now', requireAdmin, async (req, res) => {
  try {
    let periodOverride;
    try {
      periodOverride = parsePeriodOverride(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let studentIds = null;
    if (req.body?.student_id != null) {
      const studentId = Number(req.body.student_id);
      if (!Number.isInteger(studentId) || studentId < 1) {
        return res.status(400).json({ error: 'student_id must be a positive integer' });
      }
      const student = await db
        .prepare('SELECT id FROM students WHERE id = ? AND active = 1')
        .get(studentId);
      if (!student) {
        return res.status(404).json({ error: 'Student not found or inactive' });
      }
      studentIds = [studentId];
    }

    const summary = await runDigestBatch({
      periodStart: periodOverride.periodStart,
      periodEnd: periodOverride.periodEnd,
      studentIds,
    });

    res.json({ ok: true, trigger: 'manual', ...summary });
  } catch (err) {
    console.error('Digest send-now error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function handleCronRun(req, res) {
  try {
    const summary = await runDigestBatch();
    res.json({ ok: true, trigger: 'cron', ...summary });
  } catch (err) {
    console.error('Digest cron error:', err);
    res.status(500).json({ error: 'Digest cron run failed' });
  }
}

// Vercel Cron invokes its path with GET; POST is kept for other machine triggers.
router.get('/cron/digests', requireCronSecret, handleCronRun);
router.post('/cron/digests', requireCronSecret, handleCronRun);

export default router;
