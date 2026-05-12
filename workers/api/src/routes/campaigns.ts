// Campaigns CRUD — `campaigns` table.
//
// Holds time-boxed posting campaigns (e.g. "Summer Sale 2026", "Holiday Push")
// that the smart-schedule engine uses to bias post selection. Each row scopes
// to a user (or user+client for agency-managed workspaces) and carries
// start/end dates, free-form rules text, image notes, posts_per_day target,
// and an enabled flag.
//
// All four endpoints are authenticated via Clerk. No internal callers — the
// frontend's Campaign panel is the only consumer — so this is the smallest,
// cleanest first route module to extract. Establishes the
// registerXRoutes(app) pattern subsequent route extractions will copy.
//
// Extracted from src/index.ts as Phase B step 16 of the route-module split
// (first routes/* file).

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';

export function registerCampaignRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/db/campaigns', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId') ?? null;
    const rows = clientId
      ? await c.env.DB.prepare('SELECT * FROM campaigns WHERE user_id = ? AND client_id = ? ORDER BY start_date ASC').bind(uid, clientId).all()
      : await c.env.DB.prepare('SELECT * FROM campaigns WHERE user_id = ? AND client_id IS NULL ORDER BY start_date ASC').bind(uid).all();
    return c.json({ campaigns: rows.results ?? [] });
  });

  app.post('/api/db/campaigns', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json<{ clientId?: string; name: string; type?: string; startDate?: string; endDate?: string; rules?: string; postsPerDay?: number; enabled?: boolean }>();
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO campaigns (id, user_id, client_id, name, type, start_date, end_date, rules, posts_per_day, enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(id, uid, body.clientId ?? null, body.name, body.type ?? 'custom', body.startDate ?? null, body.endDate ?? null, body.rules ?? '', body.postsPerDay ?? 1, body.enabled !== false ? 1 : 0).run();
    return c.json({ id });
  });

  app.put('/api/db/campaigns/:id', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const campaignId = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const fieldMap: Record<string, string> = { name: 'name', type: 'type', startDate: 'start_date', endDate: 'end_date', rules: 'rules', imageNotes: 'image_notes', postsPerDay: 'posts_per_day', enabled: 'enabled' };
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, col] of Object.entries(fieldMap)) {
      if (body[k] !== undefined) { sets.push(`${col} = ?`); vals.push(k === 'enabled' ? (body[k] ? 1 : 0) : body[k]); }
    }
    if (sets.length === 0) return c.json({ ok: true });
    vals.push(campaignId, uid);
    await c.env.DB.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...vals).run();
    return c.json({ ok: true });
  });

  app.delete('/api/db/campaigns/:id', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    await c.env.DB.prepare('DELETE FROM campaigns WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid).run();
    return c.json({ ok: true });
  });
}
