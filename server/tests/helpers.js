import { v4 as uuidv4 } from 'uuid';
import request from 'supertest';
import app from '../app.js';
import db, { sqlNow } from '../db.js';
import { hashPassword } from '../utils/passwords.js';
import { getDefaultCenter } from '../services/centerService.js';

export const DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

/** The original (seeded) center created by the tenancy migration. */
export async function defaultCenter() {
  const center = await getDefaultCenter();
  if (!center) throw new Error('No default center — ensureDb has not run');
  return center;
}

/**
 * Provision a second, fully isolated center for cross-tenant tests.
 * Returns the centers row. Password defaults to DEFAULT_ADMIN_PASSWORD.
 */
export async function createTestCenter({
  slug,
  name = 'Test Center',
  timezone = 'America/Los_Angeles',
  password = DEFAULT_ADMIN_PASSWORD,
} = {}) {
  const uniqueSlug =
    slug || `test-${uuidv4().slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const result = await db
    .prepare(
      `INSERT INTO centers (slug, name, timezone, admin_password_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(uniqueSlug, name, timezone, hashPassword(password), sqlNow());
  return db.prepare('SELECT * FROM centers WHERE id = ?').get(result.lastInsertRowid);
}

export async function loginCookie(password = DEFAULT_ADMIN_PASSWORD, centerSlug = null) {
  // Prior suites may have cleared or rotated the hash; re-seed the known
  // test password onto the target center so login is deterministic.
  const center = centerSlug
    ? await db.prepare('SELECT * FROM centers WHERE slug = ?').get(centerSlug)
    : await defaultCenter();
  if (center) {
    await db
      .prepare('UPDATE centers SET admin_password_hash = ? WHERE id = ?')
      .run(hashPassword(password), center.id);
  }

  const path = centerSlug ? `/api/c/${centerSlug}/auth/login` : '/api/auth/login';
  const res = await request(app)
    .post(path)
    .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 20}`)
    .send({ password });
  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.headers['set-cookie'];
}

export async function insertStudent(centerId, {
  first,
  last,
  subjects = 'both',
  days = null,
  parent_phone = null,
  notify_channel = 'sms',
  parent_whatsapp = null,
  preferred_language = 'en',
  active = 1,
} = {}) {
  const result = await db
    .prepare(
      `INSERT INTO students
         (center_id, first_name, last_name, active, enrolled_subjects,
          schedule_days, parent_phone, notify_channel, parent_whatsapp, preferred_language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      centerId,
      first,
      last,
      active,
      subjects,
      days,
      parent_phone,
      notify_channel,
      parent_whatsapp,
      preferred_language
    );
  return {
    id: result.lastInsertRowid,
    center_id: centerId,
    preferred_language,
    first_name: first,
    last_name: last,
  };
}

async function tableHasColumn(table, column) {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 AS ok FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`
      )
      .get(table, column)
  );
}

async function tableExists(table) {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 AS ok FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ?`
      )
      .get(table)
  );
}

/**
 * Wipe tenant data for the centers under test. Centers rows themselves are
 * left alone (the default center is required by ensureDb); pass extra center
 * ids to delete those rows after their data is cleared.
 *
 * Child rows are removed by joining through their parent when possible, so a
 * half-migrated optional table (or a row whose center_id drifted) cannot
 * leave an FK orphan that blocks the parent delete.
 */
export async function wipeCenterData(...centerIds) {
  const ids = centerIds.filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return;

  // Dependency order: grandchildren → children → parents.
  if (await tableExists('sms_queue')) {
    await db
      .prepare(
        `DELETE FROM sms_queue
         WHERE center_id = ANY(?::int[])
            OR student_id IN (SELECT id FROM students WHERE center_id = ANY(?::int[]))`
      )
      .run(ids, ids);
  }
  if (await tableExists('messages') && (await tableHasColumn('messages', 'center_id'))) {
    await db.prepare('DELETE FROM messages WHERE center_id = ANY(?::int[])').run(ids);
  }
  if (await tableExists('resource_usage') && (await tableHasColumn('resource_usage', 'center_id'))) {
    await db.prepare('DELETE FROM resource_usage WHERE center_id = ANY(?::int[])').run(ids);
  }
  if (await tableExists('worksheet_completions')) {
    // References both sessions and students; must clear before either.
    await db
      .prepare(
        `DELETE FROM worksheet_completions
         WHERE student_id IN (SELECT id FROM students WHERE center_id = ANY(?::int[]))`
      )
      .run(ids);
  }
  if (await tableExists('sessions')) {
    await db
      .prepare(
        `DELETE FROM sessions
         WHERE center_id = ANY(?::int[])
            OR student_id IN (SELECT id FROM students WHERE center_id = ANY(?::int[]))`
      )
      .run(ids, ids);
  }
  if (await tableExists('staff_sessions')) {
    await db
      .prepare(
        `DELETE FROM staff_sessions
         WHERE center_id = ANY(?::int[])
            OR staff_id IN (SELECT id FROM staff WHERE center_id = ANY(?::int[]))`
      )
      .run(ids, ids);
  }
  if (await tableExists('zoom_meetings') && (await tableHasColumn('zoom_meetings', 'center_id'))) {
    await db.prepare('DELETE FROM zoom_meetings WHERE center_id = ANY(?::int[])').run(ids);
  }
  if (await tableExists('bookings') && (await tableHasColumn('bookings', 'center_id'))) {
    await db.prepare('DELETE FROM bookings WHERE center_id = ANY(?::int[])').run(ids);
  }
  if (await tableExists('caregivers') && (await tableHasColumn('caregivers', 'center_id'))) {
    await db.prepare('DELETE FROM caregivers WHERE center_id = ANY(?::int[])').run(ids);
  }
  if (await tableExists('resources') && (await tableHasColumn('resources', 'center_id'))) {
    await db.prepare('DELETE FROM resources WHERE center_id = ANY(?::int[])').run(ids);
  }
  if (await tableExists('webhook_subscriptions') && (await tableHasColumn('webhook_subscriptions', 'center_id'))) {
    await db
      .prepare('DELETE FROM webhook_subscriptions WHERE center_id = ANY(?::int[])')
      .run(ids);
  }
  if (await tableExists('settings') && (await tableHasColumn('settings', 'center_id'))) {
    await db.prepare('DELETE FROM settings WHERE center_id = ANY(?::int[])').run(ids);
  }
  if (await tableExists('digest_log') && (await tableHasColumn('digest_log', 'center_id'))) {
    await db.prepare('DELETE FROM digest_log WHERE center_id = ANY(?::int[])').run(ids);
  }
  if (await tableExists('student_progress')) {
    await db
      .prepare(
        `DELETE FROM student_progress
         WHERE student_id IN (SELECT id FROM students WHERE center_id = ANY(?::int[]))`
      )
      .run(ids);
  }
  if (await tableExists('parent_access_tokens')) {
    await db
      .prepare(
        `DELETE FROM parent_access_tokens
         WHERE student_id IN (SELECT id FROM students WHERE center_id = ANY(?::int[]))`
      )
      .run(ids);
  }
  if (await tableExists('staff')) {
    await db.prepare('DELETE FROM staff WHERE center_id = ANY(?::int[])').run(ids);
  }
  if (await tableExists('students')) {
    await db.prepare('DELETE FROM students WHERE center_id = ANY(?::int[])').run(ids);
  }
}

/** Delete non-default centers created by a test (cascades are not set). */
export async function deleteCenters(...centerIds) {
  const ids = centerIds.filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return;
  await wipeCenterData(...ids);
  await db.prepare('DELETE FROM centers WHERE id = ANY(?::int[])').run(ids);
}
