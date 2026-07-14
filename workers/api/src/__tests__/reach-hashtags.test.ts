import { describe, expect, it } from 'vitest';
import {
  FACEBOOK_HASHTAG_LIMIT,
  INSTAGRAM_HASHTAG_LIMIT,
  buildHashtagPlan,
} from '../lib/reach/hashtag-model';

describe('reach hashtag model', () => {
  it('includes verified location terms and respects platform-specific evidence', () => {
    const plan = buildHashtagPlan({
      locationTerms: ['Gladstone Eats'],
      categoryTerms: ['Low and Slow BBQ'],
      brandTerms: ['Hugheseys Que'],
      candidates: [
        { term: 'Friday Feast', platforms: ['facebook'], score: 90, evidence: 'fb history' },
        { term: 'Brisket Reel', platforms: ['instagram'], score: 85, evidence: 'ig history' },
      ],
    });

    expect(plan.localKeywords).toContain('gladstoneeats');
    expect(plan.facebookTags).toContain('#gladstoneeats');
    expect(plan.instagramTags).toContain('#gladstoneeats');
    expect(plan.facebookTags).toContain('#fridayfeast');
    expect(plan.instagramTags).not.toContain('#fridayfeast');
    expect(plan.instagramTags).toContain('#brisketreel');
  });

  it('normalises and removes duplicate tags', () => {
    const plan = buildHashtagPlan({
      locationTerms: ['Gladstone Eats'], categoryTerms: [], brandTerms: [],
      candidates: [
        { term: '#Gladstone Eats', platforms: ['facebook', 'instagram'], score: 90 },
        { term: 'gladstone_eats', platforms: ['facebook', 'instagram'], score: 80 },
      ],
    });
    expect(plan.facebookTags.filter((tag) => tag === '#gladstoneeats')).toHaveLength(1);
    expect(plan.instagramTags.filter((tag) => tag === '#gladstoneeats')).toHaveLength(1);
  });

  it('removes forbidden and spam terms from every platform', () => {
    const plan = buildHashtagPlan({
      locationTerms: ['Gladstone'], categoryTerms: ['BBQ'], brandTerms: [],
      forbiddenTerms: ['competitor name'],
      candidates: [
        { term: 'follow4follow', platforms: ['facebook', 'instagram'], score: 99 },
        { term: 'competitor_name', platforms: ['facebook', 'instagram'], score: 98 },
      ],
    });
    expect(plan.facebookTags.join(' ')).not.toMatch(/follow4follow|competitorname/);
    expect(plan.instagramTags.join(' ')).not.toMatch(/follow4follow|competitorname/);
    expect(plan.excluded).toEqual(expect.arrayContaining(['follow4follow', 'competitorname']));
  });

  it('falls back to verified location, category, and brand terms', () => {
    const plan = buildHashtagPlan({
      locationTerms: ['Gladstone'],
      categoryTerms: ['Butcher'],
      brandTerms: ['Richo Road'],
      candidates: [],
    });
    expect(plan.facebookTags).toEqual(['#gladstone', '#butcher', '#richoroad']);
    expect(plan.instagramTags).toEqual(['#gladstone', '#butcher', '#richoroad']);
    expect(plan.evidence).toContain('verified fallback terms');
  });

  it('caps focused sets at exported platform limits', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      term: `Local tag ${index}`,
      platforms: ['facebook', 'instagram'] as const,
      score: 100 - index,
    }));
    const plan = buildHashtagPlan({
      locationTerms: ['Gladstone'], categoryTerms: [], brandTerms: [], candidates,
    });
    expect(plan.facebookTags).toHaveLength(FACEBOOK_HASHTAG_LIMIT);
    expect(plan.instagramTags).toHaveLength(INSTAGRAM_HASHTAG_LIMIT);
  });
});
