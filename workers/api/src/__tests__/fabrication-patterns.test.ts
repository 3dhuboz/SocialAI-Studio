/**
 * Tests for shared/fabrication-patterns.ts — the lifted FAB_PATTERNS bank
 * that powers gen-time detectFabrication (gemini.ts), admin scan-flagged-
 * posts (admin-stats.ts), and the publish-missed cron pre-publish guard.
 *
 * After the 2026-05 lift, all three call sites share this bank. Tests here
 * cover patterns that recently surfaced in production fabricated drafts,
 * plus the expanded invented-quote regex (added said/mentioned/commented).
 */
import { describe, it, expect } from 'vitest';
import {
  FAB_PATTERNS,
  AI_CADENCE_THRESHOLD,
  scanContentForTropes,
} from '../../../../shared/fabrication-patterns';

describe('FAB_PATTERNS — invented quote regex covers said/mentioned/commented', () => {
  // The pre-fix regex only matched (says|told us|reported|shared|raved).
  // Real fabricated copy uses `said:` and `mentioned:` and `commented:`
  // verbs — the original list missed all three. This regression guard
  // fails loudly if a future edit narrows the list again.
  it.each([
    [`Sarah said: "We saved hours every week!"`, 'said + quote'],
    [`A local owner mentioned: "Best decision we made."`, 'mentioned + quote'],
    [`One customer commented: "It's a game-changer."`, 'commented + quote'],
    [`Bob raved: "Couldn't believe how much time we saved."`, 'raved + quote (pre-existing)'],
    [`Mary told us: "We saw a real difference."`, 'told us + quote (pre-existing)'],
  ])('flags "%s" (%s)', (sample) => {
    const reasons = scanContentForTropes(sample);
    expect(reasons.some((r) => r.includes('invented'))).toBe(true);
  });

  it('does NOT flag legitimate rhetorical anthropomorphizing', () => {
    // "The post says..." / "The caption says..." are figures of speech that
    // legitimately appear in voice-explaining drafts. The negative lookbehind
    // in the regex was specifically added to allow these.
    const safe = [
      `The post says: "Open now."`,
      `Our brand tagline says: "Made for you."`,
      `The image says it all.`,
    ];
    for (const s of safe) {
      const reasons = scanContentForTropes(s);
      expect(
        reasons.some((r) => r.includes('invented quote')),
        `unexpected invented-quote hit on: "${s}"`,
      ).toBe(false);
    }
  });
});

describe('FAB_PATTERNS — full pattern bank present', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(FAB_PATTERNS)).toBe(true);
    expect(FAB_PATTERNS.length).toBeGreaterThan(15);
  });

  it('includes the testimonial / stat / urgency families', () => {
    const sample = [
      `A local cafe in Brisbane said it changed everything.`,
      `We saw a 45% boost in engagement.`,
      `Today only — limited spots left.`,
      `Sarah J., Brisbane, says...`,
    ];
    for (const s of sample) {
      const reasons = scanContentForTropes(s);
      expect(reasons.length, `expected hits on: "${s}"`).toBeGreaterThan(0);
    }
  });
});

describe('scanContentForTropes — cadence detector threshold', () => {
  it(`fires at ${AI_CADENCE_THRESHOLD}+ consecutive short sentences`, () => {
    // 5 short sentences (≤6 words each) → must trip the cadence detector
    const tooShort = 'AI helps you. Posts get written. Time gets saved. Followers come. Engagement grows.';
    const reasons = scanContentForTropes(tooShort);
    expect(reasons.some((r) => r.includes('AI cadence'))).toBe(true);
  });

  it('does NOT fire on 3-item feature lists (false-positive guard)', () => {
    // Real marketing-list cadence — should pass. Pre-fix threshold of 3 made
    // this fail; threshold of 5 lets natural punchy lists through.
    const naturalList = 'AI writes your posts. Generates your images. Publishes at the right time.';
    const reasons = scanContentForTropes(naturalList);
    expect(reasons.some((r) => r.includes('AI cadence'))).toBe(false);
  });

  it('returns empty array on empty / null content', () => {
    expect(scanContentForTropes('')).toEqual([]);
    expect(scanContentForTropes(null as any)).toEqual([]);
  });
});

describe('scanContentForTropes — publish-missed obvious fabrication block', () => {
  // The publish-missed cron uses this to block obviously fabricated copy
  // pre-publish (defense layer 6). This is the gen-pipeline-bypass safety
  // net — if a manual portal edit slipped fabricated copy past the gen-time
  // retry loop, this scan still catches it before it hits Facebook.
  it('blocks an obvious "Sarah J., Brisbane, says: ..." fabrication', () => {
    const fabricated = `Big news this week! Sarah J., Brisbane, says: "Our engagement is up 45% since switching. We saved 12 hours a week!"`;
    const reasons = scanContentForTropes(fabricated);
    // Must catch at least one of: invented quote, testimonial signature,
    // invented percentage, invented time-saving. In practice it hits all four.
    expect(reasons.length).toBeGreaterThanOrEqual(1);
  });
});
