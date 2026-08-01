import db, { isUniqueViolation, sqlNow } from '../db.js';
import { hashPassword } from '../utils/passwords.js';

/**
 * Center (tenant) records. Every center-scoped request resolves one of these
 * rows before any data access; per-center admin credentials live on the row
 * as a scrypt hash (see utils/passwords.js), not in environment variables.
 */

/** URL-safe tenant slugs: lowercase alphanumerics and inner hyphens, 1–63 chars. */
export const CENTER_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const MIN_ADMIN_PASSWORD_LENGTH = 8;

export function serializeCenter(center) {
  return {
    id: center.id,
    slug: center.slug,
    name: center.name,
    timezone: center.timezone,
    active: Boolean(center.active),
    created_at: center.created_at,
  };
}

export async function getCenterBySlug(slug) {
  if (typeof slug !== 'string' || !CENTER_SLUG_PATTERN.test(slug)) return undefined;
  return db.prepare('SELECT * FROM centers WHERE slug = ? AND active = 1').get(slug);
}

/**
 * The original, pre-multi-tenant center. Legacy unslugged /api/... requests
 * (existing kiosk bookmarks, the gateway phone, configured webhook URLs)
 * resolve here, so the live center keeps working unchanged.
 */
export async function getDefaultCenter() {
  return db.prepare('SELECT * FROM centers WHERE active = 1 ORDER BY id ASC LIMIT 1').get();
}

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function provisioningError(message) {
  const err = new Error(message);
  err.code = 'INVALID_CENTER';
  return err;
}

/**
 * Provision a new, fully isolated center. Superadmin-only (enforced by the
 * route). The initial admin password is hashed here and never stored or
 * returned in plaintext.
 */
export async function createCenter({ slug, name, timezone, admin_password }) {
  const cleanSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  if (!CENTER_SLUG_PATTERN.test(cleanSlug)) {
    throw provisioningError(
      'slug must be 1-63 characters of lowercase letters, digits, and inner hyphens'
    );
  }

  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName) {
    throw provisioningError('name is required');
  }

  const cleanTimezone =
    timezone == null || timezone === '' ? 'America/Los_Angeles' : String(timezone).trim();
  if (!isValidTimezone(cleanTimezone)) {
    throw provisioningError(`Unknown IANA timezone: ${cleanTimezone}`);
  }

  if (typeof admin_password !== 'string' || admin_password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw provisioningError(
      `admin_password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`
    );
  }

  try {
    const result = await db
      .prepare(
        `INSERT INTO centers (slug, name, timezone, admin_password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(cleanSlug, cleanName, cleanTimezone, hashPassword(admin_password), sqlNow());

    return db.prepare('SELECT * FROM centers WHERE id = ?').get(result.lastInsertRowid);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const conflict = new Error(`A center with slug "${cleanSlug}" already exists`);
      conflict.code = 'CENTER_SLUG_TAKEN';
      throw conflict;
    }
    throw err;
  }
}
