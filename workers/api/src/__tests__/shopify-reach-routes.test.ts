import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { ReachProfile } from '../lib/reach/types';
import { makeRecordingD1 } from './helpers/recording-d1';

const mocks = vi.hoisted(() => ({
  verifySessionToken: vi.fn(),
  isRateLimited: vi.fn(async () => false),
}));
vi.mock('../lib/shopify-auth', () => ({
  verifySessionToken: mocks.verifySessionToken,
}));
vi.mock('../auth', () => ({ isRateLimited: mocks.isRateLimited }));

import {
  registerShopifyReachRoutes,
  type ShopifyReachRoutesDeps,
} from '../routes/shopify-reach';

const shopProfile: ReachProfile = {
  id: 'reach_shop', userId: 'store.myshopify.com', clientId: null,
  workspaceKey: 'shop:store.myshopify.com', ownerKind: 'shop',
  ownerId: 'store.myshopify.com', version: 2,
  confirmationStatus: 'confirmed', timezone: 'Australia/Brisbane',
  baseLocation: { country: 'Australia', region: 'Queensland', locality: 'Gladstone' },
  serviceArea: { radiusKm: 40, included: ['Gladstone'] },
  excludedLocations: [], platforms: ['facebook', 'instagram'],
};

function deps(patch: Partial<ShopifyReachRoutesDeps> = {}): ShopifyReachRoutesDeps {
  return {
    getProfile: vi.fn(async () => shopProfile),
    proposeProfile: vi.fn(async () => ({ ...shopProfile, confirmationStatus: 'proposed' })),
    confirmProfile: vi.fn(async () => shopProfile),
    proposeSegments: vi.fn(async () => [{ id: 'segment_shop', status: 'predicted' } as any]),
    ...patch,
  };
}

function makeApp(env: Env, routeDeps: ShopifyReachRoutesDeps) {
  const app = new Hono<{ Bindings: Env }>();
  registerShopifyReachRoutes(app, routeDeps);
  return { app, env };
}

beforeEach(() => {
  mocks.verifySessionToken.mockReset();
  mocks.verifySessionToken.mockImplementation(async (token: string) => (
    token === 'valid-shop-token'
      ? { shopDomain: 'store.myshopify.com' }
      : null
  ));
  mocks.isRateLimited.mockClear();
});

describe('Shopify reach routes', () => {
  it('requires a signed Shopify session', async () => {
    const { db } = makeRecordingD1();
    const routeDeps = deps();
    const { app, env } = makeApp({
      DB: db, SHOPIFY_API_KEY: 'key', SHOPIFY_API_SECRET: 'secret',
    } as Env, routeDeps);

    const response = await app.request('/api/shopify/reach/profile', {}, env);
    expect(response.status).toBe(401);
  });

  it('derives the canonical shop and ignores tenant ids supplied by the body', async () => {
    const { db } = makeRecordingD1();
    const routeDeps = deps();
    const { app, env } = makeApp({
      DB: db, SHOPIFY_API_KEY: 'key', SHOPIFY_API_SECRET: 'secret',
    } as Env, routeDeps);

    const response = await app.request('/api/shopify/reach/profile/propose', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-shop-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        shop: 'evil.myshopify.com', userId: 'evil.myshopify.com',
        timezone: 'Australia/Brisbane',
        baseLocation: shopProfile.baseLocation,
        serviceArea: shopProfile.serviceArea,
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(routeDeps.proposeProfile).toHaveBeenCalledWith(
      db,
      {
        userId: 'store.myshopify.com', clientId: null,
        ownerKind: 'shop', ownerId: 'store.myshopify.com',
      },
      expect.objectContaining({ timezone: 'Australia/Brisbane' }),
    );
  });

  it('mirrors profile and segment confirmation under the signed shop scope', async () => {
    const { db } = makeRecordingD1();
    const routeDeps = deps();
    const { app, env } = makeApp({
      DB: db, SHOPIFY_API_KEY: 'key', SHOPIFY_API_SECRET: 'secret',
    } as Env, routeDeps);
    const headers = {
      Authorization: 'Bearer valid-shop-token',
      'Content-Type': 'application/json',
    };

    const get = await app.request('/api/shopify/reach/profile', { headers }, env);
    const confirmProfile = await app.request('/api/shopify/reach/profile/confirm', {
      method: 'PUT', headers, body: JSON.stringify({ profileId: 'reach_shop' }),
    }, env);
    const propose = await app.request('/api/shopify/reach/segments/propose', {
      method: 'POST', headers, body: '{}',
    }, env);

    expect(get.status).toBe(200);
    expect(confirmProfile.status).toBe(200);
    expect(propose.status).toBe(200);
    expect(routeDeps.getProfile).toHaveBeenCalledWith(db, expect.objectContaining({
      ownerKind: 'shop', ownerId: 'store.myshopify.com',
    }));
    expect(routeDeps.proposeSegments).toHaveBeenCalledWith(env, shopProfile);
  });

  it('reads plans only for the shop derived from the signed session', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{ id: 'post_1' }],
      'FROM reach_plans': [{
        id: 'plan_1', post_id: 'post_1', status: 'shadow',
        geographic_focus_json: '[]', platform_plan_json: '{}',
        timing_json: '[]', language_json: '{}', hashtag_json: '{}',
        media_json: '{}', experiment_json: '{}',
      }],
    });
    const routeDeps = deps();
    const { app, env } = makeApp({
      DB: db, SHOPIFY_API_KEY: 'key', SHOPIFY_API_SECRET: 'secret',
    } as Env, routeDeps);

    const response = await app.request(
      '/api/shopify/reach/plans/post_1?shop=evil.myshopify.com',
      { headers: { Authorization: 'Bearer valid-shop-token' } },
      env,
    );

    expect(response.status).toBe(200);
    expect(calls[0].binds).toEqual(['post_1', 'store.myshopify.com']);
    expect(calls[1].binds).toEqual([
      'store.myshopify.com', 'shop:store.myshopify.com', 'post_1',
    ]);
  });
});
