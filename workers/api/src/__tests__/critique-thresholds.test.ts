/**
 * Sanity guards for shared/critique-thresholds.ts.
 *
 * Compile-checks that the constants are exported from the shared module and
 * that the values are sane. The real regression test is implicit — if a
 * developer tweaks the threshold here without tweaking it in every cron file
 * that used to hardcode `5`, the cron file would no longer compile because
 * it imports the same constant. Drift bug class closed.
 */
import { describe, it, expect } from 'vitest';
import {
  CRITIQUE_ACCEPT_THRESHOLD,
  MAX_REGEN_ATTEMPTS,
} from '../../../../shared/critique-thresholds';

describe('critique-thresholds', () => {
  it('CRITIQUE_ACCEPT_THRESHOLD is in the 1-10 score range', () => {
    expect(CRITIQUE_ACCEPT_THRESHOLD).toBeGreaterThanOrEqual(1);
    expect(CRITIQUE_ACCEPT_THRESHOLD).toBeLessThanOrEqual(10);
  });

  it('CRITIQUE_ACCEPT_THRESHOLD is 5 (locked — change requires audit of all 3 call sites)', () => {
    // Hard-pinned to 5 because the value is load-bearing across:
    //   - cron/prewarm-images.ts gen-time regen
    //   - lib/backfill.ts backlog regen + manual backfill
    //   - cron/publish-missed.ts publish-time guard (separate threshold but
    //     same family; a tweak here should prompt a review of the publish
    //     threshold too)
    // The intent of this assertion is to force a code review when this
    // number changes, not to bake in a guess.
    expect(CRITIQUE_ACCEPT_THRESHOLD).toBe(5);
  });

  it('MAX_REGEN_ATTEMPTS is a small positive integer', () => {
    expect(Number.isInteger(MAX_REGEN_ATTEMPTS)).toBe(true);
    expect(MAX_REGEN_ATTEMPTS).toBeGreaterThan(0);
    expect(MAX_REGEN_ATTEMPTS).toBeLessThan(10);
  });
});
