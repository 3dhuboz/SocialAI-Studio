// Poster Maker — persistent gallery + per-workspace brand-kit overrides +
// AI image generation for the standalone Poster Maker feature (ported from
// the hughesysque whitelabel build, promoted to a first-class SocialAI Studio
// tool).
//
// 7 endpoints. All authenticated via Clerk. Workspace scoping mirrors posts:
//   client_id IS NULL  → the agency owner's own workspace
//   client_id = <id>   → a specific client workspace (Agency-plan multi-client)
//
// Routes:
//   GET    /api/db/posters                  — gallery list (newest-first)
//   POST   /api/db/posters                  — create (multipart/form-data: PNG + JSON inputs)
//   GET    /api/db/posters/:id/image        — stream the R2 PNG back to the browser
//   PATCH  /api/db/posters/:id              — update (scheduled_at only)
//   DELETE /api/db/posters/:id              — remove D1 row + R2 object
//   GET    /api/db/poster-brand-kit         — fetch per-workspace BrandKitOverrides
//   PUT    /api/db/poster-brand-kit         — replace BrandKitOverrides (total-replace semantics)
//   POST   /api/ai/poster-image             — OpenRouter image gen (specialised vs /api/ai/generate)
//
// PNG bytes live in R2 (binding POSTER_ASSETS, key `posters/<id>.png`); the D1
// row holds metadata + the R2 key + an optional schedule. The 5MB poster cap
// is enforced on create; the 64KB brand-kit cap stops a runaway editor from
// poisoning the row with megabytes of JSON.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, isRateLimited } from '../auth';
import { POSTER_QUOTA_PER_MONTH, PLAN_INCLUDES_POSTERS, userHasFeature } from '../lib/pricing';

const uuid = () => crypto.randomUUID();

const POSTER_MAX_BYTES = 5 * 1024 * 1024;
const POSTER_BRAND_KIT_MAX_BYTES = 64 * 1024;

/** Normalise the workspace id read from ?clientId= or body — '' means own. */
function normalizeClientId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed ? trimmed : null;
}

/**
 * Plan-tier + per-user override gate for poster mutations. Frontend hides
 * the tab via CLIENT.plans[].includes.posters PLUS the per-user override;
 * this is the matching server-side guard so a curl'd request from a trial /
 * non-included plan still gets rejected.
 *
 * Resolution order (see lib/pricing.ts userHasFeature):
 *   1. users.addon_features.posters === true  → GRANTED
 *   2. users.addon_features.posters === false → REVOKED
 *   3. else → plan tier default (PLAN_INCLUDES_POSTERS)
 *
 * Read-only endpoints (gallery, image stream, usage) intentionally don't gate
 * here — a user who downgrades after creating posters can still see/delete
 * what they already made. Only CREATE actions are blocked.
 */
async function readUserPlanAndAddons(
  db: D1Database,
  uid: string,
): Promise<{ plan: string | null; addonFeatures: string | null; posterCredits: number }> {
  const row = await db
    .prepare('SELECT plan, addon_features, poster_credits FROM users WHERE id = ?')
    .bind(uid)
    .first<{ plan: string | null; addon_features: string | null; poster_credits: number | null }>();
  return {
    plan: row?.plan || null,
    addonFeatures: row?.addon_features || null,
    posterCredits: Number(row?.poster_credits ?? 0),
  };
}
async function userMayUsePosters(db: D1Database, uid: string): Promise<boolean> {
  const { plan, addonFeatures } = await readUserPlanAndAddons(db, uid);
  return userHasFeature('posters', plan, addonFeatures);
}

/**
 * Read the user's current month poster usage + quota in one shot. Counts ALL
 * posters this user owns across workspaces (Agency-plan users share quota
 * across all their client workspaces — matches the AI Reels credit model
 * where the agency owner pays once for the whole multi-client pool).
 *
 * The "this month" window is anchored to UTC `start of month` — D1's SQLite
 * supports the modifier directly, no JS date maths needed. created_at is
 * stamped by `datetime('now')` on INSERT (see POST /api/db/posters), so
 * comparison stays consistent.
 */
async function getPosterUsage(db: D1Database, userId: string): Promise<{
  used: number;
  quota: number;
  plan: string;
  /** Lifetime admin-gifted/purchased credits, additive on top of plan quota. */
  credits: number;
  /** Whether the per-user override is granting posters (plan tier might not). */
  hasAccess: boolean;
  /** Plan-quota-only remaining (does NOT count credits). */
  remaining: number;
  /** Total remaining including credits — what the UI should display. */
  totalRemaining: number;
}> {
  const { plan, addonFeatures, posterCredits } = await readUserPlanAndAddons(db, userId);
  // No fallback to starter here — a trial user (plan IS NULL) or a user on a
  // plan that doesn't include posters gets quota=0, which surfaces as a
  // first-class "upgrade required" state in the usage endpoint instead of
  // silently giving them 3 free posters/month.
  const planSafe = plan || 'none';
  const planQuota = PLAN_INCLUDES_POSTERS.has(planSafe) ? POSTER_QUOTA_PER_MONTH[planSafe] : 0;
  const hasAccess = userHasFeature('posters', plan, addonFeatures);

  const usageRow = await db
    .prepare(
      `SELECT COUNT(*) AS used FROM posters
       WHERE user_id = ? AND created_at >= datetime('now', 'start of month')`,
    )
    .bind(userId)
    .first<{ used: number }>();
  const used = Number(usageRow?.used ?? 0);
  const remaining = Math.max(0, planQuota - used);

  return {
    used,
    quota: planQuota,
    plan: planSafe,
    credits: posterCredits,
    hasAccess,
    remaining,
    totalRemaining: remaining + posterCredits,
  };
}

/** Row → API shape conversion. snake_case to camelCase + JSON-parse content. */
function posterRowToApi(r: any) {
  let inputs: any = {};
  try { inputs = JSON.parse(r.content_inputs || '{}'); } catch { /* tolerate corrupt rows */ }
  return {
    id: r.id,
    contentInputs: inputs,
    imageUrl: r.image_r2_key ? `/api/db/posters/${r.id}/image` : null,
    brandName: r.brand_name,
    createdBy: r.user_id,
    createdAt: r.created_at,
    scheduledAt: r.scheduled_at,
    clientId: r.client_id,
  };
}

export function registerPostersRoutes(app: Hono<{ Bindings: Env }>): void {
  // GET /api/db/posters?clientId=<id?>
  // List the current workspace's gallery, newest-first.
  app.get('/api/db/posters', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    const clientId = normalizeClientId(c.req.query('clientId'));
    const limitRaw = Number(c.req.query('limit')) || 30;
    const limit = Math.min(100, Math.max(1, limitRaw));

    const stmt = clientId == null
      ? c.env.DB.prepare(
          `SELECT id, user_id, client_id, content_inputs, image_r2_key, brand_name,
                  created_at, scheduled_at
           FROM posters WHERE user_id = ? AND client_id IS NULL
           ORDER BY created_at DESC LIMIT ?`,
        ).bind(uid, limit)
      : c.env.DB.prepare(
          `SELECT id, user_id, client_id, content_inputs, image_r2_key, brand_name,
                  created_at, scheduled_at
           FROM posters WHERE user_id = ? AND client_id = ?
           ORDER BY created_at DESC LIMIT ?`,
        ).bind(uid, clientId, limit);

    const { results } = await stmt.all();
    return c.json({ items: (results ?? []).map(posterRowToApi) });
  });

  // GET /api/db/posters-usage
  // Returns { used, quota, plan, remaining } for the current month. Frontend
  // shows this as the "X of Y this month" counter on the Poster Maker UI +
  // surfaces an upgrade CTA when remaining hits zero.
  app.get('/api/db/posters-usage', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const usage = await getPosterUsage(c.env.DB, uid);
    return c.json(usage);
  });

  // POST /api/db/posters
  // multipart/form-data with fields:
  //   image            — the rendered PNG (required, ≤5MB)
  //   content_inputs   — JSON-stringified form snapshot (required)
  //   brand_name       — display brand (optional)
  //   client_id        — workspace id, empty/missing = own workspace (optional)
  //   scheduled_at     — ISO datetime string (optional)
  // R2 PUT happens first so a failed bucket write doesn't leave a D1 row pointing
  // at missing bytes. If the D1 INSERT fails after the R2 PUT, we best-effort
  // delete the orphan; if even that fails, it's a cheap object until the future
  // cleanup cron.
  app.post('/api/db/posters', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    // Feature gate — fails closed before we touch the form data. Resolves
    // plan tier default + per-user override (admin can grant/revoke posters
    // independent of plan). Frontend mirrors this resolution.
    if (!await userMayUsePosters(c.env.DB, uid)) {
      return c.json({ error: 'Poster Maker is not included in your current plan.' }, 403);
    }

    // Quota gate — anchored to UTC start-of-month. Plan quota first, then
    // fall through to admin-gifted/purchased credits (lifetime carry-over).
    // 429 (Too Many Requests) for the no-headroom case; the response carries
    // both balances so the UI can show "0 monthly + 0 credits — upgrade".
    const usage = await getPosterUsage(c.env.DB, uid);
    const usingCredit = usage.used >= usage.quota;
    if (usingCredit && usage.credits === 0) {
      return c.json(
        {
          error: usage.quota > 0
            ? `Monthly poster limit reached (${usage.used} of ${usage.quota} on the ${usage.plan} plan), and no add-on credits available. Upgrade or buy a credit pack.`
            : `Your plan doesn't include posters and you have no add-on credits. Upgrade or ask your admin for credits.`,
          used: usage.used,
          quota: usage.quota,
          plan: usage.plan,
          credits: usage.credits,
          remaining: 0,
        },
        429,
      );
    }

    if (!c.env.POSTER_ASSETS) {
      return c.json(
        { error: 'POSTER_ASSETS R2 binding not configured on worker — see wrangler.toml.' },
        500,
      );
    }

    const ct = c.req.header('Content-Type') || '';
    if (!ct.includes('multipart/form-data')) {
      return c.json({ error: 'Expected multipart/form-data (image + content_inputs).' }, 400);
    }

    const fd = await c.req.raw.formData();
    const imageRaw = fd.get('image');
    const inputsRaw = fd.get('content_inputs');
    const brandName = (fd.get('brand_name') || '').toString().slice(0, 120) || null;
    const clientId  = normalizeClientId((fd.get('client_id') || '').toString() || null);
    const scheduledRaw = (fd.get('scheduled_at') || '').toString().trim();
    const scheduledAt  = scheduledRaw || null;

    // Duck-type the File check: workers-types declares File as an interface, not
    // a runtime constructor, so `instanceof File` fails to compile. Inspect the
    // shape (`.size` + `.stream()` are guaranteed by the FormData spec for file
    // entries) instead. `typeof imageRaw === 'string'` weeds out the text-field
    // case where the form upload sent the field as text rather than a blob.
    if (!imageRaw || typeof imageRaw === 'string') {
      return c.json({ error: 'image field missing or empty.' }, 400);
    }
    const image = imageRaw as unknown as { size: number; stream(): ReadableStream };
    if (!image.size) {
      return c.json({ error: 'image field is empty.' }, 400);
    }
    if (image.size > POSTER_MAX_BYTES) {
      return c.json({ error: `image too large (${image.size} bytes; max ${POSTER_MAX_BYTES}).` }, 413);
    }
    if (typeof inputsRaw !== 'string' || !inputsRaw) {
      return c.json({ error: 'content_inputs field missing.' }, 400);
    }

    let inputs: unknown;
    try {
      inputs = JSON.parse(inputsRaw);
      if (!inputs || typeof inputs !== 'object') throw new Error('not an object');
    } catch (e: any) {
      return c.json({ error: `content_inputs is not valid JSON: ${e?.message}` }, 400);
    }

    // If the client supplied a clientId, validate it really belongs to this user
    // (or is the on-hold passthrough — currently we just verify ownership). Stops
    // a logged-in user injecting another user's clientId into the body.
    if (clientId != null) {
      const owns = await c.env.DB
        .prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?')
        .bind(clientId, uid)
        .first();
      if (!owns) return c.json({ error: 'clientId does not belong to this user.' }, 403);
    }

    const id = uuid();
    const r2Key = `posters/${id}.png`;

    try {
      await c.env.POSTER_ASSETS.put(r2Key, image.stream(), {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          userId: uid,
          clientId: clientId || '',
          brand: brandName || '',
        },
      });
    } catch (e: any) {
      console.error('[posters] R2 put failed:', e?.message || e);
      return c.json({ error: `R2 upload failed: ${e?.message || 'unknown'}` }, 500);
    }

    try {
      await c.env.DB.prepare(
        `INSERT INTO posters (id, user_id, client_id, content_inputs, image_r2_key,
                               brand_name, created_at, scheduled_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      ).bind(id, uid, clientId, JSON.stringify(inputs), r2Key, brandName, scheduledAt).run();
    } catch (e: any) {
      // Best-effort cleanup so we don't accumulate orphans on D1 errors.
      try { await c.env.POSTER_ASSETS.delete(r2Key); } catch { /* ignore */ }
      console.error('[posters] D1 insert failed:', e?.message || e);
      return c.json({ error: `D1 insert failed: ${e?.message || 'unknown'}` }, 500);
    }

    // Decrement add-on credit balance if this poster was paid for from
    // credits rather than the monthly plan quota. SQLite doesn't have a
    // CHECK on poster_credits ≥ 0 — we already gated above on `credits > 0`,
    // and the GREATEST clamp here is belt-and-braces against a race where
    // two concurrent posts both saw credits=1.
    if (usingCredit) {
      await c.env.DB
        .prepare('UPDATE users SET poster_credits = MAX(0, poster_credits - 1) WHERE id = ?')
        .bind(uid)
        .run();
    }

    // Read back the row so the response carries the canonical created_at the DB
    // stamped, matching the GET shape exactly.
    const row = await c.env.DB
      .prepare(
        `SELECT id, user_id, client_id, content_inputs, image_r2_key, brand_name,
                created_at, scheduled_at FROM posters WHERE id = ?`,
      ).bind(id).first();
    return c.json(posterRowToApi(row), 201);
  });

  // GET /api/db/posters/:id/image — stream the R2 PNG back to the browser.
  // Workspace-scoped: a user can only fetch their own posters' bytes. The auth
  // row read also makes sure the URL resolves to a real poster (not a guessable
  // R2 path).
  app.get('/api/db/posters/:id/image', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    const id = c.req.param('id');
    const row = await c.env.DB
      .prepare('SELECT image_r2_key FROM posters WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<{ image_r2_key: string | null }>();
    if (!row || !row.image_r2_key) return c.json({ error: 'not found' }, 404);
    if (!c.env.POSTER_ASSETS) return c.json({ error: 'R2 not configured' }, 500);

    const obj = await c.env.POSTER_ASSETS.get(row.image_r2_key);
    if (!obj) return c.json({ error: 'image bytes missing in R2' }, 404);

    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/png',
        'Cache-Control': 'private, max-age=300',
      },
    });
  });

  // PATCH /api/db/posters/:id — currently scoped to scheduled_at only.
  // Body: { scheduledAt: string | null }
  // Content inputs are immutable record-of-what-was-rendered; if the admin wants
  // different copy, they "Use as base" to clone+re-render.
  app.patch('/api/db/posters/:id', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    const id = c.req.param('id');
    let body: any;
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Body must be JSON.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Body must be a JSON object.' }, 400);
    }
    if (!('scheduledAt' in body)) {
      return c.json({ error: 'Nothing to update (only scheduledAt is supported).' }, 400);
    }

    let newScheduledAt: string | null;
    if (body.scheduledAt === null) {
      newScheduledAt = null;
    } else if (typeof body.scheduledAt === 'string' && body.scheduledAt.trim()) {
      // Tolerate ISO datetimes; we store the raw string.
      newScheduledAt = body.scheduledAt.trim().slice(0, 32);
    } else {
      return c.json({ error: 'scheduledAt must be an ISO datetime string or null.' }, 400);
    }

    const existing = await c.env.DB
      .prepare('SELECT id FROM posters WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first();
    if (!existing) return c.json({ error: 'not found' }, 404);

    await c.env.DB
      .prepare('UPDATE posters SET scheduled_at = ? WHERE id = ? AND user_id = ?')
      .bind(newScheduledAt, id, uid)
      .run();

    return c.json({ id, scheduledAt: newScheduledAt });
  });

  // DELETE /api/db/posters/:id — removes the D1 row + the R2 object.
  // R2 first; if R2 fails we still drop the D1 row so the gallery doesn't show a
  // tombstone the user can't dismiss.
  app.delete('/api/db/posters/:id', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    const id = c.req.param('id');
    const row = await c.env.DB
      .prepare('SELECT image_r2_key FROM posters WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<{ image_r2_key: string | null }>();
    if (!row) return c.json({ error: 'not found' }, 404);

    if (row.image_r2_key && c.env.POSTER_ASSETS) {
      try { await c.env.POSTER_ASSETS.delete(row.image_r2_key); }
      catch (e: any) { console.warn('[posters/delete] R2 delete failed:', e?.message || e); }
    }
    await c.env.DB.prepare('DELETE FROM posters WHERE id = ? AND user_id = ?').bind(id, uid).run();
    return c.json({ success: true });
  });

  // GET /api/db/poster-brand-kit?clientId=<id?>
  // Fetch the per-workspace BrandKitOverrides blob (palette, voice, presets, QR
  // defaults). Returns { overrides: {}, updatedAt: 0 } if no overrides yet.
  app.get('/api/db/poster-brand-kit', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    // poster_brand_kit stores '' (empty string) for the own-workspace case, not
    // NULL, so the composite PK gives single-row semantics. Normalise here at
    // the boundary.
    const clientId = normalizeClientId(c.req.query('clientId')) ?? '';
    const row = await c.env.DB
      .prepare('SELECT overrides, updated_at FROM poster_brand_kit WHERE user_id = ? AND client_id = ?')
      .bind(uid, clientId)
      .first<{ overrides: string; updated_at: string }>();

    if (!row) return c.json({ overrides: {}, updatedAt: 0 });

    let parsed: unknown = {};
    try { parsed = JSON.parse(row.overrides || '{}'); } catch { /* corrupt → empty */ }
    return c.json({
      overrides: parsed && typeof parsed === 'object' ? parsed : {},
      updatedAt: Date.parse(row.updated_at) || 0,
    });
  });

  // PUT /api/db/poster-brand-kit?clientId=<id?>
  // Body: { overrides: BrandKitOverrides }
  // Total-replace semantics (NOT deep-merge): the editor needs to be able to
  // DELETE a previously-set override (e.g. drop a banned phrase), which a merge
  // can't express. Matches the hughesysque-origin /api/v1/posters/brand-kit
  // route's behaviour by design.
  app.put('/api/db/poster-brand-kit', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (!await userMayUsePosters(c.env.DB, uid)) {
      return c.json({ error: 'Poster Maker is not included in your current plan.' }, 403);
    }

    const clientId = normalizeClientId(c.req.query('clientId')) ?? '';

    let body: any;
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Body must be JSON.' }, 400); }
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be a JSON object with an `overrides` field.' }, 400);
    }
    const overrides = body.overrides;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return c.json({ error: '`overrides` must be a JSON object.' }, 400);
    }
    const serialised = JSON.stringify(overrides);
    if (serialised.length > POSTER_BRAND_KIT_MAX_BYTES) {
      return c.json(
        { error: `Override blob too large (${serialised.length} bytes; max ${POSTER_BRAND_KIT_MAX_BYTES}).` },
        413,
      );
    }

    // Upsert pattern using ON CONFLICT — D1's SQLite supports this on the
    // composite primary key (user_id, client_id).
    await c.env.DB
      .prepare(
        `INSERT INTO poster_brand_kit (user_id, client_id, overrides, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, client_id) DO UPDATE SET
           overrides  = excluded.overrides,
           updated_at = excluded.updated_at`,
      )
      .bind(uid, clientId, serialised)
      .run();

    return c.json({ overrides, updatedAt: Date.now() });
  });

  // POST /api/ai/poster-image
  // Body: { prompt: string, aspectRatio?: '1:1' | '9:16' | '16:9' }
  // Returns: { dataUrl: string } — the data URL the browser can drop into an
  // <img> or a canvas drawImage().
  // Sibling of /api/ai/generate but specialised for image-modality output —
  // OpenRouter's image config differs from the text completion request shape.
  app.post('/api/ai/poster-image', async (c) => {
    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'OpenRouter API key not configured on worker.' }, 500);

    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (!await userMayUsePosters(c.env.DB, uid)) {
      return c.json({ error: 'Poster Maker is not included in your current plan.' }, 403);
    }

    // Image gen is more expensive than text — lower rate-limit ceiling (10/min
    // per user) so a held-down Generate button can't burn through credits.
    if (await isRateLimited(c.env.DB, `ai-image:${uid}`, 10)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    }

    let body: { prompt?: string; aspectRatio?: '1:1' | '9:16' | '16:9' };
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Invalid JSON body.' }, 400); }
    const prompt = (body.prompt || '').trim();
    if (!prompt) return c.json({ error: 'prompt is required.' }, 400);

    const aspectRatio: '1:1' | '9:16' | '16:9' =
      body.aspectRatio === '9:16' || body.aspectRatio === '16:9' ? body.aspectRatio : '1:1';

    // Aspect-ratio hint paired with image_config improves framing (image_config
    // alone gives the dimensions but the model still composes the subject for a
    // square unless we cue it explicitly).
    const aspectHint =
        aspectRatio === '9:16' ? ' Tall portrait composition — subject centred top-to-bottom, suitable for a phone-story screen.'
      : aspectRatio === '16:9' ? ' Wide landscape composition — subject takes the LEFT half of the frame so a text column can sit on the right.'
      : '';
    const fullPrompt = `${prompt}.${aspectHint} No rendered text, no watermarks, no captions overlaid on the image.`;

    const imageModels = [
      'google/gemini-2.5-flash-image',
      'google/gemini-2.0-flash-exp:free',
    ];

    for (const model of imageModels) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://socialaistudio.au',
            'X-Title': 'SocialAI Studio',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: fullPrompt }],
            modalities: ['image', 'text'],
            image_config: { aspect_ratio: aspectRatio, image_size: '1K' },
          }),
        });

        if (!res.ok) {
          console.warn(`[poster-image] OpenRouter (${model}):`, res.status);
          continue;
        }

        const data: any = await res.json().catch(() => ({}));
        const msg = data?.choices?.[0]?.message;

        // Three response shapes seen in the wild — handle them all.
        if (msg?.images?.[0]?.image_url?.url) {
          return c.json({ dataUrl: msg.images[0].image_url.url });
        }
        if (Array.isArray(msg?.content)) {
          const imgPart = msg.content.find((p: any) => p.type === 'image_url' || p.image_url);
          if (imgPart?.image_url?.url) return c.json({ dataUrl: imgPart.image_url.url });
        }
        if (typeof msg?.content === 'string' && msg.content.startsWith('data:image')) {
          return c.json({ dataUrl: msg.content });
        }

        console.warn(`[poster-image] no image in response from ${model}`);
      } catch (e: any) {
        console.warn(`[poster-image] ${model} threw:`, e?.message || e);
      }
    }

    return c.json({ error: 'All poster image generation models failed.' }, 500);
  });
}
