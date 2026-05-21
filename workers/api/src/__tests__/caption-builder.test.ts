/**
 * Unit tests for buildPublishCaption (cron/_shared.ts).
 *
 * The helper centralises the FB/IG publish caption assembly so the cron path
 * (cron/publish-missed.ts) and the manual publish-now route (routes/postproxy.ts)
 * produce byte-identical captions. The AI-disclosure suffix lives here too — it's
 * the customer-readiness compliance step for Meta's Synthetic & Manipulated
 * Media policy (publisher is liable, default-on opt-out).
 *
 * Coverage:
 *   - image post with no opt-out → disclosure appended
 *   - image post with explicit opt-out → no disclosure
 *   - text-only post → no disclosure regardless of preference
 *   - undefined preference defaults to ON (back-compat with pre-disclosure
 *     profiles)
 *   - hashtag block remains correctly placed BEFORE the disclosure
 *   - idempotent hashtag stripping still works
 */
import { describe, it, expect } from 'vitest';
import { buildPublishCaption, AI_DISCLOSURE_SUFFIX } from '../cron/_shared';

describe('buildPublishCaption', () => {
  it('appends the disclosure when an image post has no opt-out', () => {
    const out = buildPublishCaption({
      content: 'Fresh sourdough straight from the oven',
      hashtags: ['#bakery', '#sourdough'],
      hasImage: true,
      // aiDisclosure omitted — undefined means "no preference set", defaults to ON
    });
    expect(out).toBe(
      `Fresh sourdough straight from the oven\n\n#bakery #sourdough${AI_DISCLOSURE_SUFFIX}`,
    );
    expect(out.endsWith(AI_DISCLOSURE_SUFFIX)).toBe(true);
  });

  it('omits the disclosure when the workspace has opted out', () => {
    const out = buildPublishCaption({
      content: 'Fresh sourdough straight from the oven',
      hashtags: ['#bakery', '#sourdough'],
      hasImage: true,
      aiDisclosure: false, // explicit opt-out
    });
    expect(out).toBe('Fresh sourdough straight from the oven\n\n#bakery #sourdough');
    expect(out).not.toContain('Created with AI');
  });

  it('omits the disclosure on text-only posts even with disclosure ON', () => {
    const out = buildPublishCaption({
      content: 'A reminder — we open at 6am tomorrow!',
      hashtags: ['#sundayplans'],
      hasImage: false, // no AI image — disclosure must not appear
      aiDisclosure: true,
    });
    expect(out).toBe('A reminder — we open at 6am tomorrow!\n\n#sundayplans');
    expect(out).not.toContain('Created with AI');
  });

  it('treats explicit aiDisclosure=true the same as undefined (default-on)', () => {
    const a = buildPublishCaption({
      content: 'Sample',
      hashtags: [],
      hasImage: true,
      aiDisclosure: true,
    });
    const b = buildPublishCaption({
      content: 'Sample',
      hashtags: [],
      hasImage: true,
      // undefined — back-compat with pre-disclosure profiles
    });
    expect(a).toBe(b);
    expect(a.endsWith(AI_DISCLOSURE_SUFFIX)).toBe(true);
  });

  it('places the disclosure AFTER the hashtag block', () => {
    const out = buildPublishCaption({
      content: 'New menu drops Friday',
      hashtags: ['#newmenu'],
      hasImage: true,
    });
    // Hashtags must be on their own line; disclosure follows the last hashtag.
    expect(out).toMatch(/#newmenu · 🤖 Created with AI$/);
  });

  it('strips trailing hashtags from content before assembling the caption', () => {
    const out = buildPublishCaption({
      // Content has trailing inline hashtags — should be stripped before the
      // canonical hashtag block is appended.
      content: 'Fresh sourdough straight from the oven #bakery #sourdough',
      hashtags: ['#bakery', '#sourdough'],
      hasImage: true,
    });
    // Trailing hashtags from content stripped, only the canonical block remains
    // before the disclosure.
    expect(out).toBe(
      `Fresh sourdough straight from the oven\n\n#bakery #sourdough${AI_DISCLOSURE_SUFFIX}`,
    );
  });

  it('keeps captions with no hashtags clean', () => {
    const out = buildPublishCaption({
      content: 'Just a quick note',
      hashtags: [],
      hasImage: true,
      aiDisclosure: false,
    });
    expect(out).toBe('Just a quick note');
  });

  it('appends the disclosure when there are no hashtags but an image is present', () => {
    const out = buildPublishCaption({
      content: 'Just a quick note',
      hashtags: [],
      hasImage: true,
      aiDisclosure: true,
    });
    expect(out).toBe(`Just a quick note${AI_DISCLOSURE_SUFFIX}`);
  });
});
