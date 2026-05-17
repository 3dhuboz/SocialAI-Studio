// Image-prompt safety + archetype guardrails for the FLUX call.
//
// Extracted from src/index.ts as Phase B step 4 of the route-module split
// (see WORKER_SPLIT_PLAN.md). All pure functions / pure data — no Env, no
// DB, no fetch. Callers (cron prewarm, JIT publish, manual backfill,
// fal-proxy) supply the raw prompt + optional archetype slug and get back
// a sanitised { prompt, negativePrompt } pair ready for fal.ai.
//
// FLUX_NEGATIVE_PROMPT, FLUX_STYLE_SUFFIX, PEOPLE_REGEX, and isAbstractUIPrompt
// live in shared/flux-prompts.ts so the frontend (gemini.ts) and worker share
// a single source of truth. Re-exported here so existing import paths keep
// working without churn.
//
// The archetype resolver (resolveArchetypeSlug) lives in index.ts because
// it needs Env to query the DB — keeping this module pure makes it
// trivially testable.

import {
  FLUX_NEGATIVE_PROMPT,
  FLUX_STYLE_SUFFIX,
  PEOPLE_REGEX,
  isAbstractUIPrompt,
  needsSafeFallback,
} from '../../../../shared/flux-prompts';
import {
  SAFE_FALLBACK_SCENES,
  ARCHETYPE_IMAGE_GUARDRAILS,
  CAPTION_ARCHETYPE_KEYWORDS,
} from '../../../../shared/archetype-scenes';

export { FLUX_NEGATIVE_PROMPT, FLUX_STYLE_SUFFIX, isAbstractUIPrompt };
// Re-exported so existing consumers (cron, image-gen, tests) keep their
// import paths. Source of truth is shared/archetype-scenes.ts — see header
// comment there for why these were lifted out of this file.
export { SAFE_FALLBACK_SCENES, ARCHETYPE_IMAGE_GUARDRAILS };

// isAbstractUIPrompt, FLUX_NEGATIVE_PROMPT, FLUX_STYLE_SUFFIX are imported
// + re-exported from shared/flux-prompts.ts at the top of this file.
// SAFE_FALLBACK_SCENES, ARCHETYPE_IMAGE_GUARDRAILS, CAPTION_ARCHETYPE_KEYWORDS
// are imported + re-exported from shared/archetype-scenes.ts.

// Apply archetype guardrails to a built safe-prompt pair. If the prompt
// contains subjects forbidden for the archetype, swap in a random
// archetype-appropriate fallback scene. Always extend negative_prompt with
// the archetype's avoid-list. Returns the updated pair + a debug flag for
// logging whether a fallback was used.
export function applyArchetypeGuardrails(
  safe: { prompt: string; negativePrompt: string },
  archetypeSlug: string | null,
): { prompt: string; negativePrompt: string; swappedForFallback: boolean } {
  if (!archetypeSlug) return { ...safe, swappedForFallback: false };
  const guardrails = ARCHETYPE_IMAGE_GUARDRAILS[archetypeSlug];
  if (!guardrails) return { ...safe, swappedForFallback: false };

  const negative = `${safe.negativePrompt}, ${guardrails.extraNegatives}`;

  if (guardrails.forbidden.test(safe.prompt)) {
    const fallback = guardrails.fallbackScenes[Math.floor(Math.random() * guardrails.fallbackScenes.length)];
    return {
      prompt: `${fallback}, ${FLUX_STYLE_SUFFIX}`,
      negativePrompt: negative,
      swappedForFallback: true,
    };
  }

  return { prompt: safe.prompt, negativePrompt: negative, swappedForFallback: false };
}

// Last-resort archetype detection from the post caption itself.
//
// The full archetype defense (guardrail-prompt-rewrite + critique-retry +
// forced-fallback) all no-ops when `users.archetype_slug` is NULL — a
// workspace that never ran /api/classify-business. This is exactly how
// food-on-SaaS slipped through for SocialAI Studio's own posts (Penny Wise
// I.T workspace was never classified, so the cron prewarm ran with
// archetypeSlug=null and the guardrails did nothing).
//
// This function does cheap keyword matching on the post caption to infer
// an archetype. Used by image-gen.ts (when DB returns null) so guardrails
// fire even for un-classified workspaces. Returns null if no clear
// archetype emerges — that's still safer than a guess, because the
// downstream code already handles null gracefully (just doesn't apply
// guardrails).
//
// Threshold: ≥2 keyword hits and a >=1 hit margin over the runner-up.
// Same shape as classifyArchetypeFromFingerprint's keyword layer in
// lib/archetypes.ts — keep them roughly aligned. Keyword bank lives in
// shared/archetype-scenes.ts so the frontend can reuse the same vocabulary
// for caption-side sniffing without drift.
export function sniffArchetypeFromCaption(caption: string | null | undefined): string | null {
  if (!caption) return null;
  const lc = caption.toLowerCase();
  const scored: Array<{ slug: string; hits: number }> = [];
  for (const [slug, kws] of Object.entries(CAPTION_ARCHETYPE_KEYWORDS)) {
    let hits = 0;
    for (const kw of kws) if (lc.includes(kw)) hits++;
    if (hits > 0) scored.push({ slug, hits });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.hits - a.hits);
  const top = scored[0];
  const second = scored[1] ?? { hits: 0 };
  // Require ≥2 hits AND a ≥1 hit margin so a borderline match doesn't
  // misroute. If two archetypes tie, return null (caller falls through
  // to the safe-base prompt unchanged).
  if (top.hits >= 2 && top.hits - second.hits >= 1) return top.slug;
  return null;
}

// Returns { prompt, negativePrompt } pair, or null if the prompt is missing
// (caller should skip image gen and let the post publish text-only).
// Uses needsSafeFallback() from shared/flux-prompts.ts — the same filter the
// frontend's buildSafeImagePromptClient uses — so abstract UI prompts,
// title-case business names, vague generic terms ("produce", "items"),
// single-word prompts, and "N/A" placeholders all get swapped for a
// neutral fallback scene instead of shipping the bad prompt to FLUX.
//
// Previously this only checked `length < 5`, which let the cron path ship
// prompts the frontend would have rejected (e.g. "Bella's Bakery" 2-word
// title, "showcase journey" vague pair). Same drift bug class as the
// FLUX_NEGATIVE_PROMPT issue.
export function buildSafeImagePrompt(rawPrompt: string | null | undefined): { prompt: string; negativePrompt: string } | null {
  const prompt = (rawPrompt || '').trim();
  if (!prompt) return null;

  const safeBase = needsSafeFallback(prompt)
    ? SAFE_FALLBACK_SCENES[Math.floor(Math.random() * SAFE_FALLBACK_SCENES.length)]
    : prompt;

  // Strip people-mentions from the POSITIVE prompt — defense-in-depth.
  // The real enforcement is FLUX_NEGATIVE_PROMPT below.
  const cleaned = safeBase
    .replace(PEOPLE_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    prompt: `${cleaned || safeBase}, ${FLUX_STYLE_SUFFIX}`,
    negativePrompt: FLUX_NEGATIVE_PROMPT,
  };
}
