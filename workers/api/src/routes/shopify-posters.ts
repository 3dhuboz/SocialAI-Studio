// Shopify embedded-app: AI poster gallery.
//
// Lets a Shopify merchant generate marketing posters/graphics from a text
// prompt, save them to a per-shop gallery, and download/share them. Backs
// the /posters page in the embedded app.
//
// Mirrors the spirit of routes/posters.ts (the main-app Poster Maker) but
// is intentionally simpler:
//   * Shop-scoped via session-token shop_domain instead of Clerk uid
//   * No plan-quota / credit-balance machinery — Shopify shops are gated
//     once at the $29/mo subscription tier; we just rate-limit generation
//   * No brand-kit override blob (no editor UI for it on the Shopify side)
//   * Image generation is done server-side via OpenRouter and persisted
//     straight to R2 — the client only ever sees a /image streaming URL
//
// All endpoints session-token gated. Errors return as JSON {error}.
//
//   POST   /api/shopify/posters             — generate + save (body: { prompt, aspectRatio? })
//   GET    /api/shopify/posters             — list newest-first (LIMIT 50)
//   GET    /api/shopify/posters/:id/image   — stream the PNG from R2
//   DELETE /api/shopify/posters/:id         — remove R2 object + D1 row
//
// Rate limits (sliding-window via auth.isRateLimited):
//   shopify-poster-gen:<shop>    → 10/min  (image gen is expensive)
//   shopify-poster-list:<shop>   → 60/min
//   shopify-poster-img:<shop>    → 60/min  (R2 streaming, low-cost)
//   shopify-poster-del:<shop>    → 30/min
//
// R2 layout: bytes stored under `shopify-posters/<id>.png` to keep them
// distinct from the main-app `posters/<id>.png` namespace so a cleanup
// pass (or accidental wildcard delete) can't conflate the two tenants.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { isRateLimited } from '../auth';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';
import { loadForbiddenSubjectsForShop, scanForForbidden } from '../lib/profile-guards';
import { requireActiveShopSubscription } from '../lib/shopify-billing';

const uuid = () => crypto.randomUUID();

const ALLOWED_ASPECT = new Set(['1:1', '9:16', '16:9']);
const MAX_PROMPT_LEN = 1000;
const GALLERY_LIMIT = 50;

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

interface PosterRow {
  id: string;
  shop_domain: string;
  prompt: string;
  aspect_ratio: string;
  image_r2_key: string;
  created_at: string;
}

function rowToApi(r: PosterRow) {
  return {
    id: r.id,
    prompt: r.prompt,
    aspectRatio: r.aspect_ratio,
    imageUrl: `/api/shopify/posters/${r.id}/image`,
    createdAt: r.created_at,
  };
}

// ── Image generation via OpenRouter ──────────────────────────────────────
// Mirrors the model fallback logic in routes/posters.ts (gemini 2.5 flash
// image preview → gemini 2.0 flash exp). Returns a data: URL on success,
// throws on total failure. We then convert the data URL to bytes and
// upload to R2 in the caller — keeps the network handling local here.

async function generatePosterImage(
  apiKey: string,
  prompt: string,
  aspectRatio: '1:1' | '9:16' | '16:9',
): Promise<{ dataUrl: string; model: string }> {
  const aspectHint =
      aspectRatio === '9:16' ? ' Tall portrait composition — subject centred top-to-bottom, suitable for a phone-story screen.'
    : aspectRatio === '16:9' ? ' Wide landscape composition — subject takes the LEFT half of the frame so a text column can sit on the right.'
    : '';

  const fullPrompt = `${prompt}.${aspectHint} No rendered text, no watermarks, no captions overlaid on the image.`;

  const imageModels = [
    'google/gemini-2.5-flash-image',
    'google/gemini-2.0-flash-exp:free',
  ];

  let lastError = '';
  for (const model of imageModels) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://app.socialaistudio.au',
          'X-Title': 'SocialAI Studio for Shopify',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: fullPrompt }],
          modalities: ['image', 'text'],
          image_config: { aspect_ratio: aspectRatio, image_size: '1K' },
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) {
        lastError = `${model}: HTTP ${res.status}`;
        continue;
      }

      const data: any = await res.json().catch(() => ({}));
      const msg = data?.choices?.[0]?.message;

      // OpenRouter has shipped three different response shapes for image
      // modality — handle all of them. Same defensive parsing as
      // routes/posters.ts /api/ai/poster-image.
      if (msg?.images?.[0]?.image_url?.url) {
        return { dataUrl: msg.images[0].image_url.url, model };
      }
      if (Array.isArray(msg?.content)) {
        const imgPart = msg.content.find((p: any) => p.type === 'image_url' || p.image_url);
        if (imgPart?.image_url?.url) return { dataUrl: imgPart.image_url.url, model };
      }
      if (typeof msg?.content === 'string' && msg.content.startsWith('data:image')) {
        return { dataUrl: msg.content, model };
      }

      lastError = `${model}: no image in response`;
    } catch (e: any) {
      lastError = `${model}: ${e?.message || String(e)}`;
    }
  }

  throw new Error(`All poster image generators failed: ${lastError}`);
}

// Convert a `data:image/...;base64,XXXX` URL into a Uint8Array we can hand
// to R2. Workers don't have node Buffer; atob + iteration is the canonical
// edge-runtime path.
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid data URL from image generator');
  const contentType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

export function registerShopifyPostersRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── POST /api/shopify/posters ─────────────────────────────────────────
  // Body: { prompt: string, aspectRatio?: '1:1'|'9:16'|'16:9' }
  // Generates an image via OpenRouter, uploads to R2, inserts a D1 row.
  app.post('/api/shopify/posters', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    const billing = await requireActiveShopSubscription(c.env, shop);
    if (!billing.ok) {
      return c.json({ error: billing.message, code: billing.code }, billing.status);
    }

    if (await isRateLimited(c.env.DB, `shopify-poster-gen:${shop}`, 10)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute' }, 429);
    }

    if (!c.env.OPENROUTER_API_KEY) {
      return c.json({ error: 'Image generation not configured' }, 500);
    }
    if (!c.env.POSTER_ASSETS) {
      return c.json({ error: 'R2 storage not configured' }, 500);
    }

    const body = await c.req.json().catch(() => ({})) as {
      prompt?: string;
      aspectRatio?: string;
    };

    const prompt = (body.prompt || '').trim();
    if (!prompt) {
      return c.json({ error: 'prompt is required' }, 400);
    }
    if (prompt.length > MAX_PROMPT_LEN) {
      return c.json({ error: `prompt too long (max ${MAX_PROMPT_LEN} chars)` }, 400);
    }
    const aspectRatio = (ALLOWED_ASPECT.has(body.aspectRatio || '') ? body.aspectRatio! : '1:1') as '1:1' | '9:16' | '16:9';

    // Forbidden-subject HARD-RULES gate before any LLM/image call. Merchants
    // declare subjects they never want depicted ("alcohol", "children",
    // competitor brand names…) via Settings → shopify_stores.profile.
    // Bail BEFORE the slow + paid image-gen leg if the prompt mentions any.
    // Same pattern as routes/posters.ts in the main app — keeps the safety
    // gate symmetric between Clerk and Shopify tenants.
    const forbiddenSubjects = await loadForbiddenSubjectsForShop(c.env, shop);
    if (forbiddenSubjects.length > 0) {
      const hit = scanForForbidden(prompt, forbiddenSubjects);
      if (hit) {
        return c.json(
          {
            error: `Prompt mentions "${hit}" which is on your shop's forbidden-subjects list. Reword the prompt or update the list in Settings.`,
            forbidden: hit,
          },
          400,
        );
      }
    }

    // Generate the image — this is the slow leg (5–20s).
    let gen: { dataUrl: string; model: string };
    try {
      gen = await generatePosterImage(c.env.OPENROUTER_API_KEY, prompt, aspectRatio);
    } catch (e: any) {
      console.error('[shopify-posters] gen failed:', e?.message);
      return c.json({ error: `Image generation failed: ${e?.message || 'unknown'}` }, 502);
    }

    // Convert + upload to R2 before the D1 row so we never end up with a
    // row that points at missing bytes. If the D1 INSERT fails after the
    // R2 put, best-effort delete keeps the bucket clean.
    const { bytes, contentType } = dataUrlToBytes(gen.dataUrl);
    const id = uuid();
    const r2Key = `shopify-posters/${id}.png`;

    try {
      await c.env.POSTER_ASSETS.put(r2Key, bytes, {
        httpMetadata: { contentType: contentType || 'image/png' },
        customMetadata: { shopDomain: shop, model: gen.model },
      });
    } catch (e: any) {
      console.error('[shopify-posters] R2 put failed:', e?.message);
      return c.json({ error: `Storage failed: ${e?.message || 'unknown'}` }, 500);
    }

    try {
      await c.env.DB.prepare(
        `INSERT INTO shopify_posters (id, shop_domain, prompt, aspect_ratio, image_r2_key)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, shop, prompt, aspectRatio, r2Key).run();
    } catch (e: any) {
      // Clean up the R2 orphan — best-effort.
      try { await c.env.POSTER_ASSETS.delete(r2Key); } catch { /* tolerate */ }
      console.error('[shopify-posters] D1 insert failed:', e?.message);
      return c.json({ error: `DB write failed: ${e?.message || 'unknown'}` }, 500);
    }

    const row = await c.env.DB.prepare(
      `SELECT id, shop_domain, prompt, aspect_ratio, image_r2_key, created_at
         FROM shopify_posters WHERE id = ?`,
    ).bind(id).first<PosterRow>();

    return c.json(row ? rowToApi(row) : { id, prompt, aspectRatio, imageUrl: `/api/shopify/posters/${id}/image`, createdAt: new Date().toISOString() }, 201);
  });

  // ── GET /api/shopify/posters ──────────────────────────────────────────
  // Returns the shop's gallery, newest-first, up to GALLERY_LIMIT.
  app.get('/api/shopify/posters', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-poster-list:${shop}`, 60)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const { results } = await c.env.DB.prepare(
      `SELECT id, shop_domain, prompt, aspect_ratio, image_r2_key, created_at
         FROM shopify_posters
        WHERE shop_domain = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    ).bind(shop, GALLERY_LIMIT).all<PosterRow>();

    return c.json({ items: (results || []).map(rowToApi) });
  });

  // ── GET /api/shopify/posters/:id/image ────────────────────────────────
  // Streams the R2 PNG back. Shop-scoped — a shop can only read its own.
  app.get('/api/shopify/posters/:id/image', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-poster-img:${shop}`, 60)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
      `SELECT image_r2_key FROM shopify_posters WHERE id = ? AND shop_domain = ?`,
    ).bind(id, shop).first<{ image_r2_key: string | null }>();

    if (!row || !row.image_r2_key) return c.json({ error: 'not found' }, 404);
    if (!c.env.POSTER_ASSETS) return c.json({ error: 'R2 not configured' }, 500);

    const obj = await c.env.POSTER_ASSETS.get(row.image_r2_key);
    if (!obj) return c.json({ error: 'image bytes missing' }, 404);

    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/png',
        // Short cache — the same poster ID always serves the same bytes,
        // and the client uses a stable URL keyed on id. 5min is enough
        // to amortise repeated renders without breaking the "delete and
        // it's gone" expectation.
        'Cache-Control': 'private, max-age=300',
      },
    });
  });

  // ── DELETE /api/shopify/posters/:id ───────────────────────────────────
  // Drops the R2 object then the D1 row. R2 errors don't block the D1
  // delete — same pattern as routes/posters.ts to keep the gallery clean
  // even if the bucket op transiently fails.
  app.delete('/api/shopify/posters/:id', async (c) => {
    const sessionOrResp = await requireSession(c);
    if (sessionOrResp instanceof Response) return sessionOrResp;
    const shop = sessionOrResp.shopDomain;

    if (await isRateLimited(c.env.DB, `shopify-poster-del:${shop}`, 30)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
      `SELECT image_r2_key FROM shopify_posters WHERE id = ? AND shop_domain = ?`,
    ).bind(id, shop).first<{ image_r2_key: string | null }>();
    if (!row) return c.json({ error: 'not found' }, 404);

    if (row.image_r2_key && c.env.POSTER_ASSETS) {
      try { await c.env.POSTER_ASSETS.delete(row.image_r2_key); }
      catch (e: any) { console.warn('[shopify-posters] R2 delete failed:', e?.message); }
    }
    await c.env.DB.prepare(
      `DELETE FROM shopify_posters WHERE id = ? AND shop_domain = ?`,
    ).bind(id, shop).run();

    return c.json({ ok: true });
  });
}
