// Brand-grounded image generation for fal.ai FLUX endpoints.
//
// Extracted from src/index.ts as Phase B step 7 of the route-module split
// (see WORKER_SPLIT_PLAN.md). The single chokepoint that all internal
// image-gen callers (cron prewarm, JIT publish, manual backfill, fal-proxy
// endpoint) share. Composes:
//
//   1. resolveArchetypeSlug → look up workspace's classified archetype
//   2. applyArchetypeGuardrails (or forced fallback) → ensure subject
//      matches archetype before sending to FLUX
//   3. Fetch top-N scraped FB photos for brand-grounded refs
//   4. FLUX Pro Kontext (with refs) → falls back to FLUX-dev
//
// Routing logic:
//   - If ≥1 photo: route to FLUX Pro Kontext with refs ($0.04/image,
//     4 refs max). Generated image inherits brand colour palette,
//     lighting, composition style — drops "every customer's images look
//     identical because FLUX-dev defaults" failure mode.
//   - If no photos (fresh workspace, no FB connection yet): fall back to
//     FLUX-dev ($0.025/MP, no refs) — preserves current behaviour.
//
// Returns { imageUrl, modelUsed, referencesUsed } so cron logs can audit
// cost + verify the brand-grounded path actually fires for users who
// should get it.

import type { Env } from '../env';
import {
  ARCHETYPE_IMAGE_GUARDRAILS,
  FLUX_STYLE_SUFFIX,
  applyArchetypeGuardrails,
  sniffArchetypeFromCaption,
} from './image-safety';
import { resolveArchetypeSlug } from './archetypes';
import { logAiUsage } from './ai-usage';

// Per-model rough cost estimates for ai_usage logging. Refined when the
// fal.ai invoice settles each month — these are the published per-MP rates
// for square_hd outputs at the steps/guidance defaults used here.
const FLUX_DEV_COST_USD = 0.025;
const FLUX_PRO_KONTEXT_COST_USD = 0.04;

// When `forceFallback` is true, skip the LLM-generated prompt entirely and
// pick a guaranteed-safe scene from the archetype's fallback bank. Used by
// the critique retry loop in cronPrewarmImages — if the first attempt
// scored ≤5 for image/caption mismatch, the LLM prompt is suspect and the
// safe path is a hand-curated archetype scene that always matches.
//
// `options.caption` is the post caption (when available). Used as a
// last-resort archetype source when the workspace's stored slug is NULL —
// e.g. the SocialAI Studio / Penny Wise I.T workspace that never ran
// classify-business. Without this, every defense layer no-ops and the
// system happily ships food imagery on SaaS posts.
export async function generateImageWithBrandRefs(
  env: Env,
  userId: string,
  clientId: string | null,
  safePrompt: { prompt: string; negativePrompt: string },
  options: { forceFallback?: boolean; caption?: string | null } = {},
): Promise<{ imageUrl: string | null; modelUsed: string; referencesUsed: number }> {
  const authHeader = { Authorization: `Key ${env.FAL_API_KEY}`, 'Content-Type': 'application/json' };

  // Archetype guardrail: look up the (client OR user) archetype and rewrite
  // the prompt if it contains subjects forbidden for that archetype (e.g. a
  // SaaS business's image_prompt drifted to "plated food on rustic wood
  // board"). Schema v9: prefers clients.archetype_slug when clientId set,
  // falls back to users.archetype_slug — so an agency owner running a food
  // client gets food guardrails on that client's posts, not tech guardrails.
  //
  // If both the client and user have NULL archetype_slug (workspace never
  // classified), fall back to sniffing the caption itself. This was the
  // exact failure mode that produced food-on-SaaS posts in May 2026 —
  // archetype was NULL, guardrails no-opped, retry no-opped, food shipped.
  let archetypeSlug = await resolveArchetypeSlug(env, userId, clientId);
  if (!archetypeSlug && options.caption) {
    archetypeSlug = sniffArchetypeFromCaption(options.caption);
    if (archetypeSlug) {
      console.log(`[image-gen] uid=${userId} archetype unset — sniffed '${archetypeSlug}' from caption`);
    }
  }

  let guarded: { prompt: string; negativePrompt: string; swappedForFallback: boolean };
  if (options.forceFallback && archetypeSlug && ARCHETYPE_IMAGE_GUARDRAILS[archetypeSlug]) {
    // Critique-retry mode: skip the LLM prompt entirely, force a curated
    // archetype scene. This is the last-resort path when the original gen
    // failed vision critique.
    const fallback = ARCHETYPE_IMAGE_GUARDRAILS[archetypeSlug];
    if (!fallback.fallbackScenes || fallback.fallbackScenes.length === 0) {
      // Archetype registered but no fallback scenes defined — fall through to
      // normal guardrail path rather than generating "undefined, candid iPhone…"
      console.warn(`[image-gen] forceFallback=true archetype=${archetypeSlug} has no fallbackScenes — using normal guardrail path`);
      guarded = applyArchetypeGuardrails(safePrompt, archetypeSlug);
    } else {
      const scene = fallback.fallbackScenes[Math.floor(Math.random() * fallback.fallbackScenes.length)];
      guarded = {
        prompt: `${scene}, ${FLUX_STYLE_SUFFIX}`,
        negativePrompt: `${safePrompt.negativePrompt}, ${fallback.extraNegatives}`,
        swappedForFallback: true,
      };
      console.log(`[image-gen] forceFallback=true archetype=${archetypeSlug} — using curated scene`);
    }
  } else {
    guarded = applyArchetypeGuardrails(safePrompt, archetypeSlug);
    if (guarded.swappedForFallback) {
      console.log(`[image-gen] archetype=${archetypeSlug} forbidden subject in prompt — swapped for fallback scene`);
    }
  }

  let referenceImageUrls: string[] = [];
  try {
    const photoRows = await env.DB.prepare(
      `SELECT metadata FROM client_facts
       WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fact_type = 'photo'
       ORDER BY engagement_score DESC, verified_at DESC
       LIMIT 4`
    ).bind(userId, clientId || '').all<{ metadata: string }>();
    for (const row of photoRows.results || []) {
      try {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        if (meta?.url && typeof meta.url === 'string') referenceImageUrls.push(meta.url);
      } catch { /* skip */ }
    }
  } catch (e) {
    console.warn(`[image-gen] brand-ref fetch failed for uid=${userId}:`, e);
  }

  if (referenceImageUrls.length > 0) {
    const res = await fetch('https://fal.run/fal-ai/flux-pro/kontext', {
      method: 'POST', headers: authHeader,
      body: JSON.stringify({
        prompt: guarded.prompt,
        image_urls: referenceImageUrls.slice(0, 4),
        aspect_ratio: '1:1',
        num_images: 1,
        guidance_scale: 3.5,
      }),
    });
    if (res.ok) {
      const data = await res.json() as any;
      const imageUrl = data?.images?.[0]?.url || null;
      if (imageUrl) {
        // Fire-and-forget metering. Logging is wrapped internally so a D1
        // hiccup can't propagate up and break the publish pipeline.
        try {
          await logAiUsage(env, {
            userId,
            clientId,
            provider: 'fal',
            model: 'flux-pro-kontext',
            operation: 'image-gen',
            imagesGenerated: 1,
            estCostUsd: FLUX_PRO_KONTEXT_COST_USD,
            ok: true,
          });
        } catch { /* never let logging break image gen */ }
        return { imageUrl, modelUsed: 'flux-pro-kontext', referencesUsed: referenceImageUrls.length };
      }
    }
    console.warn(`[image-gen] flux-pro-kontext failed (status ${res.status}), falling back to flux-dev`);
  }

  const res = await fetch('https://fal.run/fal-ai/flux/dev', {
    method: 'POST', headers: authHeader,
    body: JSON.stringify({
      prompt: guarded.prompt,
      negative_prompt: guarded.negativePrompt,
      image_size: 'square_hd',
      num_inference_steps: 28,
      num_images: 1,
      enable_safety_checker: true,
      guidance_scale: 5.0,
    }),
  });
  const data = await res.json() as any;
  if (!res.ok) {
    console.warn(`[image-gen] flux-dev failed: ${res.status} ${data?.detail || data?.message || 'unknown'}`);
    // Log the failed call too — useful for understanding which prompt
    // patterns trigger fal.ai 4xx/5xx responses.
    try {
      await logAiUsage(env, {
        userId,
        clientId,
        provider: 'fal',
        model: 'flux-dev',
        operation: 'image-gen',
        imagesGenerated: 0,
        estCostUsd: 0,
        ok: false,
      });
    } catch { /* never let logging break image gen */ }
    return { imageUrl: null, modelUsed: 'flux-dev', referencesUsed: 0 };
  }
  const imageUrl = data?.images?.[0]?.url || null;
  try {
    await logAiUsage(env, {
      userId,
      clientId,
      provider: 'fal',
      model: 'flux-dev',
      operation: 'image-gen',
      imagesGenerated: imageUrl ? 1 : 0,
      estCostUsd: imageUrl ? FLUX_DEV_COST_USD : 0,
      ok: !!imageUrl,
    });
  } catch { /* never let logging break image gen */ }
  return { imageUrl, modelUsed: 'flux-dev', referencesUsed: 0 };
}
