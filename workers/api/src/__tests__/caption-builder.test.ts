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

  it('corrects stale Gladstone BBQ ticket facts before publishing', () => {
    const out = buildPublishCaption({
      content: 'Gladstone BBQ Festival tickets are live. VIP $40, general admission $20, high school $10, primary school free. Grab yours at gladstonebbqfest.au.',
      hashtags: ['#GladstoneBBQ'],
      hasImage: true,
    });

    expect(out).toContain('Adult $30');
    expect(out).toContain('Family Pass $80');
    expect(out).toContain('High School $15');
    expect(out).toContain('Kids 5-12 $5');
    expect(out).not.toMatch(/\bVIP\b|\$20|general admission \$20|high school \$10|primary school free/i);
  });

  it('does not rewrite unrelated VIP copy for other clients', () => {
    const out = buildPublishCaption({
      content: 'VIP $40 launch night tickets are now open for the studio.',
      hashtags: [],
      hasImage: true,
    });

    expect(out).toBe('VIP $40 launch night tickets are now open for the studio.');
  });
});
