import { describe, expect, it } from 'vitest';
import {
  localWeekdayHour,
  rankPostingWindows,
  type RankedWindow,
  type TimingEvidence,
} from '../lib/reach/timing-model';
import {
  isInsideRankedWindow,
  loadReachTimingEvidence,
  nextRankedWindowSlot,
  rankWorkspaceTiming,
} from '../lib/reach/timing-evidence';
import { makeRecordingD1 } from './helpers/recording-d1';

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

  it('loads only the exact client workspace and skips malformed fact rows', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM client_facts': [
        {
          metadata: JSON.stringify({
            created_time: '2026-07-17T08:15:00.000Z',
            platform: 'facebook',
            post_type: 'image',
          }),
          engagement_score: 88,
        },
        { metadata: '{bad json', engagement_score: 99 },
        { metadata: JSON.stringify({ created_time: 'not-a-date' }), engagement_score: 50 },
      ],
    });

    const evidence = await loadReachTimingEvidence(db, {
      userId: 'agency_1',
      clientId: 'client_1',
      ownerKind: 'client',
      ownerId: 'client_1',
    }, 'Australia/Brisbane');

    expect(evidence).toEqual([{
      weekday: 5,
      hour: 18,
      platform: 'facebook',
      mediaType: 'image',
      score: 88,
    }]);
    const query = calls.find((call) => call.sql.includes('FROM client_facts'));
    expect(query?.binds).toEqual(['agency_1', 'client_1']);
    expect(query?.sql).toMatch(/LIMIT\s+100/i);
  });

  it('uses canonical Shopify facts without querying Clerk tenant facts', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM shopify_facts': [{
        metadata: JSON.stringify({
          created_time: '2026-07-19T08:00:00.000Z',
          platform: 'instagram',
          media_type: 'reel',
        }),
        engagement_score: 120,
      }],
    });

    const evidence = await loadReachTimingEvidence(db, {
      userId: 'store.myshopify.com',
      clientId: null,
      ownerKind: 'shop',
      ownerId: 'Store.MyShopify.com',
    }, 'Australia/Brisbane');

    expect(evidence).toEqual([{
      weekday: 0,
      hour: 18,
      platform: 'instagram',
      mediaType: 'video',
      score: 100,
    }]);
    expect(calls.find((call) => call.sql.includes('FROM shopify_facts'))?.binds)
      .toEqual(['store.myshopify.com']);
    expect(calls.some((call) => call.sql.includes('FROM client_facts'))).toBe(false);
  });

  it('previews and advances into account-ranked local slots', () => {
    const evidence: TimingEvidence[] = Array.from({ length: 5 }, (_, index) => ({
      weekday: 5,
      hour: 18,
      platform: 'facebook' as const,
      mediaType: 'image',
      score: 80 + index,
    }));
    const ranked = rankWorkspaceTiming(evidence);

    expect(isInsideRankedWindow(
      '2026-07-17T08:30:00.000Z',
      'Australia/Brisbane',
      ranked,
      'facebook',
      'image',
    )).toBe(true);
    expect(nextRankedWindowSlot(
      '2026-07-16T08:00:00.000Z',
      'Australia/Brisbane',
      ranked,
      'facebook',
      'image',
    )).toBe('2026-07-17T08:00:00.000Z');
  });

  it('treats canonical naive schedule values as AEST and preserves that format', () => {
    const ranked = rankWorkspaceTiming(Array.from({ length: 5 }, (_, index) => ({
      weekday: 5,
      hour: 18,
      platform: 'facebook' as const,
      mediaType: 'image',
      score: 80 + index,
    })));

    expect(isInsideRankedWindow(
      '2026-07-17T18:30:00',
      'Australia/Brisbane',
      ranked,
      'facebook',
      'image',
    )).toBe(true);
    expect(nextRankedWindowSlot(
      '2026-07-16T18:00:00',
      'Australia/Brisbane',
      ranked,
      'facebook',
      'image',
    )).toBe('2026-07-17T18:00:00');
  });
});
