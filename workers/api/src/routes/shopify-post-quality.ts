// Shopify embedded-app: pre-publish image+caption quality critique.
//
// Mirrors the Clerk-auth /api/critique-image-caption route in
// routes/post-quality.ts, but gated behind a Shopify App Bridge session
// token instead. Used by the Compose page to score the freshly-generated
// {imageUrl, caption} pair BEFORE the merchant clicks Save/Publish, so
// they can regenerate if the score is poor (≤4 = "regenerate" verdict).
//
// Shares the underlying logic with the cron's prewarm-critique path:
// critiqueImageInternal in lib/critique.ts is the single source of truth
// for vision scoring. This route is just the session-token-gated wrapper.
//
//   POST /api/shopify/critique-image-caption
//     Body: { imageUrl, caption, postId?, businessType?, archetype? }
//     Returns: { score: 0-10, match: 'yes'|'partial'|'no',
//                reasoning: string, regenerate: boolean }
//
// Persistence:
// When `postId` is provided AND the post belongs to the calling shop
// (owner_kind='shop', owner_id=<shopDomain>), the score is persisted onto
// the posts row so the Calendar can later show a quality badge without
// re-running the model. We strictly require shop ownership here — a
// malicious payload could otherwise smuggle in a Clerk-user's postId.
//
// Forbidden subjects:
// Shop-tenant posts use `shopify_stores.profile.forbiddenSubjects` (added in
// schema_v25). Wired through `loadForbiddenSubjectsForShop` so the HARD-RULES
// gate in lib/critique.ts behaves identically to the Clerk-tenant path.
// Merchants set their denylist in the embedded app's Settings page.
//
// Rate limit: 60/min per shop (matches the main-app route — these calls
// happen as the merchant clicks Regenerate, so a tight loop could
// otherwise spam Haiku 4.5).

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';
import { critiqueImageInternal } from '../lib/critique';
import { loadForbiddenSubjectsForShop } from '../lib/profile-guards';

const RATE_LIMIT_PER_MIN = 60;

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

export function registerShopifyPostQualityRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/shopify/critique-image-caption', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-critique:${shop}`, RATE_LIMIT_PER_MIN)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    if (!c.env.ANTHROPIC_API_KEY && !c.env.OPENROUTER_API_KEY) {
      return c.json({ error: 'No critique provider configured' }, 500);
    }

    const body = await c.req.json().catch(() => ({})) as {
      imageUrl?: string;
      caption?: string;
      businessType?: string;
      archetype?: string;
      postId?: string;
    };

    const { imageUrl, caption, businessType, archetype, postId } = body;
    if (!imageUrl || !caption) {
      return c.json({ error: 'imageUrl and caption are required' }, 400);
    }

    // Shop-tenant denylist from shopify_stores.profile.forbiddenSubjects
    // (schema_v25). Empty if the merchant hasn't set any — HARD-RULES gate
    // becomes a no-op in that case, which is correct (no rules to enforce).
    const forbiddenSubjects = await loadForbiddenSubjectsForShop(c.env, shop);

    const result = await critiqueImageInternal(c.env, {
      imageUrl,
      caption,
      archetypeSlug: archetype || null,
      businessType,
      forbiddenSubjects,
    });
    if (!result) {
      return c.json({ error: 'Vision critique unavailable' }, 502);
    }

    // Persist if the postId belongs to this shop. The WHERE clause covers
    // both legacy and tenant-abstracted shapes — owner_kind='shop' AND
    // owner_id=shop is the authoritative match per TENANT_ABSTRACTION.md.
    if (postId) {
      try {
        await c.env.DB.prepare(
          `UPDATE posts
              SET image_critique_score = ?,
                  image_critique_reasoning = ?,
                  image_critique_at = ?
            WHERE id = ?
              AND owner_kind = 'shop'
              AND owner_id = ?`,
        ).bind(
          result.score,
          result.reasoning,
          new Date().toISOString(),
          postId,
          shop,
        ).run();
      } catch (e) {
        // Persist is best-effort — the merchant still gets the verdict in
        // the response, and the cron will write the same fields when the
        // post is prewarmed. Don't bubble this up as a 500.
        console.warn(`[shopify-critique] persist failed for post ${postId}:`, e);
      }
    }

    return c.json({
      score: result.score,
      match: result.match,
      reasoning: result.reasoning,
      // ≤4/10 means the image-caption match was poor enough that
      // regenerating is more likely to help than tweaking the caption.
      regenerate: result.score <= 4,
    });
  });
}
