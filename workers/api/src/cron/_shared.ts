// Cross-cron shared constants + helpers.
//
// ACTIVE_CLIENT_FILTER — posts for on-hold clients must NEVER be claimed by
// any cron (publish, prewarm-images, prewarm-videos all use this). Append to
// a WHERE clause: ` AND ${ACTIVE_CLIENT_FILTER}` (no leading AND).
//
// This has been reverted twice in the past when the SQL was inline. Keep it
// named and centralised so any future cron query can include it explicitly.

import type { Env } from '../env';
import { decryptSocialTokensJson } from '../lib/social-tokens';

export const ACTIVE_CLIENT_FILTER =
  `(client_id IS NULL OR client_id NOT IN (SELECT id FROM clients WHERE status = 'on_hold'))`;

// The generic SocialAI publisher still resolves tokens through users/clients.
// Shop-owned rows need shopify_stores.social_tokens and must not be claimed
// here until that path exists.
export const NON_SHOP_OWNER_FILTER =
  `(COALESCE(owner_kind, 'user') != 'shop')`;

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
  /** Platform the row belongs to. schema_v24 added this column with
   *  DEFAULT 'facebook' so legacy rows backfill cleanly. */
  platform: string;
}

/** Normalise a posts.platform string ('Facebook', 'Instagram', etc., or
 *  undefined) to the lowercase token the rest of the postproxy code uses.
 *  Defaults to 'facebook' for legacy rows where posts.platform is NULL —
 *  matches the schema_v24 DEFAULT on postproxy_profiles.platform. */
export function normalizePostPlatform(raw: string | null | undefined): 'facebook' | 'instagram' {
  const s = (raw || '').toLowerCase();
  if (s === 'instagram' || s === 'ig') return 'instagram';
  return 'facebook';
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

  // ig-wire (schema_v24): the SELECTs now pull `platform` and the map
  // key is widened from `${userId}::${clientId??''}` to include the
  // platform suffix. A workspace can own both an FB and an IG row, and
  // lookupPostproxyMapping picks the right one based on posts.platform.
  // Don't filter by platform in the SQL — the same workspace may appear
  // in multiple posts on different platforms within a single tick.

  const queries: Promise<{ results: PostproxyMappingRow[] }>[] = [];

  if (ownerIds.size > 0) {
    queries.push(
      env.DB.prepare(
        `SELECT user_id, client_id, postproxy_profile_id, postproxy_placement_id,
                postproxy_group_id, fb_page_name, profile_status, platform
         FROM postproxy_profiles
         WHERE client_id IS NULL
           AND user_id IN (${Array.from(ownerIds, () => '?').join(',')})`,
      ).bind(...ownerIds).all<PostproxyMappingRow>(),
    );
  }
  if (tuples.size > 0) {
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
                postproxy_group_id, fb_page_name, profile_status, platform
         FROM postproxy_profiles WHERE ${orClauses}`,
      ).bind(...binds).all<PostproxyMappingRow>(),
    );
  }

  const allResults = await Promise.all(queries);
  for (const r of allResults) {
    for (const row of r.results ?? []) {
      // Defensive: rows from schema_v24-migrated D1s will have platform
      // set; pre-migration rows return NULL → normalise to 'facebook'.
      const plat = normalizePostPlatform(row.platform);
      const key = `${row.user_id}::${row.client_id ?? ''}::${plat}`;
      map.set(key, { ...row, platform: plat });
    }
  }
  return map;
}

/** Lookup helper paired with loadPostproxyMappingForPosts. Returns the
 *  mapping row for a post's workspace tuple + platform, or undefined when
 *  the workspace hasn't connected that platform yet. The `platform` arg
 *  defaults to 'facebook' so legacy callers that don't pass it get the
 *  same row they did pre-ig-wire (FB only).
 *
 *  Resolution order on miss-for-platform:
 *    1. Exact (workspace + platform) match — preferred
 *    2. Workspace + 'facebook' fallback — preserves byte-identical
 *       behaviour for posts where post.platform is NULL/legacy
 *    3. undefined — caller marks the post Missed with a reconnect prompt
 */
export function lookupPostproxyMapping(
  map: Map<string, PostproxyMappingRow>,
  post: { user_id?: string | null; client_id?: string | null; platform?: string | null },
  platform?: 'facebook' | 'instagram',
): PostproxyMappingRow | undefined {
  if (!post.user_id) return undefined;
  const plat = platform ?? normalizePostPlatform(post.platform);
  const tupleKey = `${post.user_id}::${post.client_id ?? ''}`;
  const exact = map.get(`${tupleKey}::${plat}`);
  if (exact) return exact;
  // Back-compat: for posts.platform=null or pre-schema_v24 rows, fall
  // back to the FB mapping. This keeps every existing FB workspace
  // publishing through the same code path it does today.
  if (plat !== 'facebook') return undefined;
  return map.get(`${tupleKey}::facebook`);
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

  // decryptSocialTokensJson handles both legacy plaintext and the v1
  // AES-GCM envelope transparently. Returns null on malformed/unrecoverable
  // values so a single bad row maps to "no entry in map" — the publish
  // cron then marks just that workspace's posts Missed with the standard
  // "Reconnect Facebook" message, same as the pre-encryption behaviour.
  const decrypts: Promise<void>[] = [];
  for (const r of clientRows.results ?? []) {
    decrypts.push((async () => {
      const t = await decryptSocialTokensJson<SocialTokens>(env, r.social_tokens);
      if (t) map.set(`c:${r.id}`, t);
    })());
  }
  for (const r of userRows.results ?? []) {
    decrypts.push((async () => {
      const t = await decryptSocialTokensJson<SocialTokens>(env, r.social_tokens);
      if (t) map.set(`u:${r.id}`, t);
    })());
  }
  await Promise.all(decrypts);

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

// ── AI disclosure suffix ────────────────────────────────────────────────
// Customer-readiness: Meta's Synthetic & Manipulated Media policy requires
// AI-generated images to be labelled. The customer is the publisher and
// theoretically liable, so we auto-append a small disclosure as the
// defensive default. The workspace can opt out via BusinessProfile.aiDisclosure
// = false — see frontend Settings → Content & Video toggle.
//
// Disclosure shape: a single leading middle-dot to visually break it off
// from the hashtag block, then the marker. Kept short + neutral so it
// doesn't dominate the caption. Appears AFTER hashtags (i.e. at the very
// end of the published body), so feed consumers see it last.
export const AI_DISCLOSURE_SUFFIX = ' · 🤖 Created with AI';

/**
 * Build the FB/IG publish caption for a post. Centralised here so the
 * cron publish path (cron/publish-missed.ts) and the manual publish-now
 * route (routes/postproxy.ts) produce byte-identical captions.
 *
 * Behaviour:
 *   1. Strip any trailing hashtags from `content` (idempotent — handles
 *      inline hashtags and double-appended cases).
 *   2. Append the canonical hashtag block (newline-newline separator)
 *      iff `hashtags.length > 0`.
 *   3. Append AI_DISCLOSURE_SUFFIX iff `hasImage` AND the workspace
 *      hasn't opted out via `aiDisclosure: false`.
 *
 * The disclosure is image-only by design — text-only posts get nothing.
 * That matches Meta's policy (the AI-content label is required when the
 * image is generated; the policy says nothing about AI-assisted captions).
 *
 * Default opt-in: undefined aiDisclosure → disclosure ON. False explicitly
 * opts out. This matches the BusinessProfile interface docs.
 */
export function buildPublishCaption(input: {
  content: string;
  hashtags: string[];
  hasImage: boolean;
  aiDisclosure?: boolean;
}): string {
  const { content, hashtags, hasImage, aiDisclosure } = input;
  const cleanContent = content.replace(/(\s+#\w+)+\s*$/, '').trim();
  const withHashtags = hashtags.length > 0
    ? `${cleanContent}\n\n${hashtags.join(' ')}`
    : cleanContent;
  // Disclosure is opt-out: undefined → true. Only append when the post has
  // an AI-generated image attached. Text-only posts never get it.
  const wantsDisclosure = hasImage && aiDisclosure !== false;
  return wantsDisclosure ? `${withHashtags}${AI_DISCLOSURE_SUFFIX}` : withHashtags;
}

/**
 * Look up the workspace's `aiDisclosure` preference from the profile JSON.
 * Two-tier resolution mirrors `loadForbiddenSubjects`:
 *
 *   - Client-level (clients.profile.aiDisclosure): per-workspace toggle
 *     captured in the agency UI. The client tier wins when set.
 *
 *   - User-level (users.profile.aiDisclosure): the owner's default. Falls
 *     back here when there's no client_id, OR when the client tier didn't
 *     set the field explicitly.
 *
 * Returns boolean | undefined. Undefined means "no preference set" — the
 * caller (buildPublishCaption) interprets that as the default-on policy.
 * Errors are swallowed + logged with the same rationale as
 * loadForbiddenSubjects: failing closed at the lookup would halt the cron
 * publish path entirely.
 */
export async function loadAiDisclosurePref(
  env: Env,
  userId: string,
  clientId?: string | null,
): Promise<boolean | undefined> {
  if (clientId) {
    try {
      const row = await env.DB
        .prepare('SELECT profile FROM clients WHERE id = ? AND user_id = ?')
        .bind(clientId, userId)
        .first<{ profile: string | null }>();
      if (row?.profile) {
        try {
          const parsed = JSON.parse(row.profile);
          if (typeof parsed?.aiDisclosure === 'boolean') return parsed.aiDisclosure;
        } catch { /* malformed JSON — fall through to user tier */ }
      }
    } catch (err) {
      console.warn(`[cron-shared] loadAiDisclosurePref client lookup failed for ${clientId}:`, err);
    }
  }
  try {
    const row = await env.DB
      .prepare('SELECT profile FROM users WHERE id = ?')
      .bind(userId)
      .first<{ profile: string | null }>();
    if (row?.profile) {
      try {
        const parsed = JSON.parse(row.profile);
        if (typeof parsed?.aiDisclosure === 'boolean') return parsed.aiDisclosure;
      } catch { /* malformed JSON — return undefined → default-on */ }
    }
  } catch (err) {
    console.warn(`[cron-shared] loadAiDisclosurePref user lookup failed for ${userId}:`, err);
  }
  return undefined;
}
