export type LearningSignalStatus =
  | 'tentative'
  | 'usable'
  | 'proven'
  | 'rejected'
  | 'operator_locked';

export interface LearningSignal {
  variableKey: string;
  variableValue: string;
  objective: string;
  sampleCount: number;
  effect: number;
  confidence: number;
  freshnessAt: string;
  status: LearningSignalStatus;
}

export interface SignalEvidence {
  effect: number;
  sampleCount: number;
}

const DAYS_PER_HALF_LIFE = 90;
const MAX_WEEKLY_EFFECT_CHANGE = 0.10;
const MILLISECONDS_PER_DAY = 86_400_000;

function isSampleCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasValidNumbers(signal: LearningSignal, evidence: SignalEvidence): boolean {
  return Number.isFinite(signal.effect)
    && Number.isFinite(signal.confidence)
    && signal.confidence >= 0
    && signal.confidence <= 1
    && isSampleCount(signal.sampleCount)
    && Number.isFinite(evidence.effect)
    && isSampleCount(evidence.sampleCount);
}

export function decayEffect(effect: number, ageDays: number): number {
  if (!Number.isFinite(effect) || !Number.isFinite(ageDays)) return 0;
  return effect * Math.pow(0.5, Math.max(0, ageDays) / DAYS_PER_HALF_LIFE);
}

export function nextSignal(
  current: LearningSignal,
  evidence: SignalEvidence,
  now: Date,
): LearningSignal {
  if (current.status === 'operator_locked') return current;

  const nowMs = now.getTime();
  const freshnessMs = Date.parse(current.freshnessAt);
  const sampleCount = current.sampleCount + evidence.sampleCount;
  if (
    !hasValidNumbers(current, evidence)
    || !Number.isFinite(nowMs)
    || !Number.isFinite(freshnessMs)
    || !Number.isSafeInteger(sampleCount)
  ) {
    return current;
  }

  const ageDays = Math.max(0, nowMs - freshnessMs) / MILLISECONDS_PER_DAY;
  const decayedEffect = decayEffect(current.effect, ageDays);
  const difference = evidence.effect - decayedEffect;
  if (!Number.isFinite(difference)) return current;

  const effectChange = Math.max(
    -MAX_WEEKLY_EFFECT_CHANGE,
    Math.min(MAX_WEEKLY_EFFECT_CHANGE, difference),
  );
  const status = sampleCount >= 10 ? 'proven'
    : sampleCount >= 5 ? 'usable'
      : 'tentative';

  return {
    ...current,
    sampleCount,
    effect: decayedEffect + effectChange,
    confidence: Math.min(1, sampleCount / 10),
    freshnessAt: now.toISOString(),
    status,
  };
}
