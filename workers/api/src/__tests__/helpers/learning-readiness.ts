import { REQUIRED_LEARNING_READINESS_CHECK_KEYS } from '../../../../../shared/learning-readiness-checks';

export function learningReadinessChecks(
  tenancyProofs: Partial<Record<'user' | 'client' | 'shop', boolean>> = {},
): Record<string, unknown> {
  return {
    ...Object.fromEntries(REQUIRED_LEARNING_READINESS_CHECK_KEYS.map((key) => [key, true])),
    tenancyProofs: {
      user: true,
      client: true,
      shop: true,
      ...tenancyProofs,
    },
  };
}
