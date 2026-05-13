// 90-second Magic Onboarding (2026-05 Tier 3 wow feature).
//
// The "subscribe NOW" moment. The user pastes their Facebook Page URL,
// and in ~90 seconds the system has:
//   1. Scraped the page (refreshFactsForUser)
//   2. Classified the business archetype from the scraped content
//   3. Identified the top 3 brand reference photos by engagement
//   4. Extracted the voice fingerprint (top 5 captions by engagement)
//   5. Surfaced the 5 most common content topics from their post history
//
// The frontend shows this as a "Brand DNA Card" so the user sees what the
// system learned about them, BEFORE typing a single word into a form. The
// killer demo moment competitors don't close.
//
// Returns everything needed for the wizard to display the brand card AND
// for downstream gens to use the new context immediately. Persists the
// classifier verdict to users.archetype_slug so the very first post after
// onboarding can't ship with NULL archetype.
//
// Extracted from src/index.ts as Phase B step 23 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, isRateLimited } from '../auth';
import { ArchetypeRow, classifyArchetypeFromFingerprint } from '../lib/archetypes';
import { refreshFactsForUser } from '../lib/facebook-facts';

export function registerOnboardingRoutes(app: Hono<{ Bindings: Env }>): void {
  // Body: { force?: boolean — bypass cache, re-derive everything }
  app.post('/api/onboarding-magic', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (await isRateLimited(c.env.DB, `onboard-magic:${uid}`, 5)) {
      return c.json({ error: 'Rate limit exceeded — 5 magic-onboard calls per minute' }, 429);
    }
    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500);

    // 1. Pull the workspace's user row + Facebook tokens
    const userRow = await c.env.DB.prepare(
      'SELECT id, email, social_tokens, profile FROM users WHERE id = ?'
    ).bind(uid).first<{ id: string; email: string | null; social_tokens: string | null; profile: string | null }>();

    if (!userRow?.social_tokens) {
      return c.json({ error: 'Facebook not connected — connect a Page first, then call /api/onboarding-magic' }, 400);
    }
    const tokens = JSON.parse(userRow.social_tokens);
    if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
      return c.json({ error: 'Facebook Page ID + access token missing — reconnect Facebook' }, 400);
    }

    // 2. Trigger fresh fact scrape (re-uses existing logic; idempotent)
    try {
      await refreshFactsForUser(c.env, uid, tokens.facebookPageId, tokens.facebookPageAccessToken, null);
    } catch (e: any) {
      console.warn(`[onboarding-magic] facts refresh failed for ${uid}:`, e?.message);
      // Continue anyway — maybe we have stale facts from a previous scrape
    }

    // 3. Pull the freshly-scraped facts
    const facts = await c.env.DB.prepare(
      `SELECT fact_type, content, metadata, engagement_score
       FROM client_facts
       WHERE user_id = ? AND client_id IS NULL
       ORDER BY engagement_score DESC, verified_at DESC
       LIMIT 100`
    ).bind(uid).all<{ fact_type: string; content: string; metadata: string; engagement_score: number }>();
    const allFacts = facts.results || [];

    // 4. Bucket the facts by type
    const ownPosts = allFacts.filter(f => f.fact_type === 'own_post').slice(0, 5);
    const photos = allFacts.filter(f => f.fact_type === 'photo').slice(0, 3);
    const about = allFacts.find(f => f.fact_type === 'about');
    const photoUrls = photos.map(p => {
      try { return JSON.parse(p.metadata).url; } catch { return null; }
    }).filter(Boolean);

    // 5. Use the existing classifier on the scraped content
    const profile = userRow.profile ? JSON.parse(userRow.profile) : {};
    const businessTypeFromFB = about?.content?.slice(0, 200) || '';
    const fingerprint = [
      profile.type && `Business type: ${profile.type}`,
      profile.description && `Description: ${profile.description}`,
      businessTypeFromFB && `From FB page about: ${businessTypeFromFB}`,
      ownPosts.length > 0 && `Recent posts:\n${ownPosts.map(p => `- ${p.content.slice(0, 200)}`).join('\n')}`,
    ].filter(Boolean).join('\n');

    // Route through the shared 3-layer classifier (keyword → Vectorize →
    // Haiku) so /api/onboarding-magic and /api/classify-business agree on
    // the verdict. Falls back to 'professional-services' when the
    // fingerprint is empty or the classifier errors — we MUST persist a slug
    // here so the first post after onboarding doesn't ship with NULL
    // archetype.
    let archetypeSlug = 'professional-services';
    let archetypeConfidence = 0.5;
    let archetypeReasoning = 'default fallback';
    let archetypePayload: {
      slug: string;
      name: string;
      description: string;
      voice_cues: string | null;
      content_pillars: string[];
      image_examples?: string[];
      image_avoid_notes?: string | null;
      banned_trope_extras?: string[] | null;
    } | null = null;

    if (fingerprint.trim()) {
      const result = await classifyArchetypeFromFingerprint(c.env, fingerprint);
      if ('chosen' in result) {
        archetypeSlug = result.chosen.slug;
        archetypeConfidence = result.chosen.confidence;
        archetypeReasoning = result.chosen.reasoning.slice(0, 300);
        archetypePayload = result.archetypePayload;
      } else {
        console.warn(`[onboarding-magic] classifier failed: ${result.error} — falling back to ${archetypeSlug}`);
      }
    } else {
      console.warn(`[onboarding-magic] empty fingerprint — falling back to ${archetypeSlug}`);
    }

    // Fallback path (empty fingerprint OR classifier error): load the
    // fallback archetype's payload directly so the response shape is
    // consistent with the happy path.
    if (!archetypePayload) {
      const fallback = await c.env.DB.prepare(
        `SELECT slug, name, description, image_examples, image_avoid_notes, voice_cues, content_pillars, banned_trope_extras FROM business_archetypes WHERE slug = ?`
      ).bind(archetypeSlug).first<ArchetypeRow>();
      if (fallback) {
        archetypePayload = {
          slug: fallback.slug,
          name: fallback.name,
          description: fallback.description,
          image_examples: JSON.parse(fallback.image_examples),
          image_avoid_notes: fallback.image_avoid_notes,
          voice_cues: fallback.voice_cues,
          content_pillars: JSON.parse(fallback.content_pillars),
          banned_trope_extras: fallback.banned_trope_extras ? JSON.parse(fallback.banned_trope_extras) : null,
        };
      }
    }

    // 6. Persist classifier verdict
    await c.env.DB.prepare(
      `UPDATE users SET archetype_slug = ?, archetype_confidence = ?, archetype_reasoning = ?, archetype_classified_at = ? WHERE id = ?`
    ).bind(archetypeSlug, archetypeConfidence, archetypeReasoning, new Date().toISOString(), uid).run();

    // 7. Build the Brand DNA Card payload
    const topTopics = Array.from(new Set(
      ownPosts.flatMap(p => p.content.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])
        .filter(w => !/the|and|with|that|this|from|have|will|your/.test(w))
    )).slice(0, 5);

    return c.json({
      ok: true,
      archetype: {
        slug: archetypePayload?.slug ?? archetypeSlug,
        name: archetypePayload?.name ?? archetypeSlug,
        confidence: archetypeConfidence,
        reasoning: archetypeReasoning,
        content_pillars: archetypePayload?.content_pillars ?? [],
        voice_cues: archetypePayload?.voice_cues ?? null,
      },
      brand_dna: {
        voice_samples: ownPosts.map(p => ({ content: p.content.slice(0, 240), engagement: p.engagement_score })),
        reference_photos: photoUrls,
        common_topics: topTopics,
        about: about?.content?.slice(0, 400) || null,
      },
      stats: {
        posts_scraped: ownPosts.length,
        photos_available: photoUrls.length,
        total_facts: allFacts.length,
      },
    });
  });
}
