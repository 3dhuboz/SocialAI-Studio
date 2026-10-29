import { describe, expect, it } from 'vitest';
import { smartBatchReviewStatus } from '../publishingSafety';

describe('Smart Schedule publishing boundary', () => {
  it('always saves a newly generated batch as Draft for operator review', () => {
    expect(smartBatchReviewStatus()).toBe('Draft');
  });
});
