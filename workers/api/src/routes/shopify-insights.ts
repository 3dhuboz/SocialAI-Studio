// Shopify embedded-app: Page Insights endpoint.
//
// Mirrors what the main SocialAI Studio frontend computes via
// `getLivePageStats()` in src/services/facebookService.ts, but runs in the
// worker so the FB page access token never leaves D1. Returns three groups
// of data the embedded-app Insights page renders:
//
//   1. Page stats from FB Graph (when connected):
//      - fanCount, followersCount        — `/{pageId}?fields=fan_count,followers_count`
//      - reach28d, engagedUsers28d       — `/{pageId}/insights?metric=page_impressions_unique,page_engaged_users&period=days_28`
//      - interactions28d                 — fallback: sum of likes + comments + shares
//                                          across last 28 days of posts
//      - engagementRate                  — derived (% engaged / reach) or
//                                          (% interactions / followers) on fallback
//      - source: 'insights' | 'posts'    — which calculation path won
//
//   2. Post queue stats (always available, from D1):
//      - total, drafts, scheduled, posted, missed
//      - this_week (Scheduled posts within next 7 days)
//      - by_platform: { facebook, instagram, both }
//
//   3. Connection state:
//      - connected: boolean — facebookPageId + facebookPageAccessToken both set
//      - pageName: string | null
//      - instagramConnected: boolean
//
// Rate limit: 20 req/min per shop. Two outbound FB Graph calls per request
// (plus one fallback) — cheap individually but the merchant could refresh
// in a tight loop. 20/min is generous for a real user and stops abuse.
//
// `read_insights` permission: the FB JS SDK login scopes (in fb-sdk.ts)
// don't currently request it — that needs App Review. The insights call
// degrades gracefully to the post-derived fallback when permission is
// missing, so the page still shows a meaningful "interactions (28d)"
// metric even before review approval.
//
// AbortSignal.timeout(): every FB fetch is wrapped at 8s so a hanging
// Graph endpoint doesn't blow the worker's CPU budget. The page-level
// stats request is the only one that's hard-required; the others fall
// back gracefully on timeout.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';

const RATE_LIMIT_PER_MIN = 20;
const FB_TIMEOUT_MS = 8_000;
const FB_API_VERSION = 'v21.0';

// ── Helpers ────────────────────────────────────────────────────────────────

function requireShopifyConfig(env: Env): { key: string; secret: string } | null {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) return null;
  return { key: env.SHOPIFY_API_KEY, secret: env.SHOPIFY_API_SECRET };
}

async function requireSession(c: any): Promise<VerifiedSession | Response> {
  const cfg = requireShopifyConfig(c.env);
  if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);
  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const session = await verifySessionToken(auth.slice(7), cfg.key, cfg.secret);
  if (!session) return c.json({ error: 'Invalid session token' }, 401);
  return session;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── Response shape ─────────────────────────────────────────────────────────

export interface ShopifyInsightsResponse {
  connection: {
    connected: boolean;
    pageName: string | null;
    instagramConnected: boolean;
  };
  liveStats: {
    fanCount: number;
    followersCount: number;
    reach28d: number;
    engagedUsers28d: number;
    interactions28d: number;
    engagementRate: number;
    /** 'insights' when reach/engaged_users came from the Graph Insights API,
     *  'posts' when we fell back to deriving engagement from the last 28 days
     *  of post metrics. The UI uses this to switch the middle stat label from
     *  "reach" → "interactions" and surface a small "from posts" hint. */
    source: 'insights' | 'posts';
  } | null;
  posts: {
    total: number;
    drafts: number;
    scheduled: number;
    posted: number;
    missed: number;
    thisWeek: number;
    byPlatform: {
      facebook: number;
      instagram: number;
      both: number;
    };
  };
  fetchedAt: string;
}

// ── FB Graph fetch (with timeout + structured failure) ────────────────────

async function fbGet<T = any>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FB_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

// ── Live stats path ────────────────────────────────────────────────────────
// Direct port of getLivePageStats() from src/services/facebookService.ts.
// Keeping the maths identical so the Shopify "Insights" tab shows the same
// numbers a merchant would see if they connected the same FB Page on the
// main SocialAI Studio app.

async function fetchLiveStats(
  pageId: string,
  pageAccessToken: string,
): Promise<ShopifyInsightsResponse['liveStats']> {
  const base = `https://graph.facebook.com/${FB_API_VERSION}`;

  // Step 1 — page-level metadata (fan_count, followers_count). Required.
  const pageData = await fbGet<any>(
    `${base}/${encodeURIComponent(pageId)}?fields=fan_count,followers_count&access_token=${encodeURIComponent(pageAccessToken)}`,
  );

  if (!pageData || pageData.error) {
    // Token expired / page deleted / scopes revoked. The UI shows "0
    // followers" and recommends reconnecting — this is the same posture
    // the main app takes.
    return { fanCount: 0, followersCount: 0, reach28d: 0, engagedUsers28d: 0, interactions28d: 0, engagementRate: 0, source: 'insights' };
  }

  const fanCount = typeof pageData.fan_count === 'number' ? pageData.fan_count : 0;
  const followersCount = typeof pageData.followers_count === 'number' ? pageData.followers_count : fanCount;

  // Step 2 — try Insights API (needs read_insights, often missing pre-App-Review).
  let reach28d = 0;
  let engagedUsers28d = 0;
  const insightsData = await fbGet<any>(
    `${base}/${encodeURIComponent(pageId)}/insights?metric=page_impressions_unique,page_engaged_users&period=days_28&access_token=${encodeURIComponent(pageAccessToken)}`,
  );
  if (insightsData?.data && !insightsData.error) {
    for (const item of insightsData.data) {
      const val = item?.values?.[item.values.length - 1]?.value ?? 0;
      if (item?.name === 'page_impressions_unique') reach28d = typeof val === 'number' ? val : 0;
      if (item?.name === 'page_engaged_users') engagedUsers28d = typeof val === 'number' ? val : 0;
    }
  }

  // Step 3 — if Insights was empty, derive from posts (likes + comments*3 + shares*5
  // — same weighting as facebookService.ts in the main app). This is a less
  // precise signal but works without read_insights permission.
  let interactions28d = 0;
  let source: 'insights' | 'posts' = 'insights';

  if (reach28d === 0 && engagedUsers28d === 0) {
    source = 'posts';
    const since = Math.floor((Date.now() - 28 * 86_400_000) / 1000); // unix seconds
    const postsData = await fbGet<any>(
      `${base}/${encodeURIComponent(pageId)}/posts?fields=likes.summary(true),comments.summary(true),shares&since=${since}&limit=100&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    if (postsData?.data && !postsData.error) {
      for (const post of postsData.data) {
        const likes = post?.likes?.summary?.total_count || 0;
        const comments = post?.comments?.summary?.total_count || 0;
        const shares = post?.shares?.count || 0;
        interactions28d += likes + comments + shares;
      }
    }
  }

  // Engagement rate calculation — mirrors facebookService.ts exactly.
  // insights path:  engaged_users ÷ reach × 100
  // posts path:     interactions  ÷ followers × 100
  // Round to 1dp so the UI doesn't show noisy decimals.
  const engagementRate = source === 'insights'
    ? (reach28d > 0 ? Math.round((engagedUsers28d / reach28d) * 1000) / 10 : 0)
    : (followersCount > 0 ? Math.round((interactions28d / followersCount) * 1000) / 10 : 0);

  return { fanCount, followersCount, reach28d, engagedUsers28d, interactions28d, engagementRate, source };
}

// ── Post queue stats ──────────────────────────────────────────────────────
// Pulled from D1 — `owner_kind='shop' AND owner_id=<shopDomain>` per the
// tenant abstraction. Single SELECT walks every row once and increments
// counters in JS to keep the query plan trivial (a GROUP-BY-platform would
// need two passes — not worth it for a typical shop's volume).

async function fetchPostStats(env: Env, shopDomain: string): Promise<ShopifyInsightsResponse['posts']> {
  const rows = await env.DB.prepare(
    `SELECT status, platform, scheduled_for
       FROM posts
      WHERE owner_kind = 'shop' AND owner_id = ?`,
  ).bind(shopDomain).all<{ status: string; platform: string; scheduled_for: string | null }>();

  const out: ShopifyInsightsResponse['posts'] = {
    total: 0, drafts: 0, scheduled: 0, posted: 0, missed: 0, thisWeek: 0,
    byPlatform: { facebook: 0, instagram: 0, both: 0 },
  };

  const weekFromNow = Date.now() + 7 * 86_400_000;

  for (const r of rows.results || []) {
    out.total++;
    switch (r.status) {
      case 'Draft':     out.drafts++; break;
      case 'Scheduled': out.scheduled++; break;
      case 'Posted':    out.posted++; break;
      case 'Missed':    out.missed++; break;
    }
    // Platform tally — string from D1 isn't trusted, fall back gracefully.
    if (r.platform === 'facebook')   out.byPlatform.facebook++;
    else if (r.platform === 'instagram') out.byPlatform.instagram++;
    else if (r.platform === 'both')  out.byPlatform.both++;

    // "This week" = Scheduled with a date in the next 7 days. Drafts and
    // already-Posted don't count — the merchant cares about upcoming work.
    if (r.status === 'Scheduled' && r.scheduled_for) {
      const t = Date.parse(r.scheduled_for);
      if (!Number.isNaN(t) && t > Date.now() && t <= weekFromNow) out.thisWeek++;
    }
  }

  return out;
}

// ── Route registration ────────────────────────────────────────────────────

export function registerShopifyInsightsRoutes(app: Hono<{ Bindings: Env }>): void {
  // GET /api/shopify/insights
  //
  // Always returns 200 with a fully-populated payload. The UI distinguishes
  // "FB not connected" via `connection.connected === false` + `liveStats === null`,
  // not via HTTP status — this keeps the page renderable in every state.
  app.get('/api/shopify/insights', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-insights:${shop}`, RATE_LIMIT_PER_MIN)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    // Connection state + tokens
    const row = await c.env.DB.prepare(
      `SELECT social_tokens FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL`,
    ).bind(shop).first<{ social_tokens: string | null }>();

    let social: any = null;
    if (row?.social_tokens) {
      try { social = JSON.parse(row.social_tokens); } catch { social = null; }
    }
    const pageId = isNonEmptyString(social?.facebookPageId) ? social.facebookPageId : null;
    const pageToken = isNonEmptyString(social?.facebookPageAccessToken) ? social.facebookPageAccessToken : null;
    const connected = pageId !== null && pageToken !== null;

    const connection = {
      connected,
      pageName: typeof social?.facebookPageName === 'string' ? social.facebookPageName : null,
      instagramConnected: isNonEmptyString(social?.instagramBusinessAccountId),
    };

    // Run post stats + live stats in parallel — D1 query and FB fetch are
    // independent, and FB is the slow leg (8s timeout). No sense doing them
    // sequentially when the merchant is staring at a spinner.
    const [posts, liveStats] = await Promise.all([
      fetchPostStats(c.env, shop),
      connected ? fetchLiveStats(pageId!, pageToken!) : Promise.resolve(null),
    ]);

    const payload: ShopifyInsightsResponse = {
      connection,
      liveStats,
      posts,
      fetchedAt: new Date().toISOString(),
    };

    return c.json(payload);
  });
}
