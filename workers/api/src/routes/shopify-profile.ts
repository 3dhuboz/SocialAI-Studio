// Shopify embedded-app: per-shop content-safety profile.
//
// schema_v25 added `shopify_stores.profile` as a JSON column. The
// forbidden-subjects denylist lives at `profile.forbiddenSubjects` and is
// consumed by:
//
//   - lib/profile-guards.ts → loadForbiddenSubjectsForShop
//   - routes/shopify-compose.ts (Stage 0 + post-caption + pre-image scans)
//   - routes/shopify-post-quality.ts (HARD-RULES gate in vision critique)
//   - routes/shopify-posters.ts (image-prompt scan before OpenRouter)
//
// Without a UI, merchants have no way to populate that list, so the safety
// net only protects shops whose owners happen to know to call the column
// directly. This module fixes that: a single GET/PUT pair that the Settings
// page wires into a Polaris card.
//
// Endpoints (Bearer session token from App Bridge, like every other
// /api/shopify/* route):
//
//   GET  /api/shopify/profile/denylist
//     → { forbiddenSubjects: string[] }
//
//   PUT  /api/shopify/profile/denylist
//     Body: { forbiddenSubjects: string[] }
//     → 200 { forbiddenSubjects: string[] }  (normalised + persisted)
//
// We intentionally do NOT expose the full profile JSON on GET — other keys
// (brandVoice, bannedPhrases) are reserved for future routes and leaking them
// through a generic /profile read would couple the Settings UI to fields it
// shouldn't be editing. Read-modify-write on PUT preserves any other keys
// already present in the JSON.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';
import { parseForbiddenSubjects } from '../lib/profile-guards';

// Match the bounds the main app uses elsewhere — keeps the column from
// blowing past D1's row-size sweet spot and prevents pathological per-line
// inputs (regex catastrophic backtracking is not a risk here since scanning
// uses plain `String.includes`, but a 10MB profile would still hammer parse
// time on every compose/critique call).
const MAX_ITEMS = 100;
const MAX_ITEM_LENGTH = 80;

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

// Normalise an inbound list to the same shape readers will see. Uses the
// same tokeniser the loaders use (parseForbiddenSubjects) so what the UI
// shows post-save is exactly what the pipeline will scan against.
//
// Validation rejects the request when items exceed length/count caps —
// surfacing a 400 is friendlier than silently truncating, because the
// merchant can correct the input in the UI.
function normaliseAndValidate(input: unknown): { ok: true; list: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'forbiddenSubjects must be an array of strings' };
  }
  for (const v of input) {
    if (typeof v !== 'string') {
      return { ok: false, error: 'forbiddenSubjects entries must be strings' };
    }
    if (v.length > MAX_ITEM_LENGTH) {
      return { ok: false, error: `Each entry must be ${MAX_ITEM_LENGTH} characters or fewer` };
    }
  }
  // Normalise inline — main's parseForbiddenSubjects only accepts strings,
  // but we want the array form directly (cleaner JSON storage). Same
  // tokenisation rules: trim, lowercase, dedupe, drop empties.
  const list = [
    ...new Set(
      (input as string[])
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && s.length < 60),
    ),
  ];
  if (list.length > MAX_ITEMS) {
    return { ok: false, error: `Too many entries — max ${MAX_ITEMS}` };
  }
  return { ok: true, list };
}

export function registerShopifyProfileRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── GET /api/shopify/profile/denylist ─────────────────────────────────
  // Returns the persisted denylist for the current shop. No-shop → 404 so
  // the UI can distinguish "you haven't installed yet" from "you installed
  // but the list is empty".
  app.get('/api/shopify/profile/denylist', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-profile-get:${shop}`, 60)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const row = await c.env.DB
      .prepare(`SELECT profile FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL`)
      .bind(shop)
      .first<{ profile: string | null }>();
    if (!row) return c.json({ error: 'Shop not installed' }, 404);

    if (!row.profile) return c.json({ forbiddenSubjects: [] });
    try {
      const parsed = JSON.parse(row.profile);
      return c.json({ forbiddenSubjects: parseForbiddenSubjects(parsed?.forbiddenSubjects) });
    } catch {
      // Malformed profile JSON — surface as empty rather than 500.
      // Re-saving from the UI will overwrite the bad value.
      console.warn('[shopify-profile] malformed profile JSON for', shop);
      return c.json({ forbiddenSubjects: [] });
    }
  });

  // ── PUT /api/shopify/profile/denylist ─────────────────────────────────
  // Read-modify-write the JSON column so we don't clobber sibling keys
  // (brandVoice / bannedPhrases — reserved for future UI surfaces).
  //
  // The validated list is BOTH stored AND echoed back, so the UI can render
  // the canonical form (lowercased, trimmed, deduped) the pipeline will
  // actually scan against. That feedback loop closes the gap where a
  // merchant types "Alcohol" expecting case-sensitive matching and gets
  // surprised when "alcohol" hits in a caption hours later.
  app.put('/api/shopify/profile/denylist', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-profile-put:${shop}`, 30)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const body = await c.req.json().catch(() => null) as { forbiddenSubjects?: unknown } | null;
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

    const result = normaliseAndValidate(body.forbiddenSubjects);
    if (!result.ok) return c.json({ error: result.error }, 400);
    const list = result.list;

    // Read existing profile so we preserve other reserved keys. We accept
    // a momentary race (two concurrent PUTs from the same shop) — last
    // writer wins. The Settings UI is single-pane, single-merchant, so
    // optimistic concurrency would be over-engineered for the use case.
    const row = await c.env.DB
      .prepare(`SELECT profile FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL`)
      .bind(shop)
      .first<{ profile: string | null }>();
    if (!row) return c.json({ error: 'Shop not installed' }, 404);

    let existing: Record<string, unknown> = {};
    if (row.profile) {
      try { existing = JSON.parse(row.profile) ?? {}; } catch { existing = {}; }
      // Tolerate the row holding a non-object (defensive) so a malformed
      // value doesn't infect the merged result.
      if (typeof existing !== 'object' || Array.isArray(existing) || existing === null) {
        existing = {};
      }
    }
    const merged = { ...existing, forbiddenSubjects: list };

    const upd = await c.env.DB
      .prepare(`UPDATE shopify_stores SET profile = ? WHERE shop_domain = ? AND uninstalled_at IS NULL`)
      .bind(JSON.stringify(merged), shop)
      .run();
    if (upd?.meta && typeof upd.meta.changes === 'number' && upd.meta.changes === 0) {
      return c.json({ error: 'Shop not installed' }, 404);
    }

    return c.json({ forbiddenSubjects: list });
  });
}
