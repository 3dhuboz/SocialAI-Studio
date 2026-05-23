// Public health + observability endpoints.
//
// /api/health             — uptime probe, returns { ok: true }
// /api/cron-health        — last 30 cron runs from cron_runs table (deploy
//                            monitor widget polls without auth — no PII)
// /api/post-schedule      — recent + upcoming posts feed (deploy monitor)
// /api/health/onboarding  — readiness flags + Resend domain verification +
//                            D1 + PayPal credentials. No secrets returned;
//                            same observability you'd get by attempting a
//                            live signup.
//
// Extracted from src/index.ts as Phase B step 17 of the route-module split.
// /api/health/onboarding moved in step 19 alongside the lib/paypal.ts
// extraction (it depends on paypalAccessToken).

import type { Hono } from 'hono';
import type { Env } from '../env';
import { paypalAccessToken } from '../lib/paypal';
import { ACTIVE_CLIENT_FILTER } from '../cron/_shared';

export function registerHealthRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/health', (c) => c.json({ ok: true, service: 'socialai-api' }));

  // ── /api/_meta — build manifest, public, used to detect rollbacks ────────
  //
  // Pre-merge, the Shopify routes only existed on branch claude/keen-vaughan-e42cc6
  // and any worker deploy from main / another worktree silently removed them.
  // Now that this code lives on main, the manifest serves as a forward-looking
  // observability hook: a curl against it confirms the live build carries the
  // expected Shopify route surface, and the manifest version bumps any time the
  // Shopify route set changes — so a low version number signals a stale deploy.
  //
  //   curl https://socialai-api.steve-700.workers.dev/api/_meta
  //
  // If `shopify_routes_present` is true → correct build is live.
  // If this endpoint 404s OR returns false → a stale build is live; redeploy:
  //   cd workers/api && npx wrangler deploy --config wrangler.toml
  app.get('/api/_meta', (c) => {
    return c.json({
      service: 'socialai-api',
      // Bump when Shopify route surface changes (new routes, removed routes,
      // path renames). Lets a human eyeball whether the live build is fresh.
      shopify_manifest_version: 2,
      shopify_routes_present: true,
      // List the route groups baked into this build. If any of these are
      // missing on a future deploy, the endpoint either won't exist or this
      // array will be shorter — both are easy signals.
      route_groups: [
        'health', 'ai', 'user', 'posts', 'clients', 'social-tokens',
        'portal', 'activation', 'campaigns', 'facts', 'archetypes',
        'facebook', 'paypal', 'admin-stats', 'admin-actions', 'billing',
        'onboarding', 'post-quality', 'posters', 'proxies', 'pennybuild',
        'postproxy', 'recommendations',
        'shopify-oauth', 'admin-shopify', 'shopify-products',
        'shopify-compose', 'shopify-posts', 'shopify-social-connect',
        'shopify-insights', 'shopify-post-quality', 'shopify-posters',
        'shopify-autopilot', 'shopify-campaigns', 'shopify-facts',
        'shopify-profile',
      ],
    });
  });

  // Cron observability — last 30 cron runs (public so the deploy-monitor widget
  // can poll without an auth token; emits no PII).
  app.get('/api/cron-health', async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT run_at, cron_type, success, posts_processed, duration_ms,
              substr(COALESCE(error,''),1,200) as error
       FROM cron_runs ORDER BY run_at DESC LIMIT 30`
    ).all();
    const runs = rows.results ?? [];
    const lastSuccess = runs.find((r: any) => r.success === 1);
    const lastFailure = runs.find((r: any) => r.success === 0);
    return c.json({
      runs,
      last_success_at: (lastSuccess as any)?.run_at ?? null,
      last_failure_at: (lastFailure as any)?.run_at ?? null,
    });
  });

  // Public post schedule feed — used by deploy monitor widget
  app.get('/api/post-schedule', async (c) => {
    const expected = c.env.MONITOR_SECRET;
    const provided = c.req.header('X-Monitor-Secret') || c.req.query('secret');
    if (!expected || provided !== expected) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    // Filter to active clients only so the monitor view matches what the
    // publish cron will actually do. On-hold clients' scheduled posts are
    // never claimed by the cron — showing them here is misleading.
    const rows = await c.env.DB.prepare(
      `SELECT p.scheduled_for, p.status, p.platform,
              substr(p.content, 1, 80) as preview,
              COALESCE(c.name, 'Penny Wise I.T') as workspace
       FROM posts p LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.status IN ('Scheduled','Posted','Missed')
         AND p.scheduled_for >= date('now','-1 day')
         AND ${ACTIVE_CLIENT_FILTER}
       ORDER BY p.scheduled_for ASC LIMIT 30`
    ).all();
    return c.json({ posts: rows.results ?? [] });
  });

  // ── Onboarding health check ───────────────────────────────────────────────
  // Public endpoint — returns only boolean readiness flags + Resend domain
  // verification status. No secrets, no customer info. Safe to leave open
  // since the data here is the same observability you'd get by attempting
  // a live signup yourself.
  app.get('/api/health/onboarding', async (c) => {
    const out: Record<string, any> = {};

    // PayPal credentials — try to fetch an OAuth token. If credentials are
    // wrong/missing this throws.
    try {
      await paypalAccessToken(c.env);
      out.paypal_credentials_ok = true;
    } catch (e: any) {
      out.paypal_credentials_ok = false;
      out.paypal_error = (e?.message || 'unknown').slice(0, 120);
    }

    // PayPal webhook ID configured (worker secret only — value not returned)
    out.paypal_webhook_id_set = !!c.env.PAYPAL_WEBHOOK_ID;

    // Resend — try to list domains and find socialaistudio.au. Many of our
    // Resend keys are scoped to "Sending access" only, which means /v1/domains
    // returns 401 with name="restricted_api_key". That's a GOOD outcome —
    // sending emails still works; we just can't introspect domain verification
    // from here. Treat that case as "key is fine, can't verify domain via API".
    if (c.env.RESEND_API_KEY) {
      try {
        const res = await fetch('https://api.resend.com/domains', {
          headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
        });
        if (res.status === 401) {
          const body = await res.json().catch(() => ({})) as { name?: string };
          if (body.name === 'restricted_api_key') {
            out.resend = {
              api_key_set: true,
              sending_only: true,
              note: 'Key is sending-only — domain status not introspectable. Verify socialaistudio.au manually in Resend dashboard.',
            };
          } else {
            out.resend = { api_key_set: true, auth_error: true };
          }
        } else if (res.ok) {
          const data = await res.json() as { data?: Array<{ name: string; status: string }> };
          const dom = (data.data || []).find(d => d.name === 'socialaistudio.au');
          out.resend = {
            api_key_set: true,
            sending_only: false,
            domain_found: !!dom,
            domain_status: dom?.status || null,
            domain_verified: dom?.status === 'verified',
          };
        } else {
          out.resend = { api_key_set: true, http_status: res.status };
        }
      } catch (e: any) {
        out.resend = { api_key_set: true, error: (e?.message || 'unknown').slice(0, 120) };
      }
    } else {
      out.resend = { api_key_set: false };
    }

    // D1 connectivity — minimal probe, no row content returned.
    try {
      const r = await c.env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>();
      out.db_ok = r?.ok === 1;
    } catch (e: any) {
      out.db_ok = false;
      out.db_error = (e?.message || 'unknown').slice(0, 120);
    }

    return c.json(out);
  });
}
