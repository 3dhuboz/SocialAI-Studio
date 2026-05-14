// Campaigns CRUD — `campaigns` table.
//
// Holds time-boxed posting campaigns (e.g. "Summer Sale 2026", "Holiday Push")
// that the smart-schedule engine uses to bias post selection. Each row scopes
// to a user (or user+client for agency-managed workspaces) and carries
// start/end dates, free-form rules text, image notes, posts_per_day target,
// and an enabled flag.
//
// As of schema_v12 each row also carries an AI research brief — so when the
// user types something like "promote my website example.com" the worker
// fetches the URL, builds a structured brief once, and the post-writer
// reuses that brief on every scheduled post in the window. Routes:
//
//   GET    /api/db/campaigns
//   POST   /api/db/campaigns
//   PUT    /api/db/campaigns/:id
//   DELETE /api/db/campaigns/:id
//   POST   /api/db/campaigns/:id/research   ← run/re-run the agent
//
// All authenticated via Clerk. The research endpoint is rate-limited (10/min
// per user) — it makes a chained web-fetch + AI call, ~$0.005 per run, so
// don't let a held-down button burn through credits.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, isRateLimited } from '../auth';
import { researchCampaign } from '../lib/campaign-research';

/** Row → API shape conversion. Mirrors the existing snake_case → camelCase
 *  pattern used elsewhere in the worker. JSON-parses brief_sources defensively. */
function rowToApi(r: any) {
  let sources: any[] = [];
  try { sources = JSON.parse(r.brief_sources || '[]'); } catch { /* tolerate corrupt rows */ }
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    startDate: r.start_date,
    endDate: r.end_date,
    rules: r.rules || '',
    imageNotes: r.image_notes || '',
    postsPerDay: r.posts_per_day,
    enabled: !!r.enabled,
    createdAt: r.created_at,
    clientId: r.client_id,
    // Research fields (schema_v12). Frontend uses these to render the
    // "✨ Researched X" reply card and the collapsible brief.
    brief: r.brief || '',
    briefSummary: r.brief_summary || '',
    briefStatus: (r.brief_status || 'idle') as 'idle' | 'researching' | 'ready' | 'failed',
    briefUpdatedAt: r.brief_updated_at,
    briefSources: sources,
  };
}

export function registerCampaignRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/db/campaigns', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId') ?? null;
    const rows = clientId
      ? await c.env.DB.prepare('SELECT * FROM campaigns WHERE user_id = ? AND client_id = ? ORDER BY start_date ASC').bind(uid, clientId).all()
      : await c.env.DB.prepare('SELECT * FROM campaigns WHERE user_id = ? AND client_id IS NULL ORDER BY start_date ASC').bind(uid).all();
    return c.json({ campaigns: (rows.results ?? []).map(rowToApi) });
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
    // If `rules` is being changed, the existing brief is now stale. Mark
    // brief_status='idle' so the frontend knows to re-research. (We don't
    // auto-trigger re-research from the PUT itself — that's the explicit
    // /research endpoint's job. Keeping the two responsibilities separate
    // means a bulk schedule update doesn't accidentally fan out N research
    // calls.)
    if (body.rules !== undefined) {
      sets.push(`brief_status = ?`);
      vals.push('idle');
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

  /**
   * POST /api/db/campaigns/:id/research
   *
   * Runs the agentic research pass synchronously: fetches any URLs in the
   * campaign rules, calls Haiku in JSON mode, and persists { brief, summary,
   * sources, status } to the campaign row. Returns the same shape the GET
   * route emits so the frontend can drop the result straight into state.
   *
   * Synchronous-on-purpose: total budget is ~10s (5s for fetch + 3-5s for
   * Haiku). Worth blocking the request — a background-job approach would
   * need polling + a queue, and we'd save maybe 4 seconds of UX. Not worth
   * the architectural cost at this volume.
   *
   * Optimistically writes brief_status='researching' BEFORE the AI call so
   * a refresh during the in-flight window shows the spinner instead of the
   * old brief. If the AI call throws, the catch block flips it back to
   * 'failed' so the UI can show a retry CTA.
   */
  app.post('/api/db/campaigns/:id/research', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    // Rate-limit chained AI + fetch calls.
    if (await isRateLimited(c.env.DB, `campaign-research:${uid}`, 10)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    }

    const campaignId = c.req.param('id');
    const row = await c.env.DB
      .prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?')
      .bind(campaignId, uid)
      .first<any>();
    if (!row) return c.json({ error: 'Campaign not found.' }, 404);

    const rules = String(row.rules || '').trim();
    if (!rules) {
      return c.json({ error: 'Add some rules text before researching — the agent has nothing to work with.' }, 400);
    }

    // Pull business context. For workspace-scoped campaigns (Agency plan),
    // the business profile lives on the clients row; otherwise it's on the
    // user's profile blob. Fall back to defaults so the AI always has *something*
    // to anchor on.
    let businessName = '';
    let businessType = 'small business';
    let businessDescription = '';
    let productsServices = '';
    let location = 'Australia';
    let tone = 'Friendly and professional';

    if (row.client_id) {
      const client = await c.env.DB
        .prepare('SELECT name, business_type, profile FROM clients WHERE id = ? AND user_id = ?')
        .bind(row.client_id, uid)
        .first<any>();
      if (client) {
        businessName = client.name || '';
        businessType = client.business_type || businessType;
        try {
          const p = JSON.parse(client.profile || '{}');
          businessDescription = p.description || '';
          productsServices = p.productsServices || p.products_services || '';
          location = p.location || location;
          tone = p.tone || tone;
        } catch { /* ignore */ }
      }
    } else {
      const user = await c.env.DB
        .prepare('SELECT profile FROM users WHERE id = ?')
        .bind(uid)
        .first<any>();
      if (user) {
        try {
          const p = JSON.parse(user.profile || '{}');
          businessName = p.name || '';
          businessType = p.businessType || p.business_type || businessType;
          businessDescription = p.description || '';
          productsServices = p.productsServices || p.products_services || '';
          location = p.location || location;
          tone = p.tone || tone;
        } catch { /* ignore */ }
      }
    }

    if (!businessName) {
      return c.json({ error: 'Set your business name in Settings first — the agent needs it for context.' }, 400);
    }

    // Mark researching so a concurrent fetch sees the in-flight state.
    await c.env.DB
      .prepare('UPDATE campaigns SET brief_status = ?, brief_updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?')
      .bind('researching', campaignId, uid)
      .run();

    const result = await researchCampaign({
      input: {
        campaignText: rules,
        campaignName: row.name,
        startDate: row.start_date,
        endDate: row.end_date,
        businessName,
        businessType,
        businessDescription,
        productsServices,
        location,
        tone,
      },
      anthropicApiKey: c.env.ANTHROPIC_API_KEY,
      openRouterApiKey: c.env.OPENROUTER_API_KEY,
    });

    // Persist whatever we got — including failures (so the UI can show a
    // retry state instead of indefinite spinner).
    await c.env.DB
      .prepare(
        `UPDATE campaigns
            SET brief = ?,
                brief_summary = ?,
                brief_status = ?,
                brief_updated_at = datetime('now'),
                brief_sources = ?
          WHERE id = ? AND user_id = ?`,
      )
      .bind(
        result.brief,
        result.summary,
        result.status,
        JSON.stringify(result.sources),
        campaignId,
        uid,
      )
      .run();

    // Read back the row so the response matches the GET shape exactly.
    const updated = await c.env.DB
      .prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?')
      .bind(campaignId, uid)
      .first<any>();
    if (result.status === 'failed') {
      return c.json({ ...rowToApi(updated), failureReason: result.failureReason }, 200);
    }
    return c.json(rowToApi(updated));
  });
}
