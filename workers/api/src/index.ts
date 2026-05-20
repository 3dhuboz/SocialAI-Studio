// SocialAI Studio Worker — entry point.
//
// After Phase B of the route-module split, this file is intentionally small:
//   - import the Env type + Hono app
//   - configure CORS (the one place we list allowed origins)
//   - register each route group via routes/* modules
//   - hand the scheduled() event to cron/dispatcher.ts
//
// No business logic lives here. New endpoints belong in a routes/* file;
// new background jobs belong in a cron/* file; new helpers belong in lib/*.
// See WORKER_SPLIT_PLAN.md for the boundaries and Phase B step log.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { dispatchScheduled } from './cron/dispatcher';
import { requestIdMiddleware } from './middleware/request-id';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerHealthRoutes } from './routes/health';
import { registerUserRoutes } from './routes/user';
import { registerSocialTokensRoutes } from './routes/social-tokens';
import { registerPortalRoutes } from './routes/portal';
import { registerActivationRoutes } from './routes/activations';
import { registerFactsRoutes } from './routes/facts';
import { registerPostsRoutes } from './routes/posts';
import { registerClientsRoutes } from './routes/clients';
import { registerArchetypeRoutes } from './routes/archetypes';
import { registerFacebookRoutes } from './routes/facebook';
import { registerAiRoutes } from './routes/ai';
import { registerPaypalRoutes } from './routes/paypal';
import { registerAdminStatsRoutes } from './routes/admin-stats';
import { registerAdminActionsRoutes } from './routes/admin-actions';
import { registerBillingRoutes } from './routes/billing';
import { registerOnboardingRoutes } from './routes/onboarding';
import { registerPostQualityRoutes } from './routes/post-quality';
import { registerPostersRoutes } from './routes/posters';
import { registerProxyRoutes } from './routes/proxies';
import { registerPennybuildRoutes } from './routes/pennybuilder';
import { registerPostproxyRoutes } from './routes/postproxy';
import { registerRecommendationsRoutes } from './routes/recommendations';
import { registerShopifyOauthRoutes } from './routes/shopify-oauth';
import { registerAdminShopifyRoutes } from './routes/admin-shopify';
import { registerShopifyProductsRoutes } from './routes/shopify-products';
import { registerShopifyComposeRoutes } from './routes/shopify-compose';
import { registerShopifyPostsRoutes } from './routes/shopify-posts';
import { registerShopifySocialConnectRoutes } from './routes/shopify-social-connect';
import { registerShopifyInsightsRoutes } from './routes/shopify-insights';
import { registerShopifyPostQualityRoutes } from './routes/shopify-post-quality';
import { registerShopifyPostersRoutes } from './routes/shopify-posters';
import { registerShopifyAutopilotRoutes } from './routes/shopify-autopilot';
import { registerShopifyCampaignRoutes } from './routes/shopify-campaigns';
import { registerShopifyFactsRoutes } from './routes/shopify-facts';
import { registerShopifyProfileRoutes } from './routes/shopify-profile';

const app = new Hono<{ Bindings: Env }>();

// Request-ID first — every downstream middleware (CORS, auth, onError) and
// every log line reads `c.get('requestId')`. Mounted before CORS so even
// preflight (OPTIONS) responses carry a correlation id.
app.use('*', requestIdMiddleware);

app.use(
  '*',
  cors({
    origin: (origin) => {
      const DEFAULT = 'https://socialaistudio.au';
      if (!origin) return DEFAULT;
      // Fully-specified allowlist — each entry is matched as an exact string,
      // including scheme + host (+ port for localhost). Safe to compare raw.
      const allowed = [
        'http://localhost:5173', 'http://localhost:5174',
        'https://socialaistudio.au',
        'https://social.picklenick.au', 'https://social.streetmeatzbbq.com.au',
        'https://social.hugheseysque.au', 'https://hugheseysque.au',
        // Additional whitelabel portal origins
        'https://social.gladstonebbq.com.au', 'https://social.blackcat.com.au',
        'https://social.jonesysgarage.com.au', 'https://social.jenniannesjewels.com.au',
        'https://littlestomp.com.au', 'https://www.littlestomp.com.au',
        'https://streetmeatzbbq.com.au', 'https://www.streetmeatzbbq.com.au',
        // Shopify embedded app — admin host + the embedded-app's own bounce host.
        'https://admin.shopify.com',
        'https://shopify.socialaistudio.au',
      ];
      if (allowed.includes(origin)) return origin;
      // For any wildcard branch, parse the origin as a URL and require HTTPS.
      // Raw-string suffix matching is brittle (URL-encoded hosts, ports, paths,
      // newline-smuggled headers); URL parsing normalises the host and rejects
      // malformed input outright.
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        return DEFAULT;
      }
      if (url.protocol !== 'https:') return DEFAULT;
      const host = url.hostname;
      // Shopify embedded app — Phase 1. The embedded React app loads inside
      // an iframe served from <shop>.myshopify.com. Require an exact 3-label
      // host (shop.myshopify.com) so e.g. evil.myshopify.com.attacker.tld
      // — were that ever to parse with myshopify.com as a parent label — is
      // rejected, and a literal "myshopify.com" alone is also rejected.
      if (host.endsWith('.myshopify.com') && host.split('.').length === 3) {
        return origin;
      }
      // CF Pages: tight match for the Shopify embedded app's own Pages project
      // (used by Shopify-aware routes). The general *.pages.dev branch below
      // is intentionally loose for main-app preview deploys — anyone can ship
      // a pages.dev project, so this is info-leak-by-design rather than a
      // trust boundary. Tighten if/when these routes carry sensitive data.
      if (host === 'socialai-shopify.pages.dev') return origin;
      if (host.endsWith('.pages.dev')) return origin;
      return DEFAULT;
    },
    // X-Portal-Secret is sent by whitelabel portal frontends to authenticate
    // their slug-based portal lookup. Without this, browser preflight blocks
    // the request and the portal shows "Portal not configured".
    allowHeaders: ['Content-Type', 'Authorization', 'X-Portal-Secret', 'X-Bootstrap-Secret'],
    allowMethods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

// Modular route registration — see routes/* for each group. Each
// registerXRoutes call mounts a handful of endpoints onto the shared app
// instance. Order doesn't matter unless two registrations share a path
// prefix (none currently do).
registerHealthRoutes(app);
registerAiRoutes(app);
registerUserRoutes(app);
registerPostsRoutes(app);
registerClientsRoutes(app);
registerSocialTokensRoutes(app);
registerPortalRoutes(app);
registerActivationRoutes(app);
registerCampaignRoutes(app);
registerFactsRoutes(app);
registerArchetypeRoutes(app);
registerFacebookRoutes(app);
registerPaypalRoutes(app);
registerAdminStatsRoutes(app);
registerAdminActionsRoutes(app);
registerBillingRoutes(app);
registerOnboardingRoutes(app);
registerPostQualityRoutes(app);
registerPostersRoutes(app);
registerProxyRoutes(app);
registerPennybuildRoutes(app);
registerPostproxyRoutes(app);
registerRecommendationsRoutes(app);
registerShopifyOauthRoutes(app);
registerAdminShopifyRoutes(app);
registerShopifyProductsRoutes(app);
registerShopifyComposeRoutes(app);
registerShopifyPostsRoutes(app);
registerShopifySocialConnectRoutes(app);
registerShopifyInsightsRoutes(app);
registerShopifyPostQualityRoutes(app);
registerShopifyPostersRoutes(app);
registerShopifyAutopilotRoutes(app);
registerShopifyCampaignRoutes(app);
registerShopifyFactsRoutes(app);
registerShopifyProfileRoutes(app);

// ── Global error handler ──────────────────────────────────────────────────
// Without this, a thrown error in any handler falls through to Hono's
// default text/html 500 page — which breaks the frontend's JSON-only
// fetch wrappers and hides the request id from support tickets. Every
// 500 now ships the same JSON shape as every other error: { error, message,
// requestId }. The requestId matches the X-Request-Id response header AND
// the server log line written here, so a user-pasted id is enough to find
// the failing request in `wrangler tail`.
app.onError((err, c) => {
  const requestId = c.get('requestId');
  console.error(`[error] requestId=${requestId} path=${c.req.path}`, err);
  return c.json({ error: 'internal_error', message: err.message, requestId }, 500);
});

// ── 404 handler ───────────────────────────────────────────────────────────
// Same JSON shape so the frontend doesn't choke on `res.json()` for a typo'd
// path. Includes the path back to the caller so a 404 in production tells
// the frontend dev exactly which URL the worker couldn't match.
app.notFound((c) => {
  return c.json({ error: 'not_found', path: c.req.path, requestId: c.get('requestId') }, 404);
});

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    return dispatchScheduled(event, env);
  },
};
