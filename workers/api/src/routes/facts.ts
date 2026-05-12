// Client-facts endpoints — REAL data scraped from Facebook Pages.
//
// POST /api/db/refresh-facts            → scrape calling user's own page
// POST /api/db/refresh-facts/:clientId  → scrape a specific client's page
// GET  /api/db/facts                    → read facts back (used in AI prompts)
//
// All three are thin auth+dispatch shims — the actual Graph-API scraping
// happens in lib/facebook-facts.ts (also called by cron/refresh-facts and
// the admin bootstrap endpoint).
//
// Extracted from src/index.ts as Phase B step 17 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';
import { refreshFactsForWorkspace } from '../lib/facebook-facts';

export function registerFactsRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/db/refresh-facts', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const result = await refreshFactsForWorkspace(c.env.DB, uid, null);
    return c.json(result);
  });

  app.post('/api/db/refresh-facts/:clientId', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.param('clientId');
    const result = await refreshFactsForWorkspace(c.env.DB, uid, clientId);
    return c.json(result);
  });

  // Read facts back — used by the frontend to inject into AI prompts.
  app.get('/api/db/facts', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId') || null;
    const rows = await c.env.DB.prepare(
      `SELECT fact_type, content, metadata, engagement_score, verified_at
       FROM client_facts
       WHERE user_id = ? AND COALESCE(client_id, '') = ?
       ORDER BY engagement_score DESC, verified_at DESC
       LIMIT 200`
    ).bind(uid, clientId || '').all();
    return c.json({ facts: rows.results || [] });
  });
}
