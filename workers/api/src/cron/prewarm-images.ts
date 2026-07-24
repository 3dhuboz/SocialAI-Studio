// Image prewarm cron — every 5 minutes, looks 60 minutes ahead.
//
// Runs alongside the publish cron. By the time a post crosses scheduled_for,
// its image_url should already be populated so the publish loop's
// MAX_JIT_IMAGES_PER_RUN cap never bites. Posts that don't fit in this
// tick's cap (8/tick) get caught next tick — still 25 min before publish.
//
// The 60-minute window intentionally opens before the video prewarm cron's
// 45-minute window, so video posts get a durable thumbnail before Kling starts.
//
// Processes posts in concurrent batches of CONCURRENCY (default 3). Each
// post = ~10-15s FLUX call + ~2-3s critique. Concurrency 3 cuts wall-clock
// from ~120s sequential to ~45s. Headroom against fal.ai's per-account
// concurrent-request limit (typical paid tier: 6-10).
//
// Every generated image is critiqued by the vision model. If the score is
// ≤5, the prompt is suspect — regenerate ONCE with a forced curated archetype
// fallback scene and persist the result. The final critique score lives on the
// post so PostModal can render an "AI N/10" badge.
//
// Extracted from src/index.ts as Phase B step 14 of the route-module split.

import type { Env } from '../env';
import { buildSafeImagePrompt } from '../lib/image-safety';
import { generateImageWithGuardrails, regenerateImageAfterCritique } from '../lib/image-gen';
import { critiqueImageInternal } from '../lib/critique';
import { buildCritiqueContextText } from '../lib/post-critique';
import { loadForbiddenSubjects, resolveBusinessType } from '../lib/profile-guards';
import { evaluateReleasePreflight } from '../lib/learning/release-preflight';
import type { WorkspaceOwnerKind } from '../lib/learning/types';
import { ACTIVE_CLIENT_FILTER } from './_shared';
import { CRITIQUE_ACCEPT_THRESHOLD, MAX_REGEN_ATTEMPTS } from '../../../../shared/critique-thresholds';

const CONCURRENCY = 3;
const PREWARM_LOOKAHEAD_MINUTES = 60;
const PREWARM_MISSING_IMAGE_PREDICATE = `(image_url IS NULL OR image_url = '' OR image_url LIKE 'data:%')`;

type PostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind | null;
  owner_id: string | null;
  image_prompt: string | null;
  content: string | null;
  platform: string | null;
  hashtags: string | null;
  post_type: string | null;
  video_url: string | null;
  video_status: string | null;
  video_script: string | null;
  video_shots: string | null;
};

export async function cronPrewarmImages(env: Env): Promise<{ posts_processed: number }> {
  if (!env.FAL_API_KEY) return { posts_processed: 0 };
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().replace('Z', '');
  const inLookaheadAEST = new Date(Date.now() + 10 * 60 * 60 * 1000 + PREWARM_LOOKAHEAD_MINUTES * 60 * 1000).toISOString().replace('Z', '');
  const rows = await env.DB.prepare(
    `SELECT id, user_id, client_id, owner_kind, owner_id, image_prompt, content,
            platform, hashtags, post_type, video_url, video_status, video_script, video_shots
       FROM posts
     WHERE status = 'Scheduled'
       AND scheduled_for > ? AND scheduled_for <= ?
       AND ${PREWARM_MISSING_IMAGE_PREDICATE}
       AND image_prompt IS NOT NULL AND image_prompt != '' AND image_prompt != 'N/A'
       AND length(image_prompt) > 5
       AND COALESCE(image_regen_count, 0) < ?
       AND ${ACTIVE_CLIENT_FILTER}
     ORDER BY scheduled_for ASC LIMIT 8`,
  ).bind(nowAEST, inLookaheadAEST, MAX_REGEN_ATTEMPTS).all<PostRow>();
  const posts = rows.results ?? [];
  if (posts.length === 0) return { posts_processed: 0 };
  console.log(`[CRON prewarm] ${posts.length} posts queued for image pre-warm (concurrency ${CONCURRENCY})`);

  let generated = 0;
  for (let i = 0; i < posts.length; i += CONCURRENCY) {
    const slice = posts.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map((post) => processOne(env, post)));
    generated += results.filter(Boolean).length;
  }
  return { posts_processed: generated };
}

export const __test = {
  PREWARM_MISSING_IMAGE_PREDICATE,
  PREWARM_LOOKAHEAD_MINUTES,
};

async function processOne(env: Env, post: PostRow): Promise<boolean> {
  const rawPrompt = post.image_prompt;
  const prompt = rawPrompt ? rawPrompt.split('|claim:')[0].trim() : '';
  if (!prompt || prompt.length < 5) return false;
  try {
    const caption = post.content || '';
    const critiqueContext = buildCritiqueContextText({ caption, imagePrompt: prompt });
    // Resolve businessType so buildSafeImagePrompt can fail-closed for the
    // (generic workspace + abstract-UI prompt) case. Without this the cron
    // would happily ship a random flatlay for the Penny Wise I.T failure
    // mode (businessType='small business' + image_prompt='dashboard mockup').
    // Mirrors the buildSafeImagePromptClient gate hardened in PR #136 —
    // until this commit, only frontend-initiated image requests respected it.
    const businessType = await resolveBusinessType(env, post.user_id, post.client_id);
    const safe = buildSafeImagePrompt(prompt, caption, businessType);
    if (!safe) {
      console.warn(`[CRON prewarm] skipped post ${post.id}: prompt too short, invalid, or fail-closed for generic businessType`);
      return false;
    }

    const userId = post.user_id;
    const clientId = post.client_id;
    const postId = post.id;

    // Pass caption so the in-helper guardrail fires even when archetype_slug
    // is NULL. archetypeSlug is returned from gen so the critique block
    // below doesn't need a redundant DB round-trip.
    // Run the denylist fetch in parallel with the FLUX call — the FLUX call
    // dominates wall-clock (~10s) so the DB query is essentially free.
    // The denylist is only used when the critique has enough context to run;
    // we resolve to [] otherwise so the Promise.all stays uniform.
    const denylistPromise = critiqueContext
      ? loadForbiddenSubjects(env, userId, clientId)
      : Promise.resolve([] as string[]);
    const gen = await generateImageWithGuardrails(env, userId, clientId, safe, { caption, seedHint: postId });
    let finalUrl = gen.imageUrl;
    let finalModel = gen.modelUsed;
    let finalCritique: { score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null = null;

    // Vision-critique gate: score the image against the caption + archetype.
    // Score ≤5 → regenerate once with a forced curated fallback scene.
    // We don't loop: a second failure means critique is being overly strict;
    // shipping a 6+ image is better than blocking the publish pipeline.
    // Skipped when neither critique provider key is set.
    if (finalUrl && critiqueContext) {
      // Reuse archetypeSlug from gen (already resolved + caption-sniffed
      // inside generateImageWithGuardrails) — no second DB round-trip needed.
      const archetypeSlug = gen.archetypeSlug;
      const forbiddenSubjects = await denylistPromise;

      const critique = await critiqueImageInternal(env, {
        imageUrl: finalUrl,
        caption: critiqueContext,
        archetypeSlug,
        forbiddenSubjects,
      });

      if (critique) {
        console.log(`[CRON prewarm] post ${postId} critique score=${critique.score} match=${critique.match} — ${critique.reasoning}`);
        finalCritique = critique;

        if (critique.score < CRITIQUE_ACCEPT_THRESHOLD) {
          console.log(`[CRON prewarm] post ${postId} running critic-guided relevance retry (score ${critique.score} < ${CRITIQUE_ACCEPT_THRESHOLD})`);
          const retry = await regenerateImageAfterCritique(env, userId, clientId, safe, {
            caption,
            critiqueReasoning: critique.reasoning,
            archetypeSlug,
            modelUsed: gen.modelUsed,
            seedHint: postId,
          });
          if (retry.imageUrl) {
            finalUrl = retry.imageUrl;
            finalModel = `${retry.modelUsed} (critique-guided retry)`;
            // Re-critique so the persisted score reflects what actually shipped.
            const retryCritique = await critiqueImageInternal(env, {
              imageUrl: retry.imageUrl,
              caption: critiqueContext,
              archetypeSlug,
              forbiddenSubjects,
            });
            if (retryCritique) {
              finalCritique = retryCritique;
              console.log(`[CRON prewarm] post ${postId} retry critique score=${retryCritique.score}`);
            } else {
              // Re-critique failed (provider outage). Clear the stale score
              // so the audit trail doesn't report the original bad image's
              // score against the replacement candidate. It must not be saved
              // unless a fresh verdict accepts the exact replacement image.
              finalCritique = null;
              console.warn(`[CRON prewarm] post ${postId} retry critique unavailable — image held`);
            }
          } else {
            finalUrl = null;
          }
        }
      } else if (env.ANTHROPIC_API_KEY || env.OPENROUTER_API_KEY) {
        // Critique provider configured but returned null — provider outage
        // or malformed upstream response. Image ships; backlog cron rescores.
        console.warn(`[CRON prewarm] post ${postId} critique unavailable — providers configured but returned no verdict. Backlog will rescore.`);
      }
    }

    if (!finalCritique || finalCritique.score < CRITIQUE_ACCEPT_THRESHOLD) {
      finalUrl = null;
      const scoreLabel = finalCritique ? `${finalCritique.score}/10` : 'unavailable';
      console.warn(`[CRON prewarm] post ${postId} image held by final critique gate (score ${scoreLabel})`);
    }

    if (finalUrl) {
      if (finalCritique) {
        await env.DB.prepare(
          `UPDATE posts SET image_url = ?, image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
           WHERE id = ?`
        ).bind(finalUrl, finalCritique.score, finalCritique.reasoning, new Date().toISOString(), postId).run();
      } else if ((env.ANTHROPIC_API_KEY || env.OPENROUTER_API_KEY) && critiqueContext) {
        // Critique attempted but every provider returned null. Stamp the
        // outage marker so PostModal and admin tooling surface it.
        // image_critique_at stays NULL so runBacklogCritique still picks
        // this post up on its next sweep.
        await env.DB.prepare(
          `UPDATE posts SET image_url = ?, image_critique_reasoning = ? WHERE id = ?`
        ).bind(finalUrl, 'Critique provider unavailable at gen time — backlog will rescore', postId).run();
      } else {
        await env.DB.prepare('UPDATE posts SET image_url = ? WHERE id = ?')
          .bind(finalUrl, postId).run();
      }
      await recordReleasePreflight(env, post, finalUrl, gen.archetypeSlug);
      console.log(`[CRON prewarm] generated for post ${postId} via ${finalModel}`);
      return true;
    }
    console.warn(`[CRON prewarm] no URL for post ${postId} via ${finalModel}`);
    const failureReason = finalCritique
      ? `Image held by critic (${finalCritique.score}/10): ${finalCritique.reasoning}`
      : 'Image held because the critic was unavailable or generation returned no reviewable image';
    await env.DB.prepare(
      `UPDATE posts
          SET image_regen_count = COALESCE(image_regen_count, 0) + 1,
              image_critique_score = ?,
              image_critique_reasoning = ?,
              image_critique_at = ?
        WHERE id = ?`,
    ).bind(
      finalCritique?.score ?? null,
      failureReason,
      finalCritique ? new Date().toISOString() : null,
      postId,
    ).run();
    return false;
  } catch (e: any) {
    console.warn(`[CRON prewarm] failed for post ${post.id}: ${e?.message}`);
    return false;
  }
}

async function recordReleasePreflight(
  env: Env,
  post: PostRow,
  finalUrl: string,
  archetypeSlug: string | null,
): Promise<void> {
  if (!post.owner_kind || !post.owner_id) {
    console.warn(`[CRON prewarm] skipped early release receipt for ${post.id}: ownership metadata missing`);
    return;
  }
  try {
    await evaluateReleasePreflight(env, {
      id: post.id,
      user_id: post.user_id,
      client_id: post.client_id,
      owner_kind: post.owner_kind,
      owner_id: post.owner_id,
      content: post.content ?? '',
      platform: post.platform ?? 'facebook',
      hashtags: post.hashtags,
      image_url: finalUrl,
      post_type: post.post_type,
      video_url: post.video_url,
      video_status: post.video_status,
      video_script: post.video_script,
      video_shots: post.video_shots,
      archetype_slug: archetypeSlug,
    });
  } catch (error) {
    console.warn(
      `[CRON prewarm] early release receipt failed for ${post.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
