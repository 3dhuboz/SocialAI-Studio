/**
 * Tests for the ApiError class + isNotConnectedError type guard in db.ts.
 *
 * These two are the contract between the worker's 409 NOT_CONNECTED responses
 * (POST /api/posts and POST /api/postproxy/publish-now) and the App.tsx UX
 * that routes the user to Settings → Connect Facebook/Instagram instead of
 * toasting a raw error blob. Drift here silently breaks the reconnect CTA.
 *
 * Coverage targets the exact `instanceof + status + body.code` triple-check
 * — narrow enough that a regression (e.g. someone widening the guard to
 * accept any 409, or someone narrowing it to only Facebook) fails loudly.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ApiError, createDb, isNotConnectedError, mapDbPostToSocialPost } from '../db';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isNotConnectedError', () => {
  it('returns true for canonical 409 NOT_CONNECTED with platform=facebook', () => {
    const err = new ApiError('Facebook not connected', 409, {
      error: 'Facebook not connected',
      code: 'NOT_CONNECTED',
      platform: 'facebook',
    });
    expect(isNotConnectedError(err)).toBe(true);
  });

  it('returns true for canonical 409 NOT_CONNECTED with platform=instagram', () => {
    const err = new ApiError('Instagram not connected', 409, {
      error: 'Instagram not connected',
      code: 'NOT_CONNECTED',
      platform: 'instagram',
    });
    expect(isNotConnectedError(err)).toBe(true);
  });

  it('returns false for 409 with a different code (e.g. RATE_LIMITED)', () => {
    const err = new ApiError('Rate limited', 409, {
      error: 'Too many requests',
      code: 'RATE_LIMITED',
    });
    expect(isNotConnectedError(err)).toBe(false);
  });

  it('returns false for non-409 status even when code is NOT_CONNECTED', () => {
    // Defensive: the guard must require BOTH status === 409 AND
    // code === 'NOT_CONNECTED'. If a worker route ever returned a 500
    // with a NOT_CONNECTED body (it shouldn't), we still want the UX
    // to fall through to a generic toast, not the reconnect CTA.
    const err = new ApiError('Server error', 500, {
      error: 'Internal',
      code: 'NOT_CONNECTED',
    });
    expect(isNotConnectedError(err)).toBe(false);
  });

  it('returns false for ApiError with null body', () => {
    const err = new ApiError('No body', 409, null);
    expect(isNotConnectedError(err)).toBe(false);
  });

  it('returns false for a plain Error instance', () => {
    // Not an ApiError → instanceof check fails, guard returns false even
    // when the caller has tried to monkey-patch status/body on a plain
    // Error (TypeScript would also reject this, but the guard is the
    // runtime safety net).
    const err = new Error('Something broke');
    expect(isNotConnectedError(err)).toBe(false);
  });

  it('returns false for non-Error values (string, undefined, null, plain object)', () => {
    // Catch-all: caught values from `catch (e)` clauses are `unknown` and
    // can be any JS value. The guard must safely reject all of them.
    expect(isNotConnectedError('not an error')).toBe(false);
    expect(isNotConnectedError(undefined)).toBe(false);
    expect(isNotConnectedError(null)).toBe(false);
    expect(isNotConnectedError({ status: 409, body: { code: 'NOT_CONNECTED' } })).toBe(false);
  });
});

describe('learning decision client', () => {
  it('carries the canonical client scope from D1 posts into the receipt request', async () => {
    const post = mapDbPostToSocialPost({
      id: 'post_1', client_id: 'client 1', content: 'Safe copy',
      platform: 'Facebook', status: 'Scheduled', scheduled_for: new Date().toISOString(),
      hashtags: [],
    });
    const fetchMock = vi.fn(async (_input: unknown) => new Response(
      JSON.stringify({ decisions: [{ id: 'decision_1', verdicts: [] }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    const decisions = await db.getLearningDecisions(post.id, post.clientId);

    expect(post.clientId).toBe('client 1');
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/learning/decisions/post_1?clientId=client%201',
    );
    expect(decisions).toEqual([{ id: 'decision_1', verdicts: [] }]);
  });
});

describe('organic reach client', () => {
  it('keeps profile and plan reads in the selected client scope', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      return new Response(JSON.stringify(
        url.includes('/plans/')
          ? { plans: [{ id: 'plan_1', postId: 'post_1', status: 'shadow' }] }
          : { profile: { id: 'reach_1' }, segments: [{ id: 'segment_1' }] },
      ), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    const setup = await db.getReachProfile('client 1');
    const plans = await db.getReachPlans('post 1', 'client 1');

    expect(setup.profile).toEqual({ id: 'reach_1' });
    expect(setup.segments).toEqual([{ id: 'segment_1' }]);
    expect(plans).toEqual([{ id: 'plan_1', postId: 'post_1', status: 'shadow' }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/reach/profile?clientId=client%201',
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/api/reach/plans/post%201?clientId=client%201',
    );
  });

  it('sends only reviewed reach data and the selected client id to mutations', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes('/segments/propose')
        ? { segments: [{ id: 'segment_1' }] }
        : url.includes('/segments/confirm')
          ? { segmentId: 'segment_1', status: 'confirmed' }
          : { profile: { id: 'reach_1' } };
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const db = createDb(async () => 'token');

    await db.proposeReachProfile({
      clientId: 'client_1',
      timezone: 'Australia/Brisbane',
      baseLocation: { country: 'Australia', region: 'Queensland', locality: 'Gladstone' },
      serviceArea: { radiusKm: 40, included: ['Gladstone'] },
      excludedLocations: ['Rockhampton'],
      platforms: ['facebook', 'instagram'],
    });
    await db.confirmReachProfile('reach_1', 'client_1');
    await db.proposeReachSegments('client_1');
    await db.confirmReachSegment('segment_1', 'client_1');

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method,
      body: JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')),
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      url: expect.stringContaining('/api/reach/profile/propose'),
      method: 'POST',
      body: expect.objectContaining({ clientId: 'client_1', timezone: 'Australia/Brisbane' }),
    }));
    expect(calls[0].body).not.toHaveProperty('userId');
    expect(calls[0].body).not.toHaveProperty('ownerId');
    expect(calls[1]).toEqual(expect.objectContaining({
      method: 'PUT', body: { profileId: 'reach_1', clientId: 'client_1' },
    }));
    expect(calls[2]).toEqual(expect.objectContaining({
      method: 'POST', body: { clientId: 'client_1' },
    }));
    expect(calls[3]).toEqual(expect.objectContaining({
      method: 'PUT', body: { segmentId: 'segment_1', clientId: 'client_1' },
    }));
  });
});
