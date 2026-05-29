// Typed HTTP client for the Postproxy REST API.
//
// Postproxy (https://postproxy.dev) is the hosted publishing layer we're
// migrating onto in schema_v22 to retire direct FB Graph publishing. This
// module is the one place that knows the wire shape of every Postproxy
// endpoint — every callsite (routes/postproxy.ts, cron/publish-missed.ts,
// future Postproxy webhooks) goes through these functions, so a schema
// change at Postproxy is a one-file diff for us.
//
// Conventions:
//   - Every call carries the `Authorization: Bearer ${POSTPROXY_API_KEY}`
//     header. Set the secret with `wrangler secret put POSTPROXY_API_KEY`.
//   - 30-second AbortController timeout per request — Postproxy occasionally
//     hangs on cold starts and the publish cron has a 30s CPU budget;
//     bailing at the timeout boundary keeps the rest of the batch alive.
//   - Non-2xx responses throw `Error("Postproxy {method} {path} -> {status}:
//     {body slice}")`. Caller wraps in try/catch and maps to user-facing
//     error / Missed-post path.
//   - Default base URL is https://api.postproxy.dev/api; override via the
//     POSTPROXY_BASE_URL env var (used by staging + local-mock setups).
//
// Group-creation caveat: the spike found that POST /api/profile_groups
// returns 404 on the live tenant — group creation is dashboard-only at
// the moment. `ensureProfileGroup` works around this by listing groups
// and reusing the first matching (or any) group rather than creating
// one. Flagged as a P1 to revisit once Postproxy publishes POST docs.

import type { Env } from '../env';

// ── Public types ─────────────────────────────────────────────────────────

export interface PostproxyProfile {
  id: string;
  name: string;
  platform: string;
  status: 'pending' | 'active' | 'expired' | 'revoked';
  profile_group_id: string;
  expires_at?: string;
  post_count: number;
  avatar_url?: string;
}

export interface PostproxyPlacement {
  id: string;
  name: string;
}

export interface PostproxyCreatePostArgs {
  /** Postproxy profile id, e.g. "adUxm7" — NOT the FB Page ID. */
  profileId: string;
  /** Caption text, ≤2200 chars on FB. Caller is expected to truncate. */
  body: string;
  /** Public media URLs (R2 / fal). Order matters — first URL is the
   *  primary asset (image OR video) for the post. */
  media: string[];
  /** Post format. FB accepts 'post' or 'reel'. IG accepts 'post',
   *  'reel', or 'story' per docs §platform-parameters. */
  format: 'post' | 'reel' | 'story';
  /** FB Page numeric ID = the placement.id from /profiles/:id/placements.
   *  IGNORED for Instagram (IG has no placements — see docs §3299). */
  pageId: string;
  /** For reels only — Postproxy uses this as the Reel title. ≤60 chars. */
  title?: string;
  /** Target platform. Defaults to 'facebook' to preserve all existing
   *  call-site behaviour during the ig-wire rollout. Cron + routes pass
   *  this through; the lib decides which platforms.* block to emit. */
  platform?: 'facebook' | 'instagram';
  /** Instagram only — first comment posted after the image lands. Capped
   *  at 2196 chars per docs §post-create. Ignored for FB. */
  firstComment?: string;
}

export interface PostproxyPlatformStatus {
  platform: string;
  status: string;
  permalink: string | null;
  error: string | null;
  attempted_at: string | null;
  params: Record<string, unknown>;
}

export interface PostproxyPostStatus {
  id: string;
  status: string;
  draft: boolean;
  platforms: PostproxyPlatformStatus[];
}

// ── Shared fetch helper ──────────────────────────────────────────────────

function postproxyBase(env: Env): string {
  // Trim trailing slashes so callers can write `pfFetch(env, '/profiles')`
  // without doubling up. Empty / undefined falls back to the prod default.
  const raw = env.POSTPROXY_BASE_URL?.trim() || 'https://api.postproxy.dev/api';
  return raw.replace(/\/+$/, '');
}

/** Shared low-level fetch wrapper. Adds auth, JSON content-type, 30s
 *  timeout, and surfaces non-2xx as Error with the response body for
 *  triage. Returns parsed JSON. Exported so tests can monkey-patch but
 *  prefer the typed wrappers below in app code. */
async function pfFetch<T>(
  env: Env,
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = { method: 'GET' },
): Promise<T> {
  if (!env.POSTPROXY_API_KEY) {
    throw new Error('Postproxy: POSTPROXY_API_KEY env var is not configured');
  }
  const url = `${postproxyBase(env)}${path.startsWith('/') ? path : '/' + path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${env.POSTPROXY_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // Slice keeps logs bounded — a 5xx HTML page from a misbehaving
      // edge proxy can be huge and pollute log search. Branded as
      // "Upstream" so this string is safe to bubble to the UI without
      // leaking the third-party publisher's name.
      throw new Error(`Upstream ${init.method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    }
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Upstream ${init.method} ${path} -> non-JSON body: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── Profile groups ───────────────────────────────────────────────────────

interface ProfileGroupRow {
  id: string;
  name: string;
  profiles_count?: number;
}

/** Resolve (or return existing) a Postproxy profile_group for this
 *  workspace. The spike showed POST /api/profile_groups returns 404 on
 *  the live tenant — group creation is dashboard-only right now. Until
 *  Postproxy supports POST, we:
 *    1. List existing groups
 *    2. Return the first one matching `workspaceLabel` exactly
 *    3. Fall back to the first group in the list (the "Default" group)
 *
 *  Trade-off documented in lib comments above; mark as P1 to revisit when
 *  POST works. For single-tenant setups this is fine — every workspace
 *  shares the default group and isolation is enforced at the profile_id
 *  layer instead. */
export async function ensureProfileGroup(
  env: Env,
  workspaceLabel: string,
): Promise<{ id: string }> {
  const data = await pfFetch<{ data: ProfileGroupRow[] }>(env, '/profile_groups');
  const rows = data?.data ?? [];
  if (rows.length === 0) {
    throw new Error(
      'Postproxy: no profile_groups found on the account — create one in the Postproxy dashboard first',
    );
  }
  const exact = rows.find((g) => g.name === workspaceLabel);
  if (exact) return { id: exact.id };
  // Best-effort POST in case the dashboard later starts honouring it.
  try {
    const created = await pfFetch<{ id: string }>(env, '/profile_groups', {
      method: 'POST',
      body: { name: workspaceLabel },
    });
    if (created?.id) return { id: created.id };
  } catch {
    // Swallow — falling back to the default group below is the spike-blessed
    // workaround. Don't let a 404 here break the whole connect flow.
  }
  // Fall back to the first group on the account (typically "Default").
  return { id: rows[0].id };
}

/** Open an OAuth redirect URL for the given profile_group + platform.
 *  Postproxy returns a hosted-OAuth URL that the browser navigates to;
 *  Meta consent happens there, then Postproxy redirects to `redirectUrl`
 *  carrying our oauth_state nonce.
 *
 *  `platform` defaults to 'facebook' for back-compat — existing call
 *  sites that don't pass it get the same wire shape they did before
 *  ig-wire. The /api/postproxy/init-connection route will gain a
 *  `platform` body param in the follow-up routes PR. */
export async function initializeConnection(
  env: Env,
  groupId: string,
  redirectUrl: string,
  platform: 'facebook' | 'instagram' = 'facebook',
): Promise<{ url: string }> {
  const data = await pfFetch<{ url: string; success?: boolean }>(
    env,
    `/profile_groups/${encodeURIComponent(groupId)}/initialize_connection`,
    {
      method: 'POST',
      body: { platform, redirect_url: redirectUrl },
    },
  );
  if (!data?.url) {
    throw new Error('Postproxy initialize_connection: missing url in response');
  }
  return { url: data.url };
}

// ── Profiles + placements ────────────────────────────────────────────────

/** List Postproxy profiles, optionally filtered to one profile_group. The
 *  filter param is a convenience — if Postproxy ever rejects the
 *  `profile_group_id` query, we filter in-process. */
export async function listProfiles(
  env: Env,
  groupId?: string,
): Promise<PostproxyProfile[]> {
  const path = groupId
    ? `/profiles?profile_group_id=${encodeURIComponent(groupId)}`
    : '/profiles';
  const data = await pfFetch<{ data: PostproxyProfile[] }>(env, path);
  const rows = data?.data ?? [];
  if (!groupId) return rows;
  // Defensive: in case Postproxy ignores the query filter, narrow client-side.
  return rows.filter((p) => p.profile_group_id === groupId);
}

/** List placements (eligible FB Pages, etc.) for a connected profile.
 *  Postproxy requires the owning `profile_group_id` as a query param —
 *  without it, returns 404 "Not found. Make sure you pass the correct
 *  profile_group_id" (discovered live during PR #111 smoke test). */
export async function listPlacements(
  env: Env,
  profileId: string,
  groupId: string,
): Promise<PostproxyPlacement[]> {
  const data = await pfFetch<{ data: PostproxyPlacement[] }>(
    env,
    `/profiles/${encodeURIComponent(profileId)}/placements?profile_group_id=${encodeURIComponent(groupId)}`,
  );
  return data?.data ?? [];
}

// ── Posts ────────────────────────────────────────────────────────────────

/** Build the Postproxy /api/posts payload from our typed args.
 *  Exported for tests — production callers should use createPost.
 *
 *  Branches on `args.platform` (defaults to 'facebook' for back-compat):
 *    - facebook: emits `platforms.facebook = { format, page_id, title? }`.
 *      Existing call sites that don't pass `platform` get exactly the same
 *      wire shape they did before this change.
 *    - instagram: emits `platforms.instagram = { format, title?, first_comment? }`.
 *      No `page_id` — IG has no placements (docs §3299). */
export function buildCreatePostPayload(args: PostproxyCreatePostArgs): Record<string, unknown> {
  const platform = args.platform ?? 'facebook';
  const block: Record<string, unknown> = {
    format: args.format,
  };
  if (platform === 'facebook') {
    block.page_id = args.pageId;
  }
  if (args.format === 'reel' && args.title) {
    // Reels require a title — Postproxy passes this through as the Reel
    // title. Cap at 60 chars (Meta's hard limit, applies to both FB Reels
    // and IG Reels).
    block.title = args.title.slice(0, 60);
  }
  if (platform === 'instagram' && args.firstComment) {
    // IG first_comment auto-posts as a comment after publish. Cap at 2196
    // chars per docs §post-create. Ignored for FB.
    block.first_comment = args.firstComment.slice(0, 2196);
  }
  return {
    post: {
      body: args.body,
      draft: false,
    },
    profiles: [args.profileId],
    media: args.media,
    platforms: { [platform]: block },
  };
}

/** Create + publish a post in one shot. Caller persists the returned
 *  `id` to posts.postproxy_post_id and flips status to 'Publishing';
 *  Postproxy then takes over the upload + delivery, with status arriving
 *  via the webhook. */
export async function createPost(
  env: Env,
  args: PostproxyCreatePostArgs,
): Promise<{ id: string; status: string }> {
  const body = buildCreatePostPayload(args);
  const data = await pfFetch<{ id: string; status: string }>(env, '/posts', {
    method: 'POST',
    body,
  });
  if (!data?.id) {
    throw new Error('Postproxy createPost: missing id in response');
  }
  return { id: data.id, status: data.status };
}

/** Fetch a post's current status. Used by ops tooling + as a recovery
 *  poll if a webhook is missed. Cron does NOT poll on the happy path. */
export async function getPost(
  env: Env,
  postId: string,
  groupId?: string | null,
): Promise<PostproxyPostStatus> {
  const suffix = groupId ? `?profile_group_id=${encodeURIComponent(groupId)}` : '';
  return pfFetch<PostproxyPostStatus>(env, `/posts/${encodeURIComponent(postId)}${suffix}`);
}

// ── Stats + comments (powers refresh-facts via Postproxy) ───────────────

/** Per-platform stats snapshot for one post. Field shape varies by platform
 *  — FB returns `impressions/clicks/likes`, IG returns
 *  `impressions/likes/comments/saved/profile_visits/follows`, etc. We keep
 *  the typed value loose so we don't have to maintain a platform-by-platform
 *  union — the cron consumer reads only the fields it knows about. */
export interface PostproxyStatsSnapshot {
  stats: Record<string, number | string>;
  recorded_at?: string;
}

export interface PostproxyPostPlatformStats {
  profile_id: string;
  platform: string;
  records: PostproxyStatsSnapshot[];
}

export interface PostproxyPostStatsResponse {
  data: Record<string, { platforms: PostproxyPostPlatformStats[] }>;
}

export interface PostproxyProfileWithStats extends PostproxyProfile {
  latest_stats?: Array<{
    placement_id: string | null;
    stats: Record<string, number | string>;
    recorded_at?: string;
  }>;
  summary_stats?: {
    stats: Record<string, number | string>;
    recorded_at?: string;
  } | null;
}

export interface PostproxyComment {
  id: string;
  body: string;
  like_count: number;
  author_username?: string | null;
  posted_at?: string | null;
}

export interface PostproxyCommentsResponse {
  total?: number;
  page?: number;
  per_page?: number;
  data: PostproxyComment[];
}

/** Fetch per-post engagement snapshots from Postproxy. Postproxy caps the
 *  request at 50 post IDs per call (docs §post-stats), so the caller is
 *  expected to chunk. We throw a clear error instead of silently truncating
 *  to help diagnose batch-size mistakes upstream. */
export async function getPostStats(
  env: Env,
  postIds: string[],
  opts: { profiles?: string; from?: string; to?: string } = {},
): Promise<PostproxyPostStatsResponse> {
  if (postIds.length === 0) {
    return { data: {} };
  }
  if (postIds.length > 50) {
    throw new Error(`Postproxy getPostStats: max 50 post IDs per call (got ${postIds.length}); caller must chunk`);
  }
  const params = new URLSearchParams();
  params.set('post_ids', postIds.join(','));
  if (opts.profiles) params.set('profiles', opts.profiles);
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  return pfFetch<PostproxyPostStatsResponse>(env, `/posts/stats?${params.toString()}`);
}

/** Fetch profile + latest_stats + summary_stats. Used by the facts cron to
 *  build the `about` row (fan_count from `summary_stats`). */
export async function getProfileWithLatestStats(
  env: Env,
  profileId: string,
): Promise<PostproxyProfileWithStats> {
  return pfFetch<PostproxyProfileWithStats>(env, `/profiles/${encodeURIComponent(profileId)}`);
}

/** List comments on a published post. Used by the facts cron to mine real
 *  customer voice for the `comment` fact_type. Postproxy requires the
 *  owning `profile_id` as a query param (analogous to listPlacements). */
export async function listPostComments(
  env: Env,
  postId: string,
  profileId: string,
  opts: { page?: number; perPage?: number } = {},
): Promise<PostproxyCommentsResponse> {
  const params = new URLSearchParams();
  params.set('profile_id', profileId);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.perPage) params.set('per_page', String(opts.perPage));
  const data = await pfFetch<PostproxyCommentsResponse | { data?: PostproxyComment[] }>(
    env,
    `/posts/${encodeURIComponent(postId)}/comments?${params.toString()}`,
  );
  return { data: (data as any)?.data ?? [], ...(data as any) };
}
