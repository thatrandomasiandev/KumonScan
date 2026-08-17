import { Router } from 'express';
import db from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  CurriculumError,
  getProgressPace,
  getStudentProgress,
  listLevels,
  logCompletion,
} from '../services/curriculumService.js';

/**
 * Curriculum / worksheet progress routes. All staff-authenticated and fully
 * optional relative to the core check-in/check-out flow.
 */
const router = Router();

function handleError(res, err, context) {
  if (err instanceof CurriculumError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`${context} error:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

async function findStudentOr404(req, res) {
  const studentId = Number(req.params.id);
  if (!Number.isInteger(studentId) || studentId < 1) {
    res.status(400).json({ error: 'Invalid student id' });
    return null;
  }
  const student = await db
    .prepare('SELECT * FROM students WHERE id = ? AND center_id = ?')
    .get(studentId, req.center.id);
  if (!student) {
    res.status(404).json({ error: 'Student not found' });
    return null;
  }
  return student;
}

/** Level catalog, for pickers: ?subject=math|reading (optional). */
router.get('/curriculum/levels', requireAdmin, async (req, res) => {
  try {
    const levels = await listLevels(req.query.subject ?? null);
    res.json({ levels });
  } catch (err) {
    handleError(res, err, 'Curriculum levels');
  }
});

/** Current level/page per subject plus recent completion history. */
router.get('/students/:id/progress', requireAdmin, async (req, res) => {
  try {
    const student = await findStudentOr404(req, res);
    if (!student) return;
    const data = await getStudentProgress(student.id);
    res.json({ student_id: student.id, ...data });
  } catch (err) {
    handleError(res, err, 'Get progress');
  }
});

/**
 * Log a completed worksheet:
 * { subject, page_number, accuracy_pct?, session_id?, level_code? }
 * `level_code` is the explicit level advancement (or starting-level) action;
 * it is never inferred from page numbers.
 */
router.post('/students/:id/progress', requireAdmin, async (req, res) => {
  try {
    const student = await findStudentOr404(req, res);
    if (!student) return;
    const completion = await logCompletion(student.id, req.body || {});
    const data = await getStudentProgress(student.id);
    res.status(201).json({ student_id: student.id, completion, ...data });
  } catch (err) {
    handleError(res, err, 'Log completion');
  }
});

/** Pages/week per active student over a trailing window: ?weeks=4. */
router.get('/reports/progress-pace', requireAdmin, async (req, res) => {
  try {
    const report = await getProgressPace({
      centerId: req.center.id,
      weeks: req.query.weeks != null ? Number(req.query.weeks) : 4,
    });
    res.json(report);
  } catch (err) {
    handleError(res, err, 'Progress pace report');
  }
});

export default router;
