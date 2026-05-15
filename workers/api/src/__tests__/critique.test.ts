import { describe, it, expect } from 'vitest';
import { buildCritiqueSystemPrompt } from '../lib/critique';

// buildCritiqueSystemPrompt is pure — no env, no fetch — so we test it
// directly and exhaustively. critiqueImageInternal is network-bound and
// covered by manual QA / integration tests.

describe('buildCritiqueSystemPrompt', () => {
  it('includes archetype context line when slug is provided', () => {
    const prompt = buildCritiqueSystemPrompt('bbq-smokehouse');
    expect(prompt).toContain('Business archetype context: bbq-smokehouse');
  });

  it('instructs model to infer business type from caption when slug is null', () => {
    const prompt = buildCritiqueSystemPrompt(null);
    expect(prompt).toContain('UNCLASSIFIED');
    expect(prompt).toContain('Infer the actual business type from the caption');
  });

  it('null prompt explicitly calls out SaaS vs food cross-domain example', () => {
    const prompt = buildCritiqueSystemPrompt(null);
    // The unclassified path must name tech/SaaS so the model knows the context
    expect(prompt).toContain('AI Content Autopilot');
    expect(prompt).not.toContain('Business archetype context:');
  });

  it('does NOT inject INTRA-DOMAIN HARD RULE when forbiddenSubjects is empty', () => {
    const prompt = buildCritiqueSystemPrompt('bbq-smokehouse', []);
    expect(prompt).not.toContain('INTRA-DOMAIN HARD RULE');
    expect(prompt).not.toContain('Forbidden subjects:');
  });

  it('injects INTRA-DOMAIN HARD RULE when forbiddenSubjects is non-empty', () => {
    const prompt = buildCritiqueSystemPrompt('bbq-smokehouse', ['pork', 'chicken']);
    expect(prompt).toContain('INTRA-DOMAIN HARD RULE');
    expect(prompt).toContain('pork, chicken');
  });

  it('denylist rule says score 1-2 for any visible forbidden subject', () => {
    const prompt = buildCritiqueSystemPrompt('bbq-smokehouse', ['pork']);
    expect(prompt).toContain('score 1-2');
    expect(prompt).toContain('match="no"');
  });

  it('always includes the 0-10 scoring rubric', () => {
    const prompt = buildCritiqueSystemPrompt('food-restaurant');
    expect(prompt).toContain('10 = perfect match');
    expect(prompt).toContain('0 = catastrophic mismatch');
  });

  it('always includes the CROSS-DOMAIN HARD RULE', () => {
    const prompt = buildCritiqueSystemPrompt('tech-saas-agency');
    expect(prompt).toContain('CROSS-DOMAIN BLEED');
    expect(prompt).toContain('Score 1-2');
  });

  it('always includes the TOPIC-MISMATCH RULE', () => {
    const prompt = buildCritiqueSystemPrompt(null);
    expect(prompt).toContain('TOPIC-MISMATCH RULE');
    expect(prompt).toContain('score 3-4');
  });

  it('always requires JSON-only response with score, match, reasoning', () => {
    const prompt = buildCritiqueSystemPrompt('food-restaurant');
    expect(prompt).toContain('Return JSON ONLY');
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"match"');
    expect(prompt).toContain('"reasoning"');
  });

  it('denylist rule fires regardless of caption match ("full stop" clause)', () => {
    const prompt = buildCritiqueSystemPrompt('bbq-smokehouse', ['pork']);
    // The rule should apply whether or not the caption appears to match
    expect(prompt).toContain('REGARDLESS of whether the caption');
  });
});
