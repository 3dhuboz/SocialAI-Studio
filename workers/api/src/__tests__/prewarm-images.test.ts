import { describe, expect, it } from 'vitest';

import { __test } from '../cron/prewarm-images';

describe('prewarm-images readiness query', () => {
  it('treats browser data URLs as missing publish-ready media', () => {
    expect(__test.PREWARM_MISSING_IMAGE_PREDICATE).toMatch(/image_url IS NULL/);
    expect(__test.PREWARM_MISSING_IMAGE_PREDICATE).toMatch(/image_url = ''/);
    expect(__test.PREWARM_MISSING_IMAGE_PREDICATE).toMatch(/image_url LIKE 'data:%'/);
  });
});
