/**
 * Unit tests for workers/api/src/lib/profile-guards.ts — the canonical
 * parser + scanner backing the owner-declared "never depict, never
 * mention" denylist.
 *
 * Covers:
 *   - parseForbiddenSubjects: tokenisation, separator handling, length cap
 *   - scanForForbidden: case-insensitive substring match, empty input
 *   - loadForbiddenSubjects: user + client tier UNION with mocked D1
 *
 * This is the regression-bedrock for the Seamus (hugheseysque) BBQ
 * pork-on-brisket incident — the denylist MUST stay parsed correctly or
 * the four-layer defense collapses to nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseForbiddenSubjects, scanForForbidden, loadForbiddenSubjects } from '../lib/profile-guards';

describe('parseForbiddenSubjects — tokenisation', () => {
  it('returns [] for empty / null / non-string input', () => {
    expect(parseForbiddenSubjects()).toEqual([]);
    expect(parseForbiddenSubjects(null)).toEqual([]);
    expect(parseForbiddenSubjects('')).toEqual([]);
    expect(parseForbiddenSubjects('   ')).toEqual([]);
    // Defensive: accidentally-typed non-string from a corrupt JSON parse.
    expect(parseForbiddenSubjects({ pork: true } as unknown as string)).toEqual([]);
    expect(parseForbiddenSubjects(123 as unknown as string)).toEqual([]);
  });

  it('lowercases everything', () => {
    expect(parseForbiddenSubjects('PORK, Chicken, LaMb')).toEqual(['pork', 'chicken', 'lamb']);
  });

  it('accepts commas, newlines, and semicolons as separators (interchangeable)', () => {
    expect(parseForbiddenSubjects('pork, chicken')).toEqual(['pork', 'chicken']);
    expect(parseForbiddenSubjects('pork\nchicken')).toEqual(['pork', 'chicken']);
    expect(parseForbiddenSubjects('pork; chicken')).toEqual(['pork', 'chicken']);
    expect(parseForbiddenSubjects('pork, chicken\nlamb; fish')).toEqual(['pork', 'chicken', 'lamb', 'fish']);
  });

  it('strips whitespace around each token', () => {
    expect(parseForbiddenSubjects('  pork  ,   chicken  ')).toEqual(['pork', 'chicken']);
  });

  it('drops empty tokens (trailing commas, double separators)', () => {
    expect(parseForbiddenSubjects('pork,,chicken,')).toEqual(['pork', 'chicken']);
    expect(parseForbiddenSubjects(',,,')).toEqual([]);
  });

  it('caps tokens at <60 chars to catch paste-the-whole-bio mistakes', () => {
    const longish = 'a'.repeat(59);
    const tooLong = 'a'.repeat(60);
    expect(parseForbiddenSubjects(longish)).toEqual([longish]);
    // 60 chars exactly is rejected (`length < 60`)
    expect(parseForbiddenSubjects(tooLong)).toEqual([]);
    // Mixed: short ones survive, long one dropped.
    expect(parseForbiddenSubjects(`pork, ${tooLong}, chicken`)).toEqual(['pork', 'chicken']);
  });
});

describe('scanForForbidden — substring match', () => {
  it('returns null for empty / null text', () => {
    expect(scanForForbidden(null, ['pork'])).toBeNull();
    expect(scanForForbidden(undefined, ['pork'])).toBeNull();
    expect(scanForForbidden('', ['pork'])).toBeNull();
  });

  it('returns null when denylist is empty', () => {
    expect(scanForForbidden('pork shoulder', [])).toBeNull();
  });

  it('returns the matched subject (lowercase) on a hit', () => {
    expect(scanForForbidden('Pork shoulder roast', ['pork'])).toBe('pork');
    expect(scanForForbidden('CHICKEN wings', ['chicken'])).toBe('chicken');
  });

  it('lowercases the haystack so mixed-case text still matches a lowercase denylist entry', () => {
    // Contract: denylist entries are expected lowercase (parseForbiddenSubjects
    // does that). scanForForbidden only lowercases the TEXT, not the
    // denylist — so callers must pre-normalise. This locks that contract.
    expect(scanForForbidden('Pork shoulder', ['pork'])).toBe('pork');
    expect(scanForForbidden('PORK', ['pork'])).toBe('pork');
    // Mixed-case denylist entries don't match lowercase text — caller bug,
    // but the function's behaviour is well-defined.
    expect(scanForForbidden('pork', ['Pork'])).toBeNull();
  });

  it('matches substrings (porkbelly hits "pork" — intentional, prevents compound-word evasion)', () => {
    expect(scanForForbidden('porkbelly tacos', ['pork'])).toBe('pork');
    expect(scanForForbidden('roastedchicken', ['chicken'])).toBe('chicken');
  });

  it('returns the FIRST matching subject (denylist order matters)', () => {
    const banned = ['pork', 'chicken', 'lamb'];
    expect(scanForForbidden('lamb pork chicken', banned)).toBe('pork');
    // Re-order denylist — different first match.
    expect(scanForForbidden('lamb pork chicken', ['chicken', 'pork', 'lamb'])).toBe('chicken');
  });

  it('returns null when no denylist item appears', () => {
    expect(scanForForbidden('beef brisket and ribs', ['pork', 'chicken'])).toBeNull();
  });

  it('Seamus regression: a brisket-only BBQ caption mentioning pork is caught', () => {
    const caption = 'Tomorrow we are smoking pork ribs as well as the usual brisket.';
    expect(scanForForbidden(caption, ['pork', 'chicken'])).toBe('pork');
  });
});

// ── DB-backed: loadForbiddenSubjects ──────────────────────────────────
// Mock the D1Database shape just enough to drive the two-tier UNION logic.

function makeMockEnv(opts: { userProfile?: any; clientProfile?: any; userError?: Error; clientError?: Error }) {
  // first() returns a Promise<{ profile: string | null } | null>
  const userFirst = vi.fn().mockImplementation(() => {
    if (opts.userError) return Promise.reject(opts.userError);
    return Promise.resolve(opts.userProfile === undefined ? null : { profile: opts.userProfile });
  });
  const clientFirst = vi.fn().mockImplementation(() => {
    if (opts.clientError) return Promise.reject(opts.clientError);
    return Promise.resolve(opts.clientProfile === undefined ? null : { profile: opts.clientProfile });
  });
  // route SELECT FROM users vs SELECT FROM clients to the right stub
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: () => ({
      first: sql.toLowerCase().includes('from users') ? userFirst : clientFirst,
    }),
  }));
  return { DB: { prepare } } as any;
}

describe('loadForbiddenSubjects — D1 lookup', () => {
  it('returns [] when both user and client profile are missing / null', async () => {
    const env = makeMockEnv({});
    const result = await loadForbiddenSubjects(env, 'user-1', null);
    expect(result).toEqual([]);
  });

  it('returns user-level denylist when only user has one', async () => {
    const env = makeMockEnv({
      userProfile: JSON.stringify({ forbiddenSubjects: 'porn, gambling' }),
    });
    const result = await loadForbiddenSubjects(env, 'user-1', null);
    expect(result.sort()).toEqual(['gambling', 'porn']);
  });

  it('UNIONs user + client denylists (deduplicated)', async () => {
    const env = makeMockEnv({
      userProfile: JSON.stringify({ forbiddenSubjects: 'porn, gambling' }),
      clientProfile: JSON.stringify({ forbiddenSubjects: 'pork, gambling' }),
    });
    const result = await loadForbiddenSubjects(env, 'user-1', 'client-1');
    expect(result.sort()).toEqual(['gambling', 'pork', 'porn']);
  });

  it('client-only denylist when user.profile is empty', async () => {
    const env = makeMockEnv({
      clientProfile: JSON.stringify({ forbiddenSubjects: 'pork, chicken' }),
    });
    const result = await loadForbiddenSubjects(env, 'user-1', 'client-1');
    expect(result.sort()).toEqual(['chicken', 'pork']);
  });

  it('client lookup is SKIPPED when clientId is null (no second DB read)', async () => {
    const env = makeMockEnv({
      userProfile: JSON.stringify({ forbiddenSubjects: 'porn' }),
      clientProfile: JSON.stringify({ forbiddenSubjects: 'should-not-appear' }),
    });
    const result = await loadForbiddenSubjects(env, 'user-1', null);
    expect(result).toEqual(['porn']);
    expect(result).not.toContain('should-not-appear');
  });

  it('malformed user profile JSON is swallowed, falls through to client tier', async () => {
    const env = makeMockEnv({
      userProfile: 'not json at all',
      clientProfile: JSON.stringify({ forbiddenSubjects: 'pork' }),
    });
    const result = await loadForbiddenSubjects(env, 'user-1', 'client-1');
    expect(result).toEqual(['pork']);
  });

  it('malformed client profile JSON is swallowed, user tier wins', async () => {
    const env = makeMockEnv({
      userProfile: JSON.stringify({ forbiddenSubjects: 'porn' }),
      clientProfile: '{{{garbage',
    });
    const result = await loadForbiddenSubjects(env, 'user-1', 'client-1');
    expect(result).toEqual(['porn']);
  });

  it('DB error on user lookup is logged + swallowed (never throws)', async () => {
    const env = makeMockEnv({ userError: new Error('D1 timeout') });
    const result = await loadForbiddenSubjects(env, 'user-1', null);
    expect(result).toEqual([]);
  });

  it('DB error on client lookup falls back to user-level subjects', async () => {
    const env = makeMockEnv({
      userProfile: JSON.stringify({ forbiddenSubjects: 'porn' }),
      clientError: new Error('connection reset'),
    });
    const result = await loadForbiddenSubjects(env, 'user-1', 'client-1');
    expect(result).toEqual(['porn']);
  });

  it('handles missing forbiddenSubjects key in profile JSON', async () => {
    const env = makeMockEnv({
      userProfile: JSON.stringify({ businessName: 'Bob', email: 'b@x.com' }),
    });
    const result = await loadForbiddenSubjects(env, 'user-1', null);
    expect(result).toEqual([]);
  });
});
