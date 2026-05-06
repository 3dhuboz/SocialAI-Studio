#!/usr/bin/env node
/**
 * PayPal subscription diagnostic.
 *
 * Queries the live PayPal Billing API for every plan + the parent app, prints
 * the status of each, and points at the most likely cause when the hosted
 * checkout (hermes) shows "We're sorry. Things don't appear to be working".
 *
 * Usage:
 *   PAYPAL_CLIENT_ID=<id> PAYPAL_CLIENT_SECRET=<secret> \
 *     node scripts/diagnose-paypal.mjs
 *
 * Or with a .env file:
 *   node -r dotenv/config scripts/diagnose-paypal.mjs
 *
 * Get the credentials from https://developer.paypal.com/dashboard/applications/live
 */

const PAYPAL_BASE = 'https://api-m.paypal.com';

// Plan IDs baked into src/client.config.ts at the time of writing — keep in sync.
const PLAN_IDS = {
  monthly: {
    starter: 'P-1AB09838JG575723YNG3TKPY',
    growth:  'P-5JX42118D0152071LNG3TLDY',
    pro:     'P-0MN86219YF921874FNG3TLRY',
    agency:  'P-5VB80462AU714124YNG3TL7Q',
  },
  yearly: {
    starter: 'P-62C327553Y779300FNHDUU7Y',
    growth:  'P-60J02873W1559770VNHDUVAA',
    pro:     'P-6G9907746Y8649457NHDUVAA',
    agency:  'P-1BH48559DE324360CNHDUVAA',
  },
};

const clientId     = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Missing required env vars.\n');
  console.error('  PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required.');
  console.error('  Get them from https://developer.paypal.com/dashboard/applications/live\n');
  process.exit(1);
}

// ─── Get OAuth token ─────────────────────────────────────────────────────
const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
const tokenData = await tokenRes.json();
if (!tokenData.access_token) {
  console.error('PayPal auth failed:', tokenData);
  process.exit(1);
}
const token = tokenData.access_token;
console.log(`[diagnose] PayPal auth OK — querying ${tokenData.app_id}`);

// ─── Check each plan ─────────────────────────────────────────────────────
const issues = [];

async function checkPlan(label, planId) {
  const res = await fetch(`${PAYPAL_BASE}/v1/billing/plans/${planId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.details?.[0]?.description || err?.message || `HTTP ${res.status}`;
    console.log(`  ${label.padEnd(20)} ${planId}  ❌  ${msg}`);
    issues.push(`${label}: ${msg}`);
    return;
  }
  const plan = await res.json();
  const billingCycle = plan.billing_cycles?.[0];
  const interval = billingCycle?.frequency
    ? `${billingCycle.frequency.interval_count} ${billingCycle.frequency.interval_unit}`
    : 'no cycle?';
  const price = billingCycle?.pricing_scheme?.fixed_price;
  const priceStr = price ? `${price.value} ${price.currency_code}` : 'no price?';
  const setupFee = plan.payment_preferences?.setup_fee;
  const setupStr = setupFee ? `${setupFee.value} ${setupFee.currency_code}` : 'none';
  const productId = plan.product_id || '(none)';
  const status = plan.status;
  const icon = status === 'ACTIVE' ? '✅' : status === 'INACTIVE' ? '🟡' : '❌';
  console.log(`  ${label.padEnd(20)} ${planId}  ${icon} status=${status}  cycle=${interval}  price=${priceStr}  setup=${setupStr}  product=${productId}`);
  if (status !== 'ACTIVE') {
    issues.push(`${label} (${planId}) is ${status} — must be ACTIVE for checkout to work. Activate via: PATCH /v1/billing/plans/${planId}/activate`);
  }
  if (priceStr.includes('AUD') === false && priceStr.includes('no price') === false) {
    issues.push(`${label} (${planId}) is in ${price.currency_code} not AUD — currency mismatch can cause hermes to fail`);
  }
}

console.log('\n[diagnose] Monthly plans:');
for (const [label, id] of Object.entries(PLAN_IDS.monthly)) {
  await checkPlan(label, id);
}
console.log('\n[diagnose] Yearly plans:');
for (const [label, id] of Object.entries(PLAN_IDS.yearly)) {
  await checkPlan(`${label}-yearly`, id);
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log('');
if (issues.length === 0) {
  console.log('[diagnose] All plans look healthy. The "We\'re sorry" error in the hermes flow is probably:');
  console.log('  1. PayPal anti-fraud blocking the browser session (CDP debugging attached → hermes refuses)');
  console.log('  2. PayPal app domain restriction missing socialaistudio.au');
  console.log('     Check: https://developer.paypal.com/dashboard/applications/live');
  console.log('     → your live app → Live App settings → Allowed return URLs / domains');
  console.log('');
  console.log('Try the checkout in a clean Chrome window without the Claude extension/MCP attached first.');
} else {
  console.log('[diagnose] PROBLEMS FOUND:');
  for (const issue of issues) console.log(`  • ${issue}`);
  console.log('');
  console.log('To activate a plan that is in CREATED/INACTIVE state:');
  console.log('  curl -X POST -H "Authorization: Bearer $TOKEN" \\');
  console.log('       https://api-m.paypal.com/v1/billing/plans/{plan_id}/activate');
  console.log('Or use the PayPal dashboard:');
  console.log('  https://www.paypal.com/billing/plans → click the plan → Activate');
}
