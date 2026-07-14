import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { makeRecordingD1 } from './helpers/recording-d1';

vi.mock('../auth', () => ({
  getAuthUserId: async (request: Request) => request.headers.get('X-Test-Uid') || null,
}));

import { registerLearningRoutes } from '../routes/learning';

function makeApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  registerLearningRoutes(app);
  return { app, env };
}

describe('learning receipt routes', () => {
  it('rejects unauthenticated requests before querying D1', async () => {
    const { db, calls } = makeRecordingD1();
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/api/learning/decisions/post_1', {}, env);

    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('returns receipts only after verifying owner-post ownership', async () => {
    const decision = { id: 'decision_1', post_id: 'post_1' };
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{
        id: 'post_1', user_id: 'owner_1', client_id: null,
        owner_kind: 'user', owner_id: 'owner_1',
      }],
      'FROM learning_decisions': [decision],
    });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/api/learning/decisions/post_1', {
      headers: { 'X-Test-Uid': 'owner_1' },
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ decisions: [decision] });
    expect(calls[0].binds).toEqual(['post_1', 'owner_1']);
    expect(calls[1].binds).toEqual(['owner_1', '__owner__', 'post_1', 20]);
  });

  it('uses a leak-safe 404 and never reads receipts for another owner', async () => {
    const { db, calls } = makeRecordingD1({ 'FROM posts': [] });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/api/learning/decisions/post_alice', {
      headers: { 'X-Test-Uid': 'owner_eve' },
    }, env);

    expect(response.status).toBe(404);
    expect(calls.some((call) => call.sql.includes('FROM learning_decisions'))).toBe(false);
  });

  it('rejects a client query that does not match the post workspace', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{
        id: 'post_1', user_id: 'owner_1', client_id: 'client_1',
        owner_kind: 'client', owner_id: 'client_1',
      }],
    });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request(
      '/api/learning/decisions/post_1?clientId=client_2',
      { headers: { 'X-Test-Uid': 'owner_1' } },
      env,
    );

    expect(response.status).toBe(404);
    expect(calls.some((call) => call.sql.includes('FROM learning_decisions'))).toBe(false);
  });

  it('reads canonical client and Shopify workspace keys', async () => {
    const clientDb = makeRecordingD1({
      'FROM posts': [{
        id: 'post_client', user_id: 'owner_1', client_id: 'client_1',
        owner_kind: 'client', owner_id: 'client_1',
      }],
      'FROM learning_decisions': [],
    });
    const clientApp = makeApp({ DB: clientDb.db } as Env);
    const clientResponse = await clientApp.app.request(
      '/api/learning/decisions/post_client?clientId=client_1',
      { headers: { 'X-Test-Uid': 'owner_1' } },
      clientApp.env,
    );
    expect(clientResponse.status).toBe(200);
    expect(clientDb.calls[1].binds).toEqual(['owner_1', 'client_1', 'post_client', 20]);

    const shopDb = makeRecordingD1({
      'FROM posts': [{
        id: 'post_shop', user_id: 'store.myshopify.com', client_id: null,
        owner_kind: 'shop', owner_id: 'Store.MyShopify.com',
      }],
      'FROM learning_decisions': [],
    });
    const shopApp = makeApp({ DB: shopDb.db } as Env);
    const shopResponse = await shopApp.app.request(
      '/api/learning/decisions/post_shop',
      { headers: { 'X-Test-Uid': 'store.myshopify.com' } },
      shopApp.env,
    );
    expect(shopResponse.status).toBe(200);
    expect(shopDb.calls[1].binds).toEqual([
      'store.myshopify.com', 'shop:store.myshopify.com', 'post_shop', 20,
    ]);
  });
});
