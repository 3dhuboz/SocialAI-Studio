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

describe('publish-missed Postproxy status normalization', () => {
  it('reads the array-shaped status response', () => {
    const result = __test.normalizePostproxyStatus({
      id: 'pp_1',
      status: 'pending',
      platforms: [{ platform: 'facebook', status: 'published', permalink: 'https://fb/post/1' }],
    });

    expect(result.state).toBe('published');
    expect(result.platform?.permalink).toBe('https://fb/post/1');
  });

  it('reads the object-shaped status response', () => {
    const result = __test.normalizePostproxyStatus({
      data: {
        id: 'pp_1',
        status: 'processed',
        platforms: {
          facebook: { status: 'failed', error: 'Meta rejected the post' },
        },
      },
    });

    expect(result.state).toBe('failed');
    expect(result.platform?.error).toBe('Meta rejected the post');
  });
});
