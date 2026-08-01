import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import db from '../db.js';
import { ensureResourceSchema } from '../services/resourceService.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  defaultCenter,
  insertStudent,
  loginCookie,
  wipeCenterData,
} from './helpers.js';

const IP = { 'X-Forwarded-For': '198.51.100.55' };

async function createResource(cookie, body) {
  const res = await request(app).post('/api/resources').set('Cookie', cookie).set(IP).send(body);
  expect(res.status).toBe(201);
  return res.body;
}

describe('Resource inventory API', () => {
  let cookie;
  let center;

  beforeEach(async () => {
    await ensureResourceSchema();
    center = await defaultCenter();
    await wipeCenterData(center.id);
    await db.exec('DELETE FROM resource_usage; DELETE FROM resources');
    cookie = await loginCookie(DEFAULT_ADMIN_PASSWORD);
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/resources').set(IP);
    expect(res.status).toBe(401);
  });

  it('creates resources and flags low stock in list and low-stock endpoints', async () => {
    const low = await createResource(cookie, {
      name: 'Math Level 2A Worksheet Pack',
      category: 'worksheet',
      quantity_on_hand: 3,
      low_stock_threshold: 5,
    });
    const ok = await createResource(cookie, {
      name: 'iPad Pencil',
      category: 'pencil',
      quantity_on_hand: 20,
      low_stock_threshold: 4,
    });

    const list = await request(app).get('/api/resources').set('Cookie', cookie).set(IP);
    expect(list.status).toBe(200);
    expect(list.body.count).toBe(2);
    expect(list.body.low_stock_count).toBe(1);

    const byId = Object.fromEntries(list.body.resources.map((r) => [r.id, r]));
    expect(byId[low.id].low_stock).toBe(true);
    expect(byId[ok.id].low_stock).toBe(false);

    const lowStock = await request(app)
      .get('/api/resources/low-stock')
      .set('Cookie', cookie)
      .set(IP);
    expect(lowStock.status).toBe(200);
    expect(lowStock.body.resources.map((r) => r.id)).toEqual([low.id]);
  });

  it('validates resource creation input', async () => {
    const noName = await request(app)
      .post('/api/resources')
      .set('Cookie', cookie)
      .set(IP)
      .send({ category: 'book' });
    expect(noName.status).toBe(400);

    const badCategory = await request(app)
      .post('/api/resources')
      .set('Cookie', cookie)
      .set(IP)
      .send({ name: 'Thing', category: 'gadget' });
    expect(badCategory.status).toBe(400);

    const badQuantity = await request(app)
      .post('/api/resources')
      .set('Cookie', cookie)
      .set(IP)
      .send({ name: 'Thing', quantity_on_hand: -2 });
    expect(badQuantity.status).toBe(400);
  });

  it('restock increases quantity_on_hand and clears the low-stock flag', async () => {
    const resource = await createResource(cookie, {
      name: 'Reading Level B Booklet',
      category: 'book',
      quantity_on_hand: 2,
      low_stock_threshold: 5,
    });
    expect(resource.low_stock).toBe(true);

    const restock = await request(app)
      .patch(`/api/resources/${resource.id}/restock`)
      .set('Cookie', cookie)
      .set(IP)
      .send({ quantity: 10 });
    expect(restock.status).toBe(200);
    expect(restock.body.quantity_on_hand).toBe(12);
    expect(restock.body.low_stock).toBe(false);

    const lowStock = await request(app)
      .get('/api/resources/low-stock')
      .set('Cookie', cookie)
      .set(IP);
    expect(lowStock.body.count).toBe(0);

    const badQuantity = await request(app)
      .patch(`/api/resources/${resource.id}/restock`)
      .set('Cookie', cookie)
      .set(IP)
      .send({ quantity: 0 });
    expect(badQuantity.status).toBe(400);

    const missing = await request(app)
      .patch('/api/resources/999999/restock')
      .set('Cookie', cookie)
      .set(IP)
      .send({ quantity: 1 });
    expect(missing.status).toBe(404);
  });

  it('use decrements stock, logs a usage row, and 409s when stock is insufficient', async () => {
    const student = await insertStudent(center.id, { first: 'Usage', last: 'Logger' });
    const resource = await createResource(cookie, {
      name: 'Math Level 3A Worksheet Pack',
      category: 'worksheet',
      quantity_on_hand: 5,
    });

    const use = await request(app)
      .post(`/api/resources/${resource.id}/use`)
      .set('Cookie', cookie)
      .set(IP)
      .send({ student_id: student.id, quantity: 2 });
    expect(use.status).toBe(201);
    expect(use.body.resource.quantity_on_hand).toBe(3);
    expect(use.body.usage.student_id).toBe(student.id);
    expect(use.body.usage.quantity).toBe(2);

    const tooMany = await request(app)
      .post(`/api/resources/${resource.id}/use`)
      .set('Cookie', cookie)
      .set(IP)
      .send({ quantity: 4 });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.available).toBe(3);

    const unknownStudent = await request(app)
      .post(`/api/resources/${resource.id}/use`)
      .set('Cookie', cookie)
      .set(IP)
      .send({ student_id: 999999, quantity: 1 });
    expect(unknownStudent.status).toBe(400);

    const missingResource = await request(app)
      .post('/api/resources/999999/use')
      .set('Cookie', cookie)
      .set(IP)
      .send({ quantity: 1 });
    expect(missingResource.status).toBe(404);

    const usageRows = await db
      .prepare('SELECT * FROM resource_usage WHERE resource_id = ? AND center_id = ?')
      .all(resource.id, center.id);
    expect(usageRows).toHaveLength(1);

    const list = await request(app).get('/api/resources').set('Cookie', cookie).set(IP);
    expect(list.body.resources.find((r) => r.id === resource.id).quantity_on_hand).toBe(3);
  });

  it(
    'concurrent use requests never push quantity_on_hand negative',
    { timeout: 60_000 },
    async () => {
      const resource = await createResource(cookie, {
        name: 'Contested Pencil',
        category: 'pencil',
        quantity_on_hand: 3,
      });

      const attempts = 6;
      const responses = await Promise.all(
        Array.from({ length: attempts }, () =>
          request(app)
            .post(`/api/resources/${resource.id}/use`)
            .set('Cookie', cookie)
            .set(IP)
            .send({ quantity: 1 })
        )
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(attempts - 3);

      const row = await db
        .prepare('SELECT quantity_on_hand FROM resources WHERE id = ? AND center_id = ?')
        .get(resource.id, center.id);
      expect(row.quantity_on_hand).toBe(0);

      const usageCount = await db
        .prepare('SELECT COUNT(*) AS count FROM resource_usage WHERE resource_id = ? AND center_id = ?')
        .get(resource.id, center.id);
      expect(usageCount.count).toBe(3);
    }
  );

  it('usage report totals match the sum of usage rows in the queried range', async () => {
    const student = await insertStudent(center.id, { first: 'Report', last: 'Subject' });
    const worksheets = await createResource(cookie, {
      name: 'Worksheet Pack',
      category: 'worksheet',
      quantity_on_hand: 50,
    });
    const pencils = await createResource(cookie, {
      name: 'Pencil',
      category: 'pencil',
      quantity_on_hand: 50,
    });

    for (const [resourceId, quantity, withStudent] of [
      [worksheets.id, 2, true],
      [worksheets.id, 3, true],
      [pencils.id, 1, false],
    ]) {
      const res = await request(app)
        .post(`/api/resources/${resourceId}/use`)
        .set('Cookie', cookie)
        .set(IP)
        .send({ quantity, ...(withStudent ? { student_id: student.id } : {}) });
      expect(res.status).toBe(201);
    }

    // Out-of-range row inserted directly; must be excluded by the date filter.
    await db
      .prepare(
        `INSERT INTO resource_usage (center_id, resource_id, student_id, quantity, used_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(center.id, worksheets.id, student.id, 99, '2020-01-15T12:00:00.000Z');

    const report = await request(app)
      .get('/api/reports/resource-usage?start=2025-01-01&end=2099-12-31')
      .set('Cookie', cookie)
      .set(IP);
    expect(report.status).toBe(200);
    expect(report.body.summary).toEqual({ usage_count: 3, total_quantity: 6 });

    const byResource = Object.fromEntries(
      report.body.by_resource.map((r) => [r.resource_id, r])
    );
    expect(byResource[worksheets.id]).toMatchObject({ usage_count: 2, total_quantity: 5 });
    expect(byResource[pencils.id]).toMatchObject({ usage_count: 1, total_quantity: 1 });

    const byStudent = Object.fromEntries(
      report.body.by_student.map((r) => [r.student_id ?? 'none', r])
    );
    expect(byStudent[student.id]).toMatchObject({
      name: 'Report Subject',
      total_quantity: 5,
    });
    expect(byStudent.none).toMatchObject({ name: 'Unattributed', total_quantity: 1 });

    const badDate = await request(app)
      .get('/api/reports/resource-usage?start=Jan-1')
      .set('Cookie', cookie)
      .set(IP);
    expect(badDate.status).toBe(400);

    const csv = await request(app)
      .get('/api/reports/resource-usage?start=2025-01-01&end=2099-12-31&format=csv')
      .set('Cookie', cookie)
      .set(IP);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toBe('group_type,id,name,category,usage_count,total_quantity');
    expect(lines).toContain(`resource,${worksheets.id},Worksheet Pack,worksheet,2,5`);
    expect(lines).toContain(`student,${student.id},Report Subject,,2,5`);
    expect(lines).toContain('student,,Unattributed,,1,1');
  });
});
