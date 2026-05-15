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
import { critiqueImageInternal, buildCritiqueSystemPrompt } from './critique';
import { generateImageWithBrandRefs } from './image-gen';
import { callAnthropicVision } from './anthropic';
import { loadForbiddenSubjects } from './profile-guards';

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
  // Same cache key shape is reused for the per-(user, client) denylist —
  // the lookup is two D1 reads per workspace, cached across the batch.
  const archetypeCache = new Map<string, string | null>();
  const denylistCache = new Map<string, string[]>();

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
      // Owner-declared denylist with per-client tier (CRITICAL #3 from the
      // audit). Pre-fix this call was hardcoded to uid only, so an agency-
      // managed client's own forbiddenSubjects was silently ignored at
      // backfill time even though the prewarm cron honoured it. Now both
      // tiers are union-ed and threaded through critiqueImageInternal.
      if (!denylistCache.has(cacheKey)) {
        denylistCache.set(cacheKey, await loadForbiddenSubjects(env, uid, clientId));
      }
      const forbiddenSubjects = denylistCache.get(cacheKey) || [];

      // 2026-05 image-stack upgrade: brand-grounded via FLUX Pro Kontext
      // when the workspace has scraped FB photos available, FLUX-dev when
      // it doesn't. See generateImageWithBrandRefs in lib/image-gen.ts.
      const gen = await generateImageWithBrandRefs(env, uid, clientId, safe, { caption });
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
          forbiddenSubjects,
        });
        if (critique) {
          console.log(`[backfill] post ${postId} critique score=${critique.score} match=${critique.match}`);
          finalCritique = critique;
          if (critique.score <= 3) {
            const retry = await generateImageWithBrandRefs(env, uid, clientId, safe, { forceFallback: true, caption });
            if (retry.imageUrl) {
              finalUrl = retry.imageUrl;
              critiqueRetries++;
              const retryCritique = await critiqueImageInternal(env, {
                imageUrl: retry.imageUrl,
                caption,
                archetypeSlug,
                forbiddenSubjects,
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
//   Cap 20/tick × Haiku 4.5 vision @ ~$0.003 = $0.06/tick worst case.
//   (Reduced from 50 in commit ecdd138 — stale fal.media URLs cost ~5s each
//   while Anthropic times out trying to fetch them.)
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
  // Cache archetype + denylist lookups within a tick — posts often share a workspace.
  const archetypeCache = new Map<string, string | null>();
  const denylistCache = new Map<string, string[]>();

  for (const post of posts) {
    let errorMsg: string | null = null;
    let critique: { score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null = null;

    try {
      const cacheKey = `${post.user_id}:${post.client_id || '__user__'}`;
      if (!archetypeCache.has(cacheKey)) {
        archetypeCache.set(cacheKey, await resolveArchetypeSlug(env, post.user_id, post.client_id));
      }
      const archetypeSlug = archetypeCache.get(cacheKey) || null;
      if (!denylistCache.has(cacheKey)) {
        denylistCache.set(cacheKey, await loadForbiddenSubjects(env, post.user_id, post.client_id));
      }
      const forbiddenSubjects = denylistCache.get(cacheKey) || [];

      // We inline the Anthropic/OpenRouter calls (rather than delegating to
      // critiqueImageInternal) so each post can stamp the exact provider
      // error string into image_critique_reasoning — useful for diagnosing
      // backlog stalls via SELECT instead of `wrangler tail`. The system
      // prompt comes from the shared builder so the HARD RULES gate matches
      // the user-initiated path; only the error-capture differs. Denylist
      // threaded through so backlog rescore picks up the same intra-domain
      // exclusions as the prewarm path.
      const systemPrompt = buildCritiqueSystemPrompt(archetypeSlug, forbiddenSubjects);
      const userPrompt = `Caption that will be published with this image:\n\n"${post.content.slice(0, 800)}"\n\nDoes the image match?`;

      // Strict JSON validator — same rules as critiqueImageInternal. Returns
      // null if any required field is missing/malformed so we don't synthesize
      // fake 5/partial defaults that bypass the quality gate.
      const validateCritique = (raw: any) => {
        const score = raw?.score;
        const match = raw?.match;
        const reasoning = (raw?.reasoning ?? '').toString().trim();
        if (typeof score !== 'number' || !isFinite(score)) return null;
        if (!(['yes', 'partial', 'no'] as const).includes(match)) return null;
        if (!reasoning) return null;
        return { score: Math.max(0, Math.min(10, score)), match, reasoning: reasoning.slice(0, 300) };
      };

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
          const validated = validateCritique(parsed);
          if (validated) {
            critique = validated;
          } else {
            errorMsg = `Anthropic: response missing required fields — ${text.slice(0, 180)}`;
          }
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
            const validated = validateCritique(parsed);
            if (validated) {
              critique = validated;
            } else {
              const orErr = `OpenRouter: response missing required fields — ${stripped.slice(0, 150)}`;
              errorMsg = errorMsg ? `${errorMsg} | ${orErr}` : orErr;
            }
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
    // Pace Anthropic — 300ms between calls. 20 posts × 300ms = 6s.
    await new Promise(r => setTimeout(r, 300));
  }

  return { found: posts.length, scored, low_scores: lowScores, failed };
}

// Max FLUX regen attempts per post. After this many tries, the post is
// excluded from the regen queue and (if its scheduled_for arrives without
// the score recovering) gets marked Missed by the publish-time quality
// guard in cron/publish-missed.ts. Without a cap, a post whose caption is
// hard for FLUX to render concretely (abstract wellness/coaching prompts
// where FLUX defaults to generic stock-photo aesthetics) would loop
// forever at ~$0.04/regen × 12 ticks/hour = ~$1/hour until publish.
const MAX_REGEN_ATTEMPTS = 3;

export async function runBacklogRegen(
  env: Env,
  threshold: number = 5,
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

      const gen = await generateImageWithBrandRefs(
        env, post.user_id, post.client_id, safe, { forceFallback: true, caption: post.content },
      );
      if (!gen.imageUrl) { failed++; continue; }

      // Re-critique so the new score persists. Same archetype-sniff fallback
      // as prewarm: DB → caption sniff → null. Forbidden subjects threaded
      // through so the regen verdict is held to the same intra-domain rule
      // as the prewarm-time critique.
      let archetypeSlug = await resolveArchetypeSlug(env, post.user_id, post.client_id);
      if (!archetypeSlug) archetypeSlug = sniffArchetypeFromCaption(post.content);
      const forbiddenSubjects = await loadForbiddenSubjects(env, post.user_id, post.client_id);
      const critique = await critiqueImageInternal(env, {
        imageUrl: gen.imageUrl,
        caption: post.content,
        archetypeSlug,
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
