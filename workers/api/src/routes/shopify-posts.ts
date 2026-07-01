// Shopify embedded-app post storage + publish flow.
//
// Phase 2 of the Shopify embedded app. Mirrors the Clerk-user posts CRUD in
// routes/posts.ts but scoped to a Shopify shop instead of a Clerk uid.
// Authentication is session-token (JWT) only — every request must carry
// `Authorization: Bearer <session token>` from App Bridge.
//
//   POST   /api/shopify/posts             — create a draft for the current shop
//   GET    /api/shopify/posts             — list shop's posts (optional ?status)
//   PATCH  /api/shopify/posts/:id         — edit a Draft (content/image/schedule/status)
//   DELETE /api/shopify/posts/:id         — delete (Draft or Scheduled only; not Posted)
//   POST   /api/shopify/posts/:id/publish-now — force a Draft or Missed post into the queue immediately
//
// ── Tenant isolation ──────────────────────────────────────────────────────
// Every query scopes by `owner_kind='shop' AND owner_id=?` (the verified
// shop domain from the session token). The shop NEVER receives or modifies
// any other shop's posts; the JWT signature is the only source of authority
// for `shop` (we never trust a body/query param).
//
// ── Posts table contract ──────────────────────────────────────────────────
// Per TENANT_ABSTRACTION.md (schema_v20), new code MUST write BOTH legacy
// columns (user_id, client_id) AND new owner_kind/owner_id columns. For
// shop-owned posts:
//   user_id   = shopDomain  (sentinel — posts.user_id is NOT NULL today)
//   client_id = NULL
//   owner_kind = 'shop'
//   owner_id   = shopDomain
// A follow-up schema migration will relax user_id's NOT NULL constraint and
// drop the sentinel pattern.
//
// product_id from the request body is intentionally NOT persisted — there is
// no posts column to hold it (no `metadata` JSON column today). When the
// composer needs to remember which product a post came from, add a
// posts.metadata or shopify_post_products column in schema_v23.
//
// ── Shopify publish scope ──────────────────────────────────────────────────
// Shop-owned scheduling now flows through the shared publish cron using
// `owner_kind='shop'` rows plus `shopify_stores.social_tokens`.
//
// Current supported surface:
//   - Facebook Page scheduling and publish-now
//   - shop-owned token loading through shopify_stores
//   - denylist checks through loadForbiddenSubjectsForShop
//
// Deliberately unsupported for the App Store slice:
//   - Instagram-only publishing
//   - combined Facebook + Instagram fan-out from a single shop-owned row
//
// Unsupported platform requests are rejected here and non-Facebook shop rows
// are marked Missed by the publish cron with an actionable reason.
//
// ── Rate limiting ─────────────────────────────────────────────────────────
// 60 req/min per shop on every endpoint. Key: `shopify-posts:<shop>`.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';
import { ensureShopSentinelUser } from '../lib/shopify-tenancy';
import { requireActiveShopSubscription } from '../lib/shopify-billing';
import { isShopConnected } from '../lib/connection-check';
import { buildCritiqueInvalidationPatch } from '../lib/post-critique';

// Match the OAuth route — keep both files in sync if the limit changes.
const RATE_LIMIT_PER_MIN = 60;

// Shopify scheduled publishing is currently constrained to Facebook Page
// delivery for shop-owned posts. We still validate the incoming platform
// explicitly instead of trusting raw body values.
const SUPPORTED_SHOP_PLATFORM = 'facebook';

// Status transitions allowed on PATCH. Anything else is rejected with 400.
const ALLOWED_PATCH_STATUSES = new Set(['Draft', 'Scheduled']);

function unsupportedPlatformResponse(c: any) {
  return c.json({
    error: 'Shopify scheduled publishing currently supports Facebook Page delivery only.',
    code: 'UNSUPPORTED_PLATFORM',
    supported_platform: SUPPORTED_SHOP_PLATFORM,
  }, 409);
}

function isSupportedShopPlatform(platform: string | null | undefined): boolean {
  return (platform || '').toLowerCase() === SUPPORTED_SHOP_PLATFORM;
}

async function requireConnectedFacebook(c: any, shop: string): Promise<Response | null> {
  const connected = await isShopConnected(c.env, shop, 'facebook');
  if (connected) return null;
  return c.json({
    error: 'Facebook not connected for this shop. Connect your Facebook Page in Settings before scheduling posts.',
    code: 'NOT_CONNECTED',
    platform: 'facebook',
  }, 409);
}

// requireSession — mirrors the pattern in routes/shopify-oauth.ts. Returns
// either a VerifiedSession (auth passed) or a Response (already-built error).
// Caller does `instanceof Response` to fan-out.
//
// Kept private to this file because the spec forbids exporting a shared
// helper from lib/ (lib is owned by the OAuth agent). Duplication here is
// 8 lines and changes very rarely.
async function requireSession(c: any): Promise<VerifiedSession | Response> {
  if (!c.env.SHOPIFY_API_KEY || !c.env.SHOPIFY_API_SECRET) {
    return c.json({ error: 'Shopify app not configured' }, 500);
  }
  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const session = await verifySessionToken(auth.slice(7), c.env.SHOPIFY_API_KEY, c.env.SHOPIFY_API_SECRET);
  if (!session) return c.json({ error: 'Invalid session token' }, 401);
  return session;
}

// Common gate — auth + per-shop rate limit. Returns either the verified
// shop domain or a Response (already-built error response to return).
async function gate(c: any): Promise<string | Response> {
  const sessionOrResp = await requireSession(c);
  if (sessionOrResp instanceof Response) return sessionOrResp;
  const shop = sessionOrResp.shopDomain;
  if (await isRateLimited(c.env.DB, `shopify-posts:${shop}`, RATE_LIMIT_PER_MIN)) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }
  return shop;
}

async function requireBilling(c: any, shop: string): Promise<Response | null> {
  const billing = await requireActiveShopSubscription(c.env, shop);
  if (billing.ok) return null;
  return c.json({ error: billing.message, code: billing.code }, billing.status);
}

// Narrow type for the row shape we return on GET. We hand-pick columns so
// callers (the embedded app calendar / composer) don't accidentally see
// columns reserved for the Clerk-user pipeline (e.g. late_post_id).
// video_* + image_critique_* ARE exposed — the Shopify Calendar needs them
// to render Reel chips and AI-quality badges.
interface ShopPostRow {
  id: string;
  content: string | null;
  image_url: string | null;
  platform: string | null;
  status: string | null;
  scheduled_for: string | null;
  created_at: string | null;
  // Reel fields (autopilot can schedule video posts; calendar needs to render
  // them differently from images).
  post_type: string | null;       // 'image' | 'video' | 'reel'
  video_url: string | null;       // R2-hosted URL after prewarm-videos cron
  video_status: string | null;    // 'pending' | 'ready' | 'failed'
  // Image critique fields (lets the calendar show "AI 8/10" badges).
  image_critique_score: number | null;       // 0-10
  image_critique_reasoning: string | null;
}

export function registerShopifyPostsRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── POST /api/shopify/posts ──────────────────────────────────────────
  // Create a Draft post for the current shop.
    // Body: { content, image_url?, platform: 'facebook',
  //         product_id? (currently dropped — no column for it yet) }
  // Always status='Draft', scheduled_for=NULL on create. To schedule, the
  // merchant PATCHes the row.
  app.post('/api/shopify/posts', async (c) => {
    const shopOrResp = await gate(c);
    if (shopOrResp instanceof Response) return shopOrResp;
    const shop = shopOrResp;
    const billingResp = await requireBilling(c, shop);
    if (billingResp) return billingResp;

    let body: { content?: unknown; image_url?: unknown; platform?: unknown; product_id?: unknown };
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const content = typeof body.content === 'string' ? body.content : '';
    if (!content.trim()) return c.json({ error: 'content is required' }, 400);

    const imageUrl = typeof body.image_url === 'string' && body.image_url ? body.image_url : null;
    const platform = typeof body.platform === 'string' ? body.platform : '';
    if (!isSupportedShopPlatform(platform)) {
      return unsupportedPlatformResponse(c);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Required by the FK constraint on posts.user_id → users(id). See
    // lib/shopify-tenancy.ts for the rationale. Idempotent — no-op when the
    // sentinel already exists.
    await ensureShopSentinelUser(c.env, shop);

    // Write BOTH legacy + tri-tenant columns (TENANT_ABSTRACTION.md contract).
    // user_id is the shop domain sentinel because the column is NOT NULL today.
    await c.env.DB.prepare(
      `INSERT INTO posts (id, user_id, client_id, owner_kind, owner_id, content, image_url, platform, status, scheduled_for, created_at)
       VALUES (?, ?, NULL, 'shop', ?, ?, ?, ?, 'Draft', NULL, ?)`,
    ).bind(id, shop, shop, content, imageUrl, platform, now).run();

    return c.json({ id, status: 'Draft' });
  });

  // ── GET /api/shopify/posts ───────────────────────────────────────────
  // List up to 100 most-recent posts for the current shop, newest first.
  // Optional ?status=Draft|Scheduled|Posted|Missed filter.
  app.get('/api/shopify/posts', async (c) => {
    const shopOrResp = await gate(c);
    if (shopOrResp instanceof Response) return shopOrResp;
    const shop = shopOrResp;

    const statusFilter = c.req.query('status');
    // We surface every column the Calendar needs to render correctly:
    //   - post_type / video_url / video_status: lets the Calendar show a
    //     reel chip vs an image chip, and a "rendering" pill on pending
    //     reels. Without these, autopilot-generated Reels look identical to
    //     image posts on the calendar grid — confusing.
    //   - image_critique_score / image_critique_reasoning: lets the calendar
    //     render a small "AI 8/10" badge so merchants can spot low-quality
    //     posts before they publish. The critique cron + the Compose page's
    //     manual critique both write these values; surfacing them on listing
    //     closes the loop.
    // All five columns exist on schema_v22+ — for older rows they're NULL,
    // which the frontend renders as "no badge".
    let stmt;
    if (statusFilter) {
      stmt = c.env.DB.prepare(
        `SELECT id, content, image_url, platform, status, scheduled_for, created_at,
                post_type, video_url, video_status,
                image_critique_score, image_critique_reasoning
         FROM posts
         WHERE owner_kind = 'shop' AND owner_id = ? AND status = ?
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(shop, statusFilter);
    } else {
      stmt = c.env.DB.prepare(
        `SELECT id, content, image_url, platform, status, scheduled_for, created_at,
                post_type, video_url, video_status,
                image_critique_score, image_critique_reasoning
         FROM posts
         WHERE owner_kind = 'shop' AND owner_id = ?
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(shop);
    }

    const { results } = await stmt.all<ShopPostRow>();
    return c.json({ posts: results ?? [] });
  });

  // ── PATCH /api/shopify/posts/:id ─────────────────────────────────────
  // Edit a Draft. Allowed fields: content, image_url, scheduled_for, status.
  // Status transitions allowed: 'Draft' → 'Scheduled' (schedule), 'Scheduled'
  // → 'Draft' (unschedule).
  //
  // We reject 409 if the current row is anything other than Draft to avoid
  // racing the publish-missed cron — once a row is Scheduled, the cron may
  // pick it up at any moment and a concurrent PATCH would create a confusing
  // intermediate state. The merchant can DELETE a Scheduled post (which the
  // cron skips because we delete the row, not just status-flip it) if they
  // want to abort.
  app.patch('/api/shopify/posts/:id', async (c) => {
    const shopOrResp = await gate(c);
    if (shopOrResp instanceof Response) return shopOrResp;
    const shop = shopOrResp;
    const billingResp = await requireBilling(c, shop);
    if (billingResp) return billingResp;

    const postId = c.req.param('id');

    let body: { content?: unknown; image_url?: unknown; scheduled_for?: unknown; status?: unknown };
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    // Read current row first — we need status to gate the edit, AND we need
    // to fail-fast 404 if the row doesn't belong to this shop (so we never
    // leak the existence of another shop's row via a generic "no rows
    // updated" response).
    const current = await c.env.DB.prepare(
      `SELECT status, scheduled_for, platform
         FROM posts
        WHERE id = ? AND owner_kind = 'shop' AND owner_id = ?`,
    ).bind(postId, shop).first<{
      status: string | null;
      scheduled_for: string | null;
      platform: string | null;
    }>();
    if (!current) return c.json({ error: 'Post not found' }, 404);
    if (current.status !== 'Draft' && current.status !== 'Scheduled') {
      return c.json({ error: `Only Draft or Scheduled posts can be edited (current status: ${current.status})` }, 409);
    }
    if (!isSupportedShopPlatform(current.platform)) {
      return unsupportedPlatformResponse(c);
    }
    if (current.status === 'Scheduled') {
      const allowedScheduledKeys = new Set(['scheduled_for', 'status']);
      if (Object.keys(body).some((key) => !allowedScheduledKeys.has(key))) {
        return c.json({
          error: 'Scheduled posts can only be rescheduled or moved back to Draft.',
        }, 409);
      }
    }

    // Build the UPDATE dynamically — only set fields the caller actually sent.
    const sets: string[] = [];
    const vals: unknown[] = [];

    if ('content' in body) {
      if (typeof body.content !== 'string') return c.json({ error: 'content must be a string' }, 400);
      sets.push('content = ?');
      vals.push(body.content);
    }
    if ('image_url' in body) {
      const v = body.image_url;
      if (v !== null && typeof v !== 'string') return c.json({ error: 'image_url must be a string or null' }, 400);
      sets.push('image_url = ?');
      vals.push(v ?? null);
    }
    if ('scheduled_for' in body) {
      const v = body.scheduled_for;
      if (v !== null && typeof v !== 'string') return c.json({ error: 'scheduled_for must be an ISO string or null' }, 400);
      sets.push('scheduled_for = ?');
      vals.push(v ?? null);
    }
    if ('status' in body) {
      const v = body.status;
      if (typeof v !== 'string' || !ALLOWED_PATCH_STATUSES.has(v)) {
        return c.json({ error: "status must be 'Draft' or 'Scheduled'" }, 400);
      }
      if (v === 'Scheduled') {
        const finalScheduledFor =
          typeof body.scheduled_for === 'string'
            ? body.scheduled_for
            : current.scheduled_for;
        if (!finalScheduledFor) {
          return c.json({ error: 'scheduled_for is required when scheduling a post' }, 400);
        }
        const connectedResp = await requireConnectedFacebook(c, shop);
        if (connectedResp) return connectedResp;
      }
      sets.push('status = ?');
      vals.push(v);
    }

    for (const [col, value] of Object.entries(buildCritiqueInvalidationPatch(body as Record<string, unknown>))) {
      sets.push(`${col} = ?`);
      vals.push(value);
    }

    if (!sets.length) return c.json({ error: 'No editable fields supplied' }, 400);

    // Re-assert tenant scope in the WHERE so a malicious id-guess + an
    // open-handle race can't hit somebody else's row.
    vals.push(postId, shop);
    await c.env.DB.prepare(
      `UPDATE posts SET ${sets.join(', ')}
       WHERE id = ? AND owner_kind = 'shop' AND owner_id = ?`,
    ).bind(...vals).run();

    return c.json({ ok: true });
  });

  // ── DELETE /api/shopify/posts/:id ────────────────────────────────────
  // Remove a Draft or Scheduled post. Posted is terminal — we don't allow
  // re-deletion of a published post from the embedded app (the merchant
  // should unpublish/delete on FB/IG directly; mirroring that into our DB
  // would require a Graph API call beyond Phase 2 scope).
  app.delete('/api/shopify/posts/:id', async (c) => {
    const shopOrResp = await gate(c);
    if (shopOrResp instanceof Response) return shopOrResp;
    const shop = shopOrResp;

    const postId = c.req.param('id');

    const current = await c.env.DB.prepare(
      `SELECT status FROM posts WHERE id = ? AND owner_kind = 'shop' AND owner_id = ?`,
    ).bind(postId, shop).first<{ status: string | null }>();
    if (!current) return c.json({ error: 'Post not found' }, 404);
    if (current.status !== 'Draft' && current.status !== 'Scheduled') {
      return c.json({ error: `Cannot delete a ${current.status} post (only Draft or Scheduled)` }, 409);
    }

    await c.env.DB.prepare(
      `DELETE FROM posts WHERE id = ? AND owner_kind = 'shop' AND owner_id = ?`,
    ).bind(postId, shop).run();

    return c.json({ ok: true });
  });

  // ── POST /api/shopify/posts/:id/publish-now ──────────────────────────
  // Force a Draft or Missed post into the publish queue immediately.
  app.post('/api/shopify/posts/:id/publish-now', async (c) => {
    const shopOrResp = await gate(c);
    if (shopOrResp instanceof Response) return shopOrResp;
    const shop = shopOrResp;
    const billingResp = await requireBilling(c, shop);
    if (billingResp) return billingResp;

    const postId = c.req.param('id');

    const current = await c.env.DB.prepare(
      `SELECT status, platform
         FROM posts
        WHERE id = ? AND owner_kind = 'shop' AND owner_id = ?`,
    ).bind(postId, shop).first<{ status: string | null; platform: string | null }>();
    if (!current) return c.json({ error: 'Post not found' }, 404);
    if (!isSupportedShopPlatform(current.platform)) {
      return unsupportedPlatformResponse(c);
    }
    // Allow publish-now from:
    //   - Draft    — normal "skip the schedule, publish right now" path
    //   - Missed   — retry a post that the cron couldn't publish at the
    //                originally-scheduled time (FB token expired, FB API
    //                outage, image-gen timeout, etc.). The merchant has now
    //                resolved the upstream issue (e.g. reconnected FB) and
    //                wants the post to ship. Without this branch, Missed
    //                posts were effectively un-publishable from the UI —
    //                merchants had to delete + recompose.
    // We reject Scheduled / Posted to avoid racing the cron / re-publishing
    // something already on Facebook.
    if (current.status !== 'Draft' && current.status !== 'Missed') {
      return c.json({ error: `Only Draft or Missed posts can be force-published (current: ${current.status})` }, 409);
    }
    const connectedResp = await requireConnectedFacebook(c, shop);
    if (connectedResp) return connectedResp;

    // now - 1ms in ISO form. The -1ms ensures we're strictly < now() at
    // cron-comparison time even if the cron runs in the same millisecond.
    const triggerAt = new Date(Date.now() - 1).toISOString();
    await c.env.DB.prepare(
      `UPDATE posts SET status = 'Scheduled', scheduled_for = ?
       WHERE id = ? AND owner_kind = 'shop' AND owner_id = ?`,
    ).bind(triggerAt, postId, shop).run();

    return c.json({ id: postId, status: 'Scheduled', scheduled_for: triggerAt });
  });
}
