// Facebook / Instagram connect for Shopify embedded-app merchants.
//
// This module is the Shopify-session-token-auth equivalent of
// routes/facebook.ts. The legacy route there (`/api/facebook-exchange-token`)
// has no auth — the FB short-lived token IS the proof of identity — but in
// the Shopify world we MUST gate every endpoint behind a verified App Bridge
// session token, because the side-effect (writing into shopify_stores.social_tokens)
// is shop-scoped and we need a trusted shop identity for the WHERE clause.
//
// Endpoints (all require Bearer <session token from App Bridge>):
//
//   POST /api/shopify/social/facebook-exchange-token
//     Body: { access_token: string }   — short-lived FB user token from JS SDK
//     → exchange for 60-day long-lived token + list pages with IG biz IDs
//     → returns { longLivedUserToken, expiresInSeconds, pages } WITHOUT storing
//     The frontend then asks the merchant which page to connect, then calls:
//
//   POST /api/shopify/social/connect
//     Body: { facebookUserToken, facebookPageId, facebookPageAccessToken,
//             facebookPageName, instagramBusinessAccountId? }
//     → persists into shopify_stores.social_tokens (JSON column, schema_v22)
//
//   POST /api/shopify/social/disconnect
//     → sets social_tokens = NULL
//
//   GET  /api/shopify/social/status
//     → connection state without exposing tokens
//
// Rate-limit: 10/min per shop. Each call hits Shopify session-token
// verification + (sometimes) FB Graph + a D1 write; a buggy embedded-app
// retry loop or a hostile session could otherwise hammer either dependency.
// This is the same cap shopify-oauth.ts applies to /token-exchange and
// /setup-subscription — keep it consistent across all session-token endpoints.
//
// Storage note: we DO NOT envelope-encrypt the FB tokens before storing in
// social_tokens. Rationale:
//   * The FB page token only works when paired with our FB app credentials
//     (the column is meaningless without them; an attacker who exfiltrated
//     the JSON would still need FACEBOOK_APP_SECRET to do anything with it).
//   * shopify_stores.access_token (the SHOPIFY admin token) IS encrypted in
//     the same row — that's the high-value credential. The FB tokens sit
//     alongside it but are separately scoped and lower-value.
//   * Layering a second encryption envelope on the JSON column would force
//     us to invent a new ciphertext format AND complicate every read site.
// If we later discover a reason to encrypt (e.g. compliance audit), the
// migration is straightforward — re-use lib/crypto.ts on the JSON string.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';

// ── Helpers ────────────────────────────────────────────────────────────────

function requireShopifyConfig(env: Env): { key: string; secret: string } | null {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) return null;
  return { key: env.SHOPIFY_API_KEY, secret: env.SHOPIFY_API_SECRET };
}

// Mirrors the requireSession helper in routes/shopify-oauth.ts. Centralized
// here (rather than imported from shopify-oauth.ts) because that module
// doesn't export it — and copying the 8 lines is cheaper than introducing
// a cross-module dependency that risks pulling the entire OAuth route file
// into this one's import graph.
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

// ── Route registration ─────────────────────────────────────────────────────

export function registerShopifySocialConnectRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── POST /api/shopify/social/facebook-exchange-token ──────────────────
  // Mirrors /api/facebook-exchange-token (the Clerk-auth original) but gated
  // behind a Shopify session token instead. No DB writes here — the frontend
  // takes the returned page list, shows the merchant a picker, then POSTs
  // their choice to /api/shopify/social/connect.
  app.post('/api/shopify/social/facebook-exchange-token', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-social-fbex:${shop}`, 10)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const appId = c.env.FACEBOOK_APP_ID;
    const appSecret = c.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret) {
      return c.json({ error: 'Facebook app credentials not configured' }, 500);
    }

    const body = await c.req.json().catch(() => null) as { access_token?: string } | null;
    const accessToken = body?.access_token;
    if (!isNonEmptyString(accessToken)) {
      return c.json({ error: 'access_token is required' }, 400);
    }

    // Exchange short-lived → long-lived (60-day) user token.
    const exchangeUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(accessToken)}`;
    const exchangeRes = await fetch(exchangeUrl);
    const exchangeData = await exchangeRes.json() as any;
    if (!exchangeData?.access_token) {
      return c.json({ error: 'Failed to exchange token' }, 400);
    }

    // Pull manageable pages + their IG biz account IDs in a single Graph call.
    const pagesUrl = `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,category,picture,instagram_business_account&access_token=${encodeURIComponent(exchangeData.access_token)}`;
    const pagesRes = await fetch(pagesUrl);
    const pagesData = await pagesRes.json() as any;

    // Flatten instagram_business_account.id onto each page so the frontend
    // doesn't have to dig into the nested shape (matches the existing route).
    const pages = (pagesData?.data || []).map((page: any) => ({
      ...page,
      instagramBusinessAccountId: page.instagram_business_account?.id || null,
    }));

    return c.json({
      longLivedUserToken: exchangeData.access_token,
      expiresInSeconds: exchangeData.expires_in,
      pages,
      pageTokensNeverExpire: true,
    });
  });

  // ── POST /api/shopify/social/connect ──────────────────────────────────
  // Persists the merchant's chosen FB Page + (optional) IG Business Account
  // into shopify_stores.social_tokens. social_tokens is a JSON column added
  // in schema_v22 — D1's raw-SQL binding means TS doesn't need to know
  // about it.
  app.post('/api/shopify/social/connect', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-social-connect:${shop}`, 10)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const body = await c.req.json().catch(() => null) as {
      facebookUserToken?: string;
      facebookPageId?: string;
      facebookPageAccessToken?: string;
      facebookPageName?: string;
      instagramBusinessAccountId?: string | null;
    } | null;

    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

    // Hard-validate the two fields the publish pipeline actually relies on.
    // We're strict here because a missing/empty page id or token would let
    // us write a half-broken row that surfaces as a confusing FB error
    // hours later when the cron tries to publish.
    if (!isNonEmptyString(body.facebookPageId)) {
      return c.json({ error: 'facebookPageId is required' }, 400);
    }
    if (!isNonEmptyString(body.facebookPageAccessToken)) {
      return c.json({ error: 'facebookPageAccessToken is required' }, 400);
    }

    // Build the stored JSON. Optional fields default to null (never undefined)
    // so the on-disk shape is consistent — readers can rely on the keys
    // being present.
    const social = {
      facebookUserToken: isNonEmptyString(body.facebookUserToken) ? body.facebookUserToken : null,
      facebookPageId: body.facebookPageId,
      facebookPageAccessToken: body.facebookPageAccessToken,
      facebookPageName: isNonEmptyString(body.facebookPageName) ? body.facebookPageName : null,
      instagramBusinessAccountId: isNonEmptyString(body.instagramBusinessAccountId)
        ? body.instagramBusinessAccountId
        : null,
      connectedAt: new Date().toISOString(),
    };

    // Shop-scoped UPDATE — the WHERE clause is the verified shop_domain from
    // the session token, so a malicious payload cannot write into someone
    // else's row.
    const result = await c.env.DB.prepare(
      `UPDATE shopify_stores SET social_tokens = ? WHERE shop_domain = ?`,
    ).bind(JSON.stringify(social), shop).run();

    // D1 doesn't always populate .meta.changes consistently across drivers;
    // we read back to confirm. If the row vanished (e.g. mid-uninstall race),
    // surface a 404 rather than a silent success.
    if (result?.meta && typeof result.meta.changes === 'number' && result.meta.changes === 0) {
      return c.json({ error: 'Shop not installed' }, 404);
    }

    return c.json({
      ok: true,
      page_name: social.facebookPageName,
      connected_at: social.connectedAt,
    });
  });

  // ── POST /api/shopify/social/disconnect ───────────────────────────────
  // Idempotent — clears social_tokens whether or not there was one set. We
  // never need to revoke the FB token server-side; setting it to NULL is
  // sufficient to stop the publish pipeline from using it. (The merchant
  // can also revoke the app from facebook.com if they want belt-and-braces.)
  app.post('/api/shopify/social/disconnect', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-social-disconnect:${shop}`, 10)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    await c.env.DB.prepare(
      `UPDATE shopify_stores SET social_tokens = NULL WHERE shop_domain = ?`,
    ).bind(shop).run();

    return c.json({ ok: true });
  });

  // ── GET /api/shopify/social/status ────────────────────────────────────
  // UI-facing — returns the FB Page name + IG-connected boolean so the
  // embedded app can render "Connected as Acme BBQ • Instagram linked".
  // NEVER returns tokens: this response could in principle leak through
  // a misconfigured proxy or end up in a client-side error log, and the
  // only thing the UI needs is the display name + booleans.
  app.get('/api/shopify/social/status', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-social-status:${shop}`, 10)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const row = await c.env.DB.prepare(
      `SELECT social_tokens FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL`,
    ).bind(shop).first<{ social_tokens: string | null }>();

    if (!row || !row.social_tokens) {
      return c.json({
        connected: false,
        facebookPageName: null,
        instagramConnected: false,
        connectedAt: null,
      });
    }

    // Defensive parse — a malformed JSON value should surface as "not
    // connected" rather than a 500. If we ever see this fire, something
    // wrote bad data into the column.
    let social: any;
    try { social = JSON.parse(row.social_tokens); } catch {
      console.warn('[shopify-social] malformed social_tokens JSON for', shop);
      return c.json({
        connected: false,
        facebookPageName: null,
        instagramConnected: false,
        connectedAt: null,
      });
    }

    // "Connected" = has the two fields the publish pipeline actually needs.
    // Anything else in the JSON is metadata; a row missing page id or token
    // is functionally as good as no row at all.
    const connected = isNonEmptyString(social?.facebookPageId)
      && isNonEmptyString(social?.facebookPageAccessToken);

    return c.json({
      connected,
      facebookPageName: typeof social?.facebookPageName === 'string' ? social.facebookPageName : null,
      instagramConnected: isNonEmptyString(social?.instagramBusinessAccountId),
      connectedAt: typeof social?.connectedAt === 'string' ? social.connectedAt : null,
    });
  });
}
