import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  RESOURCE_CATEGORIES,
  buildResourceUsageReport,
  createResource,
  listLowStock,
  listResources,
  resourceUsageReportToCsv,
  restockResource,
  useResource,
} from '../services/resourceService.js';

const router = Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME_LENGTH = 200;

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseNonNegativeInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

router.get('/resources', requireAdmin, async (req, res) => {
  try {
    const resources = await listResources(req.center.id, {
      includeInactive: req.query.include_inactive === '1',
    });
    res.json({
      resources,
      count: resources.length,
      low_stock_count: resources.filter((r) => r.low_stock).length,
    });
  } catch (err) {
    console.error('List resources error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/resources/low-stock', requireAdmin, async (req, res) => {
  try {
    const resources = await listLowStock(req.center.id);
    res.json({ resources, count: resources.length });
  } catch (err) {
    console.error('Low-stock list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resources', requireAdmin, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: `name must be at most ${MAX_NAME_LENGTH} characters` });
  }

  const category = req.body?.category ?? 'other';
  if (!RESOURCE_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: `category must be one of: ${RESOURCE_CATEGORIES.join(', ')}`,
    });
  }

  const quantity_on_hand =
    req.body?.quantity_on_hand === undefined ? 0 : parseNonNegativeInt(req.body.quantity_on_hand);
  if (quantity_on_hand == null) {
    return res.status(400).json({ error: 'quantity_on_hand must be a non-negative integer' });
  }

  const low_stock_threshold =
    req.body?.low_stock_threshold === undefined
      ? 5
      : parseNonNegativeInt(req.body.low_stock_threshold);
  if (low_stock_threshold == null) {
    return res.status(400).json({ error: 'low_stock_threshold must be a non-negative integer' });
  }

  try {
    const resource = await createResource(req.center.id, {
      name,
      category,
      quantity_on_hand,
      low_stock_threshold,
    });
    res.status(201).json(resource);
  } catch (err) {
    console.error('Create resource error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/resources/:id/restock', requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid resource id' });
  }

  const quantity = parsePositiveInt(req.body?.quantity);
  if (!quantity) {
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  }

  try {
    const resource = await restockResource(req.center.id, id, quantity);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found or inactive' });
    }
    res.json(resource);
  } catch (err) {
    console.error('Restock error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resources/:id/use', requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid resource id' });
  }

  const quantity = req.body?.quantity === undefined ? 1 : parsePositiveInt(req.body.quantity);
  if (!quantity) {
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  }

  let studentId = null;
  if (req.body?.student_id != null) {
    studentId = parsePositiveInt(req.body.student_id);
    if (!studentId) {
      return res.status(400).json({ error: 'student_id must be a positive integer' });
    }
  }

  let sessionId = null;
  if (req.body?.session_id != null) {
    sessionId = parsePositiveInt(req.body.session_id);
    if (!sessionId) {
      return res.status(400).json({ error: 'session_id must be a positive integer' });
    }
  }

  try {
    const result = await useResource(req.center.id, id, { studentId, sessionId, quantity });
    res.status(201).json(result);
  } catch (err) {
    if (err?.code === 'RESOURCE_NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err?.code === 'INSUFFICIENT_STOCK') {
      return res.status(409).json({ error: err.message, available: err.available });
    }
    if (err?.code === 'STUDENT_NOT_FOUND' || err?.code === 'SESSION_NOT_FOUND') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Use resource error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Usage totals by resource and by student: ?start=YYYY-MM-DD&end=YYYY-MM-DD&format=json|csv */
router.get('/reports/resource-usage', requireAdmin, async (req, res) => {
  const start = req.query.start || null;
  const end = req.query.end || null;

  if (start && !DATE_PATTERN.test(start)) {
    return res.status(400).json({ error: 'start must be YYYY-MM-DD' });
  }
  if (end && !DATE_PATTERN.test(end)) {
    return res.status(400).json({ error: 'end must be YYYY-MM-DD' });
  }

  try {
    const report = await buildResourceUsageReport(req.center.id, { start, end });

    if (req.query.format === 'csv') {
      const filename = `kumonscan-resource-usage-${start || 'all'}-${end || 'all'}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(resourceUsageReportToCsv(report));
    }

    res.json(report);
  } catch (err) {
    console.error('Resource usage report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
