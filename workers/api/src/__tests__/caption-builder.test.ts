/**
 * Unit tests for buildPublishCaption (cron/_shared.ts).
 *
 * The helper centralises FB/IG publish caption assembly so the cron path
 * and manual publish-now route produce byte-identical captions.
 */
import { describe, it, expect } from 'vitest';
import { buildPublishCaption } from '../cron/_shared';

describe('buildPublishCaption', () => {
  it('does not append an AI disclosure when an image post has no opt-out', () => {
    const out = buildPublishCaption({
      content: 'Fresh sourdough straight from the oven',
      hashtags: ['#bakery', '#sourdough'],
      hasImage: true,
    });

    expect(out).toBe('Fresh sourdough straight from the oven\n\n#bakery #sourdough');
    expect(out).not.toContain('Created with AI');
  });

  it('does not append an AI disclosure even when legacy aiDisclosure=true is saved', () => {
    const out = buildPublishCaption({
      content: 'Sample',
      hashtags: [],
      hasImage: true,
      aiDisclosure: true,
    });

    expect(out).toBe('Sample');
    expect(out).not.toContain('Created with AI');
  });

  it('omits the disclosure when the workspace has opted out', () => {
    const out = buildPublishCaption({
      content: 'Fresh sourdough straight from the oven',
      hashtags: ['#bakery', '#sourdough'],
      hasImage: true,
      aiDisclosure: false,
    });

    expect(out).toBe('Fresh sourdough straight from the oven\n\n#bakery #sourdough');
    expect(out).not.toContain('Created with AI');
  });

  it('omits the disclosure on text-only posts even with disclosure ON', () => {
    const out = buildPublishCaption({
      content: 'A reminder - we open at 6am tomorrow!',
      hashtags: ['#sundayplans'],
      hasImage: false,
      aiDisclosure: true,
    });

    expect(out).toBe('A reminder - we open at 6am tomorrow!\n\n#sundayplans');
    expect(out).not.toContain('Created with AI');
  });

  it('places hashtags on their own line with no disclosure suffix', () => {
    const out = buildPublishCaption({
      content: 'New menu drops Friday',
      hashtags: ['#newmenu'],
      hasImage: true,
    });

    expect(out).toBe('New menu drops Friday\n\n#newmenu');
    expect(out).not.toContain('Created with AI');
  });

  it('strips trailing hashtags from content before assembling the caption', () => {
    const out = buildPublishCaption({
      content: 'Fresh sourdough straight from the oven #bakery #sourdough',
      hashtags: ['#bakery', '#sourdough'],
      hasImage: true,
    });

    expect(out).toBe('Fresh sourdough straight from the oven\n\n#bakery #sourdough');
    expect(out).not.toContain('Created with AI');
  });

  it('keeps captions with no hashtags clean', () => {
    const out = buildPublishCaption({
      content: 'Just a quick note',
      hashtags: [],
      hasImage: true,
      aiDisclosure: false,
    });

    expect(out).toBe('Just a quick note');
    expect(out).not.toContain('Created with AI');
  });
});
