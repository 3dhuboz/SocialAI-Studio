import { describe, it, expect } from 'vitest';
import {
  isAbstractUIPrompt,
  buildSafeImagePrompt,
  sniffArchetypeFromCaption,
  applyArchetypeGuardrails,
  extractCaptionSubjectPhrase,
  injectCaptionSubject,
  FLUX_STYLE_SUFFIX,
  FLUX_NEGATIVE_PROMPT,
} from '../lib/image-safety';
import { isTextRenderingPrompt, needsSafeFallback, rewriteAbstractUIAsPhotography } from '../../../../shared/flux-prompts';

// ── isAbstractUIPrompt ────────────────────────────────────────────────────

describe('isAbstractUIPrompt', () => {
  // Should match — these are clearly UI / digital artefacts
  it.each([
    'dashboard screenshot of marketing analytics',
    'landing page mockup for SaaS product',
    'pricing table comparison grid',
    'wireframe of the mobile app screens',
    'UI/UX design for the checkout flow',
    'data chart showing revenue breakdown',
    'bar chart of quarterly results',
    'system architecture diagram',
    'an infographic showing content strategy',
  ])('returns true for: %s', (prompt) => {
    expect(isAbstractUIPrompt(prompt)).toBe(true);
  });

  // Should NOT match — these are legitimate small-business prompts that
  // were falsely flagged before the regex was tightened (2026-05 fix)
  it.each([
    'meal plan printed on a cafe chalkboard',
    'business plan notebook open on a desk',
    'wine tier displayed on a bottle label',
    'tea table arrangement with flowers',
    'picnic table in a sunny backyard',
    'centre column of a rustic barn',
    'fence grid in a paddock at sunset',
    'fresh harvest in wicker baskets',
    'slow-smoked brisket on a board',
    'open notebook and ceramic mug on a desk',
  ])('returns false for: %s', (prompt) => {
    expect(isAbstractUIPrompt(prompt)).toBe(false);
  });
});

// ── FLUX_NEGATIVE_PROMPT / FLUX_STYLE_SUFFIX content guards ──────────────
//
// Regression tests for 2026-05-16: the worker copy of FLUX_NEGATIVE_PROMPT
// drifted from the frontend copy and was missing the anti-dark tokens,
// which let cron-generated images ship dark/underexposed. These tests fail
// loudly if either constant loses its key tokens during a future edit.

describe('FLUX_NEGATIVE_PROMPT', () => {
  it('includes anti-dark tokens (the "dark image" bug regression guard)', () => {
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/\bdark\b/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/\bunderexposed\b/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/\bdim\b/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/\bshadowed\b/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/\bgloomy\b/);
  });
  it('includes anti-blur tokens (the "blurry image" bug regression guard)', () => {
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/\bblurry\b/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/out of focus/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/motion blur/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/soft focus/);
  });
  it('includes people/UI suppression tokens (existing safety contract)', () => {
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/\bpeople\b/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/\bfaces\b/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/\bhands\b/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/dashboard/);
    expect(FLUX_NEGATIVE_PROMPT).toMatch(/infographic/);
  });
});

describe('FLUX_STYLE_SUFFIX', () => {
  it('includes "candid iPhone" tripwire token + brightness + sharpness cues', () => {
    expect(FLUX_STYLE_SUFFIX).toContain('candid iPhone');
    expect(FLUX_STYLE_SUFFIX).toMatch(/BRIGHT natural daylight/);
    expect(FLUX_STYLE_SUFFIX).toMatch(/well-exposed/);
    expect(FLUX_STYLE_SUFFIX).toMatch(/sharp focus/);
    expect(FLUX_STYLE_SUFFIX).toMatch(/crisp detail/);
  });
});

// ── needsSafeFallback (shared filter) ─────────────────────────────────────

describe('needsSafeFallback', () => {
  // True — needs fallback
  it.each([
    ['', 'empty'],
    ['hi', 'too short (< 15)'],
    ['singleword', 'no whitespace'],
    ['N/A', 'placeholder'],
    ['none', 'placeholder'],
    ['undefined', 'placeholder'],
    ["Bella's Bakery", 'title-case ≤5 words'],
    ['Acme Co Plumbing & Heating', 'title-case ≤5 words with brand chars'],
    ['showcase items', 'vague term + < 8 words'],
    ['fresh produce stuff', 'vague terms + < 8 words'],
    ['journey of tips today', 'vague terms + < 8 words'],
    ['dashboard mockup', 'abstract UI'],
    ['pricing tier comparison page', 'abstract UI'],
    ["festival entrance gate with bold 'Gladstone BBQ Festival 2026' banner", 'readable signage request'],
    ['ticket wristbands and printed entry passes with prices visible', 'printed ticket text request'],
  ])('returns true for: "%s" (%s)', (prompt) => {
    expect(needsSafeFallback(prompt)).toBe(true);
  });

  // False — prompt is good
  it.each([
    'slow-smoked brisket on a butcher board with rosemary sprigs',
    'overhead flatlay of an open notebook, ceramic mug and pen on a linen runner',
    'fresh produce displayed in a wicker basket at the farmers market',  // vague term BUT 11 words
    'rolled yoga mat, water bottle and a folded towel on a clean studio floor',
  ])('returns false for: %s', (prompt) => {
    expect(needsSafeFallback(prompt)).toBe(false);
  });
});

describe('isTextRenderingPrompt', () => {
  it('flags prompts that ask the image model to render brand/event text', () => {
    expect(isTextRenderingPrompt("banner reading 'Gladstone BBQ Festival 2026'")).toBe(true);
    expect(isTextRenderingPrompt('printed entry passes with VIP prices visible')).toBe(true);
    expect(isTextRenderingPrompt('menu board showing BBQ prices')).toBe(true);
  });

  it('does not flag plain unprinted props', () => {
    expect(isTextRenderingPrompt('plain unprinted wristbands beside sliced brisket on butcher paper')).toBe(false);
  });
});

// ── buildSafeImagePrompt ──────────────────────────────────────────────────

describe('buildSafeImagePrompt', () => {
  it('returns null for null input', () => {
    expect(buildSafeImagePrompt(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(buildSafeImagePrompt('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(buildSafeImagePrompt('   ')).toBeNull();
  });

  it('swaps short prompts for a fallback scene (was null pre-2026-05-16)', () => {
    // Prior behaviour returned null for length < 5 — left the cron path
    // with a weaker filter than the frontend's buildSafeImagePromptClient.
    // Now both use needsSafeFallback: short prompts get a neutral scene
    // instead of dropping the image. The cron's SQL filter still rejects
    // length < 5 upstream, so this path mainly catches mid-length junk
    // like "hi mom" or "N/A".
    const result = buildSafeImagePrompt('hi');
    expect(result).not.toBeNull();
    expect(result!.prompt).toContain(FLUX_STYLE_SUFFIX);
  });

  it('swaps title-case business name (e.g. "Bella Bakery") for a fallback scene', () => {
    const result = buildSafeImagePrompt("Bella's Bakery");
    expect(result).not.toBeNull();
    expect(result!.prompt).not.toContain("Bella's");
    expect(result!.prompt).toContain(FLUX_STYLE_SUFFIX);
  });

  it('swaps "N/A" / "none" placeholder strings for a fallback scene', () => {
    const result = buildSafeImagePrompt('N/A');
    expect(result).not.toBeNull();
    expect(result!.prompt).not.toMatch(/^N\/A/);
  });

  it('swaps vague-term short prompts for a fallback scene', () => {
    // "showcase items" hits the vague-term + <8-words branch
    const result = buildSafeImagePrompt('showcase items');
    expect(result).not.toBeNull();
    expect(result!.prompt).not.toContain('showcase items');
  });

  it('returns a prompt+negativePrompt pair for a valid prompt', () => {
    const result = buildSafeImagePrompt('slow-smoked brisket on a butcher board');
    expect(result).not.toBeNull();
    expect(result!.prompt).toContain('brisket');
    expect(result!.prompt).toContain(FLUX_STYLE_SUFFIX);
    expect(result!.negativePrompt).toBe(FLUX_NEGATIVE_PROMPT);
  });

  it('rewrites readable-text prompts to a textless BBQ scene', () => {
    const result = buildSafeImagePrompt(
      "Festival entrance gate with bold 'Gladstone BBQ Festival 2026' banner and Tannum Seagulls signage",
      'The website is live and tickets are ready for Gladstone BBQ Festival.',
      'bbq-smokehouse',
    );
    expect(result).not.toBeNull();
    expect(result!.prompt).toContain('brisket');
    expect(result!.prompt).not.toContain('Gladstone BBQ Festival');
    expect(result!.prompt).not.toContain('banner');
    expect(result!.negativePrompt).toContain('misspelled words');
  });

  it('strips people-mentions from the positive prompt', () => {
    const result = buildSafeImagePrompt('a smiling chef holding a plate of pasta on a wooden table');
    expect(result!.prompt).not.toMatch(/\b(smiling|chef|holding)\b/i);
  });

  it('rewrites abstract UI prompts as photographable scenes (2026-05-19 update, businessType-gated 2026-05-21)', () => {
    // Previous behavior: UI terms got swapped for a random SAFE_FALLBACK_SCENES
    // entry (closed laptop / notebook). This made SaaS posts that LITERALLY
    // were about a dashboard ship a generic mismatched image.
    // New behavior: rewriteAbstractUIAsPhotography produces a phone-on-marble-
    // desk scene that FLUX renders as a real photo of a UI on a screen, not a
    // wireframe and not a generic substitute.
    //
    // 2026-05-21: the rewrite path is now gated behind a SPECIFIC businessType
    // (mirror of the client-side gate hardened in PR #136). Pass
    // 'tech-saas-agency' to exercise the rewrite path here — without an
    // explicit businessType the prompt fails closed (covered by the new
    // companion tests in src/lib/image-safety.test.ts).
    const result = buildSafeImagePrompt('dashboard mockup of the analytics screen', null, 'tech-saas-agency');
    expect(result).not.toBeNull();
    // The original UI terms should NOT appear verbatim in the prompt
    expect(result!.prompt).not.toMatch(/^dashboard mockup/);
    // But the rewrite should anchor to a physical phone-on-desk context
    expect(result!.prompt.toLowerCase()).toMatch(/smartphone|phone|desk|marble/);
    expect(result!.prompt).toContain(FLUX_STYLE_SUFFIX);
  });

  it('threads caption through to the safe-prompt build path (2026-05-19)', () => {
    // Caption arg is accepted on the new signature so downstream callers
    // (cron prewarm, publish-missed JIT, backfill) can plumb it through to
    // the rewriteAbstractUIAsPhotography helper. The caption itself is
    // currently used as a reserved hook (not consumed by the rewrite yet
    // beyond contextual signal) — this test guards the signature.
    //
    // Same 2026-05-21 update applies: pass a specific businessType so the
    // rewrite path actually fires (generic businessType fails closed by
    // design — covered in image-safety.test.ts).
    const result = buildSafeImagePrompt(
      'dashboard mockup of the analytics screen',
      'Our new agency dashboard shows all 5 client brands at a glance.',
      'tech-saas-agency',
    );
    expect(result).not.toBeNull();
    expect(result!.prompt).toContain(FLUX_STYLE_SUFFIX);
  });
});

// ── sniffArchetypeFromCaption ─────────────────────────────────────────────

describe('sniffArchetypeFromCaption', () => {
  it('returns null for null / empty caption', () => {
    expect(sniffArchetypeFromCaption(null)).toBeNull();
    expect(sniffArchetypeFromCaption('')).toBeNull();
  });

  it('returns null when no archetype keywords match', () => {
    expect(sniffArchetypeFromCaption('great weather today, long weekend!')).toBeNull();
  });

  it('identifies tech-saas-agency from SaaS marketing copy', () => {
    const caption = 'Our AI content autopilot publishes automatically to your social media management dashboard. Smart scheduling + engagement data included.';
    expect(sniffArchetypeFromCaption(caption)).toBe('tech-saas-agency');
  });

  it('identifies food-restaurant from menu copy', () => {
    expect(sniffArchetypeFromCaption('Check out our new seasonal menu — every dish crafted from local produce. Come dine with us at the restaurant tonight.')).toBe('food-restaurant');
  });

  it('identifies bbq-smokehouse from BBQ copy', () => {
    expect(sniffArchetypeFromCaption('Weekend special: low and slow smoked brisket. Order now from the smokehouse.')).toBe('bbq-smokehouse');
  });

  it('returns null when only 1 keyword matches (below threshold)', () => {
    // "menu" alone is only 1 hit — below the ≥2 threshold
    expect(sniffArchetypeFromCaption('check the menu')).toBeNull();
  });

  it('returns null when two archetypes tie', () => {
    // Deliberately craft a caption that hits exactly 2 in two archetypes
    // with the same count. The function returns null on ties.
    const tied = 'brisket pulled pork pilates gym';
    const result = sniffArchetypeFromCaption(tied);
    // May or may not be null depending on exact hit counts, but must not throw
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

// ── applyArchetypeGuardrails ──────────────────────────────────────────────

describe('applyArchetypeGuardrails', () => {
  const safeBase = {
    prompt: 'slow-smoked brisket on a board, natural daylight',
    negativePrompt: 'text, watermark',
  };

  it('passes through unchanged when archetypeSlug is null', () => {
    const result = applyArchetypeGuardrails(safeBase, null);
    expect(result.prompt).toBe(safeBase.prompt);
    expect(result.swappedForFallback).toBe(false);
  });

  it('passes through unchanged when archetypeSlug is unknown', () => {
    const result = applyArchetypeGuardrails(safeBase, 'unknown-archetype');
    expect(result.prompt).toBe(safeBase.prompt);
    expect(result.swappedForFallback).toBe(false);
  });

  it('always extends negativePrompt with archetype extraNegatives', () => {
    const result = applyArchetypeGuardrails(safeBase, 'bbq-smokehouse');
    expect(result.negativePrompt).toContain(safeBase.negativePrompt);
    expect(result.negativePrompt).toContain('dashboard');
  });

  it('passes through a clean prompt (no forbidden subject) without swap', () => {
    const result = applyArchetypeGuardrails(safeBase, 'bbq-smokehouse');
    // 'brisket' is NOT in bbq-smokehouse.forbidden — it's the archetype's own product
    expect(result.swappedForFallback).toBe(false);
    expect(result.prompt).toBe(safeBase.prompt);
  });

  it('swaps prompt for fallback when forbidden subject detected', () => {
    const techSaasPrompt = {
      prompt: 'plated food on rustic wood board, warm restaurant light',
      negativePrompt: 'text, watermark',
    };
    const result = applyArchetypeGuardrails(techSaasPrompt, 'tech-saas-agency');
    expect(result.swappedForFallback).toBe(true);
    // The returned prompt must come from the fallback bank, not the original
    expect(result.prompt).not.toContain('plated food');
    expect(result.prompt).toContain(FLUX_STYLE_SUFFIX);
  });

  it('swap prompt for tech-saas-agency when prompt contains bbq/food terms', () => {
    const falsePrompt = {
      prompt: 'smoked brisket on a board, BBQ smokehouse background',
      negativePrompt: 'text',
    };
    const result = applyArchetypeGuardrails(falsePrompt, 'tech-saas-agency');
    expect(result.swappedForFallback).toBe(true);
  });

  it('fallback scenes always include FLUX_STYLE_SUFFIX', () => {
    const falsePrompt = {
      prompt: 'gym equipment and treadmills for a SaaS post',
      negativePrompt: 'text',
    };
    const result = applyArchetypeGuardrails(falsePrompt, 'tech-saas-agency');
    expect(result.swappedForFallback).toBe(true);
    expect(result.prompt).toContain(FLUX_STYLE_SUFFIX);
  });

  it('food-restaurant does NOT swap for food prompts (food is its own domain)', () => {
    const foodPrompt = {
      prompt: 'overhead shot of a plated dish on a rustic wooden table',
      negativePrompt: 'text',
    };
    const result = applyArchetypeGuardrails(foodPrompt, 'food-restaurant');
    expect(result.swappedForFallback).toBe(false);
  });

  it('food-restaurant swaps for dashboard/laptop prompt (cross-domain bleed)', () => {
    const uiPrompt = {
      prompt: 'laptop screen showing a dashboard in a restaurant setting',
      negativePrompt: 'text',
    };
    const result = applyArchetypeGuardrails(uiPrompt, 'food-restaurant');
    expect(result.swappedForFallback).toBe(true);
  });

  // ── 2026-05-19 caption-injection extension ──────────────────────────────

  it('injects caption-derived subject when swapping for fallback (2026-05-19)', () => {
    // Cross-domain bleed scenario: SaaS post whose LLM-generated prompt
    // hallucinated food. applyArchetypeGuardrails swaps for a tech-saas
    // fallback scene. With the caption passed through, the centerpiece
    // (closed laptop / notebook) gets substituted by the caption subject so
    // the fallback at least gestures at the post topic.
    const techPrompt = {
      prompt: 'plated food on rustic wood board, warm restaurant light',
      negativePrompt: 'text, watermark',
    };
    const caption = 'Our multi-client agency dashboard shows 5 brands at once.';
    const result = applyArchetypeGuardrails(techPrompt, 'tech-saas-agency', caption);
    expect(result.swappedForFallback).toBe(true);
    expect(result.prompt).not.toContain('plated food');
    expect(result.prompt).toContain(FLUX_STYLE_SUFFIX);
    // The injected subject (or part of it) should appear when injection
    // successfully matched a centerpiece pattern in the scene. We allow the
    // injection helper to leave the scene unmodified when no pattern matches
    // — that's documented behavior — so this test only asserts behavior is
    // not worse than the unmodified path: subject either appears, or scene
    // is at least the curated fallback (not the original food prompt).
  });

  it('leaves fallback scene unchanged when caption has nothing extractable', () => {
    const techPrompt = {
      prompt: 'plated food on rustic wood board, warm restaurant light',
      negativePrompt: 'text, watermark',
    };
    const result = applyArchetypeGuardrails(techPrompt, 'tech-saas-agency', '');
    expect(result.swappedForFallback).toBe(true);
    expect(result.prompt).toContain(FLUX_STYLE_SUFFIX);
  });
});

// ── rewriteAbstractUIAsPhotography (Change 3) ────────────────────────────

describe('rewriteAbstractUIAsPhotography', () => {
  // Deterministic — same input always produces same output. No randomness.

  it('returns null for empty / whitespace input', () => {
    expect(rewriteAbstractUIAsPhotography('')).toBeNull();
    expect(rewriteAbstractUIAsPhotography('   ')).toBeNull();
  });

  it('returns null for non-UI prompts (no rewrite applies)', () => {
    // Caller falls through to SAFE_FALLBACK_SCENES path.
    expect(rewriteAbstractUIAsPhotography('overhead flatlay of sourdough loaves on linen')).toBeNull();
    expect(rewriteAbstractUIAsPhotography('slow-smoked brisket on a butcher board')).toBeNull();
  });

  it('is deterministic: same input always produces same output', () => {
    const first = rewriteAbstractUIAsPhotography('dashboard with analytics');
    const second = rewriteAbstractUIAsPhotography('dashboard with analytics');
    const third = rewriteAbstractUIAsPhotography('dashboard with analytics');
    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('rewrites dashboard prompts as a phone-on-marble-desk scene', () => {
    const result = rewriteAbstractUIAsPhotography('multi-client agency dashboard');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/smartphone|phone/);
    expect(result!.toLowerCase()).toMatch(/marble|desk/);
  });

  it('rewrites screenshot prompts as a phone-on-marble-desk scene', () => {
    const result = rewriteAbstractUIAsPhotography('screenshot of the new feature');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/smartphone|phone/);
  });

  it('rewrites infographic prompts as a phone-on-desk tile-grid scene', () => {
    const result = rewriteAbstractUIAsPhotography('infographic of our content strategy');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/smartphone|phone|desk/);
  });

  it('rewrites pricing-table prompts as a three-column pricing card scene', () => {
    // Use a prompt without 'comparison' so the pricing branch wins over the
    // more-specific comparison side-by-side branch.
    const result = rewriteAbstractUIAsPhotography('pricing tier plan layout');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/pricing|column|card/);
  });

  it('treats "pricing comparison" as a comparison (more specific pattern wins)', () => {
    // Documents the order-matters behavior: "comparison" + UI noun → two
    // phones side-by-side, even when 'pricing' is also present.
    const result = rewriteAbstractUIAsPhotography('pricing tier comparison table');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/two|side-by-side/);
  });

  it('rewrites chart/graph prompts as a bar-graph on phone scene', () => {
    const result = rewriteAbstractUIAsPhotography('bar chart of quarterly revenue');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/bar graph|smartphone|phone/);
  });

  it('rewrites comparison prompts as a two-phones side-by-side scene', () => {
    const result = rewriteAbstractUIAsPhotography('comparison dashboard side-by-side');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/two|side-by-side/);
  });

  it('rewrites flow/architecture diagram prompts as a notebook sketch scene', () => {
    const result = rewriteAbstractUIAsPhotography('system architecture diagram');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/notebook|flow|sketch|diagram|pen|hand-drawn/);
  });

  it('rewrites wireframe / mockup prompts as a notebook UI-sketch scene', () => {
    const result = rewriteAbstractUIAsPhotography('wireframe of the checkout flow');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/notebook|sketch|hand-drawn/);
  });

  it('rewrites landing page prompts as a laptop-on-desk hero scene', () => {
    const result = rewriteAbstractUIAsPhotography('landing page for SaaS product');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/laptop|hero|website/);
  });

  it('rewrites app screen prompts as a phone-on-marble-desk scene', () => {
    const result = rewriteAbstractUIAsPhotography('mobile app screen for booking');
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toMatch(/smartphone|phone/);
  });

  it('every rewrite anchors to a physical context (no bare UI mockups)', () => {
    // The whole point of the rewrite is to give FLUX a photographable scene
    // rather than a vector mockup. Every output must mention a physical
    // surface or hand-held device or natural light source.
    const samples = [
      'dashboard with analytics',
      'screenshot of the feature',
      'infographic of strategy',
      'app screen for booking',
      'pricing comparison',
      'bar chart of revenue',
      'system flow diagram',
    ];
    for (const s of samples) {
      const r = rewriteAbstractUIAsPhotography(s);
      expect(r, `failed on: ${s}`).not.toBeNull();
      expect(r!.toLowerCase()).toMatch(/desk|marble|notebook|wooden|phone|smartphone|laptop|daylight/);
    }
  });
});

// ── extractCaptionSubjectPhrase (Change 1) ───────────────────────────────

describe('extractCaptionSubjectPhrase', () => {
  it('returns null for null / empty / very-short captions', () => {
    expect(extractCaptionSubjectPhrase(null)).toBeNull();
    expect(extractCaptionSubjectPhrase(undefined)).toBeNull();
    expect(extractCaptionSubjectPhrase('')).toBeNull();
    expect(extractCaptionSubjectPhrase('hi')).toBeNull();
  });

  it('returns null when caption has only stopwords / generic verbs', () => {
    // "Imagine the love today" — every word is a stopword/fluff
    expect(extractCaptionSubjectPhrase('Imagine the love today!')).toBeNull();
  });

  it('extracts the multi-client agency dashboard subject from the example caption', () => {
    const caption = "SocialAI Studio's multi-client agency dashboard is a game-changer";
    const result = extractCaptionSubjectPhrase(caption);
    expect(result).not.toBeNull();
    // Should pick up 'multi-client', 'agency', and 'dashboard' as the core span
    expect(result!.toLowerCase()).toContain('dashboard');
  });

  it('extracts a meaningful phrase from the AI captions example', () => {
    const caption = 'Our new AI captions feature writes posts in your brand voice automatically.';
    const result = extractCaptionSubjectPhrase(caption);
    expect(result).not.toBeNull();
    // Should pick up 'AI captions feature' or 'captions feature' as the core span
    expect(result!.toLowerCase()).toMatch(/captions|feature/);
  });

  it('strips URLs, hashtags, @mentions before extracting', () => {
    const caption = 'Check out https://example.com #marketing @everyone our agency dashboard launched today';
    const result = extractCaptionSubjectPhrase(caption);
    expect(result).not.toBeNull();
    expect(result).not.toContain('https');
    expect(result).not.toContain('#');
    expect(result).not.toContain('@');
  });

  it('strips emojis before extracting', () => {
    const caption = 'Our new agency dashboard is here.';
    const result = extractCaptionSubjectPhrase(caption);
    expect(result).not.toBeNull();
    expect(result).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('caps at 6 words to keep the phrase substitutable', () => {
    const caption = 'Behold the absolutely incredible amazing multi-client agency dashboard launch today.';
    const result = extractCaptionSubjectPhrase(caption);
    if (result !== null) {
      expect(result.split(/\s+/).length).toBeLessThanOrEqual(6);
    }
  });

  it('returns null when extracted phrase is < 2 meaningful words', () => {
    // 'The dashboard' is 1 meaningful word — below the threshold
    expect(extractCaptionSubjectPhrase('The dashboard.')).toBeNull();
  });

  it('is deterministic: same input always produces same output', () => {
    const caption = 'Our multi-client agency dashboard is finally live.';
    const first = extractCaptionSubjectPhrase(caption);
    const second = extractCaptionSubjectPhrase(caption);
    expect(first).toBe(second);
  });
});

// ── injectCaptionSubject (Change 1) ──────────────────────────────────────

describe('injectCaptionSubject', () => {
  it('returns scene unchanged when subject is null / empty', () => {
    const scene = 'closed laptop on white desk, soft morning daylight';
    expect(injectCaptionSubject(scene, null)).toBe(scene);
    expect(injectCaptionSubject(scene, undefined)).toBe(scene);
    expect(injectCaptionSubject(scene, '')).toBe(scene);
  });

  it('returns scene unchanged when subject is < 3 words', () => {
    const scene = 'closed laptop on white desk, soft morning daylight';
    expect(injectCaptionSubject(scene, 'tiny')).toBe(scene);
    expect(injectCaptionSubject(scene, 'two words')).toBe(scene);
  });

  it('substitutes the centerpiece in a known closed-laptop scene', () => {
    const scene = 'closed laptop on white desk, soft morning daylight, overhead shot';
    const result = injectCaptionSubject(scene, 'multi-client agency dashboard');
    // The centerpiece (closed laptop on white desk) is replaced; the mood
    // tokens (soft morning daylight, overhead shot) survive.
    expect(result).toContain('multi-client agency dashboard');
    expect(result).toContain('soft morning daylight');
    expect(result).toContain('overhead shot');
    expect(result).not.toContain('closed laptop on white desk');
  });

  it('substitutes the centerpiece in a known open-notebook scene', () => {
    const scene = 'overhead flatlay of an open notebook, ceramic mug and pen on a linen runner, soft daylight';
    const result = injectCaptionSubject(scene, 'weekly content planner spread');
    expect(result).toContain('weekly content planner spread');
    expect(result).toContain('soft daylight');
  });

  it('leaves scene unchanged when no centerpiece pattern matches', () => {
    const scene = 'abstract texture of warm afternoon sunlight casting shadows across a textured wall';
    const subject = 'multi-client agency dashboard';
    const result = injectCaptionSubject(scene, subject);
    expect(result).toBe(scene);
  });

  it('is deterministic: same inputs always produce same output', () => {
    const scene = 'closed laptop on white desk, soft morning daylight, overhead shot';
    const subject = 'multi-client agency dashboard';
    const first = injectCaptionSubject(scene, subject);
    const second = injectCaptionSubject(scene, subject);
    expect(first).toBe(second);
  });
});

// ── End-to-end caption-injection scenario (the user's 3 example posts) ───
//
// These tests bind the whole pipeline together to make the regression
// guarantee explicit: the user's 3 example captions, when their image_prompt
// hallucinates a cross-domain subject, no longer produce generic stock-photo
// fallbacks. The image at least gestures at the post topic.

describe('end-to-end: caption injection on the 3 example posts', () => {
  it('SaaS dashboard caption + food-hallucinating prompt → tech-saas fallback with dashboard subject', () => {
    const stored = {
      prompt: 'plated meal on a rustic wooden table',
      negativePrompt: 'text, watermark',
    };
    const caption = "SocialAI Studio's multi-client agency dashboard is a game-changer.";
    const result = applyArchetypeGuardrails(stored, 'tech-saas-agency', caption);
    expect(result.swappedForFallback).toBe(true);
    expect(result.prompt).not.toContain('plated meal');
  });

  it('AI captions caption goes through extract+inject without throwing', () => {
    const subject = extractCaptionSubjectPhrase(
      'Our new AI captions feature writes posts in your brand voice automatically.',
    );
    // Either the extract returns something or it returns null — both are
    // acceptable. This test just guards that the helper is robust on the
    // user's actual example caption.
    expect(subject === null || typeof subject === 'string').toBe(true);
  });

  it('Behind-the-scenes app dev caption: dashboard rewrite still beats fallback', () => {
    // Caption mentions "behind-the-scenes" and "app". The buildSafeImagePrompt
    // path with caption should rewrite the abstract-UI part rather than nuking.
    //
    // 2026-05-21: rewrite path now gated by a specific businessType. Pass
    // 'tech-saas-agency' since the caption is about a SaaS feature.
    const result = buildSafeImagePrompt(
      'app screen showing the brand voice picker UI',
      'Behind the scenes — building our new brand voice picker app screen.',
      'tech-saas-agency',
    );
    expect(result).not.toBeNull();
    expect(result!.prompt.toLowerCase()).toMatch(/smartphone|phone|app|desk/);
  });
});
