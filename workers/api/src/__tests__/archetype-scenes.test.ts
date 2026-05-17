/**
 * Drift-bug regression tests for the shared archetype-scenes module.
 *
 * After the 2026-05 lift, three structures (SAFE_FALLBACK_SCENES,
 * ARCHETYPE_IMAGE_GUARDRAILS, CAPTION_ARCHETYPE_KEYWORDS) live in
 * shared/archetype-scenes.ts and are re-exported by both the worker
 * (workers/api/src/lib/image-safety.ts) and the frontend (src/services/
 * gemini.ts).
 *
 * These tests check the WORKER side. The frontend has a matching test
 * in src/data/__tests__/archetypes.test.ts that imports the same module.
 * If both compile-and-pass, the drift bug class is closed: every consumer
 * resolves to the same exported object identity.
 */
import { describe, it, expect } from 'vitest';
import {
  SAFE_FALLBACK_SCENES as SAFE_FALLBACK_SCENES_WORKER,
  ARCHETYPE_IMAGE_GUARDRAILS as ARCHETYPE_IMAGE_GUARDRAILS_WORKER,
} from '../lib/image-safety';
import {
  SAFE_FALLBACK_SCENES,
  ARCHETYPE_IMAGE_GUARDRAILS,
  CAPTION_ARCHETYPE_KEYWORDS,
} from '../../../../shared/archetype-scenes';

describe('shared/archetype-scenes — worker re-exports match shared module', () => {
  it('worker SAFE_FALLBACK_SCENES is the same object as the shared one', () => {
    // Same reference identity → no possibility of drift via a copy that
    // got tweaked on one side.
    expect(SAFE_FALLBACK_SCENES_WORKER).toBe(SAFE_FALLBACK_SCENES);
  });

  it('worker ARCHETYPE_IMAGE_GUARDRAILS is the same object as the shared one', () => {
    expect(ARCHETYPE_IMAGE_GUARDRAILS_WORKER).toBe(ARCHETYPE_IMAGE_GUARDRAILS);
  });
});

describe('SAFE_FALLBACK_SCENES content guards', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(SAFE_FALLBACK_SCENES)).toBe(true);
    expect(SAFE_FALLBACK_SCENES.length).toBeGreaterThan(0);
    for (const s of SAFE_FALLBACK_SCENES) expect(typeof s).toBe('string');
  });

  it('most scenes mention a lighting/time cue (anti-dark contract)', () => {
    // The whole point of the fallback bank is to ship BRIGHT, photographable
    // scenes. The FLUX_STYLE_SUFFIX appended downstream injects "BRIGHT
    // natural daylight" so even non-cued scenes ship bright — but we want
    // the bank itself to bias toward lighting cues so the prompt isn't
    // entirely reliant on the suffix.
    const lightingCue = /(daylight|morning|afternoon|sunrise|sunset|golden|warm|sunlit|natural light|aesthetic)/i;
    const withCue = SAFE_FALLBACK_SCENES.filter((s) => lightingCue.test(s));
    expect(withCue.length).toBeGreaterThanOrEqual(SAFE_FALLBACK_SCENES.length - 1);
  });

  it('no scene contains banned subject words (person, customer, chef, owner)', () => {
    // Hand-faced literals like "face-down" / "hand-thrown" are NOT subject
    // matter — they're describing the SCENE composition (smartphone face-down,
    // pottery hand-thrown). The /word boundary/ test we ran in the first
    // draft over-matched these. Test only the literal subject words.
    for (const s of SAFE_FALLBACK_SCENES) {
      expect(s.toLowerCase()).not.toMatch(/\b(person|people|customer|chef|owner|barista|staff|employee)\b/);
    }
  });
});

describe('ARCHETYPE_IMAGE_GUARDRAILS content guards', () => {
  it('covers the 12 published archetypes', () => {
    // If a new archetype is added to ARCHETYPES (src/data/archetypes.ts) but
    // not given a guardrail entry here, generations for that archetype skip
    // the cross-domain bleed defence. This test catches the gap before it
    // ships. Keep in lockstep with the 12-archetype taxonomy in PR #85.
    const expected = [
      'tech-saas-agency',
      'professional-services',
      'food-restaurant',
      'bbq-smokehouse',
      'butcher-meat',
      'agriculture-farming',
      'retail-ecommerce',
      'health-wellness',
      'wellness-mindfulness',
      'automotive-mechanic',
      'outdoor-sports',
      'creative-arts',
      'events-festivals',
    ];
    for (const slug of expected) {
      expect(ARCHETYPE_IMAGE_GUARDRAILS[slug]).toBeDefined();
    }
  });

  it('every entry has forbidden / extraNegatives / fallbackScenes', () => {
    for (const [slug, g] of Object.entries(ARCHETYPE_IMAGE_GUARDRAILS)) {
      expect(g.forbidden, `${slug}.forbidden`).toBeInstanceOf(RegExp);
      expect(typeof g.extraNegatives, `${slug}.extraNegatives`).toBe('string');
      expect(g.extraNegatives.length, `${slug}.extraNegatives non-empty`).toBeGreaterThan(0);
      expect(Array.isArray(g.fallbackScenes), `${slug}.fallbackScenes`).toBe(true);
      expect(g.fallbackScenes.length, `${slug}.fallbackScenes non-empty`).toBeGreaterThan(0);
    }
  });
});

describe('CAPTION_ARCHETYPE_KEYWORDS content guards', () => {
  it('covers the 12 published archetypes', () => {
    const expected = [
      'tech-saas-agency',
      'food-restaurant',
      'bbq-smokehouse',
      'butcher-meat',
      'agriculture-farming',
      'health-wellness',
      'wellness-mindfulness',
      'automotive-mechanic',
      'retail-ecommerce',
      'professional-services',
      'creative-arts',
      'outdoor-sports',
      'events-festivals',
    ];
    for (const slug of expected) {
      expect(CAPTION_ARCHETYPE_KEYWORDS[slug]).toBeDefined();
      expect(CAPTION_ARCHETYPE_KEYWORDS[slug].length).toBeGreaterThan(0);
    }
  });

  it('bbq-smokehouse includes brisket/smoker/low-and-slow tokens', () => {
    // Specific to the brisket-incident workspace (Seamus). If these tokens
    // drop out, the caption-side sniffer can't classify the workspace and
    // the guardrail defence no-ops for un-classified BBQ owners.
    expect(CAPTION_ARCHETYPE_KEYWORDS['bbq-smokehouse']).toContain('brisket');
    expect(CAPTION_ARCHETYPE_KEYWORDS['bbq-smokehouse']).toContain('smoker');
    expect(CAPTION_ARCHETYPE_KEYWORDS['bbq-smokehouse']).toContain('low and slow');
  });
});
