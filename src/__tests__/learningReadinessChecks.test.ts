import { describe, expect, it } from 'vitest';
import {
  REQUIRED_LEARNING_READINESS_CHECK_KEYS,
  hasCompleteGreenLearningReadinessChecks,
} from '../../shared/learning-readiness-checks';

function greenChecks(): Record<string, unknown> {
  return {
    ...Object.fromEntries(REQUIRED_LEARNING_READINESS_CHECK_KEYS.map((key) => [key, true])),
    tenancyProofs: { user: true, client: true, shop: true },
  };
}

describe('complete green learning readiness checks', () => {
  it('accepts only the complete current readiness schema', () => {
    expect(hasCompleteGreenLearningReadinessChecks(greenChecks())).toBe(true);
  });

  it.each([
    ['a missing required check', () => {
      const checks = greenChecks();
      delete checks.cost;
      return checks;
    }],
    ['a false required check', () => ({ ...greenChecks(), cost: false })],
    ['a missing tenancy proof', () => ({
      ...greenChecks(), tenancyProofs: { user: true, client: true },
    })],
    ['a false tenancy proof', () => ({
      ...greenChecks(), tenancyProofs: { user: true, client: true, shop: false },
    })],
    ['an unknown schema field', () => ({ ...greenChecks(), legacyReady: true })],
    ['a non-object payload', () => [true]],
  ])('rejects %s', (_label, value) => {
    expect(hasCompleteGreenLearningReadinessChecks(value())).toBe(false);
  });
});
