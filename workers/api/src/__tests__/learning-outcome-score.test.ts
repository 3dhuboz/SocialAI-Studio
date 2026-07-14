import { describe, expect, it } from 'vitest';
import { normaliseSignal, scoreOutcome } from '../lib/learning/outcome-score';

describe('learning outcome score', () => {
  it('uses 40/25/15/15/5 when all categories exist', () => {
    expect(scoreOutcome({ conversion: 100, lead: 80, tracked_action: 60, meaningful_engagement: 40, reach: 20 }))
      .toEqual({ score: 76, completeness: 'conversion' });
  });

  it('renormalizes available categories instead of treating missing as zero', () => {
    expect(scoreOutcome({ conversion: 100, reach: 0 }).score).toBe(88.89);
  });

  it('returns no score when every source is unavailable', () => {
    expect(scoreOutcome({})).toEqual({ score: null, completeness: 'none' });
  });

  it('marks engagement-only evidence lower completeness than conversions', () => {
    expect(scoreOutcome({ meaningful_engagement: 70 }).completeness).toBe('engagement');
    expect(scoreOutcome({ conversion: 70 }).completeness).toBe('conversion');
  });

  it('does not claim conversion completeness for a non-finite conversion value', () => {
    expect(scoreOutcome({ conversion: Number.NaN, reach: 70 }))
      .toEqual({ score: 70, completeness: 'engagement' });
  });

  it('returns neutral low-confidence normalisation with fewer than five historical values', () => {
    expect(normaliseSignal(80, [10, 20, 30, 40])).toEqual({ score: 50, confidence: 0.2, sampleSize: 4 });
  });

  it('uses within-workspace percentile rank once history is sufficient', () => {
    expect(normaliseSignal(35, [10, 20, 30, 40, 50])).toEqual({ score: 60, confidence: 0.25, sampleSize: 5 });
  });
});
