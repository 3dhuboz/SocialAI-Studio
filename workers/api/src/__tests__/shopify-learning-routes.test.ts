import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { makeRecordingD1 } from './helpers/recording-d1';

const mocks = vi.hoisted(() => ({
  verifySessionToken: vi.fn(),
}));

vi.mock('../lib/shopify-auth', () => ({
  verifySessionToken: mocks.verifySessionToken,
}));

import { registerShopifyLearningRoutes } from '../routes/shopify-learning';

const validHeaders = {
  Authorization: 'Bearer valid-shop-token',
  'Content-Type': 'application/json',
};

function makeApp(db: D1Database) {
  const env = {
    DB: db,
    SHOPIFY_API_KEY: 'shopify-key',
    SHOPIFY_API_SECRET: 'shopify-secret',
  } as Env;
  const app = new Hono<{ Bindings: Env }>();
  registerShopifyLearningRoutes(app);
  return { app, env };
}

beforeEach(() => {
  mocks.verifySessionToken.mockReset();
  mocks.verifySessionToken.mockImplementation(async (token: string) => (
    token === 'valid-shop-token'
      ? { shopDomain: 'Store.MyShopify.com' }
      : null
  ));
});

describe('Shopify owner conversion feedback', () => {
  it('mounts the signed Shopify learning route in the Worker entry point', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    expect(source).toContain("import { registerShopifyLearningRoutes } from './routes/shopify-learning'");
    expect(source).toContain('registerShopifyLearningRoutes(app);');
  });

  it('requires a verified Shopify session token', async () => {
    const { db, calls } = makeRecordingD1();
    const { app, env } = makeApp(db);

    const missing = await app.request(
      '/api/shopify/learning/outcomes/post-1/feedback',
      { method: 'POST', body: JSON.stringify({ leads: 1 }) },
      env,
    );
    const invalid = await app.request(
      '/api/shopify/learning/outcomes/post-1/feedback',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ leads: 1 }),
      },
      env,
    );

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(mocks.verifySessionToken).toHaveBeenCalledWith(
      'invalid-token',
      'shopify-key',
      'shopify-secret',
    );
    expect(calls).toEqual([]);
  });

  it('derives canonical tenant identity from the session and inserts owner feedback', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{ id: 'post-1' }],
    });
    const { app, env } = makeApp(db);

    const response = await app.request(
      '/api/shopify/learning/outcomes/post-1/feedback?shop=evil.myshopify.com',
      {
        method: 'POST',
        headers: validHeaders,
        body: JSON.stringify({
          shop: 'evil.myshopify.com',
          userId: 'evil.myshopify.com',
          workspaceKey: 'shop:evil.myshopify.com',
          ownerKind: 'user',
          ownerId: 'evil-owner',
          calls: 0,
          messages: 2,
          leads: 3,
          bookings: 1,
          sales: 1,
          orderValueCents: 12900,
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const ownershipRead = calls.find((call) => call.sql.includes('FROM posts'))!;
    expect(ownershipRead.sql).toContain("owner_kind = 'shop'");
    expect(ownershipRead.sql).toContain('user_id = ?');
    expect(ownershipRead.sql).toContain('client_id IS NULL');
    expect(ownershipRead.sql).toContain('owner_id = ?');
    expect(ownershipRead.binds).toEqual([
      'post-1', 'store.myshopify.com', 'store.myshopify.com',
    ]);

    const insert = calls.find((call) => call.sql.includes('INSERT INTO conversion_feedback'))!;
    expect(insert.sql).toContain('user_id');
    expect(insert.sql).toContain('workspace_key');
    expect(insert.sql).toContain('client_id');
    expect(insert.sql).toContain('owner_kind');
    expect(insert.sql).toContain('owner_id');
    expect(insert.sql).toContain('source');
    expect(insert.binds).toEqual([
      expect.any(String),
      'store.myshopify.com',
      'shop:store.myshopify.com',
      null,
      'shop',
      'store.myshopify.com',
      'post-1',
      0,
      2,
      3,
      1,
      1,
      12900,
      'owner',
    ]);
  });

  it('returns a leak-safe 404 when the post is not owned by the signed shop', async () => {
    const { db, calls } = makeRecordingD1({ 'FROM posts': [] });
    const { app, env } = makeApp(db);

    const response = await app.request(
      '/api/shopify/learning/outcomes/victim-post/feedback',
      {
        method: 'POST',
        headers: validHeaders,
        body: JSON.stringify({ shop: 'victim.myshopify.com', sales: 1 }),
      },
      env,
    );

    expect(response.status).toBe(404);
    const ownershipRead = calls.find((call) => call.sql.includes('FROM posts'))!;
    expect(ownershipRead.binds).toEqual([
      'victim-post', 'store.myshopify.com', 'store.myshopify.com',
    ]);
    expect(calls.some((call) => call.sql.includes('INSERT INTO conversion_feedback'))).toBe(false);
  });

  it.each([
    ['calls', -1],
    ['calls', 1.5],
    ['messages', -1],
    ['messages', 1.5],
    ['leads', -1],
    ['leads', 1.5],
    ['bookings', -1],
    ['bookings', 1.5],
    ['sales', -1],
    ['sales', 1.5],
  ])('rejects a non-integer or negative %s count (%s)', async (field, value) => {
    const { db, calls } = makeRecordingD1({ 'FROM posts': [{ id: 'post-1' }] });
    const { app, env } = makeApp(db);

    const response = await app.request(
      '/api/shopify/learning/outcomes/post-1/feedback',
      {
        method: 'POST',
        headers: validHeaders,
        body: JSON.stringify({ [field]: value }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/non-negative integer/i);
    expect(calls.some((call) => call.sql.includes('INSERT INTO conversion_feedback'))).toBe(false);
  });

  it.each([-1, 12.34])(
    'rejects a non-integer or negative orderValueCents value (%s)',
    async (orderValueCents) => {
      const { db, calls } = makeRecordingD1({ 'FROM posts': [{ id: 'post-1' }] });
      const { app, env } = makeApp(db);

      const response = await app.request(
        '/api/shopify/learning/outcomes/post-1/feedback',
        {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({ orderValueCents }),
        },
        env,
      );

      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toMatch(/non-negative integer/i);
      expect(calls.some((call) => call.sql.includes('INSERT INTO conversion_feedback'))).toBe(false);
    },
  );

  it('requires at least one conversion metric', async () => {
    const { db, calls } = makeRecordingD1({ 'FROM posts': [{ id: 'post-1' }] });
    const { app, env } = makeApp(db);

    const response = await app.request(
      '/api/shopify/learning/outcomes/post-1/feedback',
      { method: 'POST', headers: validHeaders, body: '{}' },
      env,
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/metric/i);
    expect(calls.some((call) => call.sql.includes('INSERT INTO conversion_feedback'))).toBe(false);
  });
});
