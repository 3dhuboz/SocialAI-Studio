/**
 * Unit tests for workers/api/src/cron/_shared.ts — specifically the
 * loadSocialTokensForPosts + lookupSocialTokens batch helpers introduced
 * to collapse the publish-missed + poll-pending-reels crons' N+1 social
 * token lookups into 2 IN-list queries.
 *
 * Mocks env.DB.prepare(...).bind(...).all() and asserts:
 *   - empty input → zero DB calls
 *   - client-only / user-only batches → only the relevant table is hit
 *   - mixed batches → both tables hit in parallel
 *   - duplicate ids → deduplicated to a single bind
 *   - malformed JSON for one workspace → that workspace's tokens come
 *     back undefined; others succeed (single bad row can't crash the batch)
 *   - lookupSocialTokens prefers client_id when both are present,
 *     falls back to user_id, returns undefined for missing entries
 *
 * If you change the batch loader's query shape, expect these to fire.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadSocialTokensForPosts, lookupSocialTokens, type SocialTokens } from '../cron/_shared';

function makeDb(rows: { table: 'clients' | 'users'; id: string; social_tokens: string | null }[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: (...binds: unknown[]) => {
      calls.push({ sql, binds });
      return {
        all: () => {
          const lower = sql.toLowerCase();
          const want = lower.includes('from clients') ? 'clients' : 'users';
          const ids = new Set(binds.map(String));
          const results = rows
            .filter((r) => r.table === want && ids.has(r.id))
            .map((r) => ({ id: r.id, social_tokens: r.social_tokens }));
          return Promise.resolve({ results });
        },
      };
    },
  }));
  return { env: { DB: { prepare } } as any, calls, prepare };
}

const fbTokens = (pageId: string) =>
  JSON.stringify({ facebookPageId: pageId, facebookPageAccessToken: `tok-${pageId}` });

describe('loadSocialTokensForPosts', () => {
  it('makes zero DB calls when posts list is empty', async () => {
    const { env, prepare } = makeDb([]);
    const map = await loadSocialTokensForPosts(env, []);
    expect(map.size).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('hits only the clients table when every post has client_id', async () => {
    const { env, calls } = makeDb([
      { table: 'clients', id: 'c1', social_tokens: fbTokens('p1') },
      { table: 'clients', id: 'c2', social_tokens: fbTokens('p2') },
    ]);
    const map = await loadSocialTokensForPosts(env, [
      { user_id: 'u-ignored', client_id: 'c1' },
      { user_id: 'u-also-ignored', client_id: 'c2' },
    ]);
    expect(calls.length).toBe(1);
    expect(calls[0].sql.toLowerCase()).toContain('from clients');
    expect(map.get('c:c1')?.facebookPageId).toBe('p1');
    expect(map.get('c:c2')?.facebookPageId).toBe('p2');
  });

  it('hits only the users table when every post is own-workspace (no client_id)', async () => {
    const { env, calls } = makeDb([
      { table: 'users', id: 'u1', social_tokens: fbTokens('p1') },
    ]);
    const map = await loadSocialTokensForPosts(env, [
      { user_id: 'u1', client_id: null },
      { user_id: 'u1', client_id: null }, // duplicate
    ]);
    expect(calls.length).toBe(1);
    expect(calls[0].sql.toLowerCase()).toContain('from users');
    expect(map.get('u:u1')?.facebookPageId).toBe('p1');
  });

  it('hits both tables when batch is mixed (own-workspace + client posts)', async () => {
    const { env, calls } = makeDb([
      { table: 'clients', id: 'c1', social_tokens: fbTokens('p-c1') },
      { table: 'users', id: 'u1', social_tokens: fbTokens('p-u1') },
    ]);
    const map = await loadSocialTokensForPosts(env, [
      { user_id: 'u1', client_id: null },
      { user_id: 'u-unused', client_id: 'c1' },
    ]);
    expect(calls.length).toBe(2);
    const sqls = calls.map((c) => c.sql.toLowerCase()).sort();
    expect(sqls[0]).toContain('from clients');
    expect(sqls[1]).toContain('from users');
    expect(map.get('c:c1')?.facebookPageId).toBe('p-c1');
    expect(map.get('u:u1')?.facebookPageId).toBe('p-u1');
  });

  it('deduplicates repeated workspace ids — one placeholder per distinct id', async () => {
    const { env, calls } = makeDb([
      { table: 'clients', id: 'c1', social_tokens: fbTokens('p1') },
    ]);
    await loadSocialTokensForPosts(env, [
      { user_id: null, client_id: 'c1' },
      { user_id: null, client_id: 'c1' },
      { user_id: null, client_id: 'c1' },
    ]);
    expect(calls.length).toBe(1);
    expect(calls[0].binds).toEqual(['c1']); // dedup, not ['c1','c1','c1']
    expect((calls[0].sql.match(/\?/g) ?? []).length).toBe(1);
  });

  it('treats missing workspace rows as undefined (no entry in map)', async () => {
    const { env } = makeDb([]); // DB has no matching rows
    const map = await loadSocialTokensForPosts(env, [
      { user_id: 'u1', client_id: null },
      { user_id: null, client_id: 'c1' },
    ]);
    expect(map.size).toBe(0);
  });

  it('isolates malformed JSON to the single bad workspace', async () => {
    const { env } = makeDb([
      { table: 'clients', id: 'good', social_tokens: fbTokens('p-good') },
      { table: 'clients', id: 'bad', social_tokens: '{not valid json' },
      { table: 'clients', id: 'alsogood', social_tokens: fbTokens('p-also') },
    ]);
    const map = await loadSocialTokensForPosts(env, [
      { user_id: null, client_id: 'good' },
      { user_id: null, client_id: 'bad' },
      { user_id: null, client_id: 'alsogood' },
    ]);
    expect(map.get('c:good')?.facebookPageId).toBe('p-good');
    expect(map.get('c:bad')).toBeUndefined();
    expect(map.get('c:alsogood')?.facebookPageId).toBe('p-also');
  });

  it('treats null social_tokens column as missing (no parse attempt)', async () => {
    const { env } = makeDb([
      { table: 'users', id: 'u1', social_tokens: null },
    ]);
    const map = await loadSocialTokensForPosts(env, [{ user_id: 'u1', client_id: null }]);
    expect(map.get('u:u1')).toBeUndefined();
  });
});

describe('lookupSocialTokens', () => {
  const map = new Map<string, SocialTokens>([
    ['c:c1', { facebookPageId: 'pc1', facebookPageAccessToken: 'tc1' }],
    ['u:u1', { facebookPageId: 'pu1', facebookPageAccessToken: 'tu1' }],
  ]);

  it('returns client tokens when post has client_id (client wins over user_id)', () => {
    const t = lookupSocialTokens(map, { user_id: 'u-ignored', client_id: 'c1' });
    expect(t?.facebookPageId).toBe('pc1');
  });

  it('falls back to user tokens when client_id is null', () => {
    const t = lookupSocialTokens(map, { user_id: 'u1', client_id: null });
    expect(t?.facebookPageId).toBe('pu1');
  });

  it('returns undefined when neither id is present', () => {
    const t = lookupSocialTokens(map, { user_id: null, client_id: null });
    expect(t).toBeUndefined();
  });

  it('returns undefined when the requested id is not in the map', () => {
    const t = lookupSocialTokens(map, { user_id: 'u-missing', client_id: null });
    expect(t).toBeUndefined();
  });
});
