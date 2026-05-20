// Shopify embedded-app: Facebook facts status + manual refresh.
//
// Surfaces the "N facts from Facebook ready" indicator on the Autopilot
// page and lets the merchant trigger an on-demand scrape (the cron runs
// nightly at 04:00 UTC, but the merchant may want fresh data right after
// connecting their FB page or pushing a hero campaign).
//
// Endpoints:
//
//   GET  /api/shopify/facts/status
//     Returns:
//       { total: number,
//         by_type: { about: N, own_post: N, photo: N, ... },
//         last_verified_at: ISO | null,
//         page_connected: boolean }
//
//   POST /api/shopify/facts/refresh
//     Triggers refreshFactsForShop synchronously (3 Graph fetches, ~5-15s).
//     Rate limited 3/min/shop to protect FB Graph quota.
//     Returns: { inserted: number, errors: string[] }

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';
import { refreshFactsForShop } from '../lib/facebook-facts';

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

export function registerShopifyFactsRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/shopify/facts/status', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-facts-status:${shop}`, 60)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    // Page-connected check first — if no token, the merchant needs to do
    // Settings → Connect Facebook before facts can land. Faster fail than
    // counting an empty table.
    const tokensRow = await c.env.DB.prepare(
      `SELECT social_tokens FROM shopify_stores
        WHERE shop_domain = ? AND uninstalled_at IS NULL`,
    ).bind(shop).first<{ social_tokens: string | null }>();
    let pageConnected = false;
    try {
      const tokens = tokensRow?.social_tokens ? JSON.parse(tokensRow.social_tokens) : null;
      pageConnected = !!(tokens?.facebookPageId && tokens?.facebookPageAccessToken);
    } catch { /* malformed JSON → treat as not connected */ }

    // Group fact counts by type for the indicator pill.
    const { results } = await c.env.DB.prepare(
      `SELECT fact_type, COUNT(*) AS n, MAX(verified_at) AS last_verified
         FROM shopify_facts
        WHERE shop_domain = ?
        GROUP BY fact_type`,
    ).bind(shop).all<{ fact_type: string; n: number; last_verified: string | null }>();

    const byType: Record<string, number> = {};
    let total = 0;
    let lastVerifiedAt: string | null = null;
    for (const r of results || []) {
      byType[r.fact_type] = Number(r.n);
      total += Number(r.n);
      if (r.last_verified && (!lastVerifiedAt || r.last_verified > lastVerifiedAt)) {
        lastVerifiedAt = r.last_verified;
      }
    }

    return c.json({
      total,
      by_type: byType,
      last_verified_at: lastVerifiedAt,
      page_connected: pageConnected,
    });
  });

  app.post('/api/shopify/facts/refresh', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-facts-refresh:${shop}`, 3)) {
      return c.json({ error: 'Rate limit exceeded — at most 3 refreshes per minute' }, 429);
    }

    const tokensRow = await c.env.DB.prepare(
      `SELECT social_tokens FROM shopify_stores
        WHERE shop_domain = ? AND uninstalled_at IS NULL`,
    ).bind(shop).first<{ social_tokens: string | null }>();

    let pageId = '';
    let pageToken = '';
    try {
      const tokens = tokensRow?.social_tokens ? JSON.parse(tokensRow.social_tokens) : null;
      pageId = tokens?.facebookPageId || '';
      pageToken = tokens?.facebookPageAccessToken || '';
    } catch { /* fall through to the 412 below */ }

    if (!pageId || !pageToken) {
      return c.json({
        error: 'No Facebook page connected. Go to Settings → Connect Facebook first.',
      }, 412);
    }

    const result = await refreshFactsForShop(c.env, shop, pageId, pageToken);
    return c.json(result);
  });
}
