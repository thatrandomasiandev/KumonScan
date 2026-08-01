import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { clearAdminSessionsForTests } from '../middleware/auth.js';
import {
  DEFAULT_LANGUAGE,
  composeAttendanceNotification,
  getAllTemplatesForTests,
  getSupportedLanguages,
  getTemplate,
  renderTemplate,
  resolveLanguage,
} from '../services/i18nService.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  defaultCenter,
  insertStudent,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

function stubTimeApi(iso = '2026-07-30T19:00:00.000Z') {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (url, options) => {
    if (String(url).includes('timeapi.io')) {
      return { ok: true, json: async () => ({ dateTime: iso }) };
    }
    return realFetch(url, options);
  });
}

describe('i18nService template lookup', () => {
  it('supports en and es, with en as the default', () => {
    const supported = getSupportedLanguages();
    expect(supported).toContain('en');
    expect(supported).toContain('es');
    expect(supported[0]).toBe(DEFAULT_LANGUAGE);
  });

  it('returns the Spanish template for es', () => {
    expect(getTemplate('checked_out', 'es')).toMatch(/recogerle/);
    expect(getTemplate('checked_in', 'es')).toMatch(/se registró/);
  });

  it('returns English for en, unset, and unrecognized languages without throwing', () => {
    const english = getTemplate('checked_out', 'en');
    expect(english).toMatch(/ready for pickup/);
    expect(getTemplate('checked_out', undefined)).toBe(english);
    expect(getTemplate('checked_out', null)).toBe(english);
    expect(getTemplate('checked_out', '')).toBe(english);
    expect(getTemplate('checked_out', 'tlh')).toBe(english);
    expect(getTemplate('checked_out', 'xx-YY')).toBe(english);
  });

  it('resolves regional and mixed-case tags to their base language', () => {
    expect(resolveLanguage('es-MX')).toBe('es');
    expect(resolveLanguage('ES')).toBe('es');
    expect(resolveLanguage('en-GB')).toBe('en');
    expect(resolveLanguage(42)).toBe('en');
  });

  it('throws on an unknown template name (programmer error, not bad data)', () => {
    expect(() => getTemplate('no_such_template', 'en')).toThrow(/unknown template/i);
    expect(() => getTemplate('_meta', 'en')).toThrow(/invalid template name/i);
  });

  it('interpolates {{vars}} and leaves unmatched placeholders visible', () => {
    const text = renderTemplate('checked_in', 'en', { name: 'Ana Ruiz', time: '4:15 PM' });
    expect(text).toBe('Ana Ruiz checked in at Kumon at 4:15 PM.');
    expect(renderTemplate('checked_in', 'en', { name: 'Ana Ruiz' })).toContain('{{time}}');
  });

  it('every language file has exactly the English template keys (no untranslated gaps)', () => {
    const templates = getAllTemplatesForTests();
    const englishKeys = Object.keys(templates.get('en')).filter((k) => !k.startsWith('_'));
    expect(englishKeys.length).toBeGreaterThan(0);
    for (const [language, table] of templates) {
      const keys = Object.keys(table).filter((k) => !k.startsWith('_'));
      expect({ language, keys: keys.sort() }).toEqual({
        language,
        keys: [...englishKeys].sort(),
      });
      for (const key of keys) {
        expect(table[key], `${language}.${key} must be a non-empty string`).toBeTypeOf('string');
        expect(table[key].trim()).not.toBe('');
      }
      expect(table._meta?.intlLocale, `${language} needs _meta.intlLocale`).toBeTypeOf('string');
      expect(table._meta?.nativeName, `${language} needs _meta.nativeName`).toBeTypeOf('string');
    }
  });
});

describe('composeAttendanceNotification', () => {
  const iso = '2026-07-30T23:25:00.000Z'; // 4:25 PM America/Los_Angeles

  it('composes Spanish for a student with preferred_language = es', () => {
    const student = { first_name: 'Sofía', last_name: 'García', preferred_language: 'es' };
    const text = composeAttendanceNotification(student, 'checked_out', iso);
    expect(text).toContain('Sofía García');
    expect(text).toMatch(/terminó su sesión en Kumon/);
    expect(text).toMatch(/4:25/);
    expect(text).not.toMatch(/\{\{/);
  });

  it('composes English for the default and for unrecognized languages', () => {
    const base = { first_name: 'Liam', last_name: 'Chen' };
    for (const preferred_language of ['en', undefined, null, 'zz']) {
      const text = composeAttendanceNotification({ ...base, preferred_language }, 'checked_in', iso);
      expect(text).toBe('Liam Chen checked in at Kumon at 4:25 PM.');
    }
  });
});

describe('preferred_language over the API', () => {
  let center;
  let cookie;

  beforeEach(async () => {
    clearAdminSessionsForTests();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    stubTimeApi();
    cookie = await loginCookie(DEFAULT_ADMIN_PASSWORD);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAdminSessionsForTests();
  });

  it('register stores the parent UI language; defaults and garbage resolve to en', async () => {
    const es = await request(app)
      .post('/api/register')
      .set('X-Forwarded-For', '198.51.100.31')
      .send({ first_name: 'Valentina', last_name: 'Morales', preferred_language: 'es' });
    expect(es.status).toBe(201);
    expect(es.body.preferred_language).toBe('es');

    const noLang = await request(app)
      .post('/api/register')
      .set('X-Forwarded-For', '198.51.100.31')
      .send({ first_name: 'Noah', last_name: 'Baker' });
    expect(noLang.status).toBe(201);
    expect(noLang.body.preferred_language).toBe('en');

    const garbage = await request(app)
      .post('/api/register')
      .set('X-Forwarded-For', '198.51.100.31')
      .send({ first_name: 'Mia', last_name: 'Kim', preferred_language: 'not-a-language' });
    expect(garbage.status).toBe(201);
    expect(garbage.body.preferred_language).toBe('en');

    const stored = await db
      .prepare(
        `SELECT preferred_language FROM students WHERE last_name = ? AND center_id = ?`
      )
      .get('Morales', center.id);
    expect(stored.preferred_language).toBe('es');
  });

  it('re-registering an existing student keeps the stored preference', async () => {
    await insertStudent(center.id, {
      first: 'Diego',
      last: 'Torres',
      preferred_language: 'es',
    });
    const res = await request(app)
      .post('/api/register')
      .set('X-Forwarded-For', '198.51.100.32')
      .send({ first_name: 'Diego', last_name: 'Torres', preferred_language: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.is_new).toBe(false);
    expect(res.body.preferred_language).toBe('es');
  });

  it('admin PATCH updates preferred_language and rejects unsupported values', async () => {
    const student = await insertStudent(center.id, { first: 'Emma', last: 'Lopez' });
    expect(student.preferred_language).toBe('en');

    const ok = await request(app)
      .patch(`/api/students/${student.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30')
      .send({ preferred_language: 'es' });
    expect(ok.status).toBe(200);
    expect(ok.body.preferred_language).toBe('es');

    const bad = await request(app)
      .patch(`/api/students/${student.id}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', '198.51.100.30')
      .send({ preferred_language: 'klingon' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/preferred_language must be one of/);

    const unchanged = await db
      .prepare('SELECT preferred_language FROM students WHERE id = ? AND center_id = ?')
      .get(student.id, center.id);
    expect(unchanged.preferred_language).toBe('es');
  });

  it('notification composed from a stored student row uses the stored language', async () => {
    const esStudent = await insertStudent(center.id, {
      first: 'Camila',
      last: 'Reyes',
      preferred_language: 'es',
    });
    const enStudent = await insertStudent(center.id, { first: 'Oliver', last: 'Wright' });

    expect(
      composeAttendanceNotification(esStudent, 'checked_out', '2026-07-30T23:25:00.000Z')
    ).toMatch(/terminó su sesión en Kumon/);
    expect(
      composeAttendanceNotification(enStudent, 'checked_out', '2026-07-30T23:25:00.000Z')
    ).toMatch(/ready for pickup/);
  });
});
