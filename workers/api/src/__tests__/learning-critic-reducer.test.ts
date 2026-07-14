import { describe, expect, it } from 'vitest';
import {
  BASE_REQUIRED_CRITICS,
  reduceCriticResults,
  type CriticResult,
} from '../lib/learning/critic-types';

const result = (patch: Partial<CriticResult>): CriticResult => ({
  kind: 'brand',
  verdict: 'pass',
  severity: 'advisory',
  confidence: 0.9,
  evidence: [],
  repairs: [],
  provider: 'test',
  model: 'test',
  ...patch,
});

describe('reduceCriticResults', () => {
  it('requests repair for repairable warnings', () => {
    const results = BASE_REQUIRED_CRITICS.map((kind) => result({ kind }));
    results[0] = result({
      kind: 'brand',
      verdict: 'warn_repairable',
      repairs: ['remove claim'],
    });

    expect(reduceCriticResults(results)).toEqual({
      state: 'repair',
      repairs: ['remove claim'],
    });
  });

  it('blocks release-critical content failures', () => {
    const results = BASE_REQUIRED_CRITICS.map((kind) => result({ kind }));
    results[1] = result({
      kind: 'fact',
      verdict: 'block',
      severity: 'release_critical',
    });

    expect(reduceCriticResults(results).state).toBe('block_red');
  });

  it('holds when a required critic remains unavailable', () => {
    const results = BASE_REQUIRED_CRITICS.map((kind) => result({ kind }));
    results[4] = result({
      kind: 'business_harm',
      verdict: 'unavailable',
      severity: 'release_critical',
    });

    expect(reduceCriticResults(results).state).toBe('hold_amber');
  });

  it('holds when any required critic is missing', () => {
    expect(reduceCriticResults([result({ kind: 'brand' })]).state).toBe('hold_amber');
  });

  it('passes when every required critic passes', () => {
    expect(
      reduceCriticResults(BASE_REQUIRED_CRITICS.map((kind) => result({ kind }))),
    ).toEqual({ state: 'pass_green', repairs: [] });
  });
});
