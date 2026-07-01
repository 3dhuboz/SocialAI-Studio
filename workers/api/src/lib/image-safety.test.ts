// Unit tests for the worker-side image-safety helpers.
//
// Focus of this file (2026-05-21 — companion to PR #136):
//   - The newly-plumbed `businessType` argument on buildSafeImagePrompt.
//   - isGenericBusinessType from shared/flux-prompts.ts (regression-pin so a
//     future regex edit can't silently drop a generic businessType value
//     out of the canonical set).
//
// Why this matters: prior to this commit, the worker's buildSafeImagePrompt
// had NO businessType awareness, so the cron path (5 callsites — prewarm,
// publish-missed, admin-actions, three in backfill.ts) could happily ship
// a random flatlay for a generic-businessType workspace that posted an
// abstract-UI prompt. The frontend gate from PR #136 only fired for
// user-initiated requests. This file pins the closed-gate behaviour.
//
// We do NOT exercise the env-bound resolveBusinessType lookup here — that
// lives in profile-guards.ts and needs a D1 mock. The 6 callsites that wire
// it in are covered by integration in the worker test harness (kept separate
// so this file stays a pure-function lockbox).

import { describe, it, expect } from 'vitest';
import {
  buildSafeImagePrompt,
  isGenericBusinessType,
  isAbstractServiceProduct,
  ABSTRACT_SERVICE_FALLBACK_PROMPT,
  refineBbqPromptForCutAccuracy,
} from './image-safety';

describe('isGenericBusinessType', () => {
  it('matches each canonical generic value', () => {
    // Exact set per the regex on shared/flux-prompts.ts. If a future edit
    // adds or removes a value, update this list — and double-check both the
    // client buildSafeImagePromptClient and the worker buildSafeImagePrompt
    // agree on the new set (drift here is the exact bug PR #136 fixed).
    expect(isGenericBusinessType('small business')).toBe(true);
    expect(isGenericBusinessType('business')).toBe(true);
    expect(isGenericBusinessType('company')).toBe(true);
    expect(isGenericBusinessType('service provider')).toBe(true);
    expect(isGenericBusinessType('local business')).toBe(true);
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(isGenericBusinessType('Small Business')).toBe(true);
    expect(isGenericBusinessType('SMALL BUSINESS')).toBe(true);
    expect(isGenericBusinessType('  company  ')).toBe(true);
    expect(isGenericBusinessType('Service Provider')).toBe(true);
  });

  it('rejects specific archetype slugs', () => {
    // These come from ARCHETYPE_IMAGE_GUARDRAILS in shared/archetype-scenes.ts.
    // If an archetype slug ever started matching the generic regex, the
    // archetype-specific fallback bank would never run on the worker side
    // because we'd fail-closed before it could fire.
    expect(isGenericBusinessType('tech-saas-agency')).toBe(false);
    expect(isGenericBusinessType('bbq-smokehouse')).toBe(false);
    expect(isGenericBusinessType('food-restaurant')).toBe(false);
    expect(isGenericBusinessType('professional-services')).toBe(false);
    expect(isGenericBusinessType('agriculture-farming')).toBe(false);
    expect(isGenericBusinessType('automotive-mechanic')).toBe(false);
  });

  it('rejects more-specific free-form descriptions', () => {
    // Owners frequently type a free-form businessType during onboarding
    // before classify-business has run. These are SPECIFIC enough to anchor
    // a fallback scene, so they should NOT be treated as generic.
    expect(isGenericBusinessType('BBQ Smokehouse')).toBe(false);
    expect(isGenericBusinessType('coffee shop')).toBe(false);
    expect(isGenericBusinessType('SaaS platform')).toBe(false);
    expect(isGenericBusinessType('hair salon')).toBe(false);
    // Multi-word but specific
    expect(isGenericBusinessType('small business consultant')).toBe(false);
    expect(isGenericBusinessType('local business directory')).toBe(false);
  });

  it('treats null / undefined / empty string as generic', () => {
    // Most-generic state: no businessType set at all. The fail-closed gate
    // SHOULD bite for these inputs — there's literally no signal to anchor
    // an image to.
    expect(isGenericBusinessType(null)).toBe(true);
    expect(isGenericBusinessType(undefined)).toBe(true);
    expect(isGenericBusinessType('')).toBe(true);
    expect(isGenericBusinessType('   ')).toBe(true);
  });
});

describe('buildSafeImagePrompt — businessType gate (2026-05-21 hardening)', () => {
  // ── The bug this gate fixes ───────────────────────────────────────────────
  // Penny Wise I.T workspace had businessType='small business' (the worker
  // default) and the AI's image_prompt was 'multi-client agency dashboard
  // mockup'. The OLD worker path ran rewriteAbstractUIAsPhotography and
  // shipped a generic phone-on-marble-desk photo for every cron tick.
  // Frontend was hardened in PR #136. This test pins the worker side.

  it('fails closed for abstract-UI prompt + generic businessType', () => {
    const result = buildSafeImagePrompt(
      'multi-client agency dashboard mockup',
      'Real-time view of every client posting all at once.',
      'small business',
    );
    // Returns null so the cron loop's `if (!safe) { failed++; continue; }`
    // branch fires — post publishes text-only.
    expect(result).toBeNull();
  });

  it('fails closed for abstract-UI prompt + null businessType (no profile set)', () => {
    // The most common failure mode for fresh workspaces: classify-business
    // hasn't run yet, so users.profile.businessType is null. The lookup
    // helper resolves to 'small business' (the default) but null itself
    // should ALSO fail closed at the regex level for defense in depth.
    const result = buildSafeImagePrompt(
      'pricing comparison table',
      'See how our tiers stack up.',
      null,
    );
    expect(result).toBeNull();
  });

  it('fails closed for abstract-UI prompt + undefined businessType (legacy callers)', () => {
    // Any legacy caller that hasn't been updated to pass businessType should
    // get the safest behaviour — fail-closed — rather than the old "ship a
    // random flatlay" path. New code resolves businessType explicitly; this
    // case exists as a backstop.
    const result = buildSafeImagePrompt(
      'app screen showing notifications',
      'New replies in real time.',
    );
    expect(result).toBeNull();
  });

  it('rewrites abstract-UI prompt to photographable scene for SPECIFIC businessType', () => {
    // For specific businessTypes (e.g. 'tech-saas-agency') the rewrite path
    // fires — we have enough signal to ground the resulting scene.
    const result = buildSafeImagePrompt(
      'multi-client agency dashboard mockup',
      'Real-time view of every client posting all at once.',
      'tech-saas-agency',
    );
    expect(result).not.toBeNull();
    // rewriteAbstractUIAsPhotography emits a phone-on-marble-desk style
    // scene with tile-grid or bar-graph. The exact wording is owned by
    // shared/flux-prompts.ts; just assert the high-level shape so future
    // copy tweaks don't break this test.
    expect(result!.prompt.toLowerCase()).toContain('smartphone');
    expect(result!.prompt.toLowerCase()).toContain('marble desk');
    expect(result!.prompt).toContain('candid iPhone'); // FLUX_STYLE_SUFFIX
  });

  it('passes specific businessTypes through to the rewrite path for various UI nouns', () => {
    // Spot-check the rewrite still fires across the abstract-UI dispatch
    // table when businessType is specific — pricing table, app screen,
    // chart, screenshot.
    const cases: Array<string> = [
      'pricing comparison table',
      'mobile app screen with notifications',
      'bar chart showing growth',
      'screenshot of the new feature',
    ];
    for (const prompt of cases) {
      const result = buildSafeImagePrompt(prompt, '', 'bbq-smokehouse');
      expect(result, `expected rewrite for prompt: ${prompt}`).not.toBeNull();
      expect(result!.prompt).toContain('candid iPhone');
    }
  });

  it('non-abstract prompt is unaffected by businessType — pass-through works for generic businessType too', () => {
    // The fail-closed gate ONLY bites when isAbstractUIPrompt fires. A real
    // photographable prompt should still pass for any businessType — the
    // worst that happens for generic is the prompt itself drives FLUX,
    // which is the same behaviour as pre-hardening.
    const result = buildSafeImagePrompt(
      'cosy cafe corner with morning daylight, ceramic mug on a wooden table',
      'Sunday morning vibes.',
      'small business',
    );
    expect(result).not.toBeNull();
    // The prompt passes through cleaned + suffixed.
    expect(result!.prompt).toContain('cosy cafe corner');
    expect(result!.prompt).toContain('candid iPhone');
    expect(result!.negativePrompt).toContain('people');
  });

  it('empty prompt returns null regardless of businessType', () => {
    // Empty prompt was already null before the businessType plumbing —
    // make sure the new code path doesn't accidentally return a value here.
    expect(buildSafeImagePrompt('', '', 'tech-saas-agency')).toBeNull();
    expect(buildSafeImagePrompt(null, '', 'tech-saas-agency')).toBeNull();
    expect(buildSafeImagePrompt(undefined, '', 'tech-saas-agency')).toBeNull();
    expect(buildSafeImagePrompt('  ', '', 'tech-saas-agency')).toBeNull();
  });
});

describe('isAbstractServiceProduct', () => {
  // Regression-pin for the Shopify image-gen "Monthly Curdial" bug — when
  // a merchant lists an intangible service ("Monthly Website Care Plan"),
  // the raw product title used to flow into "Professional product photograph
  // of …" which FLUX confabulated as a skincare bottle. Now we detect
  // services at prompt-build time and swap to a workspace scene.

  it('flags services by product_type alone (strong signal)', () => {
    // product_type with a service keyword is high-precision — merchants
    // type "Service" / "Subscription" deliberately. Single hit suffices.
    expect(isAbstractServiceProduct('Monthly Website Care Plan', 'Service')).toBe(true);
    expect(isAbstractServiceProduct('Premium Support', 'Subscription')).toBe(true);
    expect(isAbstractServiceProduct('Annual Retainer', 'Consulting')).toBe(true);
    expect(isAbstractServiceProduct('Pro Plan', 'SaaS')).toBe(true);
  });

  it('flags services by 2+ title keywords when product_type is null/empty', () => {
    // Title-only path requires multiple hits — single common words like
    // "Care" or "Support" alone are NOT enough (they legitimately appear
    // in physical product names).
    expect(isAbstractServiceProduct('Monthly Website Care Plan', null)).toBe(true); // monthly + care
    expect(isAbstractServiceProduct('Social Media Management Subscription', null)).toBe(true); // management + subscription
    expect(isAbstractServiceProduct('Annual Maintenance Plan', '')).toBe(true); // annual + maintenance
    expect(isAbstractServiceProduct('Done-for-you Setup & Onboarding', null)).toBe(true); // done-for-you + setup + onboarding
  });

  it('PHYSICAL: tangible products are not falsely flagged', () => {
    // The classic false-positive risks — single keyword hits that should
    // stay PHYSICAL. If one of these flips to true, the heuristic is too
    // loose and needs tightening.
    expect(isAbstractServiceProduct('Hair Care Set', null)).toBe(false); // "care" alone
    expect(isAbstractServiceProduct('Lumbar Support Cushion', null)).toBe(false); // "support" alone
    expect(isAbstractServiceProduct('Stainless Steel Coffee Mug', null)).toBe(false);
    expect(isAbstractServiceProduct('T-shirt', 'Apparel')).toBe(false);
    expect(isAbstractServiceProduct('Bluetooth Headphones', 'Electronics')).toBe(false);
    expect(isAbstractServiceProduct('Yoga Mat', 'Fitness')).toBe(false);
  });

  it('handles null / empty / non-string title defensively', () => {
    expect(isAbstractServiceProduct('', 'Service')).toBe(false);
    expect(isAbstractServiceProduct(null, 'Service')).toBe(false);
    expect(isAbstractServiceProduct(undefined, 'Service')).toBe(false);
  });

  it('fallback prompt is non-empty and contains no product noun', () => {
    // Sanity check on the swap-in scene — it should be a workspace, not
    // imply a physical product. If a future edit accidentally puts a
    // product noun in here, this test fails loudly.
    expect(ABSTRACT_SERVICE_FALLBACK_PROMPT.length).toBeGreaterThan(50);
    expect(ABSTRACT_SERVICE_FALLBACK_PROMPT).toMatch(/workspace|desk|laptop|notebook/i);
    expect(ABSTRACT_SERVICE_FALLBACK_PROMPT).not.toMatch(/\bphotograph of\b/i);
  });
});

describe('refineBbqPromptForCutAccuracy', () => {
  it('rewrites brisket prompts into a safer tray-and-smoker scene', () => {
    const result = refineBbqPromptForCutAccuracy({
      prompt: 'close-up of slow-smoked brisket bark on a butcher board, smoke trail behind',
      negativePrompt: 'people',
    }, 'Low and slow brisket gets 12+ hours in the pit.');

    expect(result.refined).toBe(true);
    expect(result.prompt.toLowerCase()).toContain('overlapping slices');
    expect(result.prompt.toLowerCase()).toContain('side-angle');
    expect(result.prompt.toLowerCase()).toContain('offset smoker');
    expect(result.negativePrompt.toLowerCase()).toContain('bolar blade');
    expect(result.negativePrompt.toLowerCase()).toContain('chuck roast');
    expect(result.negativePrompt.toLowerCase()).toContain('concentric rings');
  });

  it('leaves generic smoker prompts broader while still adding meat-cut negatives', () => {
    const result = refineBbqPromptForCutAccuracy({
      prompt: 'offset smoker with thin blue smoke beside split hardwood',
      negativePrompt: 'people',
    }, 'The firebox is running clean today.');

    expect(result.refined).toBe(false);
    expect(result.prompt).toContain('offset smoker');
    expect(result.negativePrompt.toLowerCase()).toContain('incorrect beef cut');
  });
});
