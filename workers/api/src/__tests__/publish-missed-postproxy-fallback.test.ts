import { describe, expect, it } from 'vitest';

import { __test } from '../cron/publish-missed';

describe('publish-missed Postproxy fallback decision', () => {
  it('falls back to legacy Graph for stale Facebook page mappings', () => {
    expect(
      __test.shouldFallbackToLegacyGraphFromPostproxy(
        'Upstream POST /posts -> 404: Facebook page not found',
        'facebook',
      ),
    ).toBe(true);

    expect(
      __test.shouldFallbackToLegacyGraphFromPostproxy(
        'Placement does not exist or is unavailable',
        'facebook',
      ),
    ).toBe(true);
  });

  it('does not fall back for Instagram or unrelated transient failures', () => {
    expect(__test.shouldFallbackToLegacyGraphFromPostproxy('Page not found', 'instagram')).toBe(false);
    expect(__test.shouldFallbackToLegacyGraphFromPostproxy('rate limit exceeded', 'facebook')).toBe(false);
  });
});
