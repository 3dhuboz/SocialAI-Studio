import { describe, expect, it } from 'vitest';
import { buildPostFeedbackPatch } from '../routes/posts';

describe('buildPostFeedbackPatch', () => {
  it('normalizes post feedback into DB columns with a timestamp', () => {
    expect(buildPostFeedbackPatch({
      qaFeedbackTarget: 'image',
      qaFeedbackReason: 'off_brand',
      qaFeedbackNote: 'Logo colour feels wrong',
    }, () => '2026-05-23T10:15:00.000Z')).toEqual({
      qa_feedback_target: 'image',
      qa_feedback_reason: 'off_brand',
      qa_feedback_note: 'Logo colour feels wrong',
      qa_feedback_at: '2026-05-23T10:15:00.000Z',
    });
  });

  it('rejects unknown feedback targets and reasons', () => {
    expect(() => buildPostFeedbackPatch({
      qaFeedbackTarget: 'soundtrack',
      qaFeedbackReason: 'too_spicy',
    })).toThrow('Invalid post feedback');
  });

  it('trims long optional notes', () => {
    const note = 'x'.repeat(620);
    const patch = buildPostFeedbackPatch({
      qaFeedbackTarget: 'caption',
      qaFeedbackReason: 'bad_caption',
      qaFeedbackNote: note,
    }, () => '2026-05-23T10:15:00.000Z');

    expect(patch.qa_feedback_note).toHaveLength(500);
  });
});
