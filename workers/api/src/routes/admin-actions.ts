// Admin "action" endpoints — write-side counterparts to admin-stats.ts.
//
// 7 endpoints, mix of admin-gated and bootstrap-secret-gated:
//   /api/db/backfill-images                 — caller-scoped image backfill
//   /api/admin/backfill-images-all          — every-workspace image backfill (bootstrap-secret)
//   /api/admin/backfill-critique-scores     — retroactive vision critique (requireAdmin)
//   /api/admin/bulk-regen-low-score-images  — regen images that scored low (requireAdmin)
//   /api/admin/portals/provision            — whitelabel portal creation (bootstrap-secret)
//   /api/admin/bootstrap-all-facts          — wipe + re-scrape facts for every FB-connected workspace
//   /api/admin/rebuild-archetype-index      — embed business_archetypes into Vectorize (requireAdmin)
//
// All have side-effects (writes to D1, calls fal.ai or OpenRouter, creates
// CF/Clerk resources). Read-only admin endpoints live in admin-stats.ts.
//
// Extracted from src/index.ts as Phase B step 22 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, requireAdmin } from '../auth';
import { backfillImagesForUser } from '../lib/backfill';
import { critiqueImageInternal } from '../lib/critique';
import { resolveArchetypeSlug } from '../lib/archetypes';
import { generateImageWithBrandRefs } from '../lib/image-gen';
import { buildSafeImagePrompt, sniffArchetypeFromCaption } from '../lib/image-safety';
import { tryCreateClerkUser, tryCreateCFPagesProject } from '../lib/provisioning';
import { refreshFactsForWorkspace } from '../lib/facebook-facts';

export function registerAdminActionsRoutes(app: Hono<{ Bindings: Env }>): void {
  // Backfill images for any Scheduled post that has an image_prompt but no image_url.
  // Authenticated variant: only the calling user's posts (own + their clients').
  app.post('/api/db/backfill-images', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    return c.json(await backfillImagesForUser(c.env, uid));
  });

  // Admin variant: backfill across every workspace. Gated by FACTS_BOOTSTRAP_SECRET.
  app.post('/api/admin/backfill-images-all', async (c) => {
    const provided = c.req.header('X-Bootstrap-Secret');
    if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const users = await c.env.DB.prepare('SELECT id FROM users').all();
    const results: any[] = [];
    for (const u of (users.results || [])) {
      const r = await backfillImagesForUser(c.env, (u as any).id);
      results.push({ user_id: (u as any).id, ...r });
    }
    return c.json({ users_processed: results.length, results });
  });

  /** POST /api/admin/backfill-critique-scores
   *
   *  Retroactively score every post that has an image_url but no critique
   *  data yet (image_critique_score IS NULL). The prewarm cron only critiques
   *  NEW image generations; this endpoint covers the historical backlog so
   *  the PostModal "AI N/10" badge appears on every post, not just freshly
   *  generated ones.
   *
   *  Caps at 50 posts per call to keep wall-time + cost predictable.
   *  Per-post cost: ~$0.003 (Haiku 4.5 vision). 50 × $0.003 = $0.15/call.
   *
   *  Admin-only (requireAdmin). Future-proof: scoped to the caller's own
   *  posts, so when this graduates to non-admin we don't have to rewrite it.
   */
  app.post('/api/admin/backfill-critique-scores', async (c) => {
    const adminCheck = await requireAdmin(c);
    if (adminCheck instanceof Response) return adminCheck;
    const { uid } = adminCheck;

    const body = await c.req.json().catch(() => ({})) as { limit?: number };
    const limit = Math.min(Math.max(body.limit || 50, 1), 100);

    const rows = await c.env.DB.prepare(
      `SELECT p.id, p.content, p.client_id, p.image_url
       FROM posts p
       LEFT JOIN clients cl ON p.client_id = cl.id
       WHERE (p.user_id = ? OR cl.user_id = ?)
         AND p.image_url IS NOT NULL AND p.image_url != ''
         AND p.image_critique_score IS NULL
         AND length(p.content) > 20
       ORDER BY p.scheduled_for DESC
       LIMIT ?`
    ).bind(uid, uid, limit).all<{ id: string; content: string; client_id: string | null; image_url: string }>();

    const posts = rows.results || [];
    let scored = 0;
    let lowScores = 0;
    let failed = 0;
    const archetypeCache = new Map<string, string | null>();

    for (const post of posts) {
      try {
        const cacheKey = post.client_id || '__user__';
        if (!archetypeCache.has(cacheKey)) {
          archetypeCache.set(cacheKey, await resolveArchetypeSlug(c.env, uid, post.client_id));
        }
        const archetypeSlug = archetypeCache.get(cacheKey) || null;

        const critique = await critiqueImageInternal(c.env, {
          imageUrl: post.image_url,
          caption: post.content,
          archetypeSlug,
        });

        if (critique) {
          await c.env.DB.prepare(
            `UPDATE posts SET image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
             WHERE id = ?`
          ).bind(critique.score, critique.reasoning, new Date().toISOString(), post.id).run();
          scored++;
          if (critique.score <= 4) lowScores++;
        } else {
          failed++;
        }
      } catch (e: any) {
        failed++;
        console.warn(`[backfill-critique] post ${post.id} failed: ${e?.message}`);
      }
      // Pace OpenRouter — 300ms between calls. 50 posts × 300ms = 15s.
      await new Promise(r => setTimeout(r, 300));
    }

    return c.json({
      found: posts.length,
      scored,
      failed,
      low_scores: lowScores,
      remaining_estimate: posts.length === limit ? 'more available — run again' : 'done',
    });
  });

  /** POST /api/admin/bulk-regen-low-score-images
   *
   *  Regenerates images for posts where image_critique_score is ≤ the
   *  provided threshold (default 4). Each regen uses the forced-archetype-
   *  fallback path so the new image is guaranteed on-archetype, then
   *  re-scores so the persisted critique reflects what now ships.
   *
   *  Caps at 20 posts per call (fal.ai cost: 20 × ~$0.04 = $0.80/call max
   *  if every retry needs FLUX Pro Kontext + critique).
   *
   *  Body: { threshold?: number (1-7, default 4), limit?: number (default 20) }
   */
  app.post('/api/admin/bulk-regen-low-score-images', async (c) => {
    const adminCheck = await requireAdmin(c);
    if (adminCheck instanceof Response) return adminCheck;
    const { uid } = adminCheck;

    const body = await c.req.json().catch(() => ({})) as { threshold?: number; limit?: number };
    // Default raised from 4 → 5 to align with the prewarm cron's hardened
    // retry threshold. The 2026-05-12 hardening flagged that food-on-SaaS
    // posts scored 4-5 from Haiku when archetype was NULL, not the expected
    // 1-2. The new critique prompt forces 1-2 for cross-domain bleed, but
    // already-scored posts won't be re-scored until backfill-critique-scores
    // re-runs them.
    const threshold = Math.min(Math.max(body.threshold ?? 5, 1), 7);
    const limit = Math.min(Math.max(body.limit || 20, 1), 50);

    const rows = await c.env.DB.prepare(
      `SELECT p.id, p.content, p.image_prompt, p.client_id, p.image_critique_score
       FROM posts p
       LEFT JOIN clients cl ON p.client_id = cl.id
       WHERE (p.user_id = ? OR cl.user_id = ?)
         AND p.image_critique_score IS NOT NULL
         AND p.image_critique_score <= ?
         AND p.image_prompt IS NOT NULL AND p.image_prompt != ''
         AND p.status IN ('Scheduled', 'Draft')
       ORDER BY p.image_critique_score ASC, p.scheduled_for ASC
       LIMIT ?`
    ).bind(uid, uid, threshold, limit).all<{
      id: string; content: string; image_prompt: string;
      client_id: string | null; image_critique_score: number;
    }>();

    const posts = rows.results || [];
    let regenerated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const post of posts) {
      try {
        const safe = buildSafeImagePrompt(post.image_prompt);
        if (!safe) { failed++; continue; }

        // Force fallback — these posts already scored badly, so trust the
        // curated archetype scene over the suspect LLM-generated prompt.
        // Pass the caption so image-gen can sniff the archetype if the
        // workspace's archetype_slug is NULL.
        const gen = await generateImageWithBrandRefs(
          c.env, uid, post.client_id, safe, { forceFallback: true, caption: post.content },
        );
        if (!gen.imageUrl) {
          failed++;
          errors.push(`${post.id}: regen returned no URL via ${gen.modelUsed}`);
          continue;
        }

        // Re-critique the new image so the persisted score reflects reality.
        // Same archetype-sniff fallback as prewarm: DB → caption → null.
        let archetypeSlug = await resolveArchetypeSlug(c.env, uid, post.client_id);
        if (!archetypeSlug) archetypeSlug = sniffArchetypeFromCaption(post.content);
        const critique = await critiqueImageInternal(c.env, {
          imageUrl: gen.imageUrl,
          caption: post.content,
          archetypeSlug,
        });

        if (critique) {
          await c.env.DB.prepare(
            `UPDATE posts SET image_url = ?, image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
             WHERE id = ?`
          ).bind(gen.imageUrl, critique.score, critique.reasoning, new Date().toISOString(), post.id).run();
        } else {
          // Critique unavailable but we still have a new image — ship it
          await c.env.DB.prepare(
            `UPDATE posts SET image_url = ?, image_critique_score = NULL, image_critique_reasoning = NULL, image_critique_at = NULL
             WHERE id = ?`
          ).bind(gen.imageUrl, post.id).run();
        }
        regenerated++;
      } catch (e: any) {
        failed++;
        errors.push(`${post.id}: ${e?.message}`);
      }
      // Pace fal.ai — 700ms between calls.
      await new Promise(r => setTimeout(r, 700));
    }

    return c.json({
      found: posts.length,
      regenerated,
      failed,
      threshold,
      errors: errors.slice(0, 5),
    });
  });

  // ── Admin: Provision a whitelabel portal (atomic) ─────────────────────────
  // Combines the existing 2-step provisioning (client row + portal row) into one
  // call, generates the per-portal shared secret, and returns the full env-var
  // set the agent must paste into the CF Pages project. CF Pages project +
  // custom domain + Clerk user creation happen automatically when their
  // respective credentials are configured; otherwise they show up in the
  // manualSteps array so a human can finish the job.
  //
  // Auth: gated by FACTS_BOOTSTRAP_SECRET (the same secret used by the existing
  // admin endpoints — keeps the bootstrap-secret surface area at one secret).
  //
  // See .windsurf/workflows/phase-b-portal-automation.md for the full design.
  app.post('/api/admin/portals/provision', async (c) => {
    const provided = c.req.header('X-Bootstrap-Secret');
    if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const body = await c.req.json<{
      slug?: string;
      ownerUserId?: string;
      businessName?: string;
      businessType?: string;
      plan?: string;
      autoLoginEmail?: string;
      autoLoginPassword?: string;
      customDomain?: string;
    }>();

    // Validate inputs
    const slug = (body.slug || '').toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
      return c.json({ error: 'slug must be lowercase, 2-41 chars, [a-z0-9-]' }, 400);
    }
    if (!body.ownerUserId || !body.businessName || !body.autoLoginEmail || !body.autoLoginPassword) {
      return c.json({ error: 'ownerUserId, businessName, autoLoginEmail, autoLoginPassword are required' }, 400);
    }
    if (body.autoLoginPassword.length < 16) {
      return c.json({ error: 'autoLoginPassword must be at least 16 chars' }, 400);
    }

    // Refuse if slug is already taken
    const existing = await c.env.DB.prepare('SELECT slug FROM portal WHERE slug = ?').bind(slug).first();
    if (existing) return c.json({ error: `slug '${slug}' is already taken` }, 409);

    // Generate the per-portal shared secret + portal token. The "password" column
    // on the portal table doubles as the shared secret used by VITE_PORTAL_SECRET.
    // We use crypto.randomUUID twice to widen the entropy beyond a single UUID.
    const portalSecret = crypto.randomUUID() + '-' + crypto.randomUUID();
    const portalToken = crypto.randomUUID() + '-' + crypto.randomUUID();

    // Atomic create: client first, then portal pointing at it.
    const clientId = crypto.randomUUID();
    const plan = body.plan || 'agency';
    await c.env.DB.prepare(
      'INSERT INTO clients (id, user_id, name, business_type, created_at, plan) VALUES (?,?,?,?,?,?)'
    ).bind(clientId, body.ownerUserId, body.businessName, body.businessType ?? null, new Date().toISOString(), plan).run();

    // 30-day expiry on initial issuance — admin can re-issue indefinitely
    // via PUT /api/db/portal/:slug to refresh the window (see portal.ts).
    const portalExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await c.env.DB.prepare(
      `INSERT INTO portal (slug, email, password, portal_token, user_id, client_id, expires_at)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(slug, body.autoLoginEmail, portalSecret, portalToken, body.ownerUserId, clientId, portalExpiresAt).run();

    // Try to create the Clerk auto-login user. We already have CLERK_SECRET_KEY
    // configured (it's used everywhere for JWT verification) and the Backend
    // API's POST /v1/users supports user creation with a password — no new
    // credentials needed. If creation fails (e.g. email already exists, network
    // error, Clerk plan restriction), we fall back to manual creation and the
    // CLI will print a clear instruction.
    const clerk = await tryCreateClerkUser(
      c.env.CLERK_SECRET_KEY,
      body.autoLoginEmail,
      body.autoLoginPassword,
      { portal_slug: slug, client_id: clientId },
    );

    // Build the env-var block. Real values are baked into the CF Pages project
    // automatically when CLOUDFLARE_API_TOKEN is set; otherwise these are the
    // values to paste manually.
    const workerUrl = (c.env as any).PUBLIC_WORKER_URL || 'https://socialai-api.steve-700.workers.dev';
    const envVars: Record<string, string> = {
      VITE_CLERK_PUBLISHABLE_KEY: '<copy from main CF Pages project>',
      VITE_AI_WORKER_URL: workerUrl,
      VITE_AUTO_LOGIN_EMAIL: body.autoLoginEmail,
      VITE_AUTO_LOGIN_PASSWORD: body.autoLoginPassword,
      VITE_PORTAL_SECRET: portalSecret,
      VITE_CLIENT_ID: slug,
      FACEBOOK_APP_ID: '<copy from main CF Pages project>',
      FACEBOOK_APP_SECRET: '<copy from main CF Pages project>',
    };

    // Try to create the Cloudflare Pages project + attach the custom domain.
    // Gated on both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID being set.
    // Skipped silently when missing — the manualSteps array surfaces the work
    // the human still needs to do.
    const customDomain = body.customDomain || `social.${slug}.com.au`;
    const cfPages = await tryCreateCFPagesProject(c.env, {
      projectName: `${slug}-social`,
      slug,
      customDomain,
      envVars,
    });

    // Build the manual-steps list. Each item conditionally appears only when
    // its automation failed or wasn't attempted.
    const manualSteps: string[] = [];

    if (!cfPages.projectCreated) {
      manualSteps.push(
        `Create CF Pages project named '${slug}-social' pointing at the SocialAI-Studio repo`,
        `Set CF Pages build command: cp src/client.configs/${slug}.ts src/client.config.ts && npm run build`,
        `Set the env vars above on the new CF Pages project`,
      );
    }
    if (!cfPages.domainAttached) {
      manualSteps.push(`Add custom domain '${customDomain}' in CF Pages → Custom domains`);
    }
    if (!clerk.created) {
      manualSteps.push(
        `In Clerk dashboard, create a user with email '${body.autoLoginEmail}' and the autoLoginPassword above (auto-create failed: ${clerk.error || 'unknown'})`
      );
    }
    manualSteps.push(
      `Create src/client.configs/${slug}.ts (copy picklenick.ts as template; set clientId='${slug}', clientMode:true, accentColor, defaultBusinessName, etc.) — the CLI does this for you when run from a checkout`,
      `Commit + push the new config — CF Pages auto-builds`,
    );
    // Re-number for readability
    const numbered = manualSteps.map((s, i) => `${i + 1}. ${s}`);

    return c.json({
      ok: true,
      clientId,
      portalToken,
      portalSecret,
      clerkUserCreated: clerk.created,
      clerkUserId: clerk.userId,
      clerkError: clerk.error,
      cfPagesProjectCreated: cfPages.projectCreated,
      cfPagesProjectName: cfPages.projectName,
      cfPagesDomainAttached: cfPages.domainAttached,
      cfPagesError: cfPages.error,
      envVars,
      manualSteps: numbered,
    });
  });

  // Bulk wipe + re-scrape facts for every FB-connected workspace. Used after
  // archetype seed changes or whenever the Page Insights schema shifts and
  // we want every workspace's facts re-derived from scratch. Protected by
  // FACTS_BOOTSTRAP_SECRET — anyone with the secret can re-seed.
  app.post('/api/admin/bootstrap-all-facts', async (c) => {
    const provided = c.req.header('X-Bootstrap-Secret');
    if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const users = await c.env.DB.prepare(
      `SELECT id FROM users WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL`
    ).all();
    const clients = await c.env.DB.prepare(
      `SELECT id, user_id FROM clients WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL AND COALESCE(status,'active') != 'on_hold'`
    ).all();
    const results: any[] = [];
    for (const u of (users.results || [])) {
      const r = await refreshFactsForWorkspace(c.env.DB, (u as any).id, null);
      results.push({ workspace: 'user:' + (u as any).id, ...r });
    }
    for (const cl of (clients.results || [])) {
      const r = await refreshFactsForWorkspace(c.env.DB, (cl as any).user_id, (cl as any).id);
      results.push({ workspace: 'client:' + (cl as any).id, ...r });
    }
    return c.json({ workspaces_processed: results.length, results });
  });

  /** Admin endpoint: rebuild the Vectorize index from the business_archetypes
   *  table. Run this once after creating the Vectorize index, then any time
   *  the archetype descriptions change.
   *
   *  Returns the number of archetypes indexed + the index's reported size.
   *
   *  Auth: requires admin (uses requireAdmin gate).
   */
  app.post('/api/admin/rebuild-archetype-index', async (c) => {
    const adminCheck = await requireAdmin(c);
    if (adminCheck instanceof Response) return adminCheck;

    if (!c.env.ARCHETYPE_VEC || !c.env.AI) {
      return c.json({ error: 'ARCHETYPE_VEC and AI bindings not configured — add to wrangler.toml first' }, 400);
    }

    const archetypeRows = await c.env.DB.prepare(
      `SELECT slug, name, description FROM business_archetypes ORDER BY slug`
    ).all<{ slug: string; name: string; description: string }>();
    const archetypes = archetypeRows.results || [];
    if (archetypes.length === 0) {
      return c.json({ error: 'business_archetypes table is empty — run seed_v7_archetypes.sql first' }, 400);
    }

    // Embed in batches (bge-base supports array input; CF Workers AI may have
    // per-call payload limits so we batch to be safe).
    const vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }> = [];
    for (const a of archetypes) {
      try {
        const embedResult: any = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: `${a.name}. ${a.description}`,
        });
        const vec = embedResult?.data?.[0] || embedResult?.embedding;
        if (!Array.isArray(vec)) {
          console.warn(`[rebuild-index] embed failed for ${a.slug}`);
          continue;
        }
        vectors.push({
          id: a.slug,
          values: vec,
          metadata: { name: a.name, description: a.description.slice(0, 500) },
        });
      } catch (e: any) {
        console.warn(`[rebuild-index] ${a.slug} failed: ${e?.message}`);
      }
    }

    if (vectors.length === 0) {
      return c.json({ error: 'No vectors generated — AI binding may be misconfigured' }, 500);
    }

    const upsertResult = await c.env.ARCHETYPE_VEC.upsert(vectors);
    const describe = await c.env.ARCHETYPE_VEC.describe();
    return c.json({
      ok: true,
      indexed: vectors.length,
      mutation_id: upsertResult.mutationId,
      index_size: describe.vectorsCount,
      dimensions: describe.dimensions,
    });
  });

  // ── Per-user add-on overrides + credit grants (schema_v13) ──────────────
  //
  // Lets Steve manually configure what an individual user has access to and
  // gift / sell credits on top of the plan quota. Resolution rules live in
  // lib/pricing.ts userHasFeature(); this endpoint is just the admin write
  // path. Read path is the existing /api/admin/customers list.

  /** GET /api/admin/users/:id/addons
   *  Returns { plan, addonFeatures, posterCredits, reelCredits } so the
   *  admin UI can render the current state before editing. Admin-gated. */
  app.get('/api/admin/users/:id/addons', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;
    const targetId = c.req.param('id');
    const row = await c.env.DB
      .prepare('SELECT id, email, plan, addon_features, poster_credits, reel_credits FROM users WHERE id = ?')
      .bind(targetId)
      .first<any>();
    if (!row) return c.json({ error: 'User not found.' }, 404);
    let addonFeatures: Record<string, boolean> = {};
    try { addonFeatures = JSON.parse(row.addon_features || '{}'); } catch { /* corrupt → empty */ }
    return c.json({
      id: row.id,
      email: row.email,
      plan: row.plan,
      addonFeatures,
      posterCredits: Number(row.poster_credits ?? 0),
      reelCredits: Number(row.reel_credits ?? 0),
    });
  });

  /** PATCH /api/admin/users/:id/addons
   *  Body: { addonFeatures?: { posters?: boolean|null, reels?: boolean|null },
   *          posterCredits?: number, reelCredits?: number,
   *          posterCreditsDelta?: number, reelCreditsDelta?: number }
   *
   *  - addonFeatures: if a key is `null`, REMOVE it (so it falls through to
   *    plan default). If `true`/`false`, set explicit grant/revoke.
   *  - posterCredits / reelCredits: SET absolute balance.
   *  - posterCreditsDelta / reelCreditsDelta: ADD (can be negative — clamped
   *    at 0). Admin's "gift 5 more posters" workflow uses delta. Setting
   *    absolute is for "give them exactly 10 this month".
   *
   *  Both delta and absolute on the same field is invalid (400).
   *  Admin-gated. Returns the same shape the GET endpoint emits. */
  app.patch('/api/admin/users/:id/addons', async (c) => {
    const auth = await requireAdmin(c);
    if (auth instanceof Response) return auth;
    const targetId = c.req.param('id');

    let body: {
      addonFeatures?: Record<string, boolean | null>;
      posterCredits?: number;
      reelCredits?: number;
      posterCreditsDelta?: number;
      reelCreditsDelta?: number;
    };
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Invalid JSON body.' }, 400); }

    if (body.posterCredits !== undefined && body.posterCreditsDelta !== undefined) {
      return c.json({ error: 'Pass posterCredits OR posterCreditsDelta, not both.' }, 400);
    }
    if (body.reelCredits !== undefined && body.reelCreditsDelta !== undefined) {
      return c.json({ error: 'Pass reelCredits OR reelCreditsDelta, not both.' }, 400);
    }

    // Read current row so we can merge the addon_features JSON (admin sends
    // partial — we don't want to wipe other features by accident).
    const current = await c.env.DB
      .prepare('SELECT addon_features FROM users WHERE id = ?')
      .bind(targetId)
      .first<{ addon_features: string | null }>();
    if (!current) return c.json({ error: 'User not found.' }, 404);

    let addons: Record<string, boolean> = {};
    try { addons = JSON.parse(current.addon_features || '{}'); } catch { /* corrupt → empty */ }

    if (body.addonFeatures && typeof body.addonFeatures === 'object') {
      for (const [key, value] of Object.entries(body.addonFeatures)) {
        if (value === null) delete addons[key];
        else if (value === true || value === false) addons[key] = value;
        // ignore garbage values silently
      }
    }

    const sets: string[] = [];
    const vals: unknown[] = [];

    sets.push('addon_features = ?');
    vals.push(JSON.stringify(addons));

    if (body.posterCredits !== undefined) {
      sets.push('poster_credits = ?');
      vals.push(Math.max(0, Math.floor(Number(body.posterCredits) || 0)));
    } else if (body.posterCreditsDelta !== undefined) {
      sets.push('poster_credits = MAX(0, COALESCE(poster_credits, 0) + ?)');
      vals.push(Math.floor(Number(body.posterCreditsDelta) || 0));
    }

    if (body.reelCredits !== undefined) {
      sets.push('reel_credits = ?');
      vals.push(Math.max(0, Math.floor(Number(body.reelCredits) || 0)));
    } else if (body.reelCreditsDelta !== undefined) {
      sets.push('reel_credits = MAX(0, COALESCE(reel_credits, 0) + ?)');
      vals.push(Math.floor(Number(body.reelCreditsDelta) || 0));
    }

    vals.push(targetId);
    await c.env.DB
      .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...vals)
      .run();

    // Read back so the response carries the canonical state.
    const updated = await c.env.DB
      .prepare('SELECT id, email, plan, addon_features, poster_credits, reel_credits FROM users WHERE id = ?')
      .bind(targetId)
      .first<any>();
    let addonFeaturesOut: Record<string, boolean> = {};
    try { addonFeaturesOut = JSON.parse(updated?.addon_features || '{}'); } catch { /* */ }
    return c.json({
      id: updated?.id,
      email: updated?.email,
      plan: updated?.plan,
      addonFeatures: addonFeaturesOut,
      posterCredits: Number(updated?.poster_credits ?? 0),
      reelCredits: Number(updated?.reel_credits ?? 0),
    });
  });
}
