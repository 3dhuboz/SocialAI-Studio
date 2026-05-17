/**
 * Unit tests for the plan-pricing / quota / addon-feature helpers in
 * workers/api/src/lib/pricing.ts.
 *
 * Pure data + small pure helpers — no DB, no fetch. The intent of this
 * suite is to lock the source-of-truth constants (plan prices, weekly
 * post quotas, poster quotas, trial caps) and the resolution logic for
 * per-user addon feature flags. Parallel PRs that touch the pricing
 * shape will trip these tests and force a deliberate update rather than
 * a silent drift between the worker and the frontend's
 * src/client.config.ts.
 *
 * Run with: `npm test` from the repo root (vitest picks the file up).
 */
import { describe, it, expect } from 'vitest';
import {
  PLAN_PRICE_AUD,
  POSTER_QUOTA_PER_MONTH,
  POSTS_PER_WEEK,
  TRIAL_POST_LIMIT,
  PLAN_INCLUDES_POSTERS,
  SUBSCRIPTION_STATUS,
  parseAddonFeatures,
  userHasFeature,
} from '../lib/pricing';

describe('PLAN_PRICE_AUD — locked source-of-truth prices', () => {
  it('has the four expected plan tiers', () => {
    expect(Object.keys(PLAN_PRICE_AUD).sort()).toEqual(['agency', 'growth', 'pro', 'starter']);
  });

  it.each([
    ['starter', 29],
    ['growth', 49],
    ['pro', 79],
    ['agency', 149],
  ])('%s plan is $%i AUD/mo', (plan, price) => {
    expect(PLAN_PRICE_AUD[plan]).toBe(price);
  });

  it('every price is a positive integer (no fractional cents)', () => {
    for (const price of Object.values(PLAN_PRICE_AUD)) {
      expect(price).toBeGreaterThan(0);
      expect(Number.isInteger(price)).toBe(true);
    }
  });
});

describe('POSTER_QUOTA_PER_MONTH — locked quota math', () => {
  it('every paid plan has a poster quota defined', () => {
    expect(POSTER_QUOTA_PER_MONTH.starter).toBe(3);
    expect(POSTER_QUOTA_PER_MONTH.growth).toBe(10);
    expect(POSTER_QUOTA_PER_MONTH.pro).toBe(30);
    expect(POSTER_QUOTA_PER_MONTH.agency).toBe(100);
  });

  it('quotas are strictly increasing with plan price (no cheaper plan beats a more expensive one)', () => {
    const tiers = ['starter', 'growth', 'pro', 'agency'];
    for (let i = 1; i < tiers.length; i++) {
      expect(POSTER_QUOTA_PER_MONTH[tiers[i]]).toBeGreaterThan(POSTER_QUOTA_PER_MONTH[tiers[i - 1]]);
    }
  });
});

describe('POSTS_PER_WEEK — locked weekly post quotas', () => {
  it.each([
    ['starter', 7],
    ['growth', 14],
    ['pro', 21],
    ['agency', 21],
  ])('%s plan = %i posts/week', (plan, quota) => {
    expect(POSTS_PER_WEEK[plan]).toBe(quota);
  });

  it('pro and agency have the same cap (intentional — agency is multi-client, not higher volume per workspace)', () => {
    expect(POSTS_PER_WEEK.pro).toBe(POSTS_PER_WEEK.agency);
  });

  it('every plan key is also a known PLAN_PRICE_AUD key (no orphan quotas)', () => {
    for (const plan of Object.keys(POSTS_PER_WEEK)) {
      expect(PLAN_PRICE_AUD[plan]).toBeDefined();
    }
  });
});

describe('TRIAL_POST_LIMIT', () => {
  it('is 7 (mirrors CLIENT.freeTrialPosts in client.config.ts)', () => {
    expect(TRIAL_POST_LIMIT).toBe(7);
  });
});

describe('PLAN_INCLUDES_POSTERS', () => {
  it('contains exactly the same plan keys as POSTER_QUOTA_PER_MONTH', () => {
    expect(new Set(PLAN_INCLUDES_POSTERS)).toEqual(new Set(Object.keys(POSTER_QUOTA_PER_MONTH)));
  });

  it.each(['starter', 'growth', 'pro', 'agency'])('%s includes posters', (plan) => {
    expect(PLAN_INCLUDES_POSTERS.has(plan)).toBe(true);
  });

  it('does NOT include trial (null plan) or unrecognised plan names', () => {
    expect(PLAN_INCLUDES_POSTERS.has('trial')).toBe(false);
    expect(PLAN_INCLUDES_POSTERS.has('')).toBe(false);
    expect(PLAN_INCLUDES_POSTERS.has('enterprise')).toBe(false);
  });
});

describe('SUBSCRIPTION_STATUS', () => {
  it('exposes PAST_DUE as the canonical string the PayPal webhook writes', () => {
    expect(SUBSCRIPTION_STATUS.PAST_DUE).toBe('past_due');
  });
});

describe('parseAddonFeatures — JSON safety', () => {
  it('returns {} for null / undefined / empty input (tolerant of NULL D1 column)', () => {
    expect(parseAddonFeatures(null)).toEqual({});
    expect(parseAddonFeatures(undefined)).toEqual({});
    expect(parseAddonFeatures('')).toEqual({});
  });

  it('returns {} for malformed JSON (never throws — corrupt rows fall through to plan defaults)', () => {
    expect(parseAddonFeatures('not json')).toEqual({});
    expect(parseAddonFeatures('{posters: true}')).toEqual({});
    expect(parseAddonFeatures('{"posters":')).toEqual({});
  });

  it('returns {} for non-object JSON (arrays, strings, numbers)', () => {
    expect(parseAddonFeatures('[]')).toEqual({});
    expect(parseAddonFeatures('"posters"')).toEqual({});
    expect(parseAddonFeatures('42')).toEqual({});
    expect(parseAddonFeatures('null')).toEqual({});
  });

  it('parses valid grant / revoke blobs', () => {
    expect(parseAddonFeatures('{"posters":true}')).toEqual({ posters: true });
    expect(parseAddonFeatures('{"posters":false,"reels":true}')).toEqual({ posters: false, reels: true });
  });
});

describe('userHasFeature — addon resolution order', () => {
  describe('posters feature', () => {
    it('plan-default GRANT: paid plan, no override → true', () => {
      expect(userHasFeature('posters', 'starter', null)).toBe(true);
      expect(userHasFeature('posters', 'growth', null)).toBe(true);
      expect(userHasFeature('posters', 'pro', '{}')).toBe(true);
      expect(userHasFeature('posters', 'agency', undefined)).toBe(true);
    });

    it('plan-default DENY: trial (null plan) → false', () => {
      expect(userHasFeature('posters', null, null)).toBe(false);
      expect(userHasFeature('posters', undefined, null)).toBe(false);
      expect(userHasFeature('posters', '', null)).toBe(false);
    });

    it('plan-default DENY: unrecognised plan → false', () => {
      expect(userHasFeature('posters', 'enterprise', null)).toBe(false);
      expect(userHasFeature('posters', 'lifetime', null)).toBe(false);
    });

    it('explicit override GRANT: trial user + addon.posters=true → true', () => {
      // Use case: gift posters to a trial user without upgrading their plan.
      expect(userHasFeature('posters', null, '{"posters":true}')).toBe(true);
      expect(userHasFeature('posters', '', '{"posters":true}')).toBe(true);
    });

    it('explicit override REVOKE: paid plan + addon.posters=false → false', () => {
      // Use case: revoke posters for an abusive paid user without
      // downgrading their whole plan.
      expect(userHasFeature('posters', 'pro', '{"posters":false}')).toBe(false);
      expect(userHasFeature('posters', 'agency', '{"posters":false}')).toBe(false);
    });

    it('missing override key falls through to plan default', () => {
      // addons.reels is set but addons.posters is missing → posters should
      // resolve via plan tier, not via the unrelated `reels` flag.
      expect(userHasFeature('posters', 'starter', '{"reels":true}')).toBe(true);
      expect(userHasFeature('posters', null, '{"reels":true}')).toBe(false);
    });
  });

  describe('reels feature', () => {
    it('plan-default GRANT: any paid plan → true', () => {
      expect(userHasFeature('reels', 'starter', null)).toBe(true);
      expect(userHasFeature('reels', 'growth', null)).toBe(true);
    });

    it('plan-default DENY: trial → false', () => {
      expect(userHasFeature('reels', null, null)).toBe(false);
    });

    it('explicit GRANT overrides trial DENY', () => {
      expect(userHasFeature('reels', null, '{"reels":true}')).toBe(true);
    });

    it('explicit REVOKE overrides paid GRANT', () => {
      expect(userHasFeature('reels', 'agency', '{"reels":false}')).toBe(false);
    });
  });

  it('ignores malformed addon JSON and falls through to plan default', () => {
    // Corruption shouldn't lock paying users out of features.
    expect(userHasFeature('posters', 'starter', 'not json')).toBe(true);
    expect(userHasFeature('posters', null, 'not json')).toBe(false);
  });
});
