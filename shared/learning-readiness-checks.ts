export const REQUIRED_LEARNING_READINESS_CHECK_KEYS = [
  'pilot',
  'pilotCohort',
  'adjudications',
  'severeFalsePasses',
  'falseHolds',
  'availability',
  'releaseJudgeAvailability',
  'releaseJudgeTelemetry',
  'receipts',
  'predictionCoverage',
  'predictionLift',
  'rankCorrelation',
  'criticalBypasses',
  'publishingRegressions',
  'cost',
  'killSwitch',
  'replayRedTeam',
  'publishRegression',
] as const;

export const REQUIRED_LEARNING_READINESS_OWNER_KINDS = [
  'user',
  'client',
  'shop',
] as const;

type ReadinessCheckKey = typeof REQUIRED_LEARNING_READINESS_CHECK_KEYS[number];
type ReadinessOwnerKind = typeof REQUIRED_LEARNING_READINESS_OWNER_KINDS[number];

export type CompleteGreenLearningReadinessChecks = Record<ReadinessCheckKey, true> & {
  tenancyProofs: Record<ReadinessOwnerKind, true>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function hasCompleteGreenLearningReadinessChecks(
  value: unknown,
): value is CompleteGreenLearningReadinessChecks {
  if (!isRecord(value)) return false;

  const expectedKeys = new Set<string>([
    ...REQUIRED_LEARNING_READINESS_CHECK_KEYS,
    'tenancyProofs',
  ]);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.size
    || actualKeys.some((key) => !expectedKeys.has(key))
  ) return false;

  if (REQUIRED_LEARNING_READINESS_CHECK_KEYS.some((key) => value[key] !== true)) {
    return false;
  }

  const tenancyProofs = value.tenancyProofs;
  if (!isRecord(tenancyProofs)) return false;
  const ownerKinds = Object.keys(tenancyProofs);
  return ownerKinds.length === REQUIRED_LEARNING_READINESS_OWNER_KINDS.length
    && ownerKinds.every((ownerKind) => (
      REQUIRED_LEARNING_READINESS_OWNER_KINDS.includes(ownerKind as ReadinessOwnerKind)
    ))
    && REQUIRED_LEARNING_READINESS_OWNER_KINDS.every(
      (ownerKind) => tenancyProofs[ownerKind] === true,
    );
}
