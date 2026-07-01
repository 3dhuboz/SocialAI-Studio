import { describe, expect, it } from 'vitest';
import {
  buildCritiqueContextText,
  buildCritiqueInvalidationPatch,
  shouldInvalidateStoredCritique,
} from '../lib/post-critique';

describe('post critique helpers', () => {
  it('builds critique context from short captions plus hashtags and the image brief', () => {
    const context = buildCritiqueContextText({
      caption: 'Now open',
      hashtags: ['#hugheseysque', '#brisket'],
      imagePrompt: 'Smoked brisket slices on butcher paper beside the offset smoker',
    });

    expect(context).toContain('Now open');
    expect(context).toContain('Hashtags: #hugheseysque #brisket');
    expect(context).toContain('Intended image brief: Smoked brisket slices on butcher paper');
  });

  it('does not inject the image brief when the caption already has enough signal', () => {
    const context = buildCritiqueContextText({
      caption: 'Our smoked brisket gets twelve hours in the pit before it hits the tray.',
      imagePrompt: 'Close-up of bark and smoke ring',
    });

    expect(context).toContain('Our smoked brisket gets twelve hours in the pit');
    expect(context).not.toContain('Intended image brief:');
  });

  it('invalidates stored critique when publish-relevant fields change', () => {
    expect(shouldInvalidateStoredCritique({ content: 'Updated caption' })).toBe(true);
    expect(shouldInvalidateStoredCritique({ hashtags: ['#bbq'] })).toBe(true);
    expect(shouldInvalidateStoredCritique({ imageUrl: 'https://cdn.example/new.jpg' })).toBe(true);
    expect(shouldInvalidateStoredCritique({ scheduledFor: '2026-07-01T10:00:00' })).toBe(false);
  });

  it('resets critique score, reasoning, timestamp, and regen budget together', () => {
    expect(buildCritiqueInvalidationPatch({ imagePrompt: 'new prompt' })).toEqual({
      image_critique_score: null,
      image_critique_reasoning: null,
      image_critique_at: null,
      image_regen_count: 0,
    });
    expect(buildCritiqueInvalidationPatch({ scheduledFor: '2026-07-01T10:00:00' })).toEqual({});
  });
});
