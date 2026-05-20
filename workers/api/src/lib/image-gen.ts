// Image generation for fal.ai FLUX endpoints.
//
// Extracted from src/index.ts as Phase B step 7 of the route-module split
// (see WORKER_SPLIT_PLAN.md). The single chokepoint that all internal
// image-gen callers (cron prewarm, JIT publish, manual backfill, fal-proxy
// endpoint) share. Composes:
//
//   1. resolveArchetypeSlug → look up workspace's classified archetype
//   2. applyArchetypeGuardrails (or forced fallback) → ensure subject
//      matches archetype before sending to FLUX
//   3. FLUX-dev (square_hd, 35 steps, guidance 7.0) → primary
//
// Why FLUX-dev and not FLUX Pro Kontext:
//   Kontext is a multi-image EDITING model — it blends/edits the reference
//   photos rather than generating from the text prompt. With guidance_scale
//   3.5, the brand-ref FB photos dominated the output, producing blurry
//   composites that looked like edited versions of random Facebook posts.
//   The text prompt (and therefore the post topic) had almost zero influence.
//   FLUX-dev is the correct text-to-image model: clear subject, bright and
//   well-exposed output, full negative_prompt support, strong prompt adherence
//   at guidance_scale 7.0.
//
// Returns { imageUrl, modelUsed, archetypeSlug } so cron logs can audit.

import type { Env } from '../env';
import {
  ARCHETYPE_IMAGE_GUARDRAILS,
  FLUX_STYLE_SUFFIX,
  applyArchetypeGuardrails,
  sniffArchetypeFromCaption,
  extractCaptionSubjectPhrase,
  injectCaptionSubject,
} from './image-safety';
import { hashStringToSceneSeed } from '../../../../shared/archetype-scenes';
import { resolveArchetypeSlug } from './archetypes';
import { logAiUsage } from './ai-usage';

// Per-model rough cost estimates for ai_usage logging. Refined when the
// fal.ai invoice settles each month — these are the published per-MP rates
// for square_hd outputs at the steps/guidance defaults used here.
const FLUX_DEV_COST_USD = 0.025;
// tech-saas-agency posts are inherently abstract (no inventory to photograph,
// no location, no people in action) so flux-dev at default 35 steps often
// rolls a soft/blurry render. We bump steps to 50 and guidance to 8.0 for
// this archetype only — same model, sharper output, stronger prompt
// adherence. Cost scales roughly with step count: ~$0.011 extra per image.
const FLUX_DEV_SAAS_COST_USD = 0.036;

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
export async function generateImageWithGuardrails(
  env: Env,
  userId: string,
  clientId: string | null,
  safePrompt: { prompt: string; negativePrompt: string },
  options: { forceFallback?: boolean; caption?: string | null; seedHint?: string | null } = {},
): Promise<{ imageUrl: string | null; modelUsed: string; archetypeSlug: string | null }> {
  const authHeader = { Authorization: `Key ${env.FAL_API_KEY}`, 'Content-Type': 'application/json' };

  const archetypeSlugRaw = await resolveArchetypeSlug(env, userId, clientId);

  // Schema v9: prefers clients.archetype_slug when clientId set, falls back
  // to users.archetype_slug. If both are NULL (workspace never classified),
  // sniff from caption — prevents food-on-SaaS posts when archetype is unset.
  let archetypeSlug = archetypeSlugRaw;
  if (!archetypeSlug && options.caption) {
    archetypeSlug = sniffArchetypeFromCaption(options.caption);
    if (archetypeSlug) {
      console.log(`[image-gen] uid=${userId} archetype unset — sniffed '${archetypeSlug}' from caption`);
    }
  }

  // Archetypes whose caption space is inherently abstract — no inventory to
  // photograph, no location, no people-in-action — force the LLM-prompt path
  // OFF and always use the curated fallback scene bank with caption-subject
  // injection. Without this, the LLM keeps generating "abstract image of...",
  // "graphic showing...", "vector illustration of..." prompts that flux can't
  // render → safety_checker rejects → black/white blanks. The 15-scene SaaS
  // bank is pre-vetted photographable; caption injection keeps each scene
  // topically tied to the post.
  const FORCE_FALLBACK_ARCHETYPES = new Set(['tech-saas-agency']);
  const forceFallback = options.forceFallback || (archetypeSlug !== null && FORCE_FALLBACK_ARCHETYPES.has(archetypeSlug));
  if (forceFallback && !options.forceFallback) {
    console.log(`[image-gen] archetype=${archetypeSlug} — auto-forcing fallback scene bank (abstract-caption archetype)`);
  }

  let guarded: { prompt: string; negativePrompt: string; swappedForFallback: boolean };
  if (forceFallback && archetypeSlug && ARCHETYPE_IMAGE_GUARDRAILS[archetypeSlug]) {
    // Critique-retry mode: skip the LLM prompt entirely, force a curated
    // archetype scene. Last-resort path when the original gen failed critique.
    const fallback = ARCHETYPE_IMAGE_GUARDRAILS[archetypeSlug];
    if (!fallback.fallbackScenes || fallback.fallbackScenes.length === 0) {
      // Archetype registered but no fallback scenes defined — fall through to
      // normal guardrail path rather than generating "undefined, candid iPhone…"
      console.warn(`[image-gen] forceFallback=true archetype=${archetypeSlug} has no fallbackScenes — using normal guardrail path`);
      guarded = applyArchetypeGuardrails(safePrompt, archetypeSlug, options.caption ?? null);
    } else {
      // Scene selection: deterministic by post-ID hash when seedHint is
      // supplied (cron prewarm + JIT publish pass post.id), random otherwise
      // (manual fal-proxy invocation). Deterministic mode is idempotent on
      // cron retries AND spreads a week's batch across the scene bank
      // instead of random-colliding on 2-3 of the same scene.
      const sceneIdx = options.seedHint
        ? hashStringToSceneSeed(options.seedHint) % fallback.fallbackScenes.length
        : Math.floor(Math.random() * fallback.fallbackScenes.length);
      const scene = fallback.fallbackScenes[sceneIdx];
      // Inject the caption-derived subject into the chosen scene so the
      // forced-fallback path doesn't ship a generic "closed laptop on desk"
      // for every regen — same fix as the normal-path applyArchetypeGuardrails
      // injection below. Without this, every critique-failure retry produces
      // visually identical generic scenes regardless of post topic.
      const captionSubject = extractCaptionSubjectPhrase(options.caption);
      const injected = injectCaptionSubject(scene, captionSubject);
      guarded = {
        prompt: `${injected}, ${FLUX_STYLE_SUFFIX}`,
        negativePrompt: `${safePrompt.negativePrompt}, ${fallback.extraNegatives}`,
        swappedForFallback: true,
      };
      console.log(`[image-gen] forceFallback=true archetype=${archetypeSlug} — using curated scene${captionSubject ? ' (caption subject injected)' : ''}${options.seedHint ? ` (seeded idx=${sceneIdx})` : ''}`);
    }
  } else {
    guarded = applyArchetypeGuardrails(safePrompt, archetypeSlug, options.caption ?? null, options.seedHint ?? null);
    if (guarded.swappedForFallback) {
      console.log(`[image-gen] archetype=${archetypeSlug} forbidden subject in prompt — swapped for fallback scene${options.seedHint ? ' (seeded)' : ''}`);
    }
  }

  // tech-saas-agency posts ship through this chokepoint with abstract,
  // people-less scenes that flux-dev underspecifies at default settings —
  // result is soft/blurry renders that look stocky. Bump steps + guidance
  // for this one archetype to force sharper, more prompt-coherent output.
  // Cost goes from ~$0.025 → ~$0.036 per image (~$0.15/week per SaaS
  // workspace at 14 posts/week).
  const isSaaS = archetypeSlug === 'tech-saas-agency';
  const numSteps = isSaaS ? 50 : 35;
  const guidance = isSaaS ? 8.0 : 7.0;
  const costUsd = isSaaS ? FLUX_DEV_SAAS_COST_USD : FLUX_DEV_COST_USD;
  const modelName = isSaaS ? 'flux-dev-hq' : 'flux-dev';

  const res = await fetch('https://fal.run/fal-ai/flux/dev', {
    method: 'POST', headers: authHeader,
    body: JSON.stringify({
      prompt: guarded.prompt,
      negative_prompt: guarded.negativePrompt,
      image_size: 'square_hd',
      num_inference_steps: numSteps,
      num_images: 1,
      enable_safety_checker: true,
      guidance_scale: guidance,
    }),
  });
  const data = await res.json() as any;
  if (!res.ok) {
    console.warn(`[image-gen] ${modelName} failed: ${res.status} ${data?.detail || data?.message || 'unknown'}`);
    // Log the failed call too — useful for understanding which prompt
    // patterns trigger fal.ai 4xx/5xx responses.
    await logAiUsage(env, {
      userId,
      clientId,
      provider: 'fal',
      model: modelName,
      operation: 'image-gen',
      imagesGenerated: 0,
      estCostUsd: 0,
      ok: false,
    });
    return { imageUrl: null, modelUsed: modelName, archetypeSlug };
  }
  const imageUrl = data?.images?.[0]?.url || null;
  await logAiUsage(env, {
    userId,
    clientId,
    provider: 'fal',
    model: modelName,
    operation: 'image-gen',
    imagesGenerated: imageUrl ? 1 : 0,
    estCostUsd: imageUrl ? costUsd : 0,
    ok: !!imageUrl,
  });
  return { imageUrl, modelUsed: modelName, archetypeSlug };
}
