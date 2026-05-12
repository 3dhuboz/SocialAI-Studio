// Facebook OAuth token exchange.
//
// POST /api/facebook-exchange-token
//   Body: { access_token: <short-lived user token from FB JS SDK> }
//   → exchanges for a 60-day long-lived user token, then fetches the user's
//     manageable Pages with their access_tokens + instagram_business_account
//     IDs, returning everything as a single payload the frontend can save
//     into social_tokens.
//
// No Clerk auth here — the FB-issued short-lived token IS the proof of
// identity. We do require FACEBOOK_APP_ID + FACEBOOK_APP_SECRET on the
// worker (configured via wrangler secret) — without those the exchange
// can't happen.
//
// Page tokens themselves never expire (FB only invalidates them on
// password change / app revocation), so callers can treat them as
// long-lived. The cron at cron/refresh-tokens.ts re-fetches them daily
// to be defensive.
//
// Extracted from src/index.ts as Phase B step 18 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';

export function registerFacebookRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/facebook-exchange-token', async (c) => {
    const appId = c.env.FACEBOOK_APP_ID;
    const appSecret = c.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret) return c.json({ error: 'Facebook app credentials not configured' }, 500);

    const { access_token } = await c.req.json();
    if (!access_token) return c.json({ error: 'access_token is required' }, 400);

    // Exchange short-lived token for long-lived token
    const exchangeUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${access_token}`;
    const exchangeRes = await fetch(exchangeUrl);
    const exchangeData = await exchangeRes.json() as any;
    if (!exchangeData.access_token) return c.json({ error: 'Failed to exchange token' }, 400);

    // Get page access tokens with fields for Instagram Business Account
    const pagesUrl = `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,category,picture,instagram_business_account&access_token=${exchangeData.access_token}`;
    const pagesRes = await fetch(pagesUrl);
    const pagesData = await pagesRes.json() as any;

    // Enrich pages with instagram_business_account ID
    const pages = (pagesData.data || []).map((page: any) => ({
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
}
