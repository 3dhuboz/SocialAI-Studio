/**
 * Unit tests for workers/api/src/lib/postproxy-facts.ts —
 * the Postproxy-flavoured client_facts refresher.
 *
 * Coverage:
 *   - Engagement formula (FB shape: impressions/clicks/likes)
 *   - refreshFactsViaPostproxy returns 'no mapping' error when there's no
 *     postproxy_profiles row
 *   - Empty-stats path skips the DELETE so prior facts survive
 *   - Happy path: builds own_post rows from /posts/stats response, comment
 *     rows from /posts/:id/comments, about row from /profiles/:id summary
 *   - Wipe is scoped to own_post + comment + about (photo rows survive)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Env } from '../env';
import { refreshFactsViaPostproxy, __test } from '../lib/postproxy-facts';

// ── In-memory D1 shim (mirrors the recommendations.test.ts pattern) ─────
type Row = Record<string, unknown>;
interface MiniDb {
  postproxy_profiles: Row[];
  posts: Row[];
  client_facts: Row[];
}

function makeDb(): MiniDb {
  return { postproxy_profiles: [], posts: [], client_facts: [] };
}

function makeD1(db: MiniDb): D1Database {
  function exec(sql: string, params: unknown[]): { changes: number; rows: Row[] } {
    const s = sql.replace(/\s+/g, ' ').trim();

    // ── postproxy_profiles reads ───────────────────────────────────────
    if (/^SELECT postproxy_profile_id, postproxy_placement_id, fb_page_name, profile_status FROM postproxy_profiles WHERE user_id = \? AND client_id IS NULL$/i.test(s)) {
      const [uid] = params as [string];
      const row = db.postproxy_profiles.find((r) => r.user_id === uid && r.client_id == null);
      return { changes: 0, rows: row ? [row] : [] };
    }
    if (/^SELECT postproxy_profile_id, postproxy_placement_id, fb_page_name, profile_status FROM postproxy_profiles WHERE user_id = \? AND client_id = \?$/i.test(s)) {
      const [uid, cid] = params as [string, string];
      const row = db.postproxy_profiles.find((r) => r.user_id === uid && r.client_id === cid);
      return { changes: 0, rows: row ? [row] : [] };
    }

    // ── posts: our DB-side captions for posts Postproxy published ─────
    if (/^SELECT id, content, hashtags, postproxy_post_id FROM posts WHERE user_id = \? AND COALESCE\(client_id,''\) = \? AND postproxy_post_id IS NOT NULL AND status = 'Posted' ORDER BY scheduled_for DESC LIMIT 50$/i.test(s)) {
      const [uid, cid] = params as [string, string];
      const rows = db.posts.filter((p) =>
        p.user_id === uid
        && (p.client_id || '') === cid
        && p.postproxy_post_id != null
        && p.status === 'Posted'
      ).map((p) => ({
        id: p.id, content: p.content, hashtags: p.hashtags, postproxy_post_id: p.postproxy_post_id,
      }));
      return { changes: 0, rows };
    }

    // ── client_facts wipes + writes ───────────────────────────────────
    if (/^DELETE FROM client_facts WHERE user_id = \? AND COALESCE\(client_id,''\) = \? AND fact_type IN \('own_post','comment','about'\)$/i.test(s)) {
      const [uid, cid] = params as [string, string];
      const before = db.client_facts.length;
      db.client_facts = db.client_facts.filter((f) => !(
        f.user_id === uid
        && (f.client_id || '') === cid
        && ['own_post', 'comment', 'about'].includes(f.fact_type as string)
      ));
      return { changes: before - db.client_facts.length, rows: [] };
    }

    if (/^INSERT OR IGNORE INTO client_facts \(user_id, client_id, fact_type, content, metadata, fb_id, engagement_score\) VALUES \(\?,\?,\?,\?,\?,\?,\?\)$/i.test(s)) {
      const [user_id, client_id, fact_type, content, metadata, fb_id, eng] = params;
      db.client_facts.push({ user_id, client_id, fact_type, content, metadata, fb_id, engagement_score: eng });
      return { changes: 1, rows: [] };
    }

    throw new Error(`MiniDb (postproxy-facts): unhandled SQL: ${s}`);
  }

  const prepare = (sql: string): D1PreparedStatement => {
    const stmt = {
      bind(...params: unknown[]) {
        return {
          async run() {
            const { changes } = exec(sql, params);
            return {
              success: true,
              meta: { changes, duration: 0, last_row_id: 0, rows_read: 0, rows_written: changes, changed_db: changes > 0, size_after: 0 },
            } as D1Result;
          },
          async first<T = Row>(): Promise<T | null> {
            const { rows } = exec(sql, params);
            return (rows[0] as T) ?? null;
          },
          async all<T = Row>(): Promise<D1Result<T>> {
            const { rows } = exec(sql, params);
            return {
              results: rows as T[],
              success: true,
              meta: { duration: 0, changes: 0, last_row_id: 0, rows_read: rows.length, rows_written: 0, changed_db: false, size_after: 0 },
            } as D1Result<T>;
          },
        };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return { prepare } as unknown as D1Database;
}

function makeEnv(db: MiniDb): Env {
  return {
    DB: makeD1(db),
    POSTPROXY_API_KEY: 'pp-test-key',
    POSTPROXY_BASE_URL: 'https://api.postproxy.dev/api',
  } as unknown as Env;
}

function mockFetchSequence(responses: Array<{ status?: number; body: unknown }>) {
  let i = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[i++];
    if (!r) throw new Error(`mockFetchSequence ran out of responses (call #${i})`);
    return {
      ok: (r.status ?? 200) < 300,
      status: r.status ?? 200,
      text: async () => JSON.stringify(r.body),
    };
  });
}

let db: MiniDb;
beforeEach(() => {
  db = makeDb();
  vi.restoreAllMocks();
});

// ── Engagement formula ──────────────────────────────────────────────────

describe('engagementFromFbStats', () => {
  it('weights clicks > likes and adds impressions / 100', () => {
    expect(__test.engagementFromFbStats({ impressions: 1000, likes: 10, clicks: 5 })).toBe(10 + 5 * 2 + 10);
    expect(__test.engagementFromFbStats({ impressions: 0, likes: 0, clicks: 0 })).toBe(0);
    expect(__test.engagementFromFbStats({ impressions: 500, likes: 0, clicks: 0 })).toBe(5);
  });

  it('tolerates missing/string fields by treating them as 0', () => {
    expect(__test.engagementFromFbStats({})).toBe(0);
    expect(__test.engagementFromFbStats({ impressions: 'foo' as any, likes: 3 })).toBe(3);
  });
});

// ── refreshFactsViaPostproxy ────────────────────────────────────────────

describe('refreshFactsViaPostproxy — guards', () => {
  it('returns error when there is no postproxy_profiles mapping', async () => {
    const env = makeEnv(db);
    const result = await refreshFactsViaPostproxy(env, 'user_a', null);
    expect(result.inserted).toBe(0);
    expect(result.errors[0]).toMatch(/No Postproxy profile/);
  });

  it('returns error when profile_status is not active', async () => {
    db.postproxy_profiles.push({
      user_id: 'user_a', client_id: null,
      postproxy_profile_id: 'prof_X', postproxy_placement_id: 'page_123',
      fb_page_name: 'My Page', profile_status: 'pending',
    });
    const env = makeEnv(db);
    const result = await refreshFactsViaPostproxy(env, 'user_a', null);
    expect(result.inserted).toBe(0);
    expect(result.errors[0]).toMatch(/status=pending/);
  });
});

describe('refreshFactsViaPostproxy — empty-stats path', () => {
  it('skips the DELETE when there are no posts (preserves prior facts)', async () => {
    db.postproxy_profiles.push({
      user_id: 'user_a', client_id: null,
      postproxy_profile_id: 'prof_X', postproxy_placement_id: 'page_123',
      fb_page_name: 'My Page', profile_status: 'active',
    });
    // Pre-seed an onboarding-magic photo fact + a stale own_post fact —
    // both should survive because the early-return skips the DELETE.
    db.client_facts.push(
      { user_id: 'user_a', client_id: null, fact_type: 'photo', content: 'old', fb_id: 'photo_1', engagement_score: 0 },
      { user_id: 'user_a', client_id: null, fact_type: 'own_post', content: 'stale post from before', fb_id: 'old_post', engagement_score: 5 },
    );
    const env = makeEnv(db);
    const result = await refreshFactsViaPostproxy(env, 'user_a', null);
    expect(result.skipped).toBe(true);
    expect(result.inserted).toBe(0);
    // Prior facts intact
    expect(db.client_facts.length).toBe(2);
  });
});

describe('refreshFactsViaPostproxy — happy path', () => {
  it('builds own_post + comment + about rows and wipes scoped fact_types only', async () => {
    db.postproxy_profiles.push({
      user_id: 'user_a', client_id: null,
      postproxy_profile_id: 'prof_X', postproxy_placement_id: 'page_123',
      fb_page_name: 'My Page', profile_status: 'active',
    });
    db.posts.push(
      { id: 'p1', user_id: 'user_a', client_id: null, content: 'Friday wrap — pulled pork on special!', hashtags: '#bbq', postproxy_post_id: 'pp_111', status: 'Posted' },
      { id: 'p2', user_id: 'user_a', client_id: null, content: 'Sunday roast slots opening Tuesday morning', hashtags: '', postproxy_post_id: 'pp_222', status: 'Posted' },
      // Should NOT be included — status != Posted
      { id: 'p3', user_id: 'user_a', client_id: null, content: 'draft caption', hashtags: '', postproxy_post_id: 'pp_333', status: 'Scheduled' },
    );
    // Pre-seed onboarding photo + onboarding event + a stale own_post — wipe
    // should remove the stale own_post but leave photo + event intact.
    db.client_facts.push(
      { user_id: 'user_a', client_id: null, fact_type: 'photo', content: 'on-brand bbq pit', fb_id: 'photo_1', engagement_score: 0 },
      { user_id: 'user_a', client_id: null, fact_type: 'event', content: 'old event', fb_id: 'evt_old', engagement_score: 0 },
      { user_id: 'user_a', client_id: null, fact_type: 'own_post', content: 'STALE', fb_id: 'old_post', engagement_score: 1 },
    );

    vi.stubGlobal('fetch', mockFetchSequence([
      // 1. getPostStats — both posts have stats
      { body: {
        data: {
          pp_111: { platforms: [{ profile_id: 'prof_X', platform: 'facebook', records: [{ stats: { impressions: 2000, likes: 25, clicks: 12 }, recorded_at: '2026-05-19T01:00:00Z' }] }] },
          pp_222: { platforms: [{ profile_id: 'prof_X', platform: 'facebook', records: [{ stats: { impressions: 800, likes: 8, clicks: 2 }, recorded_at: '2026-05-19T01:00:00Z' }] }] },
        },
      } },
      // 2. listPostComments for top-1 (pp_111 has higher eng) — return 2 comments
      { body: {
        total: 2, page: 1, per_page: 20,
        data: [
          { id: 'c1', body: 'Looks amazing, what time tomorrow?', like_count: 4, author_username: 'jane.doe' },
          { id: 'c2', body: 'short', like_count: 0, author_username: 'too.short' }, // filtered by length
        ],
      } },
      // 3. listPostComments for #2 (pp_222) — empty
      { body: { total: 0, data: [] } },
      // 4. getProfileWithLatestStats
      { body: {
        id: 'prof_X', name: 'My Page', platform: 'facebook', status: 'active',
        profile_group_id: 'grp_X', post_count: 12,
        summary_stats: { stats: { fan_count: 412, page_impressions: 9300 }, recorded_at: '2026-05-19T01:00:00Z' },
      } },
    ]));

    const result = await refreshFactsViaPostproxy(makeEnv(db), 'user_a', null);
    expect(result.skipped).toBeUndefined();
    expect(result.errors).toEqual([]);

    // Photo + event seed survived
    expect(db.client_facts.find((f) => f.fact_type === 'photo')).toBeTruthy();
    expect(db.client_facts.find((f) => f.fact_type === 'event')).toBeTruthy();
    // Stale own_post wiped + replaced
    expect(db.client_facts.find((f) => f.fb_id === 'old_post')).toBeFalsy();

    const ownPosts = db.client_facts.filter((f) => f.fact_type === 'own_post');
    expect(ownPosts).toHaveLength(2);
    const pp111 = ownPosts.find((f) => f.fb_id === 'pp_111')!;
    // Engagement = likes + clicks*2 + impressions/100 = 25 + 24 + 20 = 69
    expect(pp111.engagement_score).toBe(69);
    expect(pp111.content).toContain('pulled pork');
    expect(pp111.content).toContain('#bbq'); // hashtags appended

    const comments = db.client_facts.filter((f) => f.fact_type === 'comment');
    expect(comments).toHaveLength(1); // 'short' was length-filtered
    expect(comments[0].content).toBe('Looks amazing, what time tomorrow?');

    const aboutRow = db.client_facts.find((f) => f.fact_type === 'about');
    expect(aboutRow?.content).toContain('My Page');
    expect(aboutRow?.content).toContain('412');
    expect(aboutRow?.content).toContain('9300');
  });
});
