// Portal — public-facing slug-based whitelabel entry points.
//
// /api/db/portal/:slug              GET (public/secret-gated) / PUT (auth)
// /api/db/portal/:slug/content      GET (public) / PUT (auth)
//
// Each whitelabel deploy (picklenick, streetmeats, etc.) ships a different
// build of the frontend keyed by VITE_CLIENT_ID. The portal table maps a
// public slug to the owner's user_id + optional client_id so the portal
// can render the right brand and route auth + posts to the right
// workspace. GET is shared-secret-gated for full record reads — anonymous
// callers only get { exists: true, client_id } so a slug enumeration
// attacker can't extract emails or portal_tokens.
//
// Extracted from src/index.ts as Phase B step 17 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';

export function registerPortalRoutes(app: Hono<{ Bindings: Env }>): void {
  // Portal authentication endpoint.
  // PUBLIC: GET /api/db/portal/:slug returns ONLY non-sensitive existence info.
  //   Used by the portal frontend to confirm the slug is recognised.
  // AUTHENTICATED: GET /api/db/portal/:slug?secret=<x> returns the portal_token
  //   ONLY when the caller proves knowledge of a per-portal shared secret
  //   (set as VITE_PORTAL_SECRET env var on each Pages deploy).
  app.get('/api/db/portal/:slug', async (c) => {
    const slug = c.req.param('slug').toLowerCase();
    const row = await c.env.DB.prepare(
      'SELECT email, password, portal_token, user_id, client_id FROM portal WHERE slug = ?'
    ).bind(slug).first<{ email: string; password: string; portal_token: string | null; user_id: string | null; client_id: string | null }>();
    if (!row) return c.json({ portal: null }, 404);

    // Caller proved knowledge of the shared secret — return full record.
    // The "password" column is reused as the per-portal shared secret.
    const url = new URL(c.req.url);
    const providedSecret = url.searchParams.get('secret') || c.req.header('X-Portal-Secret');
    if (providedSecret && row.password && providedSecret === row.password) {
      return c.json({ portal: row });
    }

    // Anonymous response: no PII, no token. Just confirms slug exists.
    return c.json({ portal: { exists: true, client_id: row.client_id } });
  });

  app.put('/api/db/portal/:slug', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const slug = c.req.param('slug').toLowerCase();

    const body = await c.req.json<{ email: string; password: string; client_id?: string }>();
    const portalToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    // 30-day sliding window — every PUT (re-issue) refreshes expires_at
    // and clears any previous revoked_at, so admin can resurrect a
    // revoked portal by re-issuing without manually clearing the column.
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    // ── Ownership check ──────────────────────────────────────────────────
    // Pre-fix: any authenticated user could PUT any slug and either steal
    // an existing portal (overwriting its user_id) or claim an unused slug.
    // Now: if the slug exists, the row's user_id MUST match the caller's
    // uid. Brand-new slugs (no existing row) are still claimable, which is
    // the bootstrap path admins use when provisioning a new portal.
    const existing = await c.env.DB.prepare(
      'SELECT user_id FROM portal WHERE slug = ?'
    ).bind(slug).first<{ user_id: string | null }>();
    if (existing && existing.user_id && existing.user_id !== uid) {
      // 404 (not 403) — avoids confirming to an attacker which slugs are taken.
      return c.json({ error: 'Not found' }, 404);
    }
    await c.env.DB.prepare(
      `INSERT INTO portal (slug, email, password, portal_token, user_id, client_id, expires_at, revoked_at)
       VALUES (?,?,?,?,?,?,?,NULL)
       ON CONFLICT(slug) DO UPDATE SET email=excluded.email, password=excluded.password,
         portal_token=excluded.portal_token, user_id=excluded.user_id, client_id=excluded.client_id,
         expires_at=excluded.expires_at, revoked_at=NULL
       WHERE portal.user_id = excluded.user_id`
    ).bind(slug, body.email, body.password, portalToken, uid, body.client_id ?? null, expiresAt).run();
    return c.json({ ok: true, portalToken, expiresAt });
  });

  // Portal content — public GET (for rendering), authenticated PUT (for editing)
  app.get('/api/db/portal/:slug/content', async (c) => {
    const slug = c.req.param('slug').toLowerCase();
    const row = await c.env.DB.prepare(
      'SELECT hero_title, hero_subtitle, hero_cta_text FROM portal WHERE slug = ?'
    ).bind(slug).first<{ hero_title: string | null; hero_subtitle: string | null; hero_cta_text: string | null }>();
    return c.json({ content: row ?? { hero_title: '', hero_subtitle: '', hero_cta_text: '' } });
  });

  app.put('/api/db/portal/:slug/content', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const slug = c.req.param('slug').toLowerCase();
    const body = await c.req.json<{ hero_title?: string; hero_subtitle?: string; hero_cta_text?: string }>();
    const sets: string[] = []; const vals: unknown[] = [];
    if (body.hero_title !== undefined) { sets.push('hero_title = ?'); vals.push(body.hero_title); }
    if (body.hero_subtitle !== undefined) { sets.push('hero_subtitle = ?'); vals.push(body.hero_subtitle); }
    if (body.hero_cta_text !== undefined) { sets.push('hero_cta_text = ?'); vals.push(body.hero_cta_text); }
    if (sets.length === 0) return c.json({ ok: true });
    // ── Ownership-scoped UPDATE ──────────────────────────────────────────
    // Pre-fix: anyone authenticated could overwrite ANY portal's hero copy
    // by guessing the slug. Now: the WHERE clause requires the row's
    // user_id to match the caller. If meta.changes is 0, either the slug
    // doesn't exist or it's owned by someone else — return 404 either way
    // so we don't leak which slugs are taken.
    vals.push(slug, uid);
    const result = await c.env.DB.prepare(
      `UPDATE portal SET ${sets.join(', ')} WHERE slug = ? AND user_id = ?`
    ).bind(...vals).run();
    if (!result.meta || result.meta.changes === 0) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json({ ok: true });
  });
}
