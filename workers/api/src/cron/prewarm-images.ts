// Image prewarm cron — every 5 minutes, looks 30 minutes ahead.
//
// Runs alongside the publish cron. By the time a post crosses scheduled_for,
// its image_url should already be populated so the publish loop's
// MAX_JIT_IMAGES_PER_RUN cap never bites. Posts that don't fit in this
// tick's cap (8/tick) get caught next tick — still 25 min before publish.
//
// 2026-05 image-stack upgrade: every generated image is critiqued by the
// vision model. If the score is ≤3 (off-archetype, generic stock vibe, etc.)
// the prompt is suspect, so we regenerate ONCE with a forced curated
// archetype fallback scene and persist whichever attempt scored higher.
// The final critique result lives on the post so PostModal can render an
// "AI N/10" badge.
//
// Extracted from src/index.ts as Phase B step 14 of the route-module split.

import type { Env } from '../env';
import { buildSafeImagePrompt } from '../lib/image-safety';
import { generateImageWithBrandRefs } from '../lib/image-gen';
import { resolveArchetypeSlug } from '../lib/archetypes';
import { sniffArchetypeFromCaption } from '../lib/image-safety';
import { critiqueImageInternal } from '../lib/critique';
import { loadForbiddenSubjects } from '../lib/profile-guards';
import { ACTIVE_CLIENT_FILTER } from './_shared';

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
  ).bind(nowAEST, in30AEST).all();
  const posts = rows.results ?? [];
  if (posts.length === 0) return { posts_processed: 0 };
  console.log(`[CRON prewarm] ${posts.length} posts queued for image pre-warm`);

  let generated = 0;
  for (const post of posts) {
    const rawPrompt = (post as any).image_prompt as string | null;
    const prompt = rawPrompt ? rawPrompt.split('|claim:')[0].trim() : '';
    if (!prompt || prompt.length < 5) continue;
    try {
      const safe = buildSafeImagePrompt(prompt);
      if (!safe) {
        console.warn(`[CRON prewarm] skipped post ${(post as any).id}: prompt too short or invalid`);
        continue;
      }

      // 2026-05 image-stack upgrade: brand-grounded via shared helper.
      // Pulls top FB-scraped photos for the workspace as references, falls
      // back to FLUX-dev for fresh accounts. Same helper used by JIT
      // publish + manual backfill + fal-proxy.
      const userId = (post as any).user_id as string;
      const clientId = (post as any).client_id as string | null;
      const postId = (post as any).id as string;
      const caption = ((post as any).content as string | null) || '';

      // Pass caption into image-gen so the in-helper guardrail fires even
      // when users.archetype_slug is NULL (the SocialAI Studio failure mode).
      const gen = await generateImageWithBrandRefs(env, userId, clientId, safe, { caption });
      let finalUrl = gen.imageUrl;
      let finalModel = gen.modelUsed;
      let finalRefs = gen.referencesUsed;
      let finalCritique: { score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null = null;

      // ── Vision-critique gate (2026-05-12, hardened 2026-05-12 v2) ─────
      // Score the generated image against the caption + workspace archetype.
      // If the score is ≤5, the LLM-generated prompt likely produced an
      // off-archetype image (food on a SaaS post, etc.) — regenerate ONCE
      // using a forced archetype fallback scene, then ship whatever the
      // second attempt produces. We don't loop further: a second failure
      // means critique is being overly strict and shipping a 6+ image is
      // still better than blocking the publish pipeline.
      //
      // Threshold raised from ≤3 to ≤5 because Haiku scored food-on-SaaS
      // posts as 4-5 (not the expected 1-2) for the Penny Wise I.T
      // workspace, since archetype was NULL and the prompt told Haiku
      // "small business" was the context. The hardened system prompt in
      // lib/critique.ts now forces 1-2 for cross-domain bleed regardless,
      // but the wider threshold catches edge cases where Haiku is generous.
      //
      // archetypeSlug fallback chain: DB lookup → sniff from caption →
      // null. Sniffing means a workspace that never ran classify-business
      // still gets archetype-aware critique + retry, instead of every
      // defense layer no-opping.
      //
      // The final critique result is persisted on the post so PostModal can
      // render an "AI quality ✓ N/10" badge and admins can scan for
      // low-score posts before they publish.
      //
      // Skipped entirely when OPENROUTER_API_KEY is missing (critique
      // helper returns null) — preserves no-regression behaviour for
      // workspaces without the key.
      if (finalUrl && caption.length > 20) {
        let archetypeSlug = await resolveArchetypeSlug(env, userId, clientId);
        if (!archetypeSlug) {
          archetypeSlug = sniffArchetypeFromCaption(caption);
          if (archetypeSlug) {
            console.log(`[CRON prewarm] post ${postId} archetype unset — sniffed '${archetypeSlug}' from caption`);
          }
        }

        // Owner-declared denylist passed through so the vision model can
        // bite on intra-domain mismatches (e.g. pork shot for a brisket-
        // only BBQ) — the cross-domain hard rules in critique.ts won't
        // catch this on their own.
        const forbiddenSubjects = await loadForbiddenSubjects(env, userId);

        const critique = await critiqueImageInternal(env, {
          imageUrl: finalUrl,
          caption,
          archetypeSlug,
          forbiddenSubjects,
        });
        if (critique) {
          console.log(`[CRON prewarm] post ${postId} critique score=${critique.score} match=${critique.match} — ${critique.reasoning}`);
          finalCritique = critique;
          if (critique.score <= 5) {
            console.log(`[CRON prewarm] post ${postId} regenerating with forced archetype fallback (score ${critique.score} ≤ 5)`);
            const retry = await generateImageWithBrandRefs(env, userId, clientId, safe, { forceFallback: true, caption });
            if (retry.imageUrl) {
              finalUrl = retry.imageUrl;
              finalModel = `${retry.modelUsed} (forced-fallback retry)`;
              finalRefs = retry.referencesUsed;
              // Re-critique the retry so the persisted score reflects what
              // actually shipped (not the original failed attempt).
              const retryCritique = await critiqueImageInternal(env, {
                imageUrl: retry.imageUrl,
                caption,
                archetypeSlug,
                forbiddenSubjects,
              });
              if (retryCritique) {
                finalCritique = retryCritique;
                console.log(`[CRON prewarm] post ${postId} retry critique score=${retryCritique.score}`);
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
          await env.DB.prepare('UPDATE posts SET image_url = ? WHERE id = ?')
            .bind(finalUrl, postId).run();
        }
        generated++;
        console.log(`[CRON prewarm] generated for post ${postId} via ${finalModel} (${finalRefs} refs)`);
      } else {
        console.warn(`[CRON prewarm] no URL for post ${postId} via ${finalModel}`);
      }
    } catch (e: any) {
      console.warn(`[CRON prewarm] failed for post ${(post as any).id}: ${e?.message}`);
    }
  }
  return { posts_processed: generated };
}
