// Facebook OAuth token exchange + Reel publish smoke test.
//
// POST /api/facebook-exchange-token
//   Body: { access_token: <short-lived user token from FB JS SDK> }
//   → exchanges for a 60-day long-lived user token, then fetches the user's
//     manageable Pages with their access_tokens + instagram_business_account
//     IDs, returning everything as a single payload the frontend can save
//     into social_tokens.
//
// POST /api/test-reel-publish
//   Pre-flight smoke test for Reels publishing — kicks off video_reels
//   upload_phase=start and abandons the resulting video_id (FB GCs unused
//   sessions). Catches "FB token expired", "publish_video scope missing",
//   and "page disconnected" failure modes BEFORE the user schedules a
//   batch and watches it all fail at publish time.
//
// Neither endpoint mutates DB state. /api/facebook-exchange-token has no
// Clerk auth — the FB-issued short-lived token IS the proof of identity.
// /api/test-reel-publish requires Clerk auth (uses the stored tokens).
//
// Page tokens themselves never expire (FB only invalidates them on password
// change / app revocation), so callers can treat them as long-lived. The
// cron at cron/refresh-tokens.ts re-fetches them daily to be defensive.
//
// Extracted from src/index.ts as Phase B step 18 of the route-module split.
// test-reel-publish moved here in step 19 (it's FB-shape, not PayPal-shape).

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';

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

  // ── Reels: Pre-flight smoke test ────────────────────────────────────────────
  // Verifies the user's Facebook Page can actually accept a Reel publish via
  // /video_reels — catches "FB token expired", "publish_video scope missing",
  // "page disconnected" before the user schedules a batch and watches it all
  // fail at publish time. Safe + free: kicks off upload_phase=start and
  // abandons the resulting video_id (FB GCs unreferenced uploads after a few
  // hours, no actual reel ever publishes).
  //
  // This is the PROACTIVE counterpart to the cron's reactive image-fallback
  // safety net. Aligns with the user's #1 priority (reliability) — surface the
  // failure at config time, not at publish time.
  app.post('/api/test-reel-publish', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json<{ clientId?: string | null }>().catch(() => null);
    const clientId = body?.clientId || null;

    // Load social tokens for the appropriate workspace (mirrors the cron's
    // resolution logic exactly so this test matches what the cron actually does).
    const tokensRaw = clientId
      ? await c.env.DB.prepare('SELECT social_tokens FROM clients WHERE id = ? AND user_id = ?').bind(clientId, uid).first<{ social_tokens: string | null }>()
      : await c.env.DB.prepare('SELECT social_tokens FROM users WHERE id = ?').bind(uid).first<{ social_tokens: string | null }>();
    const tokens = tokensRaw?.social_tokens ? JSON.parse(tokensRaw.social_tokens) : null;
    if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
      return c.json({
        ok: false,
        stage: 'no-tokens',
        message: 'No Facebook page connected. Open Settings → Connected Accounts → Connect Facebook.',
      }, 200);
    }

    const base = 'https://graph.facebook.com/v21.0';
    const pageId = tokens.facebookPageId;
    const token = tokens.facebookPageAccessToken;

    // Step 1 — verify page lookup works (catches expired/revoked tokens cheap).
    try {
      const pageRes = await fetch(`${base}/${pageId}?fields=name,access_token&access_token=${encodeURIComponent(token)}`);
      const pageData = await pageRes.json() as any;
      if (!pageRes.ok || pageData.error) {
        return c.json({
          ok: false,
          stage: 'page-lookup',
          message: `Facebook rejected the page token: ${pageData.error?.message || `HTTP ${pageRes.status}`}. Reconnect Facebook in Settings to refresh.`,
        }, 200);
      }
      const pageName = pageData.name as string;

      // Step 2 — kick off video_reels upload_phase=start. If the page lacks the
      // publish_video permission OR has Reels disabled, this returns an error.
      // We DON'T follow through to transfer/finish — FB GCs the unreferenced
      // upload session. No actual reel publishes.
      const startRes = await fetch(`${base}/${pageId}/video_reels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_phase: 'start', access_token: token }),
      });
      const startData = await startRes.json() as any;
      if (!startRes.ok || startData.error) {
        const errMsg = startData.error?.message || `HTTP ${startRes.status}`;
        const errCode = startData.error?.code;
        // FB error codes: 200 = permission denied, 100 = invalid param, 190 = token expired
        const friendly =
          errCode === 200 ? 'Page is missing the publish_video permission. Reconnect Facebook in Settings and accept all permissions.'
          : errCode === 190 ? 'Facebook token expired. Reconnect Facebook in Settings.'
          : `Facebook rejected the test: ${errMsg}`;
        return c.json({
          ok: false,
          stage: 'reels-start',
          page_name: pageName,
          fb_error_code: errCode,
          message: friendly,
        }, 200);
      }
      if (!startData.video_id || !startData.upload_url) {
        return c.json({
          ok: false,
          stage: 'reels-start',
          page_name: pageName,
          message: 'Facebook accepted the request but returned no video_id — Reels API may be misconfigured. Contact support.',
        }, 200);
      }

      return c.json({
        ok: true,
        page_name: pageName,
        message: `Reels publishing is configured correctly for ${pageName}. Scheduled reels will publish automatically.`,
      });
    } catch (err: any) {
      return c.json({
        ok: false,
        stage: 'network',
        message: `Could not reach Facebook: ${err?.message || 'unknown'}. Try again in a moment.`,
      }, 200);
    }
  });
}
