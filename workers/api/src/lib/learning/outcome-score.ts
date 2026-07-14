export type OutcomeCategory =
  | 'conversion'
  | 'lead'
  | 'tracked_action'
  | 'meaningful_engagement'
  | 'reach';

const WEIGHTS: Record<OutcomeCategory, number> = {
  conversion: 0.40,
  lead: 0.25,
  tracked_action: 0.15,
  meaningful_engagement: 0.15,
  reach: 0.05,
};

export function scoreOutcome(values: Partial<Record<OutcomeCategory, number>>) {
  const available = Object.entries(values).filter((entry): entry is [OutcomeCategory, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1]));
  if (!available.length) return { score: null, completeness: 'none' as const };

  const denominator = available.reduce((sum, [key]) => sum + WEIGHTS[key], 0);
  const score = available.reduce(
    (sum, [key, value]) => sum + Math.max(0, Math.min(100, value)) * WEIGHTS[key],
    0,
  ) / denominator;
  const availableCategories = new Set(available.map(([key]) => key));
  const completeness = availableCategories.has('conversion') ? 'conversion'
    : availableCategories.has('lead') || availableCategories.has('tracked_action')
      ? 'action'
      : 'engagement';

  return { score: Math.round(score * 100) / 100, completeness };
}

export function normaliseSignal(raw: number, history: number[]) {
  const clean = history.filter((value) => Number.isFinite(value));
  if (!Number.isFinite(raw) || clean.length < 5) {
    return { score: 50, confidence: Math.min(0.2, clean.length / 20), sampleSize: clean.length };
  }

  const below = clean.filter((value) => value < raw).length;
  const equal = clean.filter((value) => value === raw).length;
  const score = Math.round(((below + equal * 0.5) / clean.length) * 10_000) / 100;
  return { score, confidence: Math.min(1, clean.length / 20), sampleSize: clean.length };
}
