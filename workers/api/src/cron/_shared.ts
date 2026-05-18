// Cross-cron shared constants + helpers.
//
// ACTIVE_CLIENT_FILTER — posts for on-hold clients must NEVER be claimed by
// any cron (publish, prewarm-images, prewarm-videos all use this). Append to
// a WHERE clause: ` AND ${ACTIVE_CLIENT_FILTER}` (no leading AND).
//
// This has been reverted twice in the past when the SQL was inline. Keep it
// named and centralised so any future cron query can include it explicitly.

import type { Env } from '../env';

export const ACTIVE_CLIENT_FILTER =
  `(client_id IS NULL OR client_id NOT IN (SELECT id FROM clients WHERE status = 'on_hold'))`;

// Shape of the JSON blob stored in users.social_tokens / clients.social_tokens.
// Only the FB fields are typed because that's all the cron paths read — other
// platforms (IG, etc.) come along as `any` extras via the index signature.
//
// Postproxy fields (schema_v22, 2026-05): the worker-side mirror of the
// Postproxy mapping is loaded from postproxy_profiles, NOT from
// social_tokens — but a few legacy callsites still read them off this
// blob for migration-period compatibility. The Schema specialist owns
// the equivalent fields on the FRONTEND src/types.ts SocialTokens
// interface; this worker-side type is separate (cron-only) and is
// extended here so the cron path's lookup helper can type the mapping
// row without an `as any`.
export type SocialTokens = {
  facebookPageId?: string;
  facebookPageAccessToken?: string;
  /** Postproxy profile.id once OAuth completes; NULL pre-connect. */
  postproxyProfileId?: string;
  /** FB Page numeric id chosen via the placement-picker. */
  postproxyPlacementId?: string;
  /** Profile group the workspace lives in (per-workspace isolation). */
  postproxyGroupId?: string;
  [k: string]: unknown;
};

// ── Postproxy mapping batch loader (publish-missed cron) ─────────────────
// Mirrors loadSocialTokensForPosts: collapses what would otherwise be a
// per-post SELECT into 2 IN-list queries (one on user_id, one on the
// composite (user_id, client_id) pair for agency posts). Returns a Map
// keyed by `${userId}::${clientId??''}` so lookupPostproxyMapping can
// resolve a post in O(1).
//
// Only Active rows (profile_status NOT IN ('revoked','expired')) are
// returned — the publish cron uses the missing-mapping path to mark the
// post Missed with a reconnect-required reason, which is the correct
// behaviour for expired/revoked profiles too.

export interface PostproxyMappingRow {
  user_id: string;
  client_id: string | null;
  postproxy_profile_id: string | null;
  postproxy_placement_id: string | null;
  postproxy_group_id: string;
  fb_page_name: string | null;
  profile_status: string | null;
}

export async function loadPostproxyMappingForPosts<
  P extends { user_id?: string | null; client_id?: string | null }
>(env: Env, posts: P[]): Promise<Map<string, PostproxyMappingRow>> {
  const ownerIds = new Set<string>();
  const tuples = new Set<string>();
  for (const p of posts) {
    const uid = p.user_id;
    if (!uid) continue;
    if (p.client_id) tuples.add(`${uid}::${p.client_id}`);
    else ownerIds.add(uid);
  }

  const map = new Map<string, PostproxyMappingRow>();
  if (ownerIds.size === 0 && tuples.size === 0) return map;

  const queries: Promise<{ results: PostproxyMappingRow[] }>[] = [];

  if (ownerIds.size > 0) {
    queries.push(
      env.DB.prepare(
        `SELECT user_id, client_id, postproxy_profile_id, postproxy_placement_id,
                postproxy_group_id, fb_page_name, profile_status
         FROM postproxy_profiles
         WHERE client_id IS NULL
           AND user_id IN (${Array.from(ownerIds, () => '?').join(',')})`,
      ).bind(...ownerIds).all<PostproxyMappingRow>(),
    );
  }
  if (tuples.size > 0) {
    // SQLite supports OR-of-equality for composite IN; we expand each tuple
    // as `(user_id = ? AND client_id = ?)` joined by OR. For typical
    // publish batches (1-3 distinct workspaces) this stays tiny.
    const userIds: string[] = [];
    const clientIds: string[] = [];
    for (const t of tuples) {
      const [u, c] = t.split('::');
      userIds.push(u);
      clientIds.push(c);
    }
    const orClauses = userIds.map(() => '(user_id = ? AND client_id = ?)').join(' OR ');
    const binds: string[] = [];
    for (let i = 0; i < userIds.length; i++) {
      binds.push(userIds[i], clientIds[i]);
    }
    queries.push(
      env.DB.prepare(
        `SELECT user_id, client_id, postproxy_profile_id, postproxy_placement_id,
                postproxy_group_id, fb_page_name, profile_status
         FROM postproxy_profiles WHERE ${orClauses}`,
      ).bind(...binds).all<PostproxyMappingRow>(),
    );
  }

  const allResults = await Promise.all(queries);
  for (const r of allResults) {
    for (const row of r.results ?? []) {
      const key = `${row.user_id}::${row.client_id ?? ''}`;
      map.set(key, row);
    }
  }
  return map;
}

/** Lookup helper paired with loadPostproxyMappingForPosts. Returns the
 *  mapping row for a post's workspace tuple, or undefined when the
 *  workspace hasn't connected Postproxy yet. */
export function lookupPostproxyMapping(
  map: Map<string, PostproxyMappingRow>,
  post: { user_id?: string | null; client_id?: string | null },
): PostproxyMappingRow | undefined {
  if (!post.user_id) return undefined;
  const key = `${post.user_id}::${post.client_id ?? ''}`;
  return map.get(key);
}

// Batch-load social_tokens for a set of posts in (worst case) two queries
// instead of one per post.
//
// Pre-fix the publish-missed + poll-pending-reels crons did a per-row
// `SELECT social_tokens FROM (clients|users) WHERE id = ?` inside their main
// loops — N+1 against D1, paid even when most of the batch shares a few
// workspaces. For a typical 20-post publish tick that's up to 20 sequential
// round-trips to fetch what's almost always 1-3 distinct workspaces' tokens.
//
// This collapses to 2 IN-list queries (one on `clients`, one on `users`).
// Returns a Map keyed by `c:<clientId>` for client-scoped posts and
// `u:<userId>` for own-workspace posts. Use `lookupSocialTokens(map, post)`
// to read.
//
// Defensive JSON.parse — malformed tokens for one workspace map to `undefined`
// so a single corrupt row can't crash the whole batch loader. The caller then
// sees "no tokens" and marks just that workspace's posts Missed with the
// standard "Reconnect Facebook" message — better than the unhelpful
// "SyntaxError: Unexpected token..." the inline JSON.parse would emit
// before being caught by the per-post try/catch.
export async function loadSocialTokensForPosts<
  P extends { user_id?: string | null; client_id?: string | null }
>(env: Env, posts: P[]): Promise<Map<string, SocialTokens>> {
  const clientIds = new Set<string>();
  const userIds = new Set<string>();
  for (const p of posts) {
    if (p.client_id) clientIds.add(p.client_id);
    else if (p.user_id) userIds.add(p.user_id);
  }

  const map = new Map<string, SocialTokens>();
  const parse = (raw: string | null, key: string) => {
    if (!raw) return;
    try { map.set(key, JSON.parse(raw) as SocialTokens); }
    catch { /* malformed JSON for this workspace — treat as missing tokens */ }
  };

  // D1 supports parameterised IN lists via splat-bound placeholders. Run both
  // queries in parallel — they're against different tables, no contention.
  const [clientRows, userRows] = await Promise.all([
    clientIds.size > 0
      ? env.DB.prepare(
          `SELECT id, social_tokens FROM clients WHERE id IN (${Array.from(clientIds, () => '?').join(',')})`,
        ).bind(...clientIds).all<{ id: string; social_tokens: string | null }>()
      : Promise.resolve({ results: [] as { id: string; social_tokens: string | null }[] }),
    userIds.size > 0
      ? env.DB.prepare(
          `SELECT id, social_tokens FROM users WHERE id IN (${Array.from(userIds, () => '?').join(',')})`,
        ).bind(...userIds).all<{ id: string; social_tokens: string | null }>()
      : Promise.resolve({ results: [] as { id: string; social_tokens: string | null }[] }),
  ]);

  for (const r of clientRows.results ?? []) parse(r.social_tokens, `c:${r.id}`);
  for (const r of userRows.results ?? []) parse(r.social_tokens, `u:${r.id}`);

  return map;
}

// Read a post's tokens out of the map returned by loadSocialTokensForPosts.
// Returns undefined when the workspace has no tokens row OR the JSON was
// malformed — callers should treat the same as "no FB connected".
export function lookupSocialTokens(
  map: Map<string, SocialTokens>,
  post: { user_id?: string | null; client_id?: string | null },
): SocialTokens | undefined {
  if (post.client_id) return map.get(`c:${post.client_id}`);
  if (post.user_id) return map.get(`u:${post.user_id}`);
  return undefined;
}
