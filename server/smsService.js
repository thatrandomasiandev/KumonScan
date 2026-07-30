import dotenv from 'dotenv';
import { Vonage } from '@vonage/server-sdk';

dotenv.config();

const apiKey = process.env.VONAGE_API_KEY?.trim() || '';
const apiSecret = process.env.VONAGE_API_SECRET?.trim() || '';
const fromNumber = process.env.VONAGE_FROM?.trim() || '';

const configured = Boolean(apiKey && apiSecret && fromNumber);

let vonage = null;
if (configured) {
  vonage = new Vonage({ apiKey, apiSecret });
}

/**
 * Normalize a US-centric phone string to E.164 (+1...).
 * Returns null when the value cannot be used as an SMS destination.
 */
export function toE164(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.trim().startsWith('+') && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

export function isSmsConfigured() {
  return configured;
}

/**
 * Send pickup-ready SMS after check-out. Never throws; logs failures.
 * @returns {{ sent: boolean, reason?: string, messageId?: string }}
 */
export async function sendPickupSms({ firstName, parentPhone }) {
  if (!configured || !vonage) {
    return { sent: false, reason: 'not_configured' };
  }

  const to = toE164(parentPhone);
  if (!to) {
    return { sent: false, reason: 'invalid_phone' };
  }

  const name = (firstName || 'Your student').trim() || 'Your student';
  const text = `${name} has finished at Kumon and is ready for pickup.`;

  try {
    const resp = await vonage.sms.send({
      to: to.replace(/^\+/, ''),
      from: fromNumber.replace(/^\+/, ''),
      text,
    });

    const messages = resp?.messages || [];
    const first = messages[0];
    const status = first?.status;
    if (status && status !== '0') {
      console.error('Pickup SMS rejected by Vonage:', first?.['error-text'] || first);
      return { sent: false, reason: 'vonage_rejected', messageId: first?.['message-id'] };
    }

    return { sent: true, messageId: first?.['message-id'] };
  } catch (err) {
    console.error('Pickup SMS error:', err?.message || err);
    return { sent: false, reason: 'send_failed' };
  }
}

/** Fire-and-forget wrapper for check-out handlers. */
export function queuePickupSms(student) {
  if (!student?.parent_phone) return;
  sendPickupSms({
    firstName: student.first_name,
    parentPhone: student.parent_phone,
  }).catch((err) => {
    console.error('Pickup SMS unexpected error:', err);
  });
}
