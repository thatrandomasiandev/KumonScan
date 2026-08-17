import { Router } from 'express';
import authRoutes from './auth.routes.js';
import kioskRoutes from './kiosk.routes.js';
import deskRoutes from './desk.routes.js';
import studentsRoutes from './students.routes.js';
import staffRoutes from './staff.routes.js';
import reportsRoutes from './reports.routes.js';
import adminRoutes from './admin.routes.js';
import gatewayRoutes from './gateway.routes.js';
import messagingRoutes from './messaging.routes.js';
import remoteAttendanceRoutes from './remoteAttendance.routes.js';
import insightsRoutes from './insights.routes.js';
import exportRoutes from './export.routes.js';
import webhooksRoutes from './webhooks.routes.js';
import whatsappWebhookRoutes from './whatsappWebhook.routes.js';
import twilioWebhookRoutes from './twilioWebhook.routes.js';
import resourcesRoutes from './resources.routes.js';
import caregiversRoutes from './caregivers.routes.js';
import bookingRoutes from './booking.routes.js';
import statusRoutes from './status.routes.js';
import parentAuthRoutes from './parentAuth.routes.js';

const router = Router();

router.use(authRoutes);
router.use(kioskRoutes);
router.use(remoteAttendanceRoutes); // agent-4-hybrid-attendance: intercepts /check-in mode='remote', must precede deskRoutes
router.use(deskRoutes);
router.use(studentsRoutes);
router.use(staffRoutes);
router.use(reportsRoutes);
router.use(adminRoutes);
router.use(messagingRoutes); // agent-1-messaging: /messages + /gateway/inbound
router.use(insightsRoutes); // agent-7-insights: /insights/summary + /insights/at-risk
router.use(whatsappWebhookRoutes); // agent-8-whatsapp: /webhooks/whatsapp (Meta inbound + delivery status)
router.use(twilioWebhookRoutes); // Twilio inbound SMS: /webhooks/sms
router.use(resourcesRoutes); // agent-5-resources
router.use(caregiversRoutes); // agent-2-pickup-auth
router.use(bookingRoutes); // agent-3-self-scheduling
router.use(statusRoutes); // agent-observability: GET /status
router.use(parentAuthRoutes); // agent-13-parent-pwa: /parent-auth/* + /parent/*
router.use('/gateway', gatewayRoutes);
router.use(exportRoutes); // agent-10-data-portability: /export/full
// agent-10-data-portability: outbound subscription management. Mounted after
// the inbound receivers (/webhooks/zoom, /webhooks/whatsapp) so those keep
// matching first; this router only handles the exact /webhooks collection.
router.use(webhooksRoutes);

export default router;
