export type ExperimentValue = string | number | boolean | null;
export type ExperimentTreatment = Record<string, ExperimentValue>;

export interface ExperimentCandidate {
  control: ExperimentTreatment;
  test: ExperimentTreatment;
  sampleCount: number;
  predictedEffect: number;
}

export interface SelectedExperiment extends ExperimentCandidate {
  mode: 'explore' | 'exploit';
  variableKey: string;
}

export const BANNED_EXPERIMENT_VARIABLES = [
  'price',
  'factual_claims',
  'denylist',
  'geography_exclusions',
  'critic_thresholds',
  'release_policy',
] as const;

export const ALLOWED_EXPERIMENT_VARIABLES = [
  'posting_hour',
  'hour',
  'posting_window',
  'weekday',
  'caption_opening',
  'caption_length',
  'cta_style',
  'hashtag_set',
  'media_format',
  'format',
  'media_style',
  'audience_segment',
  'offer_framing',
] as const;

const MAX_EXPLORATION_RATE = 0.20;

function hashUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

export function shouldExplore(
  postId: string,
  strategyVersion: number,
  configuredRate: number,
): boolean {
  if (
    !postId.trim()
    || !Number.isSafeInteger(strategyVersion)
    || strategyVersion <= 0
    || !Number.isFinite(configuredRate)
  ) {
    return false;
  }

  const rate = Math.max(0, Math.min(MAX_EXPLORATION_RATE, configuredRate));
  return hashUnit(`${postId}:${strategyVersion}`) < rate;
}

function normaliseVariableKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isExperimentVariableAllowed(variableKey: string): boolean {
  const normalized = normaliseVariableKey(variableKey);
  return (ALLOWED_EXPERIMENT_VARIABLES as readonly string[]).includes(normalized);
}

function assertValidTreatment(treatment: ExperimentTreatment): void {
  for (const [key, value] of Object.entries(treatment)) {
    if (!key.trim()) throw new Error('Experiment variable keys must not be empty');
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Experiment variable ${key} must use a finite number`);
    }
    if (
      value !== null
      && typeof value !== 'string'
      && typeof value !== 'number'
      && typeof value !== 'boolean'
    ) {
      throw new Error(`Experiment variable ${key} must use a primitive value`);
    }
  }
}

export function assertSingleExperimentChange(
  control: ExperimentTreatment,
  test: ExperimentTreatment,
): string {
  assertValidTreatment(control);
  assertValidTreatment(test);

  const keys = new Set([...Object.keys(control), ...Object.keys(test)]);
  const changed = [...keys].filter((key) => control[key] !== test[key]);
  if (changed.length !== 1) {
    throw new Error(`Experiment must change exactly one variable; received ${changed.length}`);
  }

  const changedVariable = changed[0];
  if (!isExperimentVariableAllowed(changedVariable)) {
    throw new Error(`Experiment variable ${changedVariable} is not eligible for testing`);
  }
  return changedVariable;
}

export function selectExperimentCandidate(
  postId: string,
  strategyVersion: number,
  configuredRate: number,
  candidates: readonly ExperimentCandidate[],
): SelectedExperiment | null {
  if (!postId.trim()
    || !Number.isSafeInteger(strategyVersion)
    || strategyVersion <= 0
    || !Number.isFinite(configuredRate)) {
    return null;
  }
  const eligible = candidates.flatMap((candidate) => {
    if (!Number.isSafeInteger(candidate.sampleCount)
      || candidate.sampleCount < 0
      || !Number.isFinite(candidate.predictedEffect)) {
      return [];
    }
    try {
      return [{ ...candidate, variableKey: assertSingleExperimentChange(
        candidate.control,
        candidate.test,
      ) }];
    } catch {
      return [];
    }
  });
  if (!eligible.length) return null;

  const mode = shouldExplore(postId, strategyVersion, configuredRate)
    ? 'explore' as const
    : 'exploit' as const;
  const ranked = [...eligible].sort((left, right) => {
    if (mode === 'explore') {
      return left.sampleCount - right.sampleCount
        || left.variableKey.localeCompare(right.variableKey);
    }
    return right.predictedEffect - left.predictedEffect
      || right.sampleCount - left.sampleCount
      || left.variableKey.localeCompare(right.variableKey);
  });
  return { ...ranked[0], mode };
}
