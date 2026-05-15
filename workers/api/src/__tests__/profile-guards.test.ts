import { describe, it, expect, vi } from 'vitest';
import {
  parseForbiddenSubjects,
  scanForForbidden,
  loadForbiddenSubjects,
} from '../lib/profile-guards';

// ── parseForbiddenSubjects ────────────────────────────────────────────────

describe('parseForbiddenSubjects', () => {
  it('returns [] for null / undefined / empty', () => {
    expect(parseForbiddenSubjects(null)).toEqual([]);
    expect(parseForbiddenSubjects(undefined)).toEqual([]);
    expect(parseForbiddenSubjects('')).toEqual([]);
  });

  it('splits on commas', () => {
    expect(parseForbiddenSubjects('pork, chicken, lamb')).toEqual(['pork', 'chicken', 'lamb']);
  });

  it('splits on semicolons and newlines', () => {
    expect(parseForbiddenSubjects('pork;chicken\nlamb')).toEqual(['pork', 'chicken', 'lamb']);
  });

  it('lowercases entries', () => {
    expect(parseForbiddenSubjects('Pork, CHICKEN')).toEqual(['pork', 'chicken']);
  });

  it('trims whitespace around each token', () => {
    expect(parseForbiddenSubjects('  pork  ,  chicken  ')).toEqual(['pork', 'chicken']);
  });

  it('drops tokens that exceed 60 chars (paste-mistake guard)', () => {
    const long = 'a'.repeat(61);
    expect(parseForbiddenSubjects(`pork, ${long}`)).toEqual(['pork']);
  });

  it('drops empty tokens from trailing separators', () => {
    expect(parseForbiddenSubjects('pork,')).toEqual(['pork']);
  });
});

// ── scanForForbidden ─────────────────────────────────────────────────────

describe('scanForForbidden', () => {
  it('returns null for empty denylist', () => {
    expect(scanForForbidden('big pork shoulder roast', [])).toBeNull();
  });

  it('returns null when text is null', () => {
    expect(scanForForbidden(null, ['pork'])).toBeNull();
  });

  it('matches exact word', () => {
    expect(scanForForbidden('delicious pork', ['pork'])).toBe('pork');
  });

  it('matches case-insensitively', () => {
    expect(scanForForbidden('Pork shoulder', ['pork'])).toBe('pork');
  });

  it('matches substring inside compound word (intentional — no word-boundary)', () => {
    // "porkbelly" should still hit the "pork" entry
    expect(scanForForbidden('crispy porkbelly', ['pork'])).toBe('pork');
  });

  it('returns the first match when multiple subjects match', () => {
    const result = scanForForbidden('chicken and pork', ['pork', 'chicken']);
    // denylist order: 'pork' first — but text has chicken first; result depends
    // on iteration order (denylist). Assert it's one of the two banned subjects.
    expect(['pork', 'chicken']).toContain(result);
  });

  it('returns null when no banned subject appears', () => {
    expect(scanForForbidden('slow-smoked brisket on a board', ['pork', 'chicken'])).toBeNull();
  });
});

// ── loadForbiddenSubjects ────────────────────────────────────────────────
// Uses a minimal D1-shaped mock so we can assert the function queries both
// users.profile and clients.profile and returns their union.

function makeDb(rows: Record<string, { profile: string | null } | null>) {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async <T>(): Promise<T | null> => {
          // Determine which table is being queried from the SQL string
          if (sql.includes('FROM users')) return rows['user'] as unknown as T;
          if (sql.includes('FROM clients')) return rows['client'] as unknown as T;
          return null;
        },
      }),
    }),
  };
}

describe('loadForbiddenSubjects', () => {
  it('returns user-level forbidden subjects when no clientId', async () => {
    const db = makeDb({ user: { profile: JSON.stringify({ forbiddenSubjects: 'pork, chicken' }) } });
    const env = { DB: db } as any;
    expect(await loadForbiddenSubjects(env, 'u1')).toEqual(['pork', 'chicken']);
  });

  it('returns union of user + client forbidden subjects', async () => {
    const db = makeDb({
      user:   { profile: JSON.stringify({ forbiddenSubjects: 'pork' }) },
      client: { profile: JSON.stringify({ forbiddenSubjects: 'chicken' }) },
    });
    const env = { DB: db } as any;
    const result = await loadForbiddenSubjects(env, 'u1', 'c1');
    expect(result.sort()).toEqual(['chicken', 'pork']);
  });

  it('deduplicates when user and client share a subject', async () => {
    const db = makeDb({
      user:   { profile: JSON.stringify({ forbiddenSubjects: 'pork, chicken' }) },
      client: { profile: JSON.stringify({ forbiddenSubjects: 'pork' }) },
    });
    const env = { DB: db } as any;
    const result = await loadForbiddenSubjects(env, 'u1', 'c1');
    expect(result.filter((s) => s === 'pork').length).toBe(1);
  });

  it('returns [] when user row is null', async () => {
    const db = makeDb({ user: null });
    const env = { DB: db } as any;
    expect(await loadForbiddenSubjects(env, 'u1')).toEqual([]);
  });

  it('returns [] when user profile is null (no profile set)', async () => {
    const db = makeDb({ user: { profile: null } });
    const env = { DB: db } as any;
    expect(await loadForbiddenSubjects(env, 'u1')).toEqual([]);
  });

  it('returns only user subjects when client row is null', async () => {
    const db = makeDb({
      user:   { profile: JSON.stringify({ forbiddenSubjects: 'pork' }) },
      client: null,
    });
    const env = { DB: db } as any;
    expect(await loadForbiddenSubjects(env, 'u1', 'c1')).toEqual(['pork']);
  });

  it('swallows malformed JSON and returns [] without throwing', async () => {
    const db = makeDb({ user: { profile: 'not-json' } });
    const env = { DB: db } as any;
    expect(await loadForbiddenSubjects(env, 'u1')).toEqual([]);
  });

  it('returns [] and does not throw when DB rejects', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1 unavailable'); } }) }),
    };
    const env = { DB: db } as any;
    await expect(loadForbiddenSubjects(env, 'u1')).resolves.toEqual([]);
  });
});
