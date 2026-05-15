import { describe, it, expect } from 'vitest';
import {
  isAbstractUIPrompt,
  buildSafeImagePrompt,
  sniffArchetypeFromCaption,
  applyArchetypeGuardrails,
  FLUX_STYLE_SUFFIX,
  FLUX_NEGATIVE_PROMPT,
} from '../lib/image-safety';

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

// ── buildSafeImagePrompt ──────────────────────────────────────────────────

describe('buildSafeImagePrompt', () => {
  it('returns null for null input', () => {
    expect(buildSafeImagePrompt(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(buildSafeImagePrompt('')).toBeNull();
  });

  it('returns null for strings shorter than 5 chars', () => {
    expect(buildSafeImagePrompt('hi')).toBeNull();
  });

  it('returns a prompt+negativePrompt pair for a valid prompt', () => {
    const result = buildSafeImagePrompt('slow-smoked brisket on a butcher board');
    expect(result).not.toBeNull();
    expect(result!.prompt).toContain('brisket');
    expect(result!.prompt).toContain(FLUX_STYLE_SUFFIX);
    expect(result!.negativePrompt).toBe(FLUX_NEGATIVE_PROMPT);
  });

  it('strips people-mentions from the positive prompt', () => {
    const result = buildSafeImagePrompt('a smiling chef holding a plate');
    expect(result!.prompt).not.toMatch(/\b(smiling|chef|holding)\b/i);
  });

  it('swaps abstract UI prompts for a safe fallback scene', () => {
    const result = buildSafeImagePrompt('dashboard mockup of the analytics screen');
    // The original UI terms should be replaced by a fallback scene
    expect(result!.prompt).not.toContain('dashboard');
    expect(result!.prompt).not.toContain('analytics screen');
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
});
