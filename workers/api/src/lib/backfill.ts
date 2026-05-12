// Backfill Scheduled posts that have an image_prompt but no image_url.
//
// Scoped by user_id (own + via client). Caps at 30 per call so a single
// backfill can't blow the fal.ai budget. Mirrors the prewarm cron's
// vision-critique gate so backfilled images are subject to the same
// quality bar as freshly-prewarmed ones.
//
// Shared by:
//   - POST /api/db/backfill-images (caller-scoped, in routes/admin-actions.ts)
//   - POST /api/admin/backfill-images-all (every user, gated by bootstrap secret)
//
// Extracted from src/index.ts as Phase B step 21 of the route-module split.

import type { Env } from '../env';
import { buildSafeImagePrompt, sniffArchetypeFromCaption } from './image-safety';
import { resolveArchetypeSlug } from './archetypes';
import { critiqueImageInternal } from './critique';
import { generateImageWithBrandRefs } from './image-gen';

export async function backfillImagesForUser(env: Env, uid: string) {
  const apiKey = env.FAL_API_KEY;
  if (!apiKey) return { error: 'fal.ai not configured', found: 0, succeeded: 0, failed: 0 };

  // Find Scheduled posts owned by this user (own + via client) that have a
  // prompt but no URL. Cap at 30 per call so a single backfill can't blow the
  // fal.ai budget.
  const rows = await env.DB.prepare(
    `SELECT p.id, p.image_prompt, p.client_id, p.content
     FROM posts p
     LEFT JOIN clients c ON p.client_id = c.id
     WHERE p.status = 'Scheduled'
       AND (p.user_id = ? OR c.user_id = ?)
       AND (p.image_url IS NULL OR p.image_url = '')
       AND p.image_prompt IS NOT NULL
       AND p.image_prompt != 'N/A'
       AND p.image_prompt != ''
     LIMIT 30`
  ).bind(uid, uid).all();

  const posts = rows.results || [];
  let succeeded = 0; let failed = 0; let critiqueRetries = 0; const errors: string[] = [];

  // Schema v9: archetype is per-(user OR client). Cache by client_id within
  // this run so we don't hit the DB once per post for the same workspace.
  const archetypeCache = new Map<string, string | null>();

  for (const post of posts) {
    try {
      const safe = buildSafeImagePrompt(String((post as any).image_prompt || ''));
      if (!safe) { failed++; continue; }

      const postId = (post as any).id as string;
      const clientId = (post as any).client_id as string | null;
      const caption = ((post as any).content as string | null) || '';

      const cacheKey = clientId || '__user__';
      if (!archetypeCache.has(cacheKey)) {
        archetypeCache.set(cacheKey, await resolveArchetypeSlug(env, uid, clientId));
      }
      const archetypeSlug = archetypeCache.get(cacheKey) || null;

      // 2026-05 image-stack upgrade: brand-grounded via FLUX Pro Kontext
      // when the workspace has scraped FB photos available, FLUX-dev when
      // it doesn't. See generateImageWithBrandRefs in lib/image-gen.ts.
      const gen = await generateImageWithBrandRefs(env, uid, clientId, safe);
      let finalUrl = gen.imageUrl;
      let finalCritique: { score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null = null;

      // Vision-critique gate (mirror of cronPrewarmImages). One retry with a
      // forced archetype fallback if the first attempt scored ≤3 for
      // image/caption mismatch. Skipped when caption is empty or
      // OPENROUTER_API_KEY is missing.
      if (finalUrl && caption.length > 20) {
        const critique = await critiqueImageInternal(env, {
          imageUrl: finalUrl,
          caption,
          archetypeSlug,
        });
        if (critique) {
          console.log(`[backfill] post ${postId} critique score=${critique.score} match=${critique.match}`);
          finalCritique = critique;
          if (critique.score <= 3) {
            const retry = await generateImageWithBrandRefs(env, uid, clientId, safe, { forceFallback: true });
            if (retry.imageUrl) {
              finalUrl = retry.imageUrl;
              critiqueRetries++;
              const retryCritique = await critiqueImageInternal(env, {
                imageUrl: retry.imageUrl,
                caption,
                archetypeSlug,
              });
              if (retryCritique) finalCritique = retryCritique;
            }
          }
        }
      }

      if (finalUrl) {
        if (finalCritique) {
          await env.DB.prepare(
            `UPDATE posts SET image_url = ?, image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
             WHERE id = ?`
          ).bind(finalUrl, finalCritique.score, finalCritique.reasoning, new Date().toISOString(), postId).run();
        } else {
          await env.DB.prepare('UPDATE posts SET image_url = ? WHERE id = ?').bind(finalUrl, postId).run();
        }
        succeeded++;
      } else {
        failed++;
        errors.push(`${postId}: image gen failed via ${gen.modelUsed}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(`${(post as any).id}: ${e.message}`);
    }
    // Pace fal.ai — 700ms between calls so 30 posts = ~21s, well under any rate limit
    await new Promise(r => setTimeout(r, 700));
  }
  return { found: posts.length, succeeded, failed, critique_retries: critiqueRetries, errors: errors.slice(0, 5) };
}

// ── Backlog helpers — run on every */5 cron tick, gate themselves with a
// cheap COUNT(*) so they no-op once the backlog is exhausted. Process all
// posts in the system, not just one user's — used to fill in the historical
// data that was never collected before the prewarm cron started scoring.
//
// runBacklogCritique:
//   Scores every post that has image_url but no image_critique_score yet.
//   Idempotent — the WHERE clause naturally skips already-scored posts.
//   Cap 50/tick × Haiku 4.5 vision @ ~$0.003 = $0.15/tick worst case.
//
// runBacklogRegen:
//   Regenerates images for posts that scored ≤ threshold (default 5).
//   Each successful regen lifts the score, removing the post from future
//   ticks. Cap 20/tick × FLUX Pro Kontext @ ~$0.04 = $0.80/tick worst case.
//
// Both wired into cron/dispatcher.ts on the */5 path. Once the backlog
// is exhausted the COUNT(*) guards make subsequent ticks free no-ops.

export async function runBacklogCritique(
  env: Env,
): Promise<{ skipped?: boolean; found: number; scored: number; low_scores: number; failed: number }> {
  if (!env.OPENROUTER_API_KEY && !env.ANTHROPIC_API_KEY) {
    return { skipped: true, found: 0, scored: 0, low_scores: 0, failed: 0 };
  }
  // Cheap gate — bail before doing real work if there's nothing to do.
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM posts
     WHERE image_url IS NOT NULL AND image_url != ''
       AND image_critique_score IS NULL
       AND length(content) > 20`
  ).first<{ n: number }>();
  if (!pending || pending.n === 0) return { skipped: true, found: 0, scored: 0, low_scores: 0, failed: 0 };

  const limit = 50;
  const rows = await env.DB.prepare(
    `SELECT id, content, client_id, user_id, image_url
     FROM posts
     WHERE image_url IS NOT NULL AND image_url != ''
       AND image_critique_score IS NULL
       AND length(content) > 20
     ORDER BY scheduled_for DESC
     LIMIT ?`
  ).bind(limit).all<{ id: string; content: string; client_id: string | null; user_id: string; image_url: string }>();

  const posts = rows.results || [];
  let scored = 0;
  let lowScores = 0;
  let failed = 0;
  // Cache archetype lookups within a tick — posts often share a workspace.
  const archetypeCache = new Map<string, string | null>();

  for (const post of posts) {
    try {
      const cacheKey = `${post.user_id}:${post.client_id || '__user__'}`;
      if (!archetypeCache.has(cacheKey)) {
        archetypeCache.set(cacheKey, await resolveArchetypeSlug(env, post.user_id, post.client_id));
      }
      const archetypeSlug = archetypeCache.get(cacheKey) || null;

      const critique = await critiqueImageInternal(env, {
        imageUrl: post.image_url,
        caption: post.content,
        archetypeSlug,
      });

      if (critique) {
        await env.DB.prepare(
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
      console.warn(`[backlog-critique] post ${post.id} failed: ${e?.message}`);
    }
    // Pace OpenRouter — 300ms between calls. 50 posts × 300ms = 15s.
    await new Promise(r => setTimeout(r, 300));
  }

  return { found: posts.length, scored, low_scores: lowScores, failed };
}

export async function runBacklogRegen(
  env: Env,
  threshold: number = 5,
): Promise<{ skipped?: boolean; found: number; regenerated: number; failed: number }> {
  if (!env.FAL_API_KEY) {
    return { skipped: true, found: 0, regenerated: 0, failed: 0 };
  }
  // Cheap gate.
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM posts
     WHERE image_critique_score IS NOT NULL
       AND image_critique_score <= ?
       AND image_prompt IS NOT NULL AND image_prompt != ''
       AND status IN ('Scheduled', 'Draft')`
  ).bind(threshold).first<{ n: number }>();
  if (!pending || pending.n === 0) return { skipped: true, found: 0, regenerated: 0, failed: 0 };

  const limit = 20;
  const rows = await env.DB.prepare(
    `SELECT id, content, image_prompt, client_id, user_id, image_critique_score
     FROM posts
     WHERE image_critique_score IS NOT NULL
       AND image_critique_score <= ?
       AND image_prompt IS NOT NULL AND image_prompt != ''
       AND status IN ('Scheduled', 'Draft')
     ORDER BY image_critique_score ASC, scheduled_for ASC
     LIMIT ?`
  ).bind(threshold, limit).all<{
    id: string; content: string; image_prompt: string;
    client_id: string | null; user_id: string; image_critique_score: number;
  }>();

  const posts = rows.results || [];
  let regenerated = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      const safe = buildSafeImagePrompt(post.image_prompt);
      if (!safe) { failed++; continue; }

      const gen = await generateImageWithBrandRefs(
        env, post.user_id, post.client_id, safe, { forceFallback: true, caption: post.content },
      );
      if (!gen.imageUrl) { failed++; continue; }

      // Re-critique so the new score persists. Same archetype-sniff fallback
      // as prewarm: DB → caption sniff → null.
      let archetypeSlug = await resolveArchetypeSlug(env, post.user_id, post.client_id);
      if (!archetypeSlug) archetypeSlug = sniffArchetypeFromCaption(post.content);
      const critique = await critiqueImageInternal(env, {
        imageUrl: gen.imageUrl,
        caption: post.content,
        archetypeSlug,
      });

      if (critique) {
        await env.DB.prepare(
          `UPDATE posts SET image_url = ?, image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
           WHERE id = ?`
        ).bind(gen.imageUrl, critique.score, critique.reasoning, new Date().toISOString(), post.id).run();
      } else {
        // No critique available — clear the score so the post drops out of
        // this query next tick (won't loop forever) but keep the new image.
        await env.DB.prepare(
          `UPDATE posts SET image_url = ?, image_critique_score = NULL, image_critique_reasoning = NULL, image_critique_at = NULL
           WHERE id = ?`
        ).bind(gen.imageUrl, post.id).run();
      }
      regenerated++;
    } catch (e: any) {
      failed++;
      console.warn(`[backlog-regen] post ${post.id} failed: ${e?.message}`);
    }
    // Pace fal.ai — 700ms between calls. 20 posts × 700ms = 14s.
    await new Promise(r => setTimeout(r, 700));
  }

  return { found: posts.length, regenerated, failed };
}
