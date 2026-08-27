import { Router } from 'express';
import authRoutes from './auth.routes.js';
import kioskRoutes from './kiosk.routes.js';
import deskRoutes from './desk.routes.js';
import studentsRoutes from './students.routes.js';
import staffRoutes from './staff.routes.js';
import reportsRoutes from './reports.routes.js';
import adminRoutes from './admin.routes.js';
import remoteAttendanceRoutes from './remoteAttendance.routes.js';
import insightsRoutes from './insights.routes.js';
import exportRoutes from './export.routes.js';
import webhooksRoutes from './webhooks.routes.js';
import resourcesRoutes from './resources.routes.js';
import caregiversRoutes from './caregivers.routes.js';
import bookingRoutes from './booking.routes.js';
import statusRoutes from './status.routes.js';
import curriculumRoutes from './curriculum.routes.js';
import demoRoutes from './demo.routes.js';
import privacyRoutes from './privacy.routes.js';
import { auditTrailMiddleware } from '../services/auditLogService.js';

const router = Router();

router.use(auditTrailMiddleware); // agent-privacy: wrap writes before feature routers
router.use(authRoutes);
router.use(kioskRoutes);
router.use(remoteAttendanceRoutes); // agent-4-hybrid-attendance: intercepts /check-in mode='remote', must precede deskRoutes
router.use(deskRoutes);
router.use(studentsRoutes);
router.use(staffRoutes);
router.use(reportsRoutes);
router.use(adminRoutes);
router.use(insightsRoutes); // agent-7-insights: /insights/summary + /insights/at-risk
router.use(resourcesRoutes); // agent-5-resources
router.use(caregiversRoutes); // agent-2-pickup-auth
router.use(bookingRoutes); // staff admin bookings only (public parent booking removed)
router.use(statusRoutes); // agent-observability: GET /status
router.use(curriculumRoutes); // agent-curriculum: /curriculum/levels + /students/:id/progress + /reports/progress-pace
router.use(demoRoutes); // agent-demo: /demo/reset (404 unless DEMO_MODE=true)
router.use(privacyRoutes); // agent-privacy: /admin/audit-log, /admin/privacy/*, /admin/students/:id/{purge,consent}
router.use(exportRoutes); // agent-10-data-portability: /export/full
// agent-10-data-portability: outbound subscription management.
router.use(webhooksRoutes);

export default router;
