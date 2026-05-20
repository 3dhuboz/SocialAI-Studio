// Shopify embedded-app: shop-scoped marketing campaigns.
//
// A campaign is a date-ranged marketing theme + goal that the AI Autopilot
// weaves into every post generated during its window. Examples:
//
//   { name: 'Black Friday',     goal: 'Drive 30% sales spike', theme: 'urgency, neon, dark backgrounds' }
//   { name: 'Christmas 2026',   goal: 'Gift-guide positioning', theme: 'warm cosy palette, holly accents' }
//
// The autopilot generator looks up the currently-active campaign (one
// where start_at <= now <= end_at) and stitches its goal/theme into the
// LLM user prompt — so a "Black Friday" campaign will naturally pull
// hashtags and copy that reference the sale even from generic product info.
//
// Endpoints (all session-token gated):
//
//   GET    /api/shopify/campaigns          — list, newest first
//   POST   /api/shopify/campaigns          — create
//   PATCH  /api/shopify/campaigns/:id      — update name/goal/theme/dates
//   DELETE /api/shopify/campaigns/:id      — drop
//   GET    /api/shopify/campaigns/active   — convenience: returns the
//                                            currently-active campaign or null
//
// Rate limit: 60/min per shop (these are pure D1 ops).

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';

const RATE_LIMIT_PER_MIN = 60;
const MAX_NAME_LEN = 120;
const MAX_GOAL_LEN = 400;
const MAX_THEME_LEN = 400;

function requireShopifyConfig(env: Env): { key: string; secret: string } | null {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) return null;
  return { key: env.SHOPIFY_API_KEY, secret: env.SHOPIFY_API_SECRET };
}

async function requireSession(c: any): Promise<VerifiedSession | Response> {
  const cfg = requireShopifyConfig(c.env);
  if (!cfg) return c.json({ error: 'Shopify app not configured' }, 500);
  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const session = await verifySessionToken(auth.slice(7), cfg.key, cfg.secret);
  if (!session) return c.json({ error: 'Invalid session token' }, 401);
  return session;
}

interface CampaignRow {
  id: string;
  shop_domain: string;
  name: string;
  goal: string | null;
  theme: string | null;
  start_at: string;
  end_at: string | null;
  created_at: string;
}

function rowToApi(r: CampaignRow) {
  const now = Date.now();
  const startMs = Date.parse(r.start_at);
  const endMs = r.end_at ? Date.parse(r.end_at) : Infinity;
  const isActive = startMs <= now && now <= endMs;
  return {
    id: r.id,
    name: r.name,
    goal: r.goal,
    theme: r.theme,
    startAt: r.start_at,
    endAt: r.end_at,
    createdAt: r.created_at,
    isActive,
  };
}

// Validate + coerce a campaign body. Returns either { ok: false, error } or
// the normalised fields.
function parseCampaignBody(body: any, partial: boolean) {
  if (!body || typeof body !== 'object') {
    return { ok: false as const, error: 'Body must be a JSON object' };
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LEN) : '';
  if (!partial && !name) return { ok: false as const, error: 'name is required' };

  const goal = typeof body.goal === 'string' ? body.goal.trim().slice(0, MAX_GOAL_LEN) : '';
  const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, MAX_THEME_LEN) : '';

  const startAtRaw = typeof body.startAt === 'string' ? body.startAt : (typeof body.start_at === 'string' ? body.start_at : '');
  const endAtRaw = typeof body.endAt === 'string' ? body.endAt : (typeof body.end_at === 'string' ? body.end_at : '');

  let startAt: string | null = null;
  let endAt: string | null = null;
  if (startAtRaw) {
    const ms = Date.parse(startAtRaw);
    if (Number.isNaN(ms)) return { ok: false as const, error: 'startAt must be ISO datetime' };
    startAt = new Date(ms).toISOString();
  } else if (!partial) {
    return { ok: false as const, error: 'startAt is required' };
  }

  if (endAtRaw) {
    const ms = Date.parse(endAtRaw);
    if (Number.isNaN(ms)) return { ok: false as const, error: 'endAt must be ISO datetime or empty' };
    endAt = new Date(ms).toISOString();
    if (startAt && Date.parse(endAt) <= Date.parse(startAt)) {
      return { ok: false as const, error: 'endAt must be after startAt' };
    }
  }

  return { ok: true as const, name, goal: goal || null, theme: theme || null, startAt, endAt };
}

export function registerShopifyCampaignRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── GET /api/shopify/campaigns ─────────────────────────────────────────
  app.get('/api/shopify/campaigns', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-camp-list:${shop}`, RATE_LIMIT_PER_MIN)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const { results } = await c.env.DB.prepare(
      `SELECT id, shop_domain, name, goal, theme, start_at, end_at, created_at
         FROM shopify_campaigns
        WHERE shop_domain = ?
        ORDER BY created_at DESC
        LIMIT 100`,
    ).bind(shop).all<CampaignRow>();

    return c.json({ items: (results || []).map(rowToApi) });
  });

  // ── GET /api/shopify/campaigns/active ─────────────────────────────────
  app.get('/api/shopify/campaigns/active', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-camp-active:${shop}`, RATE_LIMIT_PER_MIN)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const now = new Date().toISOString();
    const row = await c.env.DB.prepare(
      `SELECT id, shop_domain, name, goal, theme, start_at, end_at, created_at
         FROM shopify_campaigns
        WHERE shop_domain = ?
          AND start_at <= ?
          AND (end_at IS NULL OR end_at >= ?)
        ORDER BY created_at DESC
        LIMIT 1`,
    ).bind(shop, now, now).first<CampaignRow>();

    return c.json({ active: row ? rowToApi(row) : null });
  });

  // ── POST /api/shopify/campaigns ────────────────────────────────────────
  app.post('/api/shopify/campaigns', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-camp-create:${shop}`, RATE_LIMIT_PER_MIN)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = parseCampaignBody(body, false);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO shopify_campaigns (id, shop_domain, name, goal, theme, start_at, end_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, shop, parsed.name, parsed.goal, parsed.theme, parsed.startAt, parsed.endAt).run();

    const row = await c.env.DB.prepare(
      `SELECT id, shop_domain, name, goal, theme, start_at, end_at, created_at
         FROM shopify_campaigns WHERE id = ?`,
    ).bind(id).first<CampaignRow>();

    return c.json(row ? rowToApi(row) : { id }, 201);
  });

  // ── PATCH /api/shopify/campaigns/:id ───────────────────────────────────
  app.patch('/api/shopify/campaigns/:id', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-camp-update:${shop}`, RATE_LIMIT_PER_MIN)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT id FROM shopify_campaigns WHERE id = ? AND shop_domain = ?`,
    ).bind(id, shop).first();
    if (!existing) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = parseCampaignBody(body, true);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    // Build dynamic UPDATE — only set fields the body included.
    const sets: string[] = [];
    const args: any[] = [];
    if (typeof body?.name === 'string') { sets.push('name = ?'); args.push(parsed.name); }
    if ('goal' in (body ?? {})) { sets.push('goal = ?'); args.push(parsed.goal); }
    if ('theme' in (body ?? {})) { sets.push('theme = ?'); args.push(parsed.theme); }
    if (parsed.startAt) { sets.push('start_at = ?'); args.push(parsed.startAt); }
    if ('endAt' in (body ?? {}) || 'end_at' in (body ?? {})) { sets.push('end_at = ?'); args.push(parsed.endAt); }

    if (sets.length === 0) return c.json({ error: 'Nothing to update' }, 400);

    args.push(id, shop);
    await c.env.DB.prepare(
      `UPDATE shopify_campaigns SET ${sets.join(', ')} WHERE id = ? AND shop_domain = ?`,
    ).bind(...args).run();

    const row = await c.env.DB.prepare(
      `SELECT id, shop_domain, name, goal, theme, start_at, end_at, created_at
         FROM shopify_campaigns WHERE id = ?`,
    ).bind(id).first<CampaignRow>();
    return c.json(row ? rowToApi(row) : { id });
  });

  // ── DELETE /api/shopify/campaigns/:id ──────────────────────────────────
  app.delete('/api/shopify/campaigns/:id', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-camp-delete:${shop}`, RATE_LIMIT_PER_MIN)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const id = c.req.param('id');
    const result = await c.env.DB.prepare(
      `DELETE FROM shopify_campaigns WHERE id = ? AND shop_domain = ?`,
    ).bind(id, shop).run();

    if (result?.meta && typeof result.meta.changes === 'number' && result.meta.changes === 0) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json({ ok: true });
  });
}
