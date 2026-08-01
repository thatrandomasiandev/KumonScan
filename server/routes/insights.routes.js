// agent-7-insights: read-only owner analytics. Admin-authenticated, low-frequency
// reads; intentionally uncached.
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  buildInsightsSummary,
  getAtRiskStudents,
  DEFAULT_AT_RISK_THRESHOLD,
  DEFAULT_SUMMARY_WINDOW_DAYS,
  AT_RISK_WINDOW_DAYS,
} from '../services/insightsService.js';

const router = Router();

const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 365;
const MAX_PAGE_SIZE = 100;

/** Threshold arrives as a fraction (0.5 = 50% drop). Returns null when invalid. */
function parseThreshold(raw) {
  if (raw == null || raw === '') return DEFAULT_AT_RISK_THRESHOLD;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return null;
  return value;
}

function parseWindowDays(raw) {
  if (raw == null || raw === '') return DEFAULT_SUMMARY_WINDOW_DAYS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_WINDOW_DAYS || value > MAX_WINDOW_DAYS) {
    return null;
  }
  return value;
}

/**
 * All owner metrics in one payload for the dashboard's initial load.
 * Query: ?window_days=90&at_risk_threshold=0.5
 */
router.get('/insights/summary', requireAdmin, async (req, res) => {
  const windowDays = parseWindowDays(req.query.window_days);
  if (windowDays == null) {
    return res.status(400).json({
      error: `window_days must be an integer between ${MIN_WINDOW_DAYS} and ${MAX_WINDOW_DAYS}`,
    });
  }
  const threshold = parseThreshold(req.query.at_risk_threshold);
  if (threshold == null) {
    return res
      .status(400)
      .json({ error: 'at_risk_threshold must be a fraction between 0 and 1 (exclusive)' });
  }

  try {
    res.json(
      await buildInsightsSummary({
        centerId: req.center.id,
        windowDays,
        atRiskThreshold: threshold,
      })
    );
  } catch (err) {
    console.error('Insights summary error:', err);
    res.status(500).json({ error: 'Failed to build insights summary' });
  }
});

/**
 * Full at-risk student list, paginated because it can get long.
 * Query: ?page=1&page_size=25&threshold=0.5
 */
router.get('/insights/at-risk', requireAdmin, async (req, res) => {
  const threshold = parseThreshold(req.query.threshold);
  if (threshold == null) {
    return res
      .status(400)
      .json({ error: 'threshold must be a fraction between 0 and 1 (exclusive)' });
  }

  const page = req.query.page == null ? 1 : Number(req.query.page);
  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: 'page must be a positive integer' });
  }
  const pageSize = req.query.page_size == null ? 25 : Number(req.query.page_size);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return res
      .status(400)
      .json({ error: `page_size must be an integer between 1 and ${MAX_PAGE_SIZE}` });
  }

  try {
    const students = await getAtRiskStudents({ centerId: req.center.id, threshold });
    const start = (page - 1) * pageSize;
    res.json({
      threshold_pct: Math.round(threshold * 100),
      window_days: AT_RISK_WINDOW_DAYS,
      total: students.length,
      page,
      page_size: pageSize,
      students: students.slice(start, start + pageSize),
    });
  } catch (err) {
    console.error('Insights at-risk error:', err);
    res.status(500).json({ error: 'Failed to compute at-risk students' });
  }
});

export default router;
