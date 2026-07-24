import { describe, expect, it } from 'vitest';
import {
  isCurrentPilotDraftConfirmation,
  isReviewablePilotDraft,
} from '../AdminCustomers';

const HASH = 'a'.repeat(64);

function candidate() {
  return {
    samplePostId: 'draft-1',
    sampleDraft: {
      postId: 'draft-1',
      content: 'A real business post that the operator can review.',
      platform: 'facebook',
      hashtags: '["#RealBusiness"]',
      imageUrl: null,
      postType: 'text',
      videoUrl: null,
      contentHash: HASH,
    },
  };
}

describe('learning pilot draft confirmation', () => {
  it('binds confirmation to the exact reviewable content hash', () => {
    const input = candidate();

    expect(isReviewablePilotDraft(input)).toBe(true);
    expect(isCurrentPilotDraftConfirmation(input, HASH)).toBe(true);
    expect(isCurrentPilotDraftConfirmation(input, 'b'.repeat(64))).toBe(false);
  });

  it.each([
    ['missing preview', { ...candidate(), sampleDraft: null }],
    ['different post', {
      ...candidate(),
      sampleDraft: { ...candidate().sampleDraft, postId: 'draft-2' },
    }],
    ['empty content', {
      ...candidate(),
      sampleDraft: { ...candidate().sampleDraft, content: '   ' },
    }],
    ['malformed hash', {
      ...candidate(),
      sampleDraft: { ...candidate().sampleDraft, contentHash: 'not-a-hash' },
    }],
  ])('fails closed for %s', (_label, input) => {
    expect(isReviewablePilotDraft(input)).toBe(false);
    expect(isCurrentPilotDraftConfirmation(input, HASH)).toBe(false);
  });
});
