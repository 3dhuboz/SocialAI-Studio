import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { ReachProfile } from '../lib/reach/types';
import { makeRecordingD1 } from './helpers/recording-d1';

const auth = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  isRateLimited: vi.fn(async () => false),
}));
vi.mock('../auth', () => auth);

import {
  registerReachRoutes,
  type ReachRoutesDeps,
} from '../routes/reach';

const profile: ReachProfile = {
  id: 'reach_1', userId: 'owner_1', clientId: null,
  workspaceKey: '__owner__', ownerKind: 'user', ownerId: 'owner_1',
  version: 2, confirmationStatus: 'confirmed', timezone: 'Australia/Brisbane',
  baseLocation: { country: 'Australia', region: 'Queensland', locality: 'Gladstone' },
  serviceArea: { radiusKm: 40, included: ['Gladstone'] },
  excludedLocations: [], platforms: ['facebook', 'instagram'],
};

function makeDeps(patch: Partial<ReachRoutesDeps> = {}): ReachRoutesDeps {
  return {
    getProfile: vi.fn(async () => profile),
    proposeProfile: vi.fn(async (_db, scope) => ({
      ...profile,
      userId: scope.userId,
      clientId: scope.clientId,
      workspaceKey: scope.clientId ?? '__owner__',
      ownerKind: scope.ownerKind,
      ownerId: scope.ownerId,
      confirmationStatus: 'proposed' as const,
    })),
    confirmProfile: vi.fn(async () => profile),
    proposeSegments: vi.fn(async () => [{ id: 'segment_1', status: 'predicted' } as any]),
    ...patch,
  };
}

function makeApp(env: Env, deps: ReachRoutesDeps) {
  const app = new Hono<{ Bindings: Env }>();
  registerReachRoutes(app, deps);
  return { app, env };
}

beforeEach(() => {
  auth.getAuthUserId.mockReset();
  auth.getAuthUserId.mockImplementation(async (request: Request) => (
    request.headers.get('X-Test-Uid') || null
  ));
  auth.isRateLimited.mockClear();
});

describe('organic reach routes', () => {
  it('uses the shared optional embed secret auth path and rejects unauthenticated access', async () => {
    const { db, calls } = makeRecordingD1();
    const deps = makeDeps();
    const { app, env } = makeApp({
      DB: db,
      ISS_EMBED_SECRET: 'embed-secret',
    } as Env, deps);

    const response = await app.request('/api/reach/profile', {}, env);

    expect(response.status).toBe(401);
    expect(auth.getAuthUserId.mock.calls[0][4]).toBe('embed-secret');
    expect(calls).toEqual([]);
  });

  it('derives canonical client scope and ignores request-supplied ownership', async () => {
    const { db } = makeRecordingD1();
    const deps = makeDeps();
    const { app, env } = makeApp({ DB: db } as Env, deps);

    const response = await app.request('/api/reach/profile/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'owner_1' },
      body: JSON.stringify({
        clientId: 'client_1', userId: 'owner_eve', ownerId: 'client_evil',
        timezone: 'Australia/Brisbane',
        baseLocation: profile.baseLocation,
        serviceArea: profile.serviceArea,
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(deps.proposeProfile).toHaveBeenCalledWith(
      db,
      {
        userId: 'owner_1', clientId: 'client_1',
        ownerKind: 'client', ownerId: 'client_1',
      },
      expect.objectContaining({ timezone: 'Australia/Brisbane' }),
    );
    expect(auth.isRateLimited).toHaveBeenCalled();
  });

  it('covers profile read and immutable confirmation', async () => {
    const { db } = makeRecordingD1();
    const deps = makeDeps();
    const { app, env } = makeApp({ DB: db } as Env, deps);

    const getResponse = await app.request('/api/reach/profile', {
      headers: { 'X-Test-Uid': 'owner_1' },
    }, env);
    const confirmResponse = await app.request('/api/reach/profile/confirm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'owner_1' },
      body: JSON.stringify({ profileId: 'reach_1' }),
    }, env);

    expect(getResponse.status).toBe(200);
    expect(confirmResponse.status).toBe(200);
    expect(deps.getProfile).toHaveBeenCalledWith(db, {
      userId: 'owner_1', clientId: null, ownerKind: 'user', ownerId: 'owner_1',
    });
    expect(deps.confirmProfile).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ userId: 'owner_1', ownerKind: 'user' }),
      'reach_1',
    );
  });

  it('proposes and separately confirms a tenant-scoped audience segment', async () => {
    const { db, calls } = makeRecordingD1({
      'UPDATE audience_segments': [],
    });
    const deps = makeDeps();
    const { app, env } = makeApp({ DB: db } as Env, deps);

    const propose = await app.request('/api/reach/segments/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'owner_1' },
      body: '{}',
    }, env);
    const confirm = await app.request('/api/reach/segments/confirm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'owner_1' },
      body: JSON.stringify({ segmentId: 'segment_1' }),
    }, env);

    expect(propose.status).toBe(200);
    expect(confirm.status).toBe(200);
    expect(deps.proposeSegments).toHaveBeenCalledWith(env, profile);
    const update = calls.find((call) => call.sql.includes('UPDATE audience_segments'));
    expect(update?.binds).toEqual(['segment_1', 'owner_1', '__owner__', 'reach_1']);
  });

  it('returns plans only after post ownership and exact client scope are proved', async () => {
    const planRow = {
      id: 'plan_1', post_id: 'post_1', status: 'shadow',
      user_id: 'owner_1', workspace_key: 'client_1', owner_id: 'client_1',
      geographic_focus_json: '["Gladstone"]',
      platform_plan_json: '{}', timing_json: '[]', language_json: '{}',
      hashtag_json: '{}', media_json: '{}', experiment_json: '{}',
    };
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{ id: 'post_1', client_id: 'client_1' }],
      'FROM reach_plans': [planRow],
    });
    const deps = makeDeps();
    const { app, env } = makeApp({ DB: db } as Env, deps);

    const response = await app.request(
      '/api/reach/plans/post_1?clientId=client_1',
      { headers: { 'X-Test-Uid': 'owner_1' } },
      env,
    );

    expect(response.status).toBe(200);
    expect(calls[0].binds).toEqual(['post_1', 'owner_1']);
    expect(calls[1].binds).toEqual(['owner_1', 'client_1', 'post_1']);
    const body = await response.json() as { plans: Array<Record<string, unknown>> };
    expect(body).toEqual({
      plans: [expect.objectContaining({
        id: 'plan_1', postId: 'post_1', geographicFocus: ['Gladstone'],
      })],
    });
    expect(body.plans[0]).not.toHaveProperty('user_id');
    expect(body.plans[0]).not.toHaveProperty('workspace_key');
    expect(body.plans[0]).not.toHaveProperty('owner_id');
  });

  it('uses a leak-safe 404 for another owner post', async () => {
    const { db, calls } = makeRecordingD1({ 'FROM posts': [] });
    const deps = makeDeps();
    const { app, env } = makeApp({ DB: db } as Env, deps);

    const response = await app.request('/api/reach/plans/post_other', {
      headers: { 'X-Test-Uid': 'owner_1' },
    }, env);

    expect(response.status).toBe(404);
    expect(calls.some((call) => call.sql.includes('FROM reach_plans'))).toBe(false);
  });
});
