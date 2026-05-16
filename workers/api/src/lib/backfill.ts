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
import { buildSafeImagePrompt } from './image-safety';
import { resolveArchetypeSlug } from './archetypes';
import { critiqueImageInternal, buildCritiqueSystemPrompt } from './critique';
import { generateImageWithGuardrails } from './image-gen';
import { loadForbiddenSubjects } from './profile-guards';
import { callAnthropicVision } from './anthropic';
import {
  CRITIQUE_ACCEPT_THRESHOLD,
  MAX_REGEN_ATTEMPTS,
} from '../../../../shared/critique-thresholds';

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

  for (const post of posts) {
    try {
      const safe = buildSafeImagePrompt(String((post as any).image_prompt || ''));
      if (!safe) { failed++; continue; }

      const postId = (post as any).id as string;
      const clientId = (post as any).client_id as string | null;
      const caption = ((post as any).content as string | null) || '';

      // Pass caption so sniffArchetypeFromCaption fires for unclassified
      // workspaces. Reuse archetypeSlug from gen to skip a second DB call.
      const gen = await generateImageWithGuardrails(env, uid, clientId, safe, { caption });
      let finalUrl = gen.imageUrl;
      let finalCritique: { score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null = null;

      if (finalUrl && caption.length > 20) {
        const archetypeSlug = gen.archetypeSlug;
        const forbiddenSubjects = await loadForbiddenSubjects(env, uid, clientId);

        const critique = await critiqueImageInternal(env, {
          imageUrl: finalUrl,
          caption,
          archetypeSlug,
          forbiddenSubjects,
        });
        if (critique) {
          console.log(`[backfill] post ${postId} critique score=${critique.score} match=${critique.match}`);
          finalCritique = critique;
          if (critique.score <= CRITIQUE_ACCEPT_THRESHOLD) {
            const retry = await generateImageWithGuardrails(env, uid, clientId, safe, { forceFallback: true, caption });
            if (retry.imageUrl) {
              finalUrl = retry.imageUrl;
              critiqueRetries++;
              const retryCritique = await critiqueImageInternal(env, {
                imageUrl: retry.imageUrl,
                caption,
                archetypeSlug,
                forbiddenSubjects,
              });
              if (retryCritique) {
                finalCritique = retryCritique;
              } else {
                // Re-critique failed — clear stale score so we don't persist
                // the original bad image's score against the fallback that shipped.
                finalCritique = null;
              }
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
//   Cap 20/tick × Haiku 4.5 vision @ ~$0.003 = $0.06/tick worst case.
//   (Reduced from 50 in commit ecdd138 — stale fal.media URLs cost ~5s each
//   while Anthropic times out trying to fetch them.)
//
// runBacklogRegen:
//   Regenerates images for posts that scored ≤ threshold (default 5).
//   Each successful regen lifts the score, removing the post from future
//   ticks. Cap 20/tick × FLUX-dev @ ~$0.03 = $0.60/tick worst case.
//
// Both wired into cron/dispatcher.ts on the */5 path. Once the backlog
// is exhausted the COUNT(*) guards make subsequent ticks free no-ops.

export async function runBacklogCritique(
  env: Env,
): Promise<{ skipped?: boolean; found: number; scored: number; low_scores: number; failed: number }> {
  if (!env.OPENROUTER_API_KEY && !env.ANTHROPIC_API_KEY) {
    return { skipped: true, found: 0, scored: 0, low_scores: 0, failed: 0 };
  }
  // Skip user-uploaded `data:image/...` URLs — Anthropic vision can only
  // fetch http(s) URLs via source.type='url'. Pre-mark them so they drop
  // out of the backlog query and we never re-attempt.
  await env.DB.prepare(
    `UPDATE posts SET image_critique_at = ?, image_critique_reasoning = 'Skipped: user-uploaded inline data URL (no critique applicable)'
     WHERE image_url LIKE 'data:%' AND image_critique_score IS NULL AND image_critique_at IS NULL`
  ).bind(new Date().toISOString()).run();

  // Cheap gate — bail before doing real work if there's nothing to do.
  // Excludes posts we've already attempted (image_critique_at IS NOT NULL)
  // so a single failure doesn't keep us looping on the same row forever.
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM posts
     WHERE image_url IS NOT NULL AND image_url != ''
       AND image_url NOT LIKE 'data:%'
       AND image_critique_score IS NULL
       AND image_critique_at IS NULL
       AND length(content) > 20`
  ).first<{ n: number }>();
  if (!pending || pending.n === 0) return { skipped: true, found: 0, scored: 0, low_scores: 0, failed: 0 };

  // Reduced from 50 → 20: stale fal.media URLs make each critique call
  // wait ~5s for Anthropic to time out fetching the URL. 20 × 5s = 100s
  // worst case per tick, well under the 15-min cron limit.
  const limit = 20;
  const rows = await env.DB.prepare(
    `SELECT id, content, client_id, user_id, image_url
     FROM posts
     WHERE image_url IS NOT NULL AND image_url != ''
       AND image_url NOT LIKE 'data:%'
       AND image_critique_score IS NULL
       AND image_critique_at IS NULL
       AND length(content) > 20
     ORDER BY scheduled_for DESC
     LIMIT ?`
  ).bind(limit).all<{ id: string; content: string; client_id: string | null; user_id: string; image_url: string }>();

  const posts = rows.results || [];
  let scored = 0;
  let lowScores = 0;
  let failed = 0;

  // Pre-resolve archetype + denylist for every unique workspace in the batch.
  // The previous lazy-fill-inside-loop pattern wasn't concurrency-safe — when
  // we parallelise the critique loop below, two posts from the same workspace
  // could race the cache set. Pre-population sidesteps that and also lets us
  // fire all the DB queries in one Promise.all instead of N serial awaits.
  const uniqueWorkspaces = Array.from(
    new Set(posts.map((p) => `${p.user_id}:${p.client_id || '__user__'}`))
  ).map((key) => {
    const [user_id, clientPart] = key.split(':');
    return { key, user_id, client_id: clientPart === '__user__' ? null : clientPart };
  });
  const archetypeCache = new Map<string, string | null>();
  const denylistCache = new Map<string, string[]>();
  await Promise.all(uniqueWorkspaces.flatMap((w) => [
    resolveArchetypeSlug(env, w.user_id, w.client_id).then((s) => archetypeCache.set(w.key, s)),
    loadForbiddenSubjects(env, w.user_id, w.client_id).then((d) => denylistCache.set(w.key, d)),
  ]));

  // Concurrent critique — Anthropic Haiku tier easily absorbs 5 in-flight,
  // and the 300ms pacer that used to live at the end of the loop is gone.
  // Chunked Promise.all so we never exceed CRITIQUE_CONCURRENCY in flight.
  const CRITIQUE_CONCURRENCY = 5;
  const processOne = async (post: { id: string; content: string; client_id: string | null; user_id: string; image_url: string }) => {
    let errorMsg: string | null = null;
    let critique: { score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null = null;

    try {
      const cacheKey = `${post.user_id}:${post.client_id || '__user__'}`;
      const archetypeSlug = archetypeCache.get(cacheKey) || null;
      const forbiddenSubjects = denylistCache.get(cacheKey) ?? [];

      // Inline Anthropic/OpenRouter calls (vs critiqueImageInternal) so each
      // post can stamp the exact provider error string into reasoning — useful
      // for diagnosing backlog stalls via SELECT instead of wrangler tail.
      // System prompt from shared builder so HARD RULES match the user path.
      const systemPrompt = buildCritiqueSystemPrompt(archetypeSlug, forbiddenSubjects);
      const userPrompt = `Caption that will be published with this image:\n\n"${post.content.slice(0, 800)}"\n\nDoes the image match?`;

      // Path A: Anthropic direct (only when key is set).
      if (env.ANTHROPIC_API_KEY) {
        try {
          const { text } = await callAnthropicVision({
            apiKey: env.ANTHROPIC_API_KEY,
            model: 'claude-haiku-4-5',
            systemPrompt,
            prompt: userPrompt,
            imageUrl: post.image_url,
            temperature: 0.1,
            maxTokens: 250,
            responseFormat: 'json',
          });
          const parsed = JSON.parse(text);
          critique = {
            score: typeof parsed.score === 'number' ? Math.max(0, Math.min(10, parsed.score)) : 5,
            match: (['yes', 'partial', 'no'] as const).includes(parsed.match) ? parsed.match : 'partial',
            reasoning: (parsed.reasoning || '').toString().slice(0, 300),
          };
        } catch (e: any) {
          errorMsg = `Anthropic: ${(e?.message || 'unknown').slice(0, 180)}`;
        }
      }

      // Path B: OpenRouter (used when no Anthropic key OR Anthropic failed).
      if (!critique && env.OPENROUTER_API_KEY) {
        try {
          const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://socialaistudio.au',
              'X-Title': 'SocialAI Studio — Backlog Critique',
            },
            body: JSON.stringify({
              model: 'anthropic/claude-haiku-4.5',
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: userPrompt },
                    { type: 'image_url', image_url: { url: post.image_url } },
                  ],
                },
              ],
              temperature: 0.1,
              max_tokens: 250,
              response_format: { type: 'json_object' },
            }),
          });
          if (!orRes.ok) {
            const body = await orRes.text().catch(() => '');
            const orErr = `OpenRouter HTTP ${orRes.status}: ${body.slice(0, 150)}`;
            errorMsg = errorMsg ? `${errorMsg} | ${orErr}` : orErr;
          } else {
            const orJson = await orRes.json() as any;
            const raw = (orJson.choices?.[0]?.message?.content || '').trim();
            // Strip ```json / ``` fences — OpenRouter+Haiku sometimes wraps
            // JSON in a markdown code block despite response_format=json_object.
            const stripped = raw
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/i, '')
              .trim();
            const parsed = JSON.parse(stripped);
            critique = {
              score: typeof parsed.score === 'number' ? Math.max(0, Math.min(10, parsed.score)) : 5,
              match: (['yes', 'partial', 'no'] as const).includes(parsed.match) ? parsed.match : 'partial',
              reasoning: (parsed.reasoning || '').toString().slice(0, 300),
            };
          }
        } catch (e: any) {
          const orErr = `OpenRouter threw: ${(e?.message || 'unknown').slice(0, 150)}`;
          errorMsg = errorMsg ? `${errorMsg} | ${orErr}` : orErr;
        }
      }

      if (!critique && !errorMsg) {
        errorMsg = 'No vision API key configured';
      }

      if (critique) {
        await env.DB.prepare(
          `UPDATE posts SET image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
           WHERE id = ?`
        ).bind(critique.score, critique.reasoning, new Date().toISOString(), post.id).run();
        scored++;
        if (critique.score <= 4) lowScores++;
      } else {
        // Critique failed — write the actual error into reasoning so we
        // can SELECT and diagnose without parsing wrangler tail. Score
        // stays NULL (no badge, not eligible for regen path).
        await env.DB.prepare(
          `UPDATE posts SET image_critique_at = ?, image_critique_reasoning = ?
           WHERE id = ?`
        ).bind(new Date().toISOString(), errorMsg || 'Critique returned no result', post.id).run();
        failed++;
      }
    } catch (e: any) {
      try {
        await env.DB.prepare(
          `UPDATE posts SET image_critique_at = ?, image_critique_reasoning = ?
           WHERE id = ?`
        ).bind(new Date().toISOString(), `Backlog loop threw: ${(e?.message || 'unknown').slice(0, 200)}`, post.id).run();
      } catch { /* logging is best-effort */ }
      failed++;
    }
  };

  for (let i = 0; i < posts.length; i += CRITIQUE_CONCURRENCY) {
    await Promise.all(posts.slice(i, i + CRITIQUE_CONCURRENCY).map(processOne));
  }

  return { found: posts.length, scored, low_scores: lowScores, failed };
}

// MAX_REGEN_ATTEMPTS is imported from shared/critique-thresholds.ts (single
// source of truth shared with the publish-time quality guard in
// cron/publish-missed.ts and the gen-time critique in cron/prewarm-images.ts).

export async function runBacklogRegen(
  env: Env,
  threshold: number = CRITIQUE_ACCEPT_THRESHOLD,
): Promise<{ skipped?: boolean; found: number; regenerated: number; failed: number }> {
  if (!env.FAL_API_KEY) {
    return { skipped: true, found: 0, regenerated: 0, failed: 0 };
  }
  // Cheap gate. Excludes posts that have exhausted their regen budget so
  // the COUNT goes to 0 once the workable backlog is drained — keeps this
  // a free no-op on most ticks.
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM posts
     WHERE image_critique_score IS NOT NULL
       AND image_critique_score <= ?
       AND image_prompt IS NOT NULL AND image_prompt != ''
       AND status IN ('Scheduled', 'Draft')
       AND COALESCE(image_regen_count, 0) < ?`
  ).bind(threshold, MAX_REGEN_ATTEMPTS).first<{ n: number }>();
  if (!pending || pending.n === 0) return { skipped: true, found: 0, regenerated: 0, failed: 0 };

  const limit = 20;
  const rows = await env.DB.prepare(
    `SELECT id, content, image_prompt, client_id, user_id, image_critique_score
     FROM posts
     WHERE image_critique_score IS NOT NULL
       AND image_critique_score <= ?
       AND image_prompt IS NOT NULL AND image_prompt != ''
       AND status IN ('Scheduled', 'Draft')
       AND COALESCE(image_regen_count, 0) < ?
     ORDER BY image_critique_score ASC, scheduled_for ASC
     LIMIT ?`
  ).bind(threshold, MAX_REGEN_ATTEMPTS, limit).all<{
    id: string; content: string; image_prompt: string;
    client_id: string | null; user_id: string; image_critique_score: number;
  }>();

  const posts = rows.results || [];
  let regenerated = 0;
  let failed = 0;
  // Cache denylist lookups within a tick — posts often share a workspace,
  // and loadForbiddenSubjects is two D1 queries (user + client). Mirrors
  // the cache pattern in runBacklogCritique.
  const denylistCache = new Map<string, string[]>();

  for (const post of posts) {
    // Bump regen_count up front so a mid-loop throw or transient FAL
    // failure still consumes one of the 3 attempts. Without this a
    // generation-side error mode could starve the cap and loop indefinitely.
    await env.DB.prepare(
      `UPDATE posts SET image_regen_count = COALESCE(image_regen_count, 0) + 1 WHERE id = ?`,
    ).bind(post.id).run();

    try {
      const safe = buildSafeImagePrompt(post.image_prompt);
      if (!safe) { failed++; continue; }

      const gen = await generateImageWithGuardrails(
        env, post.user_id, post.client_id, safe, { forceFallback: true, caption: post.content },
      );
      if (!gen.imageUrl) { failed++; continue; }

      // Reuse archetypeSlug from gen (already resolved + caption-sniffed)
      // and load the owner denylist so the critique catches intra-domain
      // exclusions (e.g. pork on a brisket-only BBQ).
      const cacheKey = `${post.user_id}:${post.client_id || '__user__'}`;
      if (!denylistCache.has(cacheKey)) {
        denylistCache.set(cacheKey, await loadForbiddenSubjects(env, post.user_id, post.client_id));
      }
      const forbiddenSubjects = denylistCache.get(cacheKey) ?? [];
      const critique = await critiqueImageInternal(env, {
        imageUrl: gen.imageUrl,
        caption: post.content,
        archetypeSlug: gen.archetypeSlug,
        forbiddenSubjects,
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
