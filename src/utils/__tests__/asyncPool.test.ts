import { describe, expect, it } from 'vitest';

import { REVIEWED_IMAGE_CONCURRENCY, runWithConcurrency } from '../asyncPool';

describe('runWithConcurrency', () => {
  it('uses one reviewed-image wave for a standard seven-post calendar', () => {
    expect(REVIEWED_IMAGE_CONCURRENCY).toBe(8);
  });

  it('completes every task without exceeding the concurrency limit', async () => {
    const completed: number[] = [];
    let active = 0;
    let maxActive = 0;

    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, item % 2 === 0 ? 2 : 1));
      completed.push(item);
      active -= 1;
    });

    expect(maxActive).toBe(3);
    expect(completed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('does not start work for an empty collection', async () => {
    let calls = 0;

    await runWithConcurrency([], 8, async () => {
      calls += 1;
    });

    expect(calls).toBe(0);
  });
});
