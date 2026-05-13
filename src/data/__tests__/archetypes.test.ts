/**
 * Unit tests for the Business Archetype library.
 *
 * Run with: `npm test` (or `npm run test:watch` for HMR).
 *
 * These cover the pure-function part of the classifier (the synchronous
 * keyword match) — the LLM-fallback layer (Haiku 4.5 zero-shot) lives in
 * the worker and is exercised by the smoke test against a real OpenRouter
 * key when needed.
 */
import { describe, it, expect } from 'vitest';
import { ARCHETYPES, matchArchetypeByKeyword, getArchetypeBySlug, DEFAULT_ARCHETYPE_SLUG } from '../archetypes';

describe('ARCHETYPES library', () => {
  it('contains exactly 13 archetypes', () => {
    expect(ARCHETYPES.length).toBe(13);
  });

  it('every archetype has a unique slug', () => {
    const slugs = ARCHETYPES.map(a => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every archetype has all required fields populated', () => {
    for (const a of ARCHETYPES) {
      expect(a.slug).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(a.description.length).toBeGreaterThanOrEqual(50);
      expect(a.keywords.length).toBeGreaterThanOrEqual(3);
      expect(a.imageExamples.length).toBeGreaterThanOrEqual(5);
      expect(a.imageAvoidNotes).toBeTruthy();
      expect(a.voiceCues).toBeTruthy();
      expect(a.contentPillars.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('DEFAULT_ARCHETYPE_SLUG resolves to a real archetype', () => {
    expect(getArchetypeBySlug(DEFAULT_ARCHETYPE_SLUG)).toBeDefined();
  });

  it('image-avoid notes never recommend including people (no-people policy)', () => {
    for (const a of ARCHETYPES) {
      expect(a.imageAvoidNotes!.toLowerCase()).toContain('never');
    }
  });
});

describe('matchArchetypeByKeyword', () => {
  it('classifies a bakery into food-restaurant', () => {
    expect(matchArchetypeByKeyword('Family-owned bakery in Bondi')!.slug).toBe('food-restaurant');
  });

  it('classifies a SaaS / agency business correctly (the regression we fixed)', () => {
    // This is the failure case the user screenshotted today: "SocialAI Studio"
    // / "Marketing Agency" used to fall through to food defaults. Now hits
    // tech-saas-agency reliably.
    expect(matchArchetypeByKeyword('Marketing Agency for SMBs')!.slug).toBe('tech-saas-agency');
    expect(matchArchetypeByKeyword('Social Media Studio Pty Ltd')!.slug).toBe('tech-saas-agency');
    expect(matchArchetypeByKeyword('Web design and SaaS consultancy')!.slug).toBe('tech-saas-agency');
  });

  it('classifies a BBQ pitmaster into bbq-smokehouse, NOT food-restaurant', () => {
    // Specialist sub-types should beat the general parent on keyword match
    const result = matchArchetypeByKeyword('Competition BBQ pitmaster — brisket and ribs');
    expect(result?.slug).toBe('bbq-smokehouse');
  });

  it('classifies a butcher correctly even when the description mentions food', () => {
    const result = matchArchetypeByKeyword('Local butcher specialising in dry-age beef and charcuterie');
    expect(result?.slug).toBe('butcher-meat');
  });

  it('classifies a wellness business correctly', () => {
    expect(matchArchetypeByKeyword('Yoga studio and meditation classes')!.slug).toBe('health-wellness');
  });

  it('classifies a meditation/breathwork practitioner into specialist archetype', () => {
    const result = matchArchetypeByKeyword('Breathwork facilitator and sound healing practitioner');
    expect(result?.slug).toBe('wellness-mindfulness');
  });

  it('classifies a mechanic workshop correctly', () => {
    expect(matchArchetypeByKeyword('Family-run mechanic workshop')!.slug).toBe('automotive-mechanic');
  });

  it('classifies a surf shop correctly', () => {
    expect(matchArchetypeByKeyword('Surf shop on the Gold Coast')!.slug).toBe('outdoor-sports');
  });

  it('classifies a jeweller into creative-arts', () => {
    expect(matchArchetypeByKeyword('Handmade jewellery and ceramics maker')!.slug).toBe('creative-arts');
  });

  it('classifies a festival into events-festivals', () => {
    expect(matchArchetypeByKeyword('Annual food and music festival')!.slug).toBe('events-festivals');
  });

  it('classifies an accountant into professional-services, NOT tech-saas-agency', () => {
    // Edge case: accountants and lawyers can sound similar to "consultancy"
    // but they're regulated professional services, not SaaS.
    const result = matchArchetypeByKeyword('Accounting firm specialising in small-business tax');
    expect(result?.slug).toBe('professional-services');
  });

  it('returns null for genuinely ambiguous input (caller falls through to LLM)', () => {
    // "Small business" alone is the canonical too-vague case. Should NOT
    // match anything — the worker falls through to Haiku for these.
    expect(matchArchetypeByKeyword('My small business')).toBeNull();
    expect(matchArchetypeByKeyword('Local company')).toBeNull();
  });

  it('returns null for empty / nonsense input', () => {
    expect(matchArchetypeByKeyword('')).toBeNull();
    expect(matchArchetypeByKeyword('   ')).toBeNull();
    expect(matchArchetypeByKeyword('xxxxxx')).toBeNull();
  });
});

describe('getArchetypeBySlug', () => {
  it('returns the archetype for every known slug', () => {
    for (const a of ARCHETYPES) {
      const found = getArchetypeBySlug(a.slug);
      expect(found?.slug).toBe(a.slug);
    }
  });

  it('returns undefined for unknown slugs', () => {
    expect(getArchetypeBySlug('does-not-exist')).toBeUndefined();
    expect(getArchetypeBySlug('')).toBeUndefined();
  });
});
