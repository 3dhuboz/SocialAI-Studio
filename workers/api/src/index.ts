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

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return 'https://socialaistudio.au';
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
      ];
      if (allowed.includes(origin)) return origin;
      // Allow all *.pages.dev subdomains (CF Pages preview/prod deployments)
      if (origin.endsWith('.pages.dev')) return origin;
      return 'https://socialaistudio.au';
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

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    return dispatchScheduled(event, env);
  },
};
