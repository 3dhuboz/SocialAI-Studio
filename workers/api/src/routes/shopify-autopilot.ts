// Shopify embedded-app: AI Autopilot batch generator.
//
// Backs the bulk content-calendar flow on the embedded app. The frontend
// plans the schedule client-side (it knows the merchant's local timezone,
// the vibe preset, and the synced product list), then calls the
// single-post endpoint below N times with concurrency-3 to fill the
// calendar in parallel.
//
// We deliberately keep the worker stateless across the batch — each
// /generate-one call is independent, so:
//   * a flaky LLM/image call on slot 4 doesn't kill slots 5–10
//   * the frontend can show real-time "3 of 10 generated" progress
//   * rate-limit pressure naturally throttles at the per-shop cap
//
// Endpoints:
//
//   POST /api/shopify/autopilot/generate-one
//     Body: { productId, platform, scheduledFor, tone? }
//     1. Re-uses composeProductPost() from shopify-compose.ts (caption + image)
//     2. Inserts a Scheduled post directly into the posts table with
//        owner_kind='shop', owner_id=<shopDomain>, status='Scheduled'
//        and the provided scheduledFor.
//     3. Returns the created post.
//
// Rate limit: 20/min per shop. Higher than the 10/min cap on /compose
// because the bulk gen does naturally space things out (3 parallel × 5–20s
// per call ≈ 9–60 sec per slot), but still bounded so a hostile retry
// can't blow through 100 posts a minute.
//
// Auth: session-token (Bearer). The shop domain is taken from the verified
// JWT, never from the body — a caller can't generate on behalf of another
// shop.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';
import { ensureShopSentinelUser } from '../lib/shopify-tenancy';
import { composeProductPost, ComposeError } from './shopify-compose';

const RATE_LIMIT_PER_MIN = 20;
const ALLOWED_PLATFORMS = new Set(['facebook', 'instagram', 'both']);
const ALLOWED_TONES = new Set(['friendly', 'professional', 'playful']);
const ALLOWED_POST_TYPES = new Set(['image', 'video']);

/** Default motion prompt for the Kling i2v cron. Specific enough to give
 *  Kling a recognisable visual goal without being so prescriptive that
 *  every product looks identical. The prewarm-videos cron already adds a
 *  generic "cinematic, smooth motion" fallback if this is omitted. */
const DEFAULT_MOTION_PROMPT =
  'cinematic product showcase, slow camera dolly forward, soft natural light, gentle subject rotation, premium tabletop staging';

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

// Look up the shop's active campaign (if any). Active = start_at <= now()
// AND (end_at IS NULL OR end_at >= now()). When present, its theme/goal
// is woven into the compose prompt so the generated post reflects the
// merchant's current marketing push.
//
// Tolerant of the campaigns table not existing yet — autopilot can ship
// independently of campaigns, and the catch below stops a missing table
// from blocking generation.
async function findActiveCampaignContext(env: Env, shop: string): Promise<string | null> {
  try {
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `SELECT name, goal, theme
         FROM shopify_campaigns
        WHERE shop_domain = ?
          AND start_at <= ?
          AND (end_at IS NULL OR end_at >= ?)
        ORDER BY created_at DESC
        LIMIT 1`,
    ).bind(shop, now, now).first<{ name: string; goal: string | null; theme: string | null }>();
    if (!row) return null;
    return [
      `Campaign name: ${row.name}`,
      row.goal ? `Goal: ${row.goal}` : null,
      row.theme ? `Theme: ${row.theme}` : null,
    ].filter(Boolean).join('\n');
  } catch {
    // Table doesn't exist or query failed — degrade silently.
    return null;
  }
}

export function registerShopifyAutopilotRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/shopify/autopilot/generate-one', async (c) => {
   // Outer try/catch: if anything escapes the per-stage error handling below
   // (e.g. an unexpected DB / image-gen / runtime error) Hono otherwise
   // returns a bare 500 with no body, which the frontend renders as the
   // useless "HTTP 500" string. This wrapper guarantees the merchant
   // sees the actual error message in the Autopilot failure list.
   try {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-autopilot:${shop}`, RATE_LIMIT_PER_MIN)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute' }, 429);
    }

    // Required by the FK constraint on posts.user_id → users(id). See
    // lib/shopify-tenancy.ts for the rationale. Idempotent — costs a D1
    // round-trip but only writes once per shop.
    await ensureShopSentinelUser(c.env, shop);

    const body = await c.req.json().catch(() => null) as {
      productId?: string;
      platform?: string;
      scheduledFor?: string;
      tone?: string;
      postType?: string;
      motionPrompt?: string;
      // dryRun=true → compose caption+image but DO NOT INSERT into posts. The
      // frontend uses this to build a review-before-accept queue: gather all
      // composed results in React state, let the merchant edit/delete, then
      // ship the surviving ones via POST /save-batch. Mirrors how the main
      // SocialAI Studio Smart Schedule works.
      dryRun?: boolean;
    } | null;
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

    const dryRun = body.dryRun === true;

    const productId = typeof body.productId === 'string' ? body.productId.trim() : '';
    if (!productId) return c.json({ error: 'productId is required' }, 400);

    const platform = body.platform || 'both';
    if (!ALLOWED_PLATFORMS.has(platform)) {
      return c.json({ error: `platform must be one of: ${[...ALLOWED_PLATFORMS].join(', ')}` }, 400);
    }

    const tone = body.tone || 'friendly';
    if (!ALLOWED_TONES.has(tone)) {
      return c.json({ error: `tone must be one of: ${[...ALLOWED_TONES].join(', ')}` }, 400);
    }

    const postType = body.postType || 'image';
    if (!ALLOWED_POST_TYPES.has(postType)) {
      return c.json({ error: `postType must be 'image' or 'video'` }, 400);
    }
    const motionPrompt = typeof body.motionPrompt === 'string' && body.motionPrompt.trim()
      ? body.motionPrompt.trim().slice(0, 500)
      : DEFAULT_MOTION_PROMPT;

    // scheduledFor must be an ISO string in the future. We refuse anything
    // > 60 days out to avoid persisting stale rows the cron will hit.
    const scheduledFor = typeof body.scheduledFor === 'string' ? body.scheduledFor : '';
    const scheduleMs = Date.parse(scheduledFor);
    if (!scheduleMs || Number.isNaN(scheduleMs)) {
      return c.json({ error: 'scheduledFor must be a valid ISO date string' }, 400);
    }
    if (scheduleMs < Date.now() - 60_000) {
      return c.json({ error: 'scheduledFor cannot be in the past' }, 400);
    }
    if (scheduleMs > Date.now() + 60 * 86_400_000) {
      return c.json({ error: 'scheduledFor cannot be more than 60 days out' }, 400);
    }

    // Look up active campaign for context (best-effort).
    const campaignContext = await findActiveCampaignContext(c.env, shop);

    let composed;
    try {
      composed = await composeProductPost(
        c.env, shop, productId,
        platform as 'facebook' | 'instagram' | 'both',
        tone as 'friendly' | 'professional' | 'playful',
        campaignContext || undefined,
      );
    } catch (err: any) {
      if (err instanceof ComposeError) {
        const code = err.stage === 'product' ? 404 : 502;
        return c.json({ stage: err.stage, error: err.message }, code);
      }
      console.error('[shopify-autopilot] unexpected:', String(err?.stack ?? err));
      return c.json({ error: String(err?.message ?? err).slice(0, 300) }, 500);
    }

    // Insert as Scheduled. Mirror shopify-posts.ts contract: write BOTH
    // legacy (user_id, client_id) AND tenant-abstracted (owner_kind, owner_id)
    // columns. user_id is the shop sentinel because the column is NOT NULL.
    //
    // For postType='video' we also set:
    //   post_type='video', video_status='pending', video_script=<motion>
    // which the prewarm-videos cron (runs every 5 min) picks up to fire
    // off Kling i2v generation against image_url as the thumbnail. When
    // the video lands the cron flips video_status to 'ready' and sets
    // video_url; publish-missed then ships it to FB via the Reels API.
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const scheduledIso = new Date(scheduleMs).toISOString();

    // Dry-run path: return composed data without persisting. Caller (frontend
    // preview flow) collects the result in React state, then calls
    // /save-batch when the merchant clicks Accept All.
    if (dryRun) {
      return c.json({
        id,                // client-side identity for the preview card
        status: 'Preview', // not yet a DB row
        caption: composed.caption,
        image_url: composed.imageUrl,
        platform,
        scheduled_for: scheduledIso,
        product: composed.product,
        campaign_used: !!campaignContext,
        post_type: postType,
        video_status: postType === 'video' ? 'pending' : null,
        motion_prompt: postType === 'video' ? motionPrompt : null,
      }, 200);
    }

    // Wrap the INSERT — if D1 throws (FK violation, NOT NULL, schema mismatch,
    // etc.) Hono's default handler returns a bare 500 with no body, which the
    // frontend renders as the useless "HTTP 500" string. With this catch, the
    // merchant sees the actual DB error.
    try {
      if (postType === 'video') {
        await c.env.DB.prepare(
          `INSERT INTO posts (
             id, user_id, client_id, owner_kind, owner_id,
             content, image_url, platform, status, scheduled_for, created_at,
             post_type, video_status, video_script
           )
           VALUES (?, ?, NULL, 'shop', ?, ?, ?, ?, 'Scheduled', ?, ?, 'video', 'pending', ?)`,
        ).bind(
          id, shop, shop,
          composed.caption,
          composed.imageUrl,   // serves as the thumbnail for Kling i2v
          platform,
          scheduledIso,
          nowIso,
          motionPrompt,
        ).run();
      } else {
        await c.env.DB.prepare(
          `INSERT INTO posts (id, user_id, client_id, owner_kind, owner_id, content, image_url, platform, status, scheduled_for, created_at)
           VALUES (?, ?, NULL, 'shop', ?, ?, ?, ?, 'Scheduled', ?, ?)`,
        ).bind(
          id, shop, shop,
          composed.caption,
          composed.imageUrl,
          platform,
          scheduledIso,
          nowIso,
        ).run();
      }
    } catch (err: any) {
      console.error('[shopify-autopilot] INSERT failed:', String(err?.stack ?? err));
      return c.json({
        stage: 'persist',
        error: `Database insert failed: ${String(err?.message ?? err).slice(0, 200)}`,
      }, 500);
    }

    return c.json({
      id,
      status: 'Scheduled',
      caption: composed.caption,
      image_url: composed.imageUrl,
      platform,
      scheduled_for: scheduledIso,
      product: composed.product,
      campaign_used: !!campaignContext,
      post_type: postType,
      video_status: postType === 'video' ? 'pending' : null,
    }, 201);
   } catch (err: any) {
    // Catch-all for anything that escaped the per-stage handlers above.
    // Logs the full stack but only returns the message (truncated) to the
    // caller so prompt-injection attempts can't echo arbitrary payloads.
    console.error('[shopify-autopilot] uncaught:', String(err?.stack ?? err));
    const msg = String(err?.message ?? err).slice(0, 300) || 'Unknown server error';
    return c.json({ stage: 'unknown', error: msg }, 500);
   }
  });

  // ── POST /api/shopify/autopilot/save-batch ─────────────────────────────
  //
  // Persists a batch of pre-composed posts that the merchant approved on the
  // Autopilot review screen. Body shape:
  //
  //   { posts: Array<{
  //       caption: string,
  //       imageUrl: string,
  //       platform: 'facebook' | 'instagram' | 'both',
  //       scheduledFor: string  // ISO
  //       postType?: 'image' | 'video',
  //       motionPrompt?: string,
  //     }>
  //   }
  //
  // Each row inserts independently — if one fails (FK, NOT NULL, bad input)
  // the others still land. Returns `{ saved: <ids[]>, failed: <{idx,error}[]> }`
  // so the frontend can show "11 of 14 saved" + flag the failing ones.
  //
  // Rate limit shares the per-shop bucket with /generate-one (20/min) since
  // a batch save is one user action. Cap batch size at 50 to keep a single
  // request bounded.
  app.post('/api/shopify/autopilot/save-batch', async (c) => {
    try {
      const sessionOrResp = await requireSession(c);
      if (sessionOrResp instanceof Response) return sessionOrResp;
      const shop = sessionOrResp.shopDomain;

      if (await isRateLimited(c.env.DB, `shopify-autopilot:${shop}`, RATE_LIMIT_PER_MIN)) {
        return c.json({ error: 'Rate limit exceeded — try again in a minute' }, 429);
      }

      await ensureShopSentinelUser(c.env, shop);

      const body = await c.req.json().catch(() => null) as {
        posts?: Array<{
          caption?: string;
          imageUrl?: string;
          platform?: string;
          scheduledFor?: string;
          postType?: string;
          motionPrompt?: string;
        }>;
      } | null;

      const posts = Array.isArray(body?.posts) ? body!.posts : null;
      if (!posts || posts.length === 0) {
        return c.json({ error: 'posts array is required' }, 400);
      }
      if (posts.length > 50) {
        return c.json({ error: 'Batch capped at 50 posts' }, 400);
      }

      const saved: string[] = [];
      const failed: Array<{ idx: number; error: string }> = [];
      const nowIso = new Date().toISOString();

      for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        try {
          const caption = typeof p.caption === 'string' ? p.caption : '';
          const imageUrl = typeof p.imageUrl === 'string' ? p.imageUrl : '';
          const platform = typeof p.platform === 'string' ? p.platform : '';
          const scheduledFor = typeof p.scheduledFor === 'string' ? p.scheduledFor : '';
          const postType = p.postType === 'video' ? 'video' : 'image';
          const motionPrompt = typeof p.motionPrompt === 'string' && p.motionPrompt.trim()
            ? p.motionPrompt.trim().slice(0, 500)
            : DEFAULT_MOTION_PROMPT;

          if (!caption.trim()) { failed.push({ idx: i, error: 'empty caption' }); continue; }
          if (!imageUrl)       { failed.push({ idx: i, error: 'missing imageUrl' }); continue; }
          if (!ALLOWED_PLATFORMS.has(platform)) { failed.push({ idx: i, error: 'bad platform' }); continue; }
          const ms = Date.parse(scheduledFor);
          if (!ms || Number.isNaN(ms))    { failed.push({ idx: i, error: 'bad scheduledFor' }); continue; }
          if (ms < Date.now() - 60_000)   { failed.push({ idx: i, error: 'scheduledFor in past' }); continue; }
          if (ms > Date.now() + 60 * 86_400_000) { failed.push({ idx: i, error: 'scheduledFor >60d' }); continue; }

          const id = crypto.randomUUID();
          const scheduledIso = new Date(ms).toISOString();

          if (postType === 'video') {
            await c.env.DB.prepare(
              `INSERT INTO posts (
                 id, user_id, client_id, owner_kind, owner_id,
                 content, image_url, platform, status, scheduled_for, created_at,
                 post_type, video_status, video_script
               )
               VALUES (?, ?, NULL, 'shop', ?, ?, ?, ?, 'Scheduled', ?, ?, 'video', 'pending', ?)`,
            ).bind(
              id, shop, shop,
              caption, imageUrl, platform, scheduledIso, nowIso, motionPrompt,
            ).run();
          } else {
            await c.env.DB.prepare(
              `INSERT INTO posts (id, user_id, client_id, owner_kind, owner_id, content, image_url, platform, status, scheduled_for, created_at)
               VALUES (?, ?, NULL, 'shop', ?, ?, ?, ?, 'Scheduled', ?, ?)`,
            ).bind(id, shop, shop, caption, imageUrl, platform, scheduledIso, nowIso).run();
          }
          saved.push(id);
        } catch (err: any) {
          console.error('[shopify-autopilot/save-batch] insert failed idx', i, String(err?.stack ?? err));
          failed.push({ idx: i, error: String(err?.message ?? err).slice(0, 200) });
        }
      }

      return c.json({ saved, failed });
    } catch (err: any) {
      console.error('[shopify-autopilot/save-batch] uncaught:', String(err?.stack ?? err));
      return c.json({ error: String(err?.message ?? err).slice(0, 300) || 'Unknown error' }, 500);
    }
  });
}
