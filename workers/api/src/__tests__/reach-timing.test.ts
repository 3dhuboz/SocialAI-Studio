import { describe, expect, it } from 'vitest';
import {
  localWeekdayHour,
  rankPostingWindows,
  type RankedWindow,
  type TimingEvidence,
} from '../lib/reach/timing-model';

const fallback: RankedWindow[] = [{
  weekday: 5, startHour: 17, endHour: 19,
  platform: 'facebook', mediaType: 'image', expectedScore: 50,
  confidence: 0.25, sampleSize: 0, source: 'archetype',
}];

describe('reach timing model', () => {
  it('converts UTC timestamps into the confirmed workspace timezone', () => {
    expect(localWeekdayHour(
      '2026-07-13T23:30:00.000Z',
      'Australia/Brisbane',
    )).toEqual({ weekday: 2, hour: 9 });
  });

  it('returns archetype windows when account history is sparse', () => {
    expect(rankPostingWindows([], fallback)).toEqual(fallback);
    expect(rankPostingWindows([
      { weekday: 1, hour: 9, platform: 'facebook', mediaType: 'image', score: 70 },
    ], fallback)).toEqual(fallback);
  });

  it('preserves platform and media evidence while grouping duplicate slots', () => {
    const evidence: TimingEvidence[] = [
      { weekday: 5, hour: 18, platform: 'facebook', mediaType: 'image', score: 80 },
      { weekday: 5, hour: 18, platform: 'facebook', mediaType: 'image', score: 70 },
      { weekday: 5, hour: 18, platform: 'instagram', mediaType: 'video', score: 90 },
      { weekday: 5, hour: 18, platform: 'instagram', mediaType: 'video', score: 85 },
      { weekday: 6, hour: 11, platform: 'facebook', mediaType: 'video', score: 60 },
    ];

    const ranked = rankPostingWindows(evidence, fallback);

    expect(ranked).toHaveLength(3);
    expect(ranked.find((window) => window.platform === 'facebook'
      && window.mediaType === 'image')).toMatchObject({ sampleSize: 2 });
    expect(ranked.find((window) => window.platform === 'instagram'
      && window.mediaType === 'video')).toMatchObject({ sampleSize: 2 });
  });

  it('returns ranked windows rather than a hold when confidence is low', () => {
    const evidence: TimingEvidence[] = Array.from({ length: 5 }, (_, index) => ({
      weekday: index,
      hour: 10 + index,
      platform: 'facebook' as const,
      mediaType: 'image',
      score: 60 + index,
    }));

    const ranked = rankPostingWindows(evidence, fallback);

    expect(ranked).toHaveLength(5);
    expect(ranked.every((window) => window.confidence === 0.1)).toBe(true);
  });

  it('rejects invalid evidence and invalid timezone conversion', () => {
    expect(() => rankPostingWindows([{
      weekday: 7, hour: 10, platform: 'facebook', mediaType: 'image', score: 50,
    }], fallback)).toThrow('weekday');
    expect(() => rankPostingWindows([{
      weekday: 1, hour: 24, platform: 'facebook', mediaType: 'image', score: 50,
    }], fallback)).toThrow('hour');
    expect(() => rankPostingWindows([{
      weekday: 1, hour: 10, platform: 'facebook', mediaType: 'image', score: 101,
    }], fallback)).toThrow('score');
    expect(() => localWeekdayHour('2026-07-13T23:30:00.000Z', 'Not/AZone'))
      .toThrow();
  });
});
