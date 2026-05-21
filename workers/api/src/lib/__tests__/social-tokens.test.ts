/**
 * Unit tests for lib/social-tokens.ts — the at-rest encryption helpers
 * for users.social_tokens / clients.social_tokens.
 *
 * These pin the "mixed plaintext + ciphertext fleet" behaviour we ship
 * during the lazy migration:
 *   - A row written before MASTER_ENCRYPTION_KEY existed is plain JSON.
 *     decryptSocialTokensJson must parse it transparently and return
 *     the same object the previous JSON.parse call would have.
 *   - A row written after the migration is a v1: AES-GCM envelope.
 *     decryptSocialTokensJson decrypts + parses it.
 *   - encrypt → decrypt must round-trip the original object byte-for-byte
 *     (so the cron's `tokens.facebookPageAccessToken` lookup keeps
 *     working post-encryption).
 *   - When MASTER_ENCRYPTION_KEY is unset, encryptSocialTokensJson
 *     stores plaintext (with a warning) so misconfigured deploys don't
 *     break installs — same posture as the Shopify side.
 *   - Decrypting plaintext when no key is configured still works (the
 *     legacy-row path doesn't need the key).
 *
 * Web Crypto (crypto.subtle.*) is available globally in Node 18+ and
 * in vitest's default environment, same as shopify-auth.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../../env';
import {
  decryptSocialTokensJson,
  encryptSocialTokensJson,
  scheduleSocialTokensReencrypt,
} from '../social-tokens';
import { encryptToken } from '../crypto';

// 32-byte hex key. Different per test run isn't necessary — these are
// unit tests; the key is purely fixture data, not a real secret.
const TEST_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function envWith(key?: string): Env {
  // Only the fields the helpers actually read. Cast through unknown to
  // keep TS happy — the helpers never touch DB / Clerk / etc.
  return { MASTER_ENCRYPTION_KEY: key, DB: {} as any } as unknown as Env;
}

const SAMPLE_TOKENS = {
  facebookPageId: '123456',
  facebookPageAccessToken: 'EAAG_test_token_xyz',
  facebookUserId: '987',
  instagramBusinessAccountId: 'ig_42',
  longLivedUserToken: 'EAAG_long_lived',
};

describe('decryptSocialTokensJson', () => {
  it('parses legacy plaintext JSON without needing a key', async () => {
    const env = envWith(); // no MASTER_ENCRYPTION_KEY
    const raw = JSON.stringify(SAMPLE_TOKENS);
    const out = await decryptSocialTokensJson<typeof SAMPLE_TOKENS>(env, raw);
    expect(out).toEqual(SAMPLE_TOKENS);
  });

  it('parses legacy plaintext JSON even when a key IS configured', async () => {
    // Mixed-fleet rollout: encrypted rows + legacy plaintext rows coexist
    // until every workspace has been touched by a write path. The helper
    // must transparently pass plaintext through when isEncrypted() is false.
    const env = envWith(TEST_KEY);
    const raw = JSON.stringify(SAMPLE_TOKENS);
    const out = await decryptSocialTokensJson<typeof SAMPLE_TOKENS>(env, raw);
    expect(out).toEqual(SAMPLE_TOKENS);
  });

  it('decrypts and parses a v1 AES-GCM envelope', async () => {
    const env = envWith(TEST_KEY);
    const ciphertext = await encryptToken(TEST_KEY, JSON.stringify(SAMPLE_TOKENS));
    expect(ciphertext.startsWith('v1:')).toBe(true);
    const out = await decryptSocialTokensJson<typeof SAMPLE_TOKENS>(env, ciphertext);
    expect(out).toEqual(SAMPLE_TOKENS);
  });

  it('returns null for null / empty / "{}" inputs without touching the cipher', async () => {
    const env = envWith(TEST_KEY);
    expect(await decryptSocialTokensJson(env, null)).toBeNull();
    expect(await decryptSocialTokensJson(env, '')).toBeNull();
    expect(await decryptSocialTokensJson(env, undefined)).toBeNull();
    // '{}' is the fb-platform deauthorize sentinel — must be treated as
    // "no tokens" without invoking the cipher (the cipher would either
    // refuse the missing v1 prefix or succeed-but-return '{}' anyway,
    // but skipping the call is cheaper and more obviously correct).
    expect(await decryptSocialTokensJson(env, '{}')).toBeNull();
  });

  it('returns null for malformed plaintext JSON (one bad row never crashes the batch)', async () => {
    const env = envWith(); // legacy fleet
    const out = await decryptSocialTokensJson(env, '{not valid json');
    expect(out).toBeNull();
  });

  it('returns null when ciphertext is present but no key is configured', async () => {
    // Misconfiguration scenario — secret rotated out from under us. We
    // can't return plaintext (we don't have it), so the caller sees
    // "no tokens connected" and routes the user to reconnect. console.error
    // is emitted so Steve can spot this in wrangler tail.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const env = envWith(); // no key
      const ciphertext = await encryptToken(TEST_KEY, JSON.stringify(SAMPLE_TOKENS));
      const out = await decryptSocialTokensJson(env, ciphertext);
      expect(out).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('returns null when ciphertext is valid format but auth tag fails (wrong key)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const wrongKey =
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      const env = envWith(wrongKey);
      const ciphertext = await encryptToken(TEST_KEY, JSON.stringify(SAMPLE_TOKENS));
      const out = await decryptSocialTokensJson(env, ciphertext);
      expect(out).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('encryptSocialTokensJson', () => {
  it('returns "{}" without encrypting empty / null objects (deauth sentinel preserved)', async () => {
    const env = envWith(TEST_KEY);
    expect(await encryptSocialTokensJson(env, null)).toBe('{}');
    expect(await encryptSocialTokensJson(env, undefined)).toBe('{}');
    expect(await encryptSocialTokensJson(env, {})).toBe('{}');
    // fb-platform.ts uses `WHERE social_tokens LIKE '%"facebookUserId":"..."%'`
    // to invalidate tokens on FB deauthorize. That LIKE pattern would never
    // match an encrypted '{}' blob (the v1: envelope has random IV bytes),
    // and the cron path would never see the deauthorize either. Keeping
    // '{}' as the literal sentinel preserves both behaviours.
  });

  it('produces a v1: ciphertext envelope when MASTER_ENCRYPTION_KEY is set', async () => {
    const env = envWith(TEST_KEY);
    const stored = await encryptSocialTokensJson(env, SAMPLE_TOKENS);
    expect(stored.startsWith('v1:')).toBe(true);
    // The stored string must NOT contain any plaintext token substring —
    // the whole point of at-rest encryption is that a D1 export reveals
    // nothing useful without the master key.
    expect(stored).not.toContain(SAMPLE_TOKENS.facebookPageAccessToken);
    expect(stored).not.toContain(SAMPLE_TOKENS.longLivedUserToken);
  });

  it('falls back to plaintext JSON when MASTER_ENCRYPTION_KEY is NOT set (with warning)', async () => {
    // This is the "local dev / misconfigured deploy" branch. We MUST keep
    // serving traffic — refusing to write because the key is missing
    // would brick the connect-Facebook flow for any deploy where the
    // secret wasn't wired up. A console.warn surfaces it in logs.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const env = envWith(); // no key
      const stored = await encryptSocialTokensJson(env, SAMPLE_TOKENS);
      // The stored value is exactly the JSON the legacy code would have
      // stored — so existing downstream readers (json_extract in old
      // queries, JSON.parse callers we haven't migrated yet) keep working.
      expect(stored).toBe(JSON.stringify(SAMPLE_TOKENS));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('MASTER_ENCRYPTION_KEY not set'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('round-trips: encrypt → decrypt returns the original object', async () => {
    const env = envWith(TEST_KEY);
    const stored = await encryptSocialTokensJson(env, SAMPLE_TOKENS);
    const out = await decryptSocialTokensJson<typeof SAMPLE_TOKENS>(env, stored);
    expect(out).toEqual(SAMPLE_TOKENS);
  });

  it('round-trips through plaintext fallback too (no-key install)', async () => {
    // When the key is unset we still need the read side to recover the
    // object — otherwise local dev / misconfigured deploys would have a
    // half-broken connect flow where writes succeed but reads return null.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const env = envWith();
      const stored = await encryptSocialTokensJson(env, SAMPLE_TOKENS);
      const out = await decryptSocialTokensJson<typeof SAMPLE_TOKENS>(env, stored);
      expect(out).toEqual(SAMPLE_TOKENS);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('produces different ciphertexts for identical plaintexts (random IV)', async () => {
    // AES-GCM ciphertext determinism is a vulnerability — the helper
    // must generate a fresh IV every call. encryptToken does this via
    // crypto.getRandomValues; we pin the property at the helper level
    // so a refactor that accidentally fixes the IV gets caught here.
    const env = envWith(TEST_KEY);
    const a = await encryptSocialTokensJson(env, SAMPLE_TOKENS);
    const b = await encryptSocialTokensJson(env, SAMPLE_TOKENS);
    expect(a).not.toBe(b);
  });
});

describe('scheduleSocialTokensReencrypt', () => {
  it('schedules a re-write when the row is plaintext and a key is configured', async () => {
    const ctxCalls: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { ctxCalls.push(p); } };
    const dbCalls: { sql: string; binds: unknown[] }[] = [];
    const env = {
      MASTER_ENCRYPTION_KEY: TEST_KEY,
      DB: {
        prepare: (sql: string) => ({
          bind: (...binds: unknown[]) => {
            dbCalls.push({ sql, binds });
            return { run: () => Promise.resolve({ success: true }) };
          },
        }),
      },
    } as unknown as Env;

    const plaintextRow = JSON.stringify(SAMPLE_TOKENS);
    scheduleSocialTokensReencrypt(env, ctx, { scope: 'users', id: 'u1' }, plaintextRow);
    // waitUntil was called with a promise; await it to drive the side-effect.
    expect(ctxCalls.length).toBe(1);
    await ctxCalls[0];

    expect(dbCalls.length).toBe(1);
    expect(dbCalls[0].sql).toContain('UPDATE users');
    expect(dbCalls[0].binds[1]).toBe('u1');
    // The bound value must be a v1: envelope, not the original plaintext.
    expect(String(dbCalls[0].binds[0]).startsWith('v1:')).toBe(true);
  });

  it('no-ops when the row is already encrypted (idempotent)', async () => {
    const ctxCalls: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { ctxCalls.push(p); } };
    const env = envWith(TEST_KEY);
    const ciphertext = await encryptToken(TEST_KEY, JSON.stringify(SAMPLE_TOKENS));
    scheduleSocialTokensReencrypt(env, ctx, { scope: 'users', id: 'u1' }, ciphertext);
    expect(ctxCalls.length).toBe(0);
  });

  it('no-ops when MASTER_ENCRYPTION_KEY is not set', async () => {
    // Re-writing plaintext as plaintext buys us nothing — skip.
    const ctxCalls: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { ctxCalls.push(p); } };
    const env = envWith();
    scheduleSocialTokensReencrypt(env, ctx, { scope: 'users', id: 'u1' }, JSON.stringify(SAMPLE_TOKENS));
    expect(ctxCalls.length).toBe(0);
  });

  it('no-ops when ctx is undefined (cron path)', async () => {
    // Crons run without an ExecutionContext. The helper must accept
    // that and silently no-op rather than throwing — the cron's
    // explicit re-encrypt happens on the refresh-tokens path instead.
    const env = envWith(TEST_KEY);
    expect(() => {
      scheduleSocialTokensReencrypt(env, undefined, { scope: 'users', id: 'u1' }, JSON.stringify(SAMPLE_TOKENS));
    }).not.toThrow();
  });

  it('no-ops on null / empty / "{}" rows', async () => {
    const ctxCalls: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { ctxCalls.push(p); } };
    const env = envWith(TEST_KEY);
    scheduleSocialTokensReencrypt(env, ctx, { scope: 'users', id: 'u1' }, null);
    scheduleSocialTokensReencrypt(env, ctx, { scope: 'users', id: 'u1' }, '');
    scheduleSocialTokensReencrypt(env, ctx, { scope: 'users', id: 'u1' }, '{}');
    expect(ctxCalls.length).toBe(0);
  });

  it('no-ops on malformed JSON (no UPDATE issued)', async () => {
    // If we can't parse the row, we can't encrypt it — and re-writing
    // garbage as v1: ciphertext would mask the underlying corruption.
    // Skip and let the next real write replace the row.
    const ctxCalls: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { ctxCalls.push(p); } };
    const dbCalls: { sql: string; binds: unknown[] }[] = [];
    const env = {
      MASTER_ENCRYPTION_KEY: TEST_KEY,
      DB: {
        prepare: (sql: string) => ({
          bind: (...binds: unknown[]) => {
            dbCalls.push({ sql, binds });
            return { run: () => Promise.resolve({ success: true }) };
          },
        }),
      },
    } as unknown as Env;
    scheduleSocialTokensReencrypt(env, ctx, { scope: 'users', id: 'u1' }, '{not valid json');
    expect(ctxCalls.length).toBe(0);
    expect(dbCalls.length).toBe(0);
  });

  it('updates the clients table when scope is clients', async () => {
    const ctxCalls: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { ctxCalls.push(p); } };
    const dbCalls: { sql: string; binds: unknown[] }[] = [];
    const env = {
      MASTER_ENCRYPTION_KEY: TEST_KEY,
      DB: {
        prepare: (sql: string) => ({
          bind: (...binds: unknown[]) => {
            dbCalls.push({ sql, binds });
            return { run: () => Promise.resolve({ success: true }) };
          },
        }),
      },
    } as unknown as Env;
    scheduleSocialTokensReencrypt(env, ctx, { scope: 'clients', id: 'c42' }, JSON.stringify(SAMPLE_TOKENS));
    await ctxCalls[0];
    expect(dbCalls[0].sql).toContain('UPDATE clients');
    expect(dbCalls[0].binds[1]).toBe('c42');
  });
});
