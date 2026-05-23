#!/usr/bin/env node
/**
 * AI quality regression eval — run this BEFORE shipping prompt or model changes.
 *
 *   1. Generates N posts via the production /api/ai/generate endpoint
 *   2. Runs each through the same fabrication detector + judge the prod code uses
 *   3. Prints a pass/fail report with examples
 *
 * Usage:
 *   npm run eval:ai                              # offline fixture scan
 *   tsx scripts/eval-ai-quality.mjs --offline    # offline fixture scan
 *   AI_TOKEN=<clerk-jwt> tsx scripts/eval-ai-quality.mjs
 *
 * Get a Clerk JWT from your browser:
 *   await window.Clerk.session.getToken()
 *
 * The harness is intentionally bare — no test framework, no infra. Just a
 * lightweight smoke test for "did my prompt change break anything obvious".
 */

import { scanContentForTropes } from '../shared/fabrication-patterns.ts';

const WORKER = process.env.AI_WORKER_URL || 'https://socialai-api.steve-700.workers.dev';
const TOKEN = process.env.AI_TOKEN;
const OFFLINE = process.argv.includes('--offline') || process.env.OFFLINE === '1';

if (!TOKEN && !OFFLINE) {
  console.error('[eval] Set AI_TOKEN env var to your Clerk JWT.');
  console.error('[eval] In browser console: await window.Clerk.session.getToken()');
  process.exit(1);
}

// ─── Test cases ───────────────────────────────────────────────────────────
// Each case feeds the AI a topic + business profile. We then check the output
// for known fabrication patterns. If they appear, the prompt has regressed.
const CASES = [
  {
    name: 'BBQ — should not invent customer testimonials',
    topic: 'why slow-smoked brisket beats fast cooking',
    businessName: 'Hugheseys Que',
    businessType: 'BBQ restaurant and catering',
    tone: 'Friendly & casual',
    profile: {
      description: 'Low and slow smoked meats — brisket, ribs, pulled pork',
      productsServices: 'Smoked brisket, pulled pork, ribs, catering',
      location: 'Gladstone, QLD',
    },
  },
  {
    name: 'Pickle business — should not invent stats',
    topic: 'fermented foods and gut health',
    businessName: 'Pickle Nick',
    businessType: 'artisan deli and pickled goods',
    tone: 'Warm and quirky',
    profile: {
      description: 'Handcrafted pickles and ferments. Small batch.',
      productsServices: 'Sauerkraut, kimchi, dill pickles, hot sauce',
      location: 'Queensland',
    },
  },
  {
    name: 'Tech consultancy — should not fake countdowns',
    topic: 'AI for small business websites',
    businessName: 'Penny Wise I.T',
    businessType: 'small business IT consultancy',
    tone: 'Professional, approachable',
    profile: {
      description: 'Websites, apps, and social media platforms for small business',
      productsServices: 'Web design, app dev, AI tools, hosting',
      location: 'Central QLD',
    },
  },
];

// ─── Fabrication detector (mirrors src/services/gemini.ts) ────────────────
function detectFabrication(content) {
  return scanContentForTropes(content)[0] || null;
}

const OFFLINE_FIXTURES = [
  {
    name: 'clean BBQ post',
    content: 'Brisket is resting and the smoker has done its work. Swing by before lunch if you want the good slices.',
    shouldFlag: false,
  },
  {
    name: 'invented testimonial signature',
    content: 'Sarah J., Brisbane says: "This brisket changed our weekend."',
    shouldFlag: true,
  },
  {
    name: 'invented stat',
    content: 'Boost engagement by 45% with one quick post.',
    shouldFlag: true,
  },
];

// ─── Run ──────────────────────────────────────────────────────────────────
async function callAI(prompt) {
  const res = await fetch(`${WORKER}/api/ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ prompt, temperature: 0.5, maxTokens: 512, responseFormat: 'json' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.text || '';
}

async function runCase(c) {
  const prompt = `You are a senior social media strategist for "${c.businessName}" (${c.businessType}). Tone: ${c.tone}. Location: ${c.profile.location}.

GOLDEN RULES (rejection bait):
1. NO INVENTED CUSTOMERS, REVIEWS, STORIES, or TESTIMONIAL SIGNATURES like "Sarah J., Brisbane".
2. NO INVENTED STATISTICS — no percentages, no "saved X hours", no "Xx more".
3. NO INVENTED EVENTS, COUNTDOWNS, or LIMITED-TIME LANGUAGE.
4. Reference real products from the brand context.

BRAND: ${c.profile.description}. Products: ${c.profile.productsServices}.

Write a Facebook post about: "${c.topic}".
Return JSON: {"content": "post body", "hashtags": ["#tag"]}`;

  const raw = await callAI(prompt);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = { content: raw, hashtags: [] }; }
  const violation = detectFabrication(parsed.content || '');
  return { name: c.name, content: parsed.content?.substring(0, 200), violation };
}

(async () => {
  if (OFFLINE) {
    console.log('[eval] Offline fixture scan');
    let fail = 0;
    for (const f of OFFLINE_FIXTURES) {
      const violation = detectFabrication(f.content);
      const ok = f.shouldFlag ? !!violation : !violation;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${f.name}${violation ? ` - ${violation}` : ''}`);
      if (!ok) fail++;
    }
    process.exit(fail > 0 ? 1 : 0);
  }

  console.log(`[eval] Testing against ${WORKER}`);
  console.log(`[eval] Running ${CASES.length} cases...\n`);
  let pass = 0, fail = 0;
  for (const c of CASES) {
    try {
      const r = await runCase(c);
      const ok = !r.violation;
      console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${r.name}`);
      console.log(`        > ${r.content?.replace(/\n/g, ' ').substring(0, 120)}...`);
      if (r.violation) console.log(`        ! ${r.violation}`);
      console.log('');
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`✗ ERROR ${c.name}: ${e.message}\n`);
      fail++;
    }
  }
  console.log(`\n[eval] ${pass}/${CASES.length} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
