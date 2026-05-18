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
export type SocialTokens = {
  facebookPageId?: string;
  facebookPageAccessToken?: string;
  [k: string]: unknown;
};

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
