#!/usr/bin/env node
/**
 * Whitelabel portal provisioning CLI — Phase B-Lite.
 *
 * Atomically creates the database side of a new whitelabel portal:
 *   - clients row (the agency-managed client workspace)
 *   - portal row (the slug → email/password/portal_token mapping)
 *
 * Then prints the env-var block the human still needs to paste into the new
 * CF Pages project, plus the remaining manual steps (CF Pages project
 * creation, custom domain, Clerk auto-login user, client.configs/<slug>.ts).
 *
 * The CF Pages, GitHub, and Clerk admin API integrations are deferred until
 * those credentials are wired in (see .windsurf/workflows/phase-b-portal-automation.md).
 *
 * Usage:
 *   FACTS_BOOTSTRAP_SECRET=<secret> \
 *   OWNER_USER_ID=<your-clerk-user-id> \
 *   node scripts/provision-portal.mjs \
 *     --slug newclient \
 *     --businessName "New Client" \
 *     --businessType florist \
 *     --autoLoginEmail client@socialaistudio.au \
 *     --customDomain social.newclient.com.au
 *
 * The autoLoginPassword is auto-generated and printed — copy it BEFORE
 * losing the terminal output. It also goes into VITE_AUTO_LOGIN_PASSWORD
 * on the CF Pages project AND becomes the password on the Clerk user
 * you'll create manually.
 */

import { randomBytes } from 'node:crypto';

const WORKER = process.env.AI_WORKER_URL || 'https://socialai-api.steve-700.workers.dev';
const SECRET = process.env.FACTS_BOOTSTRAP_SECRET;
const OWNER  = process.env.OWNER_USER_ID;

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

console.log('\n[provision] Env vars to paste into the new CF Pages project:');
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

console.log('\n[provision] Done. Save this output — the autoLoginPassword is not stored anywhere we can recover it from.');
