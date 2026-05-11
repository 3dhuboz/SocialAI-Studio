/**
 * Smoke test for the 2026-05 AI quality audit fixes.
 *
 * Runs synthetic inputs through the four safety helpers and asserts each one
 * behaves as documented. Standalone — no test framework, no infrastructure,
 * just `tsx scripts/audit-smoke-test.ts` from the repo root. Designed to be
 * cheap to run by hand pre-merge.
 *
 *   ✅ green check  = expected behaviour
 *   ❌ red cross    = regression — investigate before shipping
 *
 * Exits 0 if all cases pass, 1 otherwise (so it can sit in CI).
 */

import {
  isAbstractUIPrompt,
  buildSafeImagePromptClient,
  buildRegionalVoiceBlock,
  detectFabrication,
  scrubBannedPhrases,
} from '../src/services/gemini';

interface Case {
  name: string;
  input: string;
  expect: (out: any) => boolean;
  describeExpected: string;
}

let pass = 0;
let fail = 0;

function run(label: string, cases: Case[], fn: (input: string) => any) {
  console.log(`\n━━━ ${label} ━━━`);
  for (const c of cases) {
    const out = fn(c.input);
    const ok = c.expect(out);
    if (ok) {
      console.log(`  ✅ ${c.name}`);
      pass++;
    } else {
      console.log(`  ❌ ${c.name}`);
      console.log(`     input:    ${JSON.stringify(c.input).slice(0, 100)}`);
      console.log(`     expected: ${c.describeExpected}`);
      console.log(`     got:      ${JSON.stringify(out).slice(0, 200)}`);
      fail++;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// isAbstractUIPrompt — tightened regex shouldn't false-positive on SMB nouns
// ═══════════════════════════════════════════════════════════════════════════
run('isAbstractUIPrompt — false-positive guards', [
  { name: "'meal plan' is NOT abstract UI", input: 'weekly meal plan with macros on a wooden board', expect: o => o === false, describeExpected: 'false' },
  { name: "'wine tier' is NOT abstract UI", input: 'premium wine tier bottles on oak shelf', expect: o => o === false, describeExpected: 'false' },
  { name: "'tea table' is NOT abstract UI", input: 'high tea spread on a marble table', expect: o => o === false, describeExpected: 'false' },
  { name: "'picnic table' is NOT abstract UI", input: 'BBQ platter on picnic table outdoors', expect: o => o === false, describeExpected: 'false' },
  { name: "'business plan' is NOT abstract UI", input: 'business plan notebook on desk', expect: o => o === false, describeExpected: 'false' },
  { name: "'fence grid' is NOT abstract UI", input: 'wooden fence grid in golden hour', expect: o => o === false, describeExpected: 'false' },
], isAbstractUIPrompt);

run('isAbstractUIPrompt — true positives still fire', [
  { name: "'dashboard' is abstract UI", input: 'dashboard with charts and metrics', expect: o => o === true, describeExpected: 'true' },
  { name: "'pricing table' is abstract UI", input: 'pricing table with tiers and features', expect: o => o === true, describeExpected: 'true' },
  { name: "'comparison chart' is abstract UI", input: 'comparison chart of features', expect: o => o === true, describeExpected: 'true' },
  { name: "'app screen' is abstract UI", input: 'app screen showing settings page', expect: o => o === true, describeExpected: 'true' },
  { name: "'illustration of a graph' is abstract UI", input: 'illustration of a growth graph', expect: o => o === true, describeExpected: 'true' },
  { name: "'wireframe' is abstract UI", input: 'wireframe of new feature', expect: o => o === true, describeExpected: 'true' },
  { name: "'architecture diagram' is abstract UI", input: 'architecture diagram for the system', expect: o => o === true, describeExpected: 'true' },
], isAbstractUIPrompt);

// ═══════════════════════════════════════════════════════════════════════════
// buildSafeImagePromptClient — fail-closed + negative_prompt separation
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━ buildSafeImagePromptClient — return shape ━━━');
(() => {
  const r1 = buildSafeImagePromptClient('overhead flatlay of sourdough loaves on linen', 'bakery');
  if (r1 && typeof r1.prompt === 'string' && typeof r1.negativePrompt === 'string') {
    console.log('  ✅ valid prompt returns { prompt, negativePrompt } object');
    pass++;
  } else {
    console.log('  ❌ valid prompt did not return object shape:', r1);
    fail++;
  }

  const r2 = buildSafeImagePromptClient('', 'small business');
  if (r2 === null) {
    console.log('  ✅ empty prompt + generic businessType → fail-closed (null)');
    pass++;
  } else {
    console.log('  ❌ empty prompt with generic businessType should be null:', r2);
    fail++;
  }

  const r3 = buildSafeImagePromptClient('dashboard with pricing tiers', 'small business');
  if (r3 === null) {
    console.log('  ✅ abstract UI prompt + generic businessType → fail-closed (null)');
    pass++;
  } else {
    console.log('  ❌ abstract UI + generic businessType should be null:', r3);
    fail++;
  }

  const r4 = buildSafeImagePromptClient('dashboard with pricing tiers', 'bakery & café');
  if (r4 && r4.prompt && !r4.prompt.includes('dashboard')) {
    console.log('  ✅ abstract UI + specific businessType → fallback scene (not null)');
    pass++;
  } else {
    console.log('  ❌ abstract UI + specific businessType should produce a fallback prompt:', r4);
    fail++;
  }

  const r5 = buildSafeImagePromptClient('overhead flatlay of pastries on linen', 'bakery');
  if (r5 && !r5.prompt.toLowerCase().includes('no people') && !r5.prompt.toLowerCase().includes('no hands')) {
    console.log('  ✅ negatives NOT in positive prompt (they live in negativePrompt now)');
    pass++;
  } else {
    console.log('  ❌ negatives leaked into positive prompt:', r5?.prompt?.slice(0, 200));
    fail++;
  }

  const r6 = buildSafeImagePromptClient('overhead flatlay of pastries on linen', 'bakery');
  if (r6 && r6.negativePrompt.includes('hands') && r6.negativePrompt.includes('people')) {
    console.log('  ✅ negative_prompt contains expected suppression terms');
    pass++;
  } else {
    console.log('  ❌ negativePrompt missing expected terms:', r6?.negativePrompt);
    fail++;
  }

  const r7 = buildSafeImagePromptClient('chef holding pizza with both hands', 'bakery');
  if (r7 && !/\bchef\b|\bholding\b|\bhands\b/i.test(r7.prompt)) {
    console.log('  ✅ people-words stripped from positive prompt');
    pass++;
  } else {
    console.log('  ❌ people-words leaked through:', r7?.prompt);
    fail++;
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// buildRegionalVoiceBlock — fires on Australian locations only
// ═══════════════════════════════════════════════════════════════════════════
run('buildRegionalVoiceBlock — Aussie detection', [
  { name: "'Rockhampton, QLD' → returns block", input: 'Rockhampton, QLD', expect: o => o.length > 100 && o.includes('REGIONAL VOICE LOCK'), describeExpected: 'non-empty REGIONAL VOICE LOCK block' },
  { name: "'Brisbane' → returns block", input: 'Brisbane', expect: o => o.length > 100, describeExpected: 'non-empty block' },
  { name: "'Bondi Beach, Sydney NSW' → returns block", input: 'Bondi Beach, Sydney NSW', expect: o => o.length > 100, describeExpected: 'non-empty block' },
  { name: "'Perth, WA' → returns block", input: 'Perth, WA', expect: o => o.length > 100, describeExpected: 'non-empty block' },
  { name: "'London, UK' → returns empty (not Aussie)", input: 'London, UK', expect: o => o === '', describeExpected: 'empty string' },
  { name: "'New York' → returns empty (not Aussie)", input: 'New York', expect: o => o === '', describeExpected: 'empty string' },
  { name: "'' → returns empty (no location)", input: '', expect: o => o === '', describeExpected: 'empty string' },
], buildRegionalVoiceBlock);

// ═══════════════════════════════════════════════════════════════════════════
// detectFabrication — catches the new patterns from the screenshots
// ═══════════════════════════════════════════════════════════════════════════
run('detectFabrication — invented stats & cadence', [
  { name: 'Penny Wise screenshot: "posting 7-14 times per week" → flagged', input: 'Small business owners in Rocky are already posting 7-14 times per week on autopilot. Join them.', expect: o => o !== null && /posting-frequency|customer/i.test(o), describeExpected: 'flagged with reason' },
  { name: '"How many hours could you reclaim" → flagged', input: 'AI does it for you. How many hours could you reclaim this week?', expect: o => o !== null && /implied invented stat|leading question/i.test(o), describeExpected: 'flagged with reason' },
  { name: 'AI cadence: 4 short sentences in a row → flagged', input: 'Nobody sees it. Timing is everything. We fix that. Trust us.', expect: o => o !== null && /cadence|short sentences/i.test(o), describeExpected: 'cadence flagged' },
  { name: 'Invented percentage stat → flagged', input: 'Boost engagement by 45% with our new feature.', expect: o => o !== null && /percentage/i.test(o), describeExpected: 'percentage flagged' },
  { name: 'Fake testimonial signature → flagged', input: 'Loved it! — Sarah J., Brisbane', expect: o => o !== null && /testimonial signature/i.test(o), describeExpected: 'signature flagged' },
  { name: 'Clean post → NOT flagged', input: 'Fresh sourdough out the oven at 7am. Drop in before they go.', expect: o => o === null, describeExpected: 'null (no flag)' },
  { name: 'Two short sentences (OK) → NOT flagged', input: 'Open till 2pm. Come say hi. We have got pastries fresh out of the oven and the coffee machine is warmed up.', expect: o => o === null, describeExpected: 'null (no flag — only 2 consecutive shorts)' },
  // 2026-05 SaaS-marketing genre additions
  { name: 'SocialAI screenshot: "generates 7-14 posts per week" → flagged', input: 'Our AI Content Autopilot generates 7-14 posts per week-captions, hashtags, and all.', expect: o => o !== null && /content-generation cadence/i.test(o), describeExpected: 'content-generation cadence flagged' },
  { name: 'Brand-guide preferred "7-14 posts/week" form → NOT flagged', input: 'Plans include 7-14 posts/week and image generation.', expect: o => o === null, describeExpected: 'null (preserves brand-guide preferred form)' },
], detectFabrication);

// ═══════════════════════════════════════════════════════════════════════════
// scrubBannedPhrases — new structural-trope patterns
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━ scrubBannedPhrases — new trope patterns ━━━');
const tropeCases: Array<[string, string, RegExp]> = [
  ['"Nobody sees it. Timing is everything." stripped', 'Your post goes live at 3 AM on a Tuesday. Nobody sees it. Timing is everything.', /Nobody sees it/i],
  ['"No more staring at a blank screen" stripped', 'Tired of stuck? No more staring at a blank screen wondering what to write.', /No more staring/i],
  ['"Every X. Every Y. Every Z." stripped', 'Every website coded. Every app custom-built. Every AI tool tailored.', /Every \w+(?:\s+\w+){0,3}[.!]\s+Every/i],
  ['"channelled creative energy" + "bespoke digital platforms" stripped', "We've channelled significant creative energy into designing bespoke digital platforms.", /bespoke digital platforms|channell?ed.+creative energy/i],
  ['"Small business owners often..." stripped', 'Small business owners often post when convenient, not when scrolled.', /Small business owners often/i],
  ['"Timing is everything." closer stripped', 'Get it right. Timing is everything.', /Timing is everything/i],
  ['"That\'s the gap we close." stripped', "We help you fill it. That's the gap we close.", /the gap we close/i],
  // ── 2026-05 SaaS-marketing genre additions ──
  ['"Staring at a blank caption for 20 minutes?" stripped', 'Staring at a blank caption for 20 minutes? SocialAI writes them.', /Staring at a blank caption for 20 minutes/i],
  ['"Ready to reclaim those hours?" stripped', 'AI does the work. Ready to reclaim those hours?', /Ready to reclaim those hours/i],
  ['"Ready to automate?" stripped', 'Set it and forget it. Ready to automate?', /Ready to automate/i],
  ['"no lock-in" pitch fragment stripped (price preserved separately)', 'From $29/mo, no lock-in. Cancel anytime.', /no lock-in/i],
  ['"Your social media on autopilot" stripped', 'Your social media on autopilot from $29/mo.', /Your social media on autopilot/i],
  ['"Consistency without the burnout" stripped', 'Post every day. Consistency without the burnout.', /Consistency without the burnout/i],
  ['"Scale your agency without scaling your workload" stripped', 'Scale your agency without scaling your workload.', /without scaling/i],
  ['"That\'s not laziness-that\'s reality" stripped (hyphen variant)', "They're busy. That's not laziness-that's reality.", /That'?s not laziness/i],
  ['"Multi-client, white-label, centralized" feature list stripped', 'Multi-client management, white-label client portals, centralized analytics.', /Multi-client management,\s+white-label/i],
  ['"Managing multiple client social accounts?" stripped', 'Managing multiple client social accounts? Let us help.', /Managing multiple client social accounts\?/i],
  ['"Link in bio." stripped', 'Learn more—link in bio.', /link in bio/i],
  ['"Small business owners post inconsistently because..." stripped', 'Small business owners post inconsistently because they are busy. We fix that.', /Small business owners post inconsistently/i],
];
for (const [name, input, leftoverRegex] of tropeCases) {
  const out = scrubBannedPhrases(input);
  if (!leftoverRegex.test(out)) {
    console.log(`  ✅ ${name}`);
    pass++;
  } else {
    console.log(`  ❌ ${name}`);
    console.log(`     input: ${input}`);
    console.log(`     got:   ${out}`);
    fail++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// scrubBannedPhrases — false-positive guards (these MUST survive scrubbing)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━ scrubBannedPhrases — preservation guards ━━━');
const preservationCases: Array<[string, string, RegExp]> = [
  // Brand-guide-mandated facts that must survive (line 1548-1549 of gemini.ts)
  ['"$29/mo" pricing literal preserved', 'Plans from $29/mo include images.', /\$29\/mo/],
  ['Product name "AI Content Autopilot" preserved', 'Our AI Content Autopilot does the work for you.', /AI Content Autopilot/],
  ['"7-14 posts/week" brand-form preserved (no marketing verb)', 'Plans include 7-14 posts/week.', /7-14 posts\/week/],
  // Legitimate small-business content that must NOT be over-scrubbed
  ['Menu list "burgers, salads, shakes" preserved (no SaaS-prefix)', 'Our menu features burgers, salads, and shakes.', /burgers, salads/],
  ['Hours list "Open Mon, Wed, Fri" preserved', 'Open Monday, Wednesday, Friday 9am-5pm.', /Monday, Wednesday/],
  ['"Ready to order?" preserved (food-truck rhetorical opener)', 'Lunch starts at 11. Ready to order?', /Ready to order\?/],
  ['"Are you ready to automate?" — different structure, preserved', 'Are you ready to automate your workflow?', /Are you ready/],
  ['Mid-sentence "small business owners" preserved', 'We welcome small business owners in our co-working space.', /small business owners/],
];
for (const [name, input, requiredRegex] of preservationCases) {
  const out = scrubBannedPhrases(input);
  if (requiredRegex.test(out)) {
    console.log(`  ✅ ${name}`);
    pass++;
  } else {
    console.log(`  ❌ ${name} — content was over-scrubbed`);
    console.log(`     input: ${input}`);
    console.log(`     got:   ${out}`);
    fail++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} passed   ${fail} failed   (${pass + fail} total)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if (fail > 0) process.exit(1);
