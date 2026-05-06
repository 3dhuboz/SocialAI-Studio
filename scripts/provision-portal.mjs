#!/usr/bin/env node
/**
 * Whitelabel portal provisioning CLI — Phase B.
 *
 * Automates everything in the new-portal flow that doesn't need
 * Cloudflare API credentials:
 *
 *   1. clients + portal D1 rows (atomic, via worker endpoint)
 *   2. Clerk auto-login user (via Clerk Backend API, falls back to
 *      manual instruction on failure)
 *   3. src/client.configs/<slug>.ts file (templated locally from
 *      picklenick.ts; pass --noConfigFile to skip)
 *
 * Still manual after running this:
 *   - CF Pages project creation (needs CLOUDFLARE_API_TOKEN)
 *   - Custom domain attachment
 *   - Setting env vars on the CF Pages project
 *   - git commit + push of the generated config file
 *
 * Usage:
 *   FACTS_BOOTSTRAP_SECRET=<secret> \
 *   OWNER_USER_ID=<your-clerk-user-id> \
 *   node scripts/provision-portal.mjs \
 *     --slug newclient \
 *     --businessName "New Client" \
 *     --businessType florist \
 *     --location "Brisbane, Australia" \
 *     --tone "Friendly and professional" \
 *     --accentColor "#b5513c" \
 *     --autoLoginEmail client@socialaistudio.au \
 *     --customDomain social.newclient.com.au
 *
 * Optional flags:
 *   --appName            "Newclient Social" (default: "<businessName> Social")
 *   --tagline            short tagline shown in app header
 *   --description        2-line business description
 *   --plan               'agency' (default) | 'starter' | 'growth' | 'pro'
 *   --noConfigFile       skip generating src/client.configs/<slug>.ts
 *
 * The autoLoginPassword is auto-generated and printed — copy it BEFORE
 * losing the terminal output. It's stored only in the portal table
 * (as VITE_PORTAL_SECRET) and on the Clerk user; we can't recover it.
 */

import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = process.env.AI_WORKER_URL || 'https://socialai-api.steve-700.workers.dev';
const SECRET = process.env.FACTS_BOOTSTRAP_SECRET;
const OWNER  = process.env.OWNER_USER_ID;

// The CLI lives at <repo>/scripts/provision-portal.mjs.
// Resolve <repo>/src/client.configs/ for writing the generated config file.
const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');
const configsDir = resolve(repoRoot, 'src/client.configs');

// ─── Args ─────────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const val = process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[++i]
    : 'true';
  args[key] = val;
}

const required = ['slug', 'businessName', 'autoLoginEmail'];
const missing = required.filter(k => !args[k]);

if (!SECRET || !OWNER || missing.length) {
  console.error('Missing required input.\n');
  if (!SECRET) console.error('  FACTS_BOOTSTRAP_SECRET env var is required');
  if (!OWNER)  console.error('  OWNER_USER_ID env var is required (Clerk user id of agency admin)');
  for (const k of missing) console.error(`  --${k} is required`);
  console.error('\nSee header of this file for full usage.');
  process.exit(1);
}

// ─── Generate auto-login password ────────────────────────────────────────
// 24 random bytes → 32 base64url chars → strong enough for Clerk and not
// awkward to copy-paste. Customers never see this; only the agency admin
// uses it for portal env vars + the Clerk user.
const autoLoginPassword = randomBytes(24).toString('base64url');

// ─── Provision via admin endpoint ────────────────────────────────────────
const body = {
  slug: args.slug,
  ownerUserId: OWNER,
  businessName: args.businessName,
  businessType: args.businessType,
  plan: args.plan || 'agency',
  autoLoginEmail: args.autoLoginEmail,
  autoLoginPassword,
  customDomain: args.customDomain,
};

console.log(`[provision] POST ${WORKER}/api/admin/portals/provision`);
console.log(`[provision] slug=${body.slug}, owner=${body.ownerUserId}, business="${body.businessName}"`);

const res = await fetch(`${WORKER}/api/admin/portals/provision`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Secret': SECRET },
  body: JSON.stringify(body),
});
const data = await res.json();

if (!res.ok) {
  console.error(`\n[provision] ERROR ${res.status}:`, data);
  process.exit(1);
}

// ─── Print result ────────────────────────────────────────────────────────
console.log('\n[provision] DB rows created:');
console.log(`  clientId      = ${data.clientId}`);
console.log(`  portalToken   = ${data.portalToken}`);
console.log(`  portalSecret  = ${data.portalSecret}`);

if (data.clerkUserCreated) {
  console.log(`\n[provision] Clerk user created automatically:`);
  console.log(`  clerkUserId   = ${data.clerkUserId}`);
} else if (data.clerkError) {
  console.log(`\n[provision] Clerk user auto-create FAILED — needs manual creation:`);
  console.log(`  reason        = ${data.clerkError}`);
}

if (data.cfPagesProjectCreated) {
  console.log(`\n[provision] CF Pages project created automatically:`);
  console.log(`  project       = ${data.cfPagesProjectName}`);
  if (data.cfPagesDomainAttached) {
    console.log(`  custom domain = attached (SSL provisioning runs async ~5 min)`);
  } else if (data.cfPagesError) {
    console.log(`  domain attach = FAILED — ${data.cfPagesError}`);
  }
} else if (data.cfPagesError) {
  console.log(`\n[provision] CF Pages auto-create skipped or failed:`);
  console.log(`  reason        = ${data.cfPagesError}`);
}

console.log('\n[provision] Env vars (already on CF Pages project if auto-create succeeded):');
console.log('─'.repeat(72));
for (const [k, v] of Object.entries(data.envVars)) {
  console.log(`${k}=${v}`);
}
console.log('─'.repeat(72));

console.log('\n[provision] Auto-login credentials (also matches Clerk user):');
console.log(`  Email:    ${body.autoLoginEmail}`);
console.log(`  Password: ${autoLoginPassword}`);

console.log('\n[provision] Remaining manual steps:');
for (const step of data.manualSteps) {
  console.log(`  ${step}`);
}

// ─── Generate the client.configs/<slug>.ts file ──────────────────────────
// Skip generation if --noConfigFile is passed, or if the file already exists
// (we don't want to clobber a hand-edited config).
let wroteConfig = false;
if (args.noConfigFile === 'true') {
  console.log('\n[provision] Skipping config-file generation (--noConfigFile).');
} else {
  const configPath = resolve(configsDir, `${args.slug}.ts`);
  if (existsSync(configPath)) {
    console.log(`\n[provision] Config file already exists at ${configPath}. Not overwriting.`);
  } else {
    if (!existsSync(configsDir)) mkdirSync(configsDir, { recursive: true });
    const accent     = args.accentColor   || '#f59e0b';
    const tone       = args.tone          || 'Friendly and professional';
    const description = args.description  || '';
    const appName    = args.appName       || `${args.businessName} Social`;
    const tagline    = args.tagline       || 'AI-powered social media — done for you';
    const customDomain = args.customDomain || `social.${args.slug}.com.au`;

    writeFileSync(configPath, renderClientConfig({
      slug: args.slug,
      appName,
      tagline,
      businessName: args.businessName,
      businessType: args.businessType || 'small business',
      location: args.location || 'Australia',
      tone,
      description,
      accentColor: accent,
      customDomain,
    }), 'utf8');
    wroteConfig = true;
    console.log(`\n[provision] Wrote config file: ${configPath}`);
    console.log(`[provision]   Edit it before committing if you want to customise plans, theme, etc.`);
  }
}

// Re-print the remaining manual steps, this time filtering out the
// "create the .ts file" instruction if the CLI just wrote it.
if (wroteConfig) {
  const filtered = data.manualSteps.filter(s => !/Create src\/client\.configs\//.test(s));
  console.log('\n[provision] Updated remaining manual steps (config file written above):');
  for (const step of filtered) {
    console.log(`  ${step}`);
  }
}

console.log('\n[provision] Done. Save this output — the autoLoginPassword is not stored anywhere we can recover it from.');

// ─── Template ─────────────────────────────────────────────────────────────
// Mirrors src/client.configs/picklenick.ts but with the per-portal fields
// substituted. Plans block copied verbatim from picklenick — edit if the
// portal needs different pricing (rare, since clientMode:true hides plan UI).
function renderClientConfig({
  slug, appName, tagline, businessName, businessType, location, tone, description,
  accentColor, customDomain,
}) {
  return `/// <reference types="vite/client" />
/**
 * ─────────────────────────────────────────────────────────
 *  CLIENT CONFIG  —  ${businessName}
 *  Deployed at: ${customDomain}
 *  CF Pages env: VITE_CLIENT_ID=${slug}
 *  Generated by scripts/provision-portal.mjs
 * ─────────────────────────────────────────────────────────
 */
export const CLIENT = {
  clientId: ${JSON.stringify(slug)},
  appName: ${JSON.stringify(appName)},
  tagline: ${JSON.stringify(tagline)},

  defaultBusinessName: ${JSON.stringify(businessName)},
  defaultBusinessType: ${JSON.stringify(businessType)},
  defaultLocation: ${JSON.stringify(location)},
  defaultTone: ${JSON.stringify(tone)},
  defaultDescription: ${JSON.stringify(description)},

  accentColor: ${JSON.stringify(accentColor)},
  theme: 'light' as const,

  poweredBy: 'Powered by Penny Wise I.T',
  poweredByUrl: 'https://pennywiseit.com.au',

  facebookAppId: '847198108337884',
  facebookLoginConfigId: import.meta.env.VITE_FACEBOOK_LOGIN_CONFIG_ID ?? '',

  adminEmails: ['steve@3dhub.au', 'steve@pennywiseit.com.au'],

  youtubeVideoId: '',

  salesUrl: 'https://pennywiseit.com.au',
  onboardingFormUrl: 'https://pennywiseit.com.au/onboarding',
  supportEmail: 'support@pennywiseit.com.au',

  emailJsServiceId: '',
  emailJsTemplateId: '',
  emailJsPublicKey: '',

  setupFee: 0,

  stripePublishableKey: '',
  stripePricingTableId: '',
  stripeCustomerPortalUrl: '',

  stripePaymentLinks: {
    starter: '',
    growth: '',
    pro: '',
    agency: '',
  },

  stripePaymentLinksNew: {
    starter: '',
    growth: '',
    pro: '',
    agency: '',
  },

  agencyClientLimit: 10,
  clientMode: true,
  autoLoginEmail: import.meta.env.VITE_AUTO_LOGIN_EMAIL ?? '',
  autoLoginPassword: import.meta.env.VITE_AUTO_LOGIN_PASSWORD ?? '',

  plans: [
    {
      id: 'starter' as const,
      name: 'Starter',
      price: 29,
      postsPerWeek: 7,
      features: [
        'Up to 7 posts per week',
        'AI-written captions & hashtags',
        'Facebook & Instagram scheduling',
        'AI Insights & best-time analysis',
        'Content calendar',
      ],
      limitations: ['Text posts only — no AI images'],
      color: 'from-blue-500 to-indigo-600',
      badge: null,
    },
    {
      id: 'growth' as const,
      name: 'Growth',
      price: 49,
      postsPerWeek: 14,
      features: [
        'Up to 14 posts per week',
        'AI-written captions & hashtags',
        'Facebook & Instagram scheduling',
        'AI-generated images for every post',
        'Smart AI Scheduler (auto-plan 2 weeks)',
        'AI Insights & best-time analysis',
        'Content calendar',
      ],
      limitations: [],
      color: 'from-amber-500 to-orange-500',
      badge: 'Most Popular',
    },
    {
      id: 'pro' as const,
      name: 'Pro',
      price: 79,
      postsPerWeek: 21,
      features: [
        'Up to 21 posts per week',
        'AI-written captions & hashtags',
        'Facebook & Instagram scheduling',
        'AI-generated images for every post',
        'Smart AI Scheduler + Saturation Mode',
        'Short video script generation',
        'AI Insights & best-time analysis',
        'Priority support',
      ],
      limitations: [],
      color: 'from-purple-500 to-pink-600',
      badge: 'Best Value',
    },
    {
      id: 'agency' as const,
      name: 'Agency',
      price: 149,
      postsPerWeek: 21,
      features: [
        'Up to 5 client workspaces',
        'Switch between clients instantly',
        'Per-client AI content & scheduling',
        'Per-client Facebook & Instagram connection',
        'AI-generated images for every post',
        'Smart AI Scheduler + Saturation Mode',
        'Per-client Insights & analytics',
        'Priority support',
      ],
      limitations: [],
      color: 'from-emerald-500 to-teal-600',
      badge: 'For Agencies',
    },
  ],
} as const;
`;
}
