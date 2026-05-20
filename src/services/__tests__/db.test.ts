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
import { describe, it, expect } from 'vitest';
import { ApiError, isNotConnectedError } from '../db';

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
