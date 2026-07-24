export const PROTECTED_AUTOPILOT_EXPERIMENT_STEPS = [0, 0.1, 0.15] as const;

export type ProtectedAutopilotExperimentRate =
  typeof PROTECTED_AUTOPILOT_EXPERIMENT_STEPS[number];

export type ProtectedAutopilotExperimentIncrease = Exclude<
  ProtectedAutopilotExperimentRate,
  0
>;

export function nextProtectedAutopilotExperimentRate(
  currentRate: unknown,
): ProtectedAutopilotExperimentIncrease | null {
  if (typeof currentRate !== 'number' || !Number.isFinite(currentRate) || currentRate < 0) {
    return null;
  }
  const current = currentRate;
  if (current < 0.1) return 0.1;
  if (current < 0.15) return 0.15;
  return null;
}

export function isProtectedAutopilotExperimentTransitionAllowed(input: {
  hasCurrentConsent: boolean;
  currentRate: unknown;
  requestedRate: number;
}): boolean {
  if (!PROTECTED_AUTOPILOT_EXPERIMENT_STEPS.some((rate) => rate === input.requestedRate)) {
    return false;
  }
  if (!input.hasCurrentConsent) return input.requestedRate === 0;

  if (
    typeof input.currentRate !== 'number'
    || !Number.isFinite(input.currentRate)
    || input.currentRate < 0
  ) return input.requestedRate === 0;
  const current = input.currentRate;
  if (input.requestedRate <= current) return true;
  return nextProtectedAutopilotExperimentRate(current) === input.requestedRate;
}
