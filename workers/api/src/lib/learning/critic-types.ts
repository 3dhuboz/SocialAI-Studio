import type { CriticSeverity, CriticVerdict } from './types';

export type CriticKind =
  | 'brand'
  | 'fact'
  | 'repetition'
  | 'platform'
  | 'business_harm'
  | 'image'
  | 'video_manifest';

export const BASE_REQUIRED_CRITICS: CriticKind[] = [
  'brand',
  'fact',
  'repetition',
  'platform',
  'business_harm',
];

export const DETERMINISTIC_REQUIRED_CRITICS: CriticKind[] = [
  'brand',
  'fact',
  'repetition',
  'platform',
];

export interface CriticResult {
  kind: CriticKind;
  verdict: CriticVerdict;
  severity: CriticSeverity;
  confidence: number;
  evidence: string[];
  repairs: string[];
  provider: string;
  model: string;
}

export type CouncilState = 'repair' | 'pass_green' | 'hold_amber' | 'block_red';

export function reduceCriticResults(
  results: CriticResult[],
  requiredKinds: CriticKind[] = BASE_REQUIRED_CRITICS,
): { state: CouncilState; repairs: string[] } {
  if (requiredKinds.some((kind) => !results.some((result) => result.kind === kind))) {
    return { state: 'hold_amber', repairs: [] };
  }

  if (results.some((result) => result.verdict === 'block')) {
    return { state: 'block_red', repairs: [] };
  }

  if (
    results.some(
      (result) =>
        result.severity === 'release_critical' && result.verdict === 'unavailable',
    )
  ) {
    return { state: 'hold_amber', repairs: [] };
  }

  const repairs = results
    .filter((result) => result.verdict === 'warn_repairable')
    .flatMap((result) => result.repairs);

  return repairs.length > 0
    ? { state: 'repair', repairs }
    : { state: 'pass_green', repairs: [] };
}
