/**
 * Unit tests for the pure-function decision-making code in gemini.ts.
 *
 * Run with: `npm test`. Hot paths covered:
 *   - isAbstractUIPrompt           (image-prompt safety regex)
 *   - buildSafeImagePromptClient   (the consolidated safety pipeline)
 *   - buildRegionalVoiceBlock      (Aussie-location voice lock)
 *   - detectFabrication            (fake-stat / fake-testimonial detector)
 *   - scrubBannedPhrases           (post-flight trope scrubber)
 *
 * Complements scripts/audit-smoke-test.ts which is the standalone
 * pre-merge sanity script. The vitest suite is the same tests in a proper
 * framework so they can run in CI alongside type-check + build.
 */
import { describe, it, expect } from 'vitest';
import {
  isAbstractUIPrompt,
  buildSafeImagePromptClient,
  buildRegionalVoiceBlock,
  detectFabrication,
  scrubBannedPhrases,
} from '../gemini';

describe('isAbstractUIPrompt — false-positive guards', () => {
  it.each([
    ['weekly meal plan with macros on a wooden board', false, "'meal plan' is a real food concept"],
    ['premium wine tier bottles on oak shelf', false, "'wine tier' is product line"],
    ['high tea spread on a marble table', false, "'tea table' is a real surface"],
    ['BBQ platter on picnic table outdoors', false, "'picnic table' is a real surface"],
    ['business plan notebook on desk', false, "'business plan' is a real document"],
    ['wooden fence grid in golden hour', false, "'fence grid' is a real structure"],
  ])('"%s" → %s (%s)', (input, expected) => {
    expect(isAbstractUIPrompt(input)).toBe(expected);
  });
});

describe('isAbstractUIPrompt — true positives still fire', () => {
  it.each([
    ['dashboard with charts and metrics', true],
    ['pricing table with tiers and features', true],
    ['comparison chart of features', true],
    ['app screen showing settings page', true],
    ['illustration of a growth graph', true],
    ['wireframe of new feature', true],
    ['architecture diagram for the system', true],
  ])('"%s" → %s', (input, expected) => {
    expect(isAbstractUIPrompt(input)).toBe(expected);
  });
});

describe('buildSafeImagePromptClient', () => {
  it('returns { prompt, negativePrompt } for valid inputs', () => {
    const r = buildSafeImagePromptClient('overhead flatlay of sourdough loaves on linen', 'bakery');
    expect(r).not.toBeNull();
    expect(typeof r!.prompt).toBe('string');
    expect(typeof r!.negativePrompt).toBe('string');
  });

  it('fails closed for empty prompt + generic businessType', () => {
    expect(buildSafeImagePromptClient('', 'small business')).toBeNull();
  });

  it('fails closed for abstract-UI prompt + generic businessType', () => {
    expect(buildSafeImagePromptClient('dashboard with pricing tiers', 'small business')).toBeNull();
  });

  it('falls back to industry scene for abstract-UI + specific businessType', () => {
    const r = buildSafeImagePromptClient('dashboard with pricing tiers', 'bakery & café');
    expect(r).not.toBeNull();
    expect(r!.prompt).not.toMatch(/dashboard/);
  });

  it('does NOT inline negatives in the positive prompt', () => {
    const r = buildSafeImagePromptClient('overhead flatlay of pastries on linen', 'bakery');
    expect(r!.prompt.toLowerCase()).not.toContain('no people');
    expect(r!.prompt.toLowerCase()).not.toContain('no hands');
  });

  it('sets the canonical negativePrompt with required suppression terms', () => {
    const r = buildSafeImagePromptClient('overhead flatlay of pastries on linen', 'bakery');
    expect(r!.negativePrompt).toContain('hands');
    expect(r!.negativePrompt).toContain('people');
  });

  it('strips people-mentions from positive prompts', () => {
    const r = buildSafeImagePromptClient('chef holding pizza with both hands', 'bakery');
    expect(r!.prompt).not.toMatch(/\bchef\b|\bholding\b|\bhands\b/i);
  });
});

describe('buildRegionalVoiceBlock', () => {
  it.each([
    ['Rockhampton, QLD', true, 'regional Aussie city'],
    ['Brisbane', true, 'capital city'],
    ['Bondi Beach, Sydney NSW', true, 'metro suburb'],
    ['Perth, WA', true, 'state-level identifier'],
    ['London, UK', false, 'non-Australian'],
    ['New York', false, 'non-Australian'],
    ['', false, 'empty string'],
  ])('"%s" → has voice block: %s (%s)', (input, expected) => {
    const result = buildRegionalVoiceBlock(input);
    if (expected) {
      expect(result.length).toBeGreaterThan(100);
      expect(result).toContain('REGIONAL VOICE LOCK');
    } else {
      expect(result).toBe('');
    }
  });
});

describe('detectFabrication — invented stats and cadence', () => {
  it.each([
    ['Small business owners in Rocky are already posting 7-14 times per week on autopilot. Join them.', /posting-frequency/i],
    ['AI does it for you. How many hours could you reclaim this week?', /implied invented stat|leading question/i],
    // 5+ consecutive ≤6-word sentences trips the structural cadence detector.
    // (Threshold was bumped from 3 to 5 in 2026-05 to stop false-positives on
    // natural 3-item feature lists like "AI writes your posts. Generates your
    // images. Publishes at the right time." Sustained AI rhythm is still caught.)
    ['Nobody sees it. Timing is everything. We fix that. Trust us. We promise.', /cadence|short sentences/i],
    ['Boost engagement by 45% with our new feature.', /percentage/i],
    ['Loved it! — Sarah J., Brisbane', /testimonial signature/i],
    // 2026-05 SaaS-genre additions
    ['Our AI Content Autopilot generates 7-14 posts per week-captions, hashtags, and all.', /content-generation cadence/i],
  ])('flags "%s"', (input, reasonRegex) => {
    const result = detectFabrication(input);
    expect(result).not.toBeNull();
    expect(result!).toMatch(reasonRegex);
  });

  it.each([
    'Fresh sourdough out the oven at 7am. Drop in before they go.',
    'Open till 2pm. Come say hi. We have got pastries fresh out of the oven and the coffee machine is warmed up.',
    'Plans include 7-14 posts/week and image generation.', // brand-form preserved
    // 2026-05-11 false-positive regression: rhetorical anthropomorphizing is
    // not a fabricated testimonial. The pattern previously matched `says:` +
    // quote blindly, flagging legitimate copy about stock photos.
    'Stock photos are dead. Your audience can spot a generic one a mile away. It says: "I didn\'t care enough."',
    'A generic ad says: "buy now" — and nobody listens.',
    'The tagline says: "We do everything" and means nothing.',
  ])('does NOT flag clean post: "%s"', (input) => {
    expect(detectFabrication(input)).toBeNull();
  });

  // The detector should still catch human-attributed fake quotes — adding
  // a quote-form testimonial case to lock that behavior in alongside the
  // rhetorical-personification exclusion above. Reason can vary because the
  // detector picks the first matching pattern (e.g. "happy customer raved"
  // hits the testimonial-shape check before the quote check); any fab-style
  // reason is acceptable as long as the post is flagged.
  it.each([
    ['Sarah says: "best service ever."', /invented quote/i],
    ['Our client raved: "amazing work."', /invented quote/i],
    ['John told us: "this changed our business."', /invented quote/i],
    ['One happy customer raved: "amazing work."', /invented/i],
  ])('still flags human-attributed quote: "%s"', (input, reasonRegex) => {
    const result = detectFabrication(input);
    expect(result).not.toBeNull();
    expect(result!).toMatch(reasonRegex);
  });
});

describe('scrubBannedPhrases — banned-trope removal', () => {
  it.each([
    ['Your post goes live at 3 AM on a Tuesday. Nobody sees it. Timing is everything.', /Nobody sees it/i],
    ['Tired of stuck? No more staring at a blank screen wondering what to write.', /No more staring/i],
    ['Every website coded. Every app custom-built. Every AI tool tailored.', /Every \w+(?:\s+\w+){0,3}[.!]\s+Every/i],
    ['Small business owners often post when convenient, not when scrolled.', /Small business owners often/i],
    // SaaS-genre additions
    ['Staring at a blank caption for 20 minutes? SocialAI writes them.', /Staring at a blank caption for 20 minutes/i],
    ['AI does the work. Ready to reclaim those hours?', /Ready to reclaim those hours/i],
    ['From $29/mo, no lock-in. Cancel anytime.', /no lock-in/i],
    ['Your social media on autopilot from $29/mo.', /Your social media on autopilot/i],
    ['Post every day. Consistency without the burnout.', /Consistency without the burnout/i],
    ['Scale your agency without scaling your workload.', /without scaling/i],
    ["They're busy. That's not laziness-that's reality.", /That'?s not laziness/i],
    ['Multi-client management, white-label client portals, centralized analytics.', /Multi-client management,\s+white-label/i],
    ['Managing multiple client social accounts? Let us help.', /Managing multiple client social accounts\?/i],
    ['Learn more—link in bio.', /link in bio/i],
  ])('strips banned phrase from "%s"', (input, leftoverRegex) => {
    const out = scrubBannedPhrases(input);
    expect(out).not.toMatch(leftoverRegex);
  });
});

describe('scrubBannedPhrases — preservation guards', () => {
  // Brand-guide-mandated facts that MUST survive scrubbing
  it.each([
    ['Plans from $29/mo include images.', /\$29\/mo/, 'price literal preserved'],
    ['Our AI Content Autopilot does the work for you.', /AI Content Autopilot/, 'product name preserved'],
    ['Plans include 7-14 posts/week.', /7-14 posts\/week/, 'brand-form posts/week preserved'],
    // Legitimate small-business content
    ['Our menu features burgers, salads, and shakes.', /burgers, salads/, 'menu list preserved'],
    ['Open Monday, Wednesday, Friday 9am-5pm.', /Monday, Wednesday/, 'hours list preserved'],
    ['Lunch starts at 11. Ready to order?', /Ready to order\?/, 'food-truck rhetorical opener preserved'],
    ['Are you ready to automate your workflow?', /Are you ready/, 'mid-sentence "ready to" preserved'],
    ['We welcome small business owners in our co-working space.', /small business owners/, 'mid-sentence reference preserved'],
  ])('preserves "%s"', (input, requiredRegex) => {
    const out = scrubBannedPhrases(input);
    expect(out).toMatch(requiredRegex);
  });
});
