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
  rewriteAbstractUIAsPhotography,
} from '../../../../shared/flux-prompts';
import {
  SAFE_FALLBACK_SCENES,
  ARCHETYPE_IMAGE_GUARDRAILS,
  CAPTION_ARCHETYPE_KEYWORDS,
} from '../../../../shared/archetype-scenes';

export { FLUX_NEGATIVE_PROMPT, FLUX_STYLE_SUFFIX, isAbstractUIPrompt, rewriteAbstractUIAsPhotography };
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
//
// When `caption` is supplied AND a fallback is chosen, the caption-derived
// subject phrase is injected into the fallback scene's centerpiece so the
// final prompt at least gestures at the post topic instead of being purely
// generic. See extractCaptionSubjectPhrase + injectCaptionSubject below.
// Without this, a SaaS post about "multi-client agency dashboard" whose
// stored image_prompt got nuked for containing 'food' would ship a generic
// "closed laptop on white desk" with zero topical anchor.
export function applyArchetypeGuardrails(
  safe: { prompt: string; negativePrompt: string },
  archetypeSlug: string | null,
  caption?: string | null,
): { prompt: string; negativePrompt: string; swappedForFallback: boolean } {
  if (!archetypeSlug) return { ...safe, swappedForFallback: false };
  const guardrails = ARCHETYPE_IMAGE_GUARDRAILS[archetypeSlug];
  if (!guardrails) return { ...safe, swappedForFallback: false };

  const negative = `${safe.negativePrompt}, ${guardrails.extraNegatives}`;

  if (guardrails.forbidden.test(safe.prompt)) {
    const fallback = guardrails.fallbackScenes[Math.floor(Math.random() * guardrails.fallbackScenes.length)];
    const captionSubject = extractCaptionSubjectPhrase(caption);
    const injected = injectCaptionSubject(fallback, captionSubject);
    return {
      prompt: `${injected}, ${FLUX_STYLE_SUFFIX}`,
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
// Pipeline order (2026-05-19 update — was previously just needsSafeFallback
// → fallback):
//   1. Empty prompt → null (caller skips image gen)
//   2. UI prompt (dashboard/screenshot/UI) → rewriteAbstractUIAsPhotography
//      tries to keep the post-topic specificity by rewriting as a
//      photographable scene (phone on marble desk, etc.) before falling
//      back to a generic scene. Without this, SaaS posts whose subject IS
//      a dashboard get nuked to "closed laptop on white desk".
//   3. Other bad prompts (title-case business names, vague terms, "N/A") →
//      SAFE_FALLBACK_SCENES fallback as before.
//   4. Good prompt → pass through.
//
// Previously this only checked `length < 5`, which let the cron path ship
// prompts the frontend would have rejected (e.g. "Bella's Bakery" 2-word
// title, "showcase journey" vague pair). Same drift bug class as the
// FLUX_NEGATIVE_PROMPT issue.
export function buildSafeImagePrompt(
  rawPrompt: string | null | undefined,
  caption?: string | null,
): { prompt: string; negativePrompt: string } | null {
  const prompt = (rawPrompt || '').trim();
  if (!prompt) return null;

  let safeBase: string;
  if (isAbstractUIPrompt(prompt)) {
    // Try to rewrite the UI prompt as a photographable scene before
    // surrendering to the generic fallback. The rewrite produces a phone-on-
    // desk scene that FLUX renders as a real photo rather than a vector UI
    // mockup, AND preserves the caller's intent ("show a dashboard") instead
    // of throwing it away.
    const rewritten = rewriteAbstractUIAsPhotography(prompt, caption ?? null);
    safeBase = rewritten ?? SAFE_FALLBACK_SCENES[Math.floor(Math.random() * SAFE_FALLBACK_SCENES.length)];
  } else if (needsSafeFallback(prompt)) {
    safeBase = SAFE_FALLBACK_SCENES[Math.floor(Math.random() * SAFE_FALLBACK_SCENES.length)];
  } else {
    safeBase = prompt;
  }

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

// ── Caption → photographable centerpiece extraction ──────────────────────
//
// Background: when buildSafeImagePrompt or applyArchetypeGuardrails has to
// fall back to a generic scene from SAFE_FALLBACK_SCENES or the per-archetype
// fallbackScenes bank, the caption is ignored. The result is 3 recent posts
// where the caption was specific ("multi-client agency dashboard is a game-
// changer") but the image was generic ("closed laptop on a white desk").
//
// This helper extracts a photographable centerpiece NOUN PHRASE from the
// caption using simple string heuristics — no LLM call. The phrase is used
// to substitute the centerpiece in a generic fallback scene, so the image
// at least gestures at the post topic.
//
// Returns null when the caption has nothing extractable (too short, only
// stopwords, generic verbs). The caller falls back to the unmodified
// generic scene rather than injecting noise.
//
// Heuristic:
//   1. Strip emojis, URLs, hashtags, @mentions.
//   2. Take the first sentence (first 120 chars, split on . ! ?).
//   3. Strip leading filler ("How to", "Why", "Imagine", possessive prefix).
//   4. Find the longest contiguous noun phrase by removing stopwords and
//      common verbs. Cap at 6 words.
//   5. Reject if < 3 meaningful words remain, or if every word is a stopword.

const CAPTION_STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'or', 'but', 'so', 'yet', 'for', 'nor',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'has', 'have', 'had', 'do', 'does', 'did', 'doing', 'done',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
  'of', 'in', 'on', 'at', 'to', 'from', 'with', 'by', 'as', 'about', 'into', 'over',
  'just', 'now', 'then', 'here', 'there', 'where', 'when', 'how', 'why', 'what', 'who',
  'all', 'any', 'some', 'every', 'no', 'not', "n't",
  'very', 'really', 'truly', 'literally', 'actually', 'simply',
  // Common marketing-fluff verbs that are NOT the subject
  'love', 'loving', 'loved', 'imagine', 'introducing', 'meet', 'check', 'see',
  'know', 'get', 'getting', 'got', 'make', 'making', 'made',
  // Pure brand fluff / connective words that aren't the subject
  'game-changer', 'gamechanger', 'today', 'tonight', 'tomorrow',
]);

// Concrete subject tokens — when present in the caption, the helper biases
// toward including them in the extracted phrase. Order matters: items earlier
// in the list are preferred when scoring phrases.
const CAPTION_SUBJECT_NOUNS = [
  'dashboard', 'screen', 'feed', 'calendar', 'planner', 'inbox',
  'agency', 'client', 'clients', 'workspace', 'studio',
  'caption', 'captions', 'post', 'posts', 'reel', 'reels', 'video',
  'app', 'platform', 'tool', 'tools', 'feature', 'features',
  'logo', 'brand', 'brands', 'tile', 'tiles', 'grid', 'cards', 'panel',
  'menu', 'dish', 'plate', 'brisket', 'steak', 'coffee', 'pastry',
  'workshop', 'studio', 'shop', 'store', 'truck', 'cafe', 'bar',
];

export function extractCaptionSubjectPhrase(caption: string | null | undefined): string | null {
  if (!caption) return null;
  // Strip emojis, URLs, hashtags, @mentions before tokenising
  const cleaned = caption
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[#@]\w+/g, ' ')
    // Remove emoji + symbol chars (broad Unicode class)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 10) return null;

  // First sentence (up to 120 chars, terminator-bounded)
  const firstSentenceMatch = cleaned.split(/[.!?\n]/, 1)[0] || '';
  const firstSentence = firstSentenceMatch.slice(0, 120).trim();
  if (!firstSentence) return null;

  // Strip common opener filler so the first noun is what we land on
  let working = firstSentence
    .replace(/^(how to|why|imagine|introducing|meet|check out|see|watch|behold|presenting|today)\s+/i, '')
    // Strip possessive openers like "SocialAI Studio's"
    .replace(/^[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3}'s\s+/, '')
    // Strip "the X is" / "our X is" leading patterns where X is the subject we want
    .trim();
  if (!working) return null;

  // Tokenize, drop stopwords + pure punctuation
  const tokens = working
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z0-9-]/g, '').toLowerCase())
    .filter(Boolean);
  if (tokens.length < 3) return null;

  // Score each token: 0 if stopword, 1 otherwise, +2 bonus for concrete subject nouns
  const scored = tokens.map((tok) => ({
    tok,
    score: CAPTION_STOPWORDS.has(tok) ? 0 : (CAPTION_SUBJECT_NOUNS.includes(tok) ? 3 : 1),
  }));

  // Find longest contiguous span of non-stopwords (score > 0)
  let bestStart = -1;
  let bestEnd = -1;
  let bestScore = 0;
  let curStart = -1;
  let curScore = 0;
  for (let i = 0; i < scored.length; i++) {
    if (scored[i].score > 0) {
      if (curStart === -1) curStart = i;
      curScore += scored[i].score;
      const len = i - curStart + 1;
      // Prefer longer spans, then higher score
      if (len > (bestEnd - bestStart + 1) || (len === (bestEnd - bestStart + 1) && curScore > bestScore)) {
        bestStart = curStart;
        bestEnd = i;
        bestScore = curScore;
      }
    } else {
      curStart = -1;
      curScore = 0;
    }
    if (bestEnd - bestStart + 1 >= 6) break; // cap at 6 words
  }

  if (bestStart === -1) return null;
  const span = scored.slice(bestStart, Math.min(bestEnd + 1, bestStart + 6));
  const meaningful = span.filter((s) => !CAPTION_STOPWORDS.has(s.tok));
  // Reject phrases that are just a single token or all marketing fluff
  if (meaningful.length < 2) return null;
  // Reject phrases without at least one concrete-feeling word (length ≥ 4)
  if (!meaningful.some((s) => s.tok.length >= 4)) return null;

  return span.map((s) => s.tok).join(' ');
}

// ── Inject caption-derived subject into a generic fallback scene ─────────
//
// Background: when a generic fallback scene from SAFE_FALLBACK_SCENES or
// per-archetype fallbackScenes is used, the centerpiece object (closed
// laptop / notebook / mug) is ungrounded — it doesn't reflect the caption.
// This helper replaces the centerpiece with a caption-derived phrase so the
// fallback at least gestures at the post topic.
//
// Returns the original scene unchanged when:
//   - subject is null / empty / shorter than 3 words after stopword strip
//   - the scene has no recognisable centerpiece to substitute
//
// Deterministic — no randomness so the same scene + caption → same output.
// Tested in image-safety.test.ts.
const FALLBACK_CENTERPIECE_PATTERNS: Array<{ pattern: RegExp; }> = [
  // Order matters: more specific patterns first
  { pattern: /closed laptop on (?:a )?(?:white |clean |wooden )?desk/i },
  { pattern: /open notebook(?:\s*,?\s*(?:smartphone face-down|ceramic mug)?(?:\s+and pen)?)?(?:\s+on)?/i },
  { pattern: /matte black smartphone face-down/i },
  { pattern: /leather-bound journal and brass pen/i },
  { pattern: /beige aesthetic workspace with notebook(?:\s*,\s*pen)?(?:\s*,\s*plant)?(?:\s+and closed laptop)?/i },
  { pattern: /modern co-working studio with closed laptop on a clean desk/i },
  { pattern: /modern office desk with closed laptop/i },
  { pattern: /sleek desk corner with brushed metal lamp/i },
  { pattern: /small potted plant, closed laptop and geometric wall art/i },
];

export function injectCaptionSubject(
  scene: string,
  captionSubject: string | null | undefined,
): string {
  const subject = (captionSubject || '').trim();
  if (!subject || subject.split(/\s+/).length < 3) return scene;
  if (!scene) return scene;

  for (const { pattern } of FALLBACK_CENTERPIECE_PATTERNS) {
    if (pattern.test(scene)) {
      // Replace the centerpiece phrase with the caption-derived subject,
      // preserving the surrounding mood/lighting/composition tokens.
      return scene.replace(pattern, subject);
    }
  }

  // No centerpiece pattern matched — leave the scene unchanged. Better an
  // unmodified scene than mangled prepositions.
  return scene;
}
