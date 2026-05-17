// Image prewarm cron — every 5 minutes, looks 30 minutes ahead.
//
// Runs alongside the publish cron. By the time a post crosses scheduled_for,
// its image_url should already be populated so the publish loop's
// MAX_JIT_IMAGES_PER_RUN cap never bites. Posts that don't fit in this
// tick's cap (8/tick) get caught next tick — still 25 min before publish.
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
import { generateImageWithGuardrails } from '../lib/image-gen';
import { critiqueImageInternal } from '../lib/critique';
import { loadForbiddenSubjects } from '../lib/profile-guards';
import { ACTIVE_CLIENT_FILTER } from './_shared';
import { CRITIQUE_ACCEPT_THRESHOLD } from '../../../../shared/critique-thresholds';

const CONCURRENCY = 3;

type PostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  image_prompt: string | null;
  content: string | null;
};

export async function cronPrewarmImages(env: Env): Promise<{ posts_processed: number }> {
  if (!env.FAL_API_KEY) return { posts_processed: 0 };
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().replace('Z', '');
  const in30AEST = new Date(Date.now() + 10 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString().replace('Z', '');
  const rows = await env.DB.prepare(
    `SELECT id, user_id, client_id, image_prompt, content FROM posts
     WHERE status = 'Scheduled'
       AND scheduled_for > ? AND scheduled_for <= ?
       AND (image_url IS NULL OR image_url = '')
       AND image_prompt IS NOT NULL AND image_prompt != '' AND image_prompt != 'N/A'
       AND length(image_prompt) > 5
       AND ${ACTIVE_CLIENT_FILTER}
     ORDER BY scheduled_for ASC LIMIT 8`,
  ).bind(nowAEST, in30AEST).all<PostRow>();
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

async function processOne(env: Env, post: PostRow): Promise<boolean> {
  const rawPrompt = post.image_prompt;
  const prompt = rawPrompt ? rawPrompt.split('|claim:')[0].trim() : '';
  if (!prompt || prompt.length < 5) return false;
  try {
    const safe = buildSafeImagePrompt(prompt);
    if (!safe) {
      console.warn(`[CRON prewarm] skipped post ${post.id}: prompt too short or invalid`);
      return false;
    }

    const userId = post.user_id;
    const clientId = post.client_id;
    const postId = post.id;
    const caption = post.content || '';

    // Pass caption so the in-helper guardrail fires even when archetype_slug
    // is NULL. archetypeSlug is returned from gen so the critique block
    // below doesn't need a redundant DB round-trip.
    // Run the denylist fetch in parallel with the FLUX call — the FLUX call
    // dominates wall-clock (~10s) so the DB query is essentially free.
    // The denylist is only used when caption is long enough to critique;
    // we resolve to [] otherwise so the Promise.all stays uniform.
    const denylistPromise = caption.length > 20
      ? loadForbiddenSubjects(env, userId, clientId)
      : Promise.resolve([] as string[]);
    const gen = await generateImageWithGuardrails(env, userId, clientId, safe, { caption });
    let finalUrl = gen.imageUrl;
    let finalModel = gen.modelUsed;
    let finalCritique: { score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null = null;

    // Vision-critique gate: score the image against the caption + archetype.
    // Score ≤5 → regenerate once with a forced curated fallback scene.
    // We don't loop: a second failure means critique is being overly strict;
    // shipping a 6+ image is better than blocking the publish pipeline.
    // Skipped when neither critique provider key is set.
    if (finalUrl && caption.length > 20) {
      // Reuse archetypeSlug from gen (already resolved + caption-sniffed
      // inside generateImageWithGuardrails) — no second DB round-trip needed.
      const archetypeSlug = gen.archetypeSlug;
      const forbiddenSubjects = await denylistPromise;

      const critique = await critiqueImageInternal(env, {
        imageUrl: finalUrl,
        caption,
        archetypeSlug,
        forbiddenSubjects,
      });

      if (critique) {
        console.log(`[CRON prewarm] post ${postId} critique score=${critique.score} match=${critique.match} — ${critique.reasoning}`);
        finalCritique = critique;

        if (critique.score < CRITIQUE_ACCEPT_THRESHOLD) {
          console.log(`[CRON prewarm] post ${postId} regenerating with forced archetype fallback (score ${critique.score} < ${CRITIQUE_ACCEPT_THRESHOLD})`);
          const retry = await generateImageWithGuardrails(env, userId, clientId, safe, { forceFallback: true, caption });
          if (retry.imageUrl) {
            finalUrl = retry.imageUrl;
            finalModel = `${retry.modelUsed} (forced-fallback retry)`;
            // Re-critique so the persisted score reflects what actually shipped.
            const retryCritique = await critiqueImageInternal(env, {
              imageUrl: retry.imageUrl,
              caption,
              archetypeSlug,
              forbiddenSubjects,
            });
            if (retryCritique) {
              finalCritique = retryCritique;
              console.log(`[CRON prewarm] post ${postId} retry critique score=${retryCritique.score}`);
            } else {
              // Re-critique failed (provider outage). Clear the stale score
              // so the audit trail doesn't report the original bad image's
              // score against the fallback that actually shipped. The backlog
              // cron will rescore on the next tick.
              finalCritique = null;
              console.warn(`[CRON prewarm] post ${postId} re-critique failed after forceFallback — clearing stale score`);
            }
          }
        }
      } else if (env.ANTHROPIC_API_KEY || env.OPENROUTER_API_KEY) {
        // Critique provider configured but returned null — provider outage
        // or malformed upstream response. Image ships; backlog cron rescores.
        console.warn(`[CRON prewarm] post ${postId} critique unavailable — providers configured but returned no verdict. Backlog will rescore.`);
      }
    }

    if (finalUrl) {
      if (finalCritique) {
        await env.DB.prepare(
          `UPDATE posts SET image_url = ?, image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
           WHERE id = ?`
        ).bind(finalUrl, finalCritique.score, finalCritique.reasoning, new Date().toISOString(), postId).run();
      } else if ((env.ANTHROPIC_API_KEY || env.OPENROUTER_API_KEY) && caption.length > 20) {
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
      console.log(`[CRON prewarm] generated for post ${postId} via ${finalModel}`);
      return true;
    }
    console.warn(`[CRON prewarm] no URL for post ${postId} via ${finalModel}`);
    return false;
  } catch (e: any) {
    console.warn(`[CRON prewarm] failed for post ${post.id}: ${e?.message}`);
    return false;
  }
}
