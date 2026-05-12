// Public health + observability endpoints.
//
// /api/health         — uptime probe, returns { ok: true }
// /api/cron-health    — last 30 cron runs from cron_runs table (deploy
//                       monitor widget polls without auth — no PII)
// /api/post-schedule  — recent + upcoming posts feed (deploy monitor)
//
// NOTE: /api/health/onboarding intentionally stays in index.ts for now —
// it depends on paypalAccessToken which is still inline. Move both
// together when lib/paypal.ts gets extracted.
//
// Extracted from src/index.ts as Phase B step 17 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';

export function registerHealthRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/health', (c) => c.json({ ok: true, service: 'socialai-api' }));

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
    const rows = await c.env.DB.prepare(
      `SELECT p.scheduled_for, p.status, p.platform,
              substr(p.content, 1, 80) as preview,
              COALESCE(c.name, 'Penny Wise I.T') as workspace
       FROM posts p LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.status IN ('Scheduled','Posted','Missed')
         AND p.scheduled_for >= date('now','-1 day')
       ORDER BY p.scheduled_for ASC LIMIT 30`
    ).all();
    return c.json({ posts: rows.results ?? [] });
  });
}
