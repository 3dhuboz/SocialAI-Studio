// Business Archetype classifier routes (2026-05 Phase 1).
//
// GET  /api/business-archetype              — read the cached classification for
//                                              the calling user
// POST /api/classify-business                — run the classifier + cache on
//                                              users.archetype_slug
// POST /api/clients/:id/classify-business    — same but cached on
//                                              clients.archetype_slug (agency
//                                              owners need per-client guardrails)
//
// All three honour an existing cache unless force=true. The classifier
// pipeline (3-layer keyword → Vectorize → Haiku) lives in lib/archetypes;
// these routes are thin wrappers that handle auth, rate limiting,
// fingerprint construction, and DB persistence.
//
// Rate limit: 10 calls/min/user — classification is moderately expensive
// (Haiku inference if Vectorize layer misses) so we cap abuse early.
//
// Extracted from src/index.ts as Phase B step 18 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, isRateLimited } from '../auth';
import {
  ArchetypeRow,
  classifyArchetypeFromFingerprint,
} from '../lib/archetypes';

export function registerArchetypeRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/business-archetype', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    const userRow = await c.env.DB.prepare(
      `SELECT archetype_slug, archetype_confidence, archetype_reasoning, archetype_classified_at FROM users WHERE id = ?`
    ).bind(uid).first<{ archetype_slug: string | null; archetype_confidence: number | null; archetype_reasoning: string | null; archetype_classified_at: string | null }>();

    if (!userRow?.archetype_slug) {
      return c.json({ error: 'Not yet classified', classified: false }, 404);
    }

    const arch = await c.env.DB.prepare(
      `SELECT * FROM business_archetypes WHERE slug = ?`
    ).bind(userRow.archetype_slug).first<ArchetypeRow>();

    if (!arch) {
      // Cached slug points to a now-deleted archetype — caller should re-classify
      return c.json({ error: 'Cached archetype no longer exists', classified: false, stale_slug: userRow.archetype_slug }, 404);
    }

    return c.json({
      classified: true,
      archetype: {
        slug: arch.slug,
        name: arch.name,
        description: arch.description,
        keywords: JSON.parse(arch.keywords),
        image_examples: JSON.parse(arch.image_examples),
        image_avoid_notes: arch.image_avoid_notes,
        voice_cues: arch.voice_cues,
        content_pillars: JSON.parse(arch.content_pillars),
        banned_trope_extras: arch.banned_trope_extras ? JSON.parse(arch.banned_trope_extras) : null,
      },
      confidence: userRow.archetype_confidence,
      reasoning: userRow.archetype_reasoning,
      classified_at: userRow.archetype_classified_at,
    });
  });

  /** POST /api/classify-business — runs the Haiku classifier, caches the result
   *  on the user row, returns the verdict. Body fields are optional except at
   *  least one of businessType/description must be present.
   *
   *  Body: { businessType?, description?, productsServices?, contentTopics?, force?: boolean }
   *  force=true bypasses the cache and re-classifies even if archetype_slug is set.
   */
  app.post('/api/classify-business', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (await isRateLimited(c.env.DB, `classify:${uid}`, 10)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    }

    const body = await c.req.json().catch(() => ({})) as {
      businessType?: string;
      description?: string;
      productsServices?: string;
      contentTopics?: string;
      force?: boolean;
    };
    const { businessType = '', description = '', productsServices = '', contentTopics = '', force = false } = body;

    // Build the brand fingerprint string — what the classifier sees and what
    // Phase 2 will embed for Vectorize similarity search.
    const fingerprint = [
      businessType && `Business type: ${businessType}`,
      description && `Description: ${description}`,
      productsServices && `Products/services: ${productsServices}`,
      contentTopics && `Content topics: ${contentTopics}`,
    ].filter(Boolean).join('\n');

    if (!fingerprint.trim()) {
      return c.json({ error: 'At least one of businessType / description must be non-empty.' }, 400);
    }

    // Honour the cache unless force=true
    if (!force) {
      const cached = await c.env.DB.prepare(
        `SELECT archetype_slug, archetype_confidence, archetype_reasoning FROM users WHERE id = ?`
      ).bind(uid).first<{ archetype_slug: string | null; archetype_confidence: number | null; archetype_reasoning: string | null }>();
      if (cached?.archetype_slug) {
        const arch = await c.env.DB.prepare(`SELECT * FROM business_archetypes WHERE slug = ?`).bind(cached.archetype_slug).first<ArchetypeRow>();
        if (arch) {
          return c.json({
            classified: true,
            cached: true,
            archetype_slug: cached.archetype_slug,
            confidence: cached.archetype_confidence,
            reasoning: cached.archetype_reasoning,
            archetype: {
              slug: arch.slug, name: arch.name, description: arch.description,
              image_examples: JSON.parse(arch.image_examples),
              image_avoid_notes: arch.image_avoid_notes, voice_cues: arch.voice_cues,
              content_pillars: JSON.parse(arch.content_pillars),
              banned_trope_extras: arch.banned_trope_extras ? JSON.parse(arch.banned_trope_extras) : null,
            },
          });
        }
      }
    }

    const result = await classifyArchetypeFromFingerprint(c.env, fingerprint);
    if ('error' in result) return c.json({ error: result.error, valid_slugs: result.valid_slugs }, result.status as 400 | 500 | 502);

    // ── Cache on the user row ──
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE users SET archetype_slug = ?, archetype_confidence = ?, archetype_reasoning = ?, archetype_classified_at = ? WHERE id = ?`
    ).bind(result.chosen.slug, result.chosen.confidence, result.chosen.reasoning, now, uid).run();

    return c.json({
      classified: true,
      cached: false,
      archetype_slug: result.chosen.slug,
      confidence: result.chosen.confidence,
      reasoning: result.chosen.reasoning,
      classified_at: now,
      archetype: result.archetypePayload,
    });
  });

  /** POST /api/clients/:id/classify-business — same classifier as the user-
   *  level endpoint but persists the result on clients.archetype_slug. Lets
   *  agency users get the RIGHT image guardrails per client workspace.
   *  Caller passes the client's businessType/description/products/topics
   *  (the worker doesn't trust the client_id alone — needs the profile
   *  fields to fingerprint accurately, since the clients table only
   *  guarantees name + business_type). force=true bypasses the cache.
   */
  app.post('/api/clients/:id/classify-business', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (await isRateLimited(c.env.DB, `classify:${uid}`, 10)) {
      return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
    }
    const clientId = c.req.param('id');

    // Ownership check — caller must own this client. Prevents one user from
    // re-classifying someone else's clients.
    const clientRow = await c.env.DB.prepare(
      `SELECT id, name, business_type, archetype_slug, archetype_confidence, archetype_reasoning
       FROM clients WHERE id = ? AND user_id = ?`
    ).bind(clientId, uid).first<{
      id: string; name: string; business_type: string | null;
      archetype_slug: string | null; archetype_confidence: number | null; archetype_reasoning: string | null;
    }>();
    if (!clientRow) return c.json({ error: 'Client not found' }, 404);

    const body = await c.req.json().catch(() => ({})) as {
      businessType?: string; description?: string;
      productsServices?: string; contentTopics?: string;
      force?: boolean;
    };
    const businessType = body.businessType || clientRow.business_type || '';
    const description = body.description || '';
    const productsServices = body.productsServices || '';
    const contentTopics = body.contentTopics || '';
    const force = !!body.force;

    const fingerprint = [
      clientRow.name && `Client name: ${clientRow.name}`,
      businessType && `Business type: ${businessType}`,
      description && `Description: ${description}`,
      productsServices && `Products/services: ${productsServices}`,
      contentTopics && `Content topics: ${contentTopics}`,
    ].filter(Boolean).join('\n');

    if (!fingerprint.trim()) {
      return c.json({ error: 'At least one of businessType / description must be non-empty.' }, 400);
    }

    // Honour cache unless force=true
    if (!force && clientRow.archetype_slug) {
      const arch = await c.env.DB.prepare(`SELECT * FROM business_archetypes WHERE slug = ?`)
        .bind(clientRow.archetype_slug).first<ArchetypeRow>();
      if (arch) {
        return c.json({
          classified: true,
          cached: true,
          archetype_slug: clientRow.archetype_slug,
          confidence: clientRow.archetype_confidence,
          reasoning: clientRow.archetype_reasoning,
          archetype: {
            slug: arch.slug, name: arch.name, description: arch.description,
            image_examples: JSON.parse(arch.image_examples),
            image_avoid_notes: arch.image_avoid_notes, voice_cues: arch.voice_cues,
            content_pillars: JSON.parse(arch.content_pillars),
            banned_trope_extras: arch.banned_trope_extras ? JSON.parse(arch.banned_trope_extras) : null,
          },
        });
      }
    }

    const result = await classifyArchetypeFromFingerprint(c.env, fingerprint);
    if ('error' in result) return c.json({ error: result.error, valid_slugs: result.valid_slugs }, result.status as 400 | 500 | 502);

    // ── Cache on the client row ──
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE clients SET archetype_slug = ?, archetype_confidence = ?, archetype_reasoning = ?, archetype_classified_at = ? WHERE id = ?`
    ).bind(result.chosen.slug, result.chosen.confidence, result.chosen.reasoning, now, clientId).run();

    return c.json({
      classified: true,
      cached: false,
      archetype_slug: result.chosen.slug,
      confidence: result.chosen.confidence,
      reasoning: result.chosen.reasoning,
      classified_at: now,
      archetype: result.archetypePayload,
    });
  });
}
