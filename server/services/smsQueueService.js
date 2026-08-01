import db, { sqlNow } from '../db.js';
import { getCenterTimezone } from '../timeService.js';
import { formatFullName } from '../utils/names.js';
import { isWhatsAppConfigured, sendAttendanceWhatsApp } from './whatsappService.js';

function formatLocalTime(iso) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: getCenterTimezone(),
  }).format(new Date(iso));
}

function buildMessage(action, student, iso) {
  const name = formatFullName(student);
  const time = formatLocalTime(iso);
  if (action === 'checked_out') {
    return `${name} has finished at Kumon and is ready for pickup (${time}).`;
  }
  return `${name} checked in at Kumon at ${time}.`;
}

/**
 * Dispatch one check-in/check-out notification. Never throws: a queue or
 * send failure must not block or fail a check-in/check-out, matching how the
 * old Vonage notifyParent was allowed to fail silently.
 *
 * Channel routing (agent-8-whatsapp): students with notify_channel =
 * 'whatsapp' go straight to the Meta Cloud API when a parent_whatsapp number
 * exists and WhatsApp is configured; otherwise they fall back to the SMS
 * queue with a logged warning rather than silently sending nothing. A
 * WhatsApp API failure does NOT fall back to SMS — an ambiguous failure
 * (e.g. timeout) could otherwise double-notify; the failed row stays visible
 * in the message thread instead.
 */
export async function enqueueNotification(session, student, action, iso) {
  try {
    if ((student?.notify_channel || 'sms') === 'whatsapp') {
      const waPhone =
        typeof student?.parent_whatsapp === 'string' ? student.parent_whatsapp.trim() : '';
      if (waPhone && isWhatsAppConfigured()) {
        return await sendAttendanceWhatsApp(session, student, action, iso);
      }
      console.warn(
        `WhatsApp preferred for student ${student?.id} but ` +
          (waPhone ? 'WhatsApp is not configured' : 'no parent_whatsapp is set') +
          `; falling back to SMS for ${action}`
      );
    }

    const phone = typeof student?.parent_phone === 'string' ? student.parent_phone.trim() : '';
    if (!phone) {
      console.log(`SMS queue: no parent_phone for student ${student?.id}, skipping ${action}`);
      return { enqueued: false, reason: 'no_parent_phone' };
    }

    // The student row carries its own tenancy; the queue row inherits it so
    // the gateway poll for another center can never claim this message.
    await db
      .prepare(
        `INSERT INTO sms_queue (center_id, session_id, student_id, parent_phone, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        student.center_id,
        session?.id ?? null,
        student.id,
        phone,
        buildMessage(action, student, iso),
        sqlNow()
      );

    return { enqueued: true };
  } catch (err) {
    console.error('SMS queue enqueue failed:', err?.message || err);
    return { enqueued: false, reason: 'error' };
  }
}
