/**
 * SocialAI Studio — PayPal YEARLY Subscription Setup Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates 4 yearly subscription plans under your EXISTING PayPal app.
 * Uses the same credentials as your monthly plans so they work together.
 *
 * Usage:
 *   PAYPAL_CLIENT_ID=<id> PAYPAL_CLIENT_SECRET=<secret> node scripts/setup-paypal-yearly.mjs
 *
 * Or set those in a .env file and run:
 *   node -r dotenv/config scripts/setup-paypal-yearly.mjs
 *
 * Outputs the paypalYearlyPlanIds block to paste into src/client.config.ts
 * and the env vars to add to Cloudflare Pages.
 */

const PAYPAL_BASE = 'https://api-m.paypal.com';
const SETUP_FEE   = '99.00';
const CURRENCY    = 'AUD';

// Yearly = 10 months price (2 months free)
const PLANS = [
  { id: 'starter', name: 'Starter (Yearly)',  yearlyPrice: '290.00', description: 'Starter plan — billed annually (save ~17%)' },
  { id: 'growth',  name: 'Growth (Yearly)',   yearlyPrice: '490.00', description: 'Growth plan — billed annually (save ~17%)' },
  { id: 'pro',     name: 'Pro (Yearly)',      yearlyPrice: '790.00', description: 'Pro plan — billed annually (save ~17%)' },
  { id: 'agency',  name: 'Agency (Yearly)',   yearlyPrice: '1490.00', description: 'Agency plan — billed annually (save ~17%)' },
];

function required(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`\n❌  Missing env var: ${name}`);
    console.error('    Set it before running this script.\n');
    process.exit(1);
  }
  return val;
}

async function getToken(clientId, clientSecret) {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = await res.json();
  if (!json.access_token) {
    console.error('\n❌  Failed to authenticate with PayPal. Check your credentials.\n');
    console.error(json);
    process.exit(1);
  }
  return json.access_token;
}

async function ppPost(path, body, token) {
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(`\n❌  PayPal API error on POST ${path}:`);
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

async function ppGet(path, token) {
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function main() {
  const clientId     = required('PAYPAL_CLIENT_ID');
  const clientSecret = required('PAYPAL_CLIENT_SECRET');

  console.log('\n🔑  Authenticating with PayPal…');
  const token = await getToken(clientId, clientSecret);
  console.log('    ✓ Token obtained\n');

  // Find existing product or create one
  console.log('📦  Looking for existing "SocialAI Studio" product…');
  const products = await ppGet('/v1/catalogs/products?page_size=20', token);
  let product = products.products?.find(p => p.name === 'SocialAI Studio');

  if (product) {
    console.log(`    ✓ Found existing product → ID: ${product.id}\n`);
  } else {
    console.log('    Not found — creating new product…');
    product = await ppPost('/v1/catalogs/products', {
      name:        'SocialAI Studio',
      description: 'AI-powered social media management — done for you.',
      type:        'SERVICE',
      category:    'SOFTWARE',
    }, token);
    console.log(`    ✓ Product created → ID: ${product.id}\n`);
  }

  // Check for existing yearly plans to avoid duplicates
  console.log('🔍  Checking for existing yearly plans…');
  const existingPlans = await ppGet('/v1/billing/plans?page_size=20&status=ACTIVE', token);
  const existingNames = new Set((existingPlans.plans || []).map(p => p.name));

  // Create yearly plans
  const yearlyPlanIds = {};

  for (const plan of PLANS) {
    const fullName = `SocialAI Studio — ${plan.name}`;
    if (existingNames.has(fullName)) {
      const existing = existingPlans.plans.find(p => p.name === fullName);
      console.log(`    ⚠️  "${plan.name}" already exists → ${existing.id} (skipping)`);
      yearlyPlanIds[plan.id] = existing.id;
      continue;
    }
    console.log(`💳  Creating "${plan.name}" plan ($${plan.yearlyPrice}/yr + $${SETUP_FEE} setup)…`);
    const result = await ppPost('/v1/billing/plans', {
      product_id:  product.id,
      name:        `SocialAI Studio — ${plan.name}`,
      description: plan.description,
      status:      'ACTIVE',
      billing_cycles: [
        {
          // recurring yearly subscription — starts immediately
          tenure_type:    'REGULAR',
          sequence:       1,
          total_cycles:   0,
          pricing_scheme: {
            fixed_price: { value: plan.yearlyPrice, currency_code: CURRENCY },
          },
          frequency: { interval_unit: 'YEAR', interval_count: 1 },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding:     true,
        setup_fee:                 { value: SETUP_FEE, currency_code: CURRENCY },
        setup_fee_failure_action:  'CANCEL',
        payment_failure_threshold: 1,
      },
    }, token);

    yearlyPlanIds[plan.id] = result.id;
    console.log(`    ✓ ${plan.name} → ${result.id}\n`);
  }

  const divider = '─'.repeat(70);
  console.log(divider);
  console.log('🎉  All yearly plans created!\n');

  console.log('── Paste into src/client.config.ts (replace existing paypalYearlyPlanIds) ──\n');
  console.log(`  paypalYearlyPlanIds: {`);
  for (const [id, planId] of Object.entries(yearlyPlanIds)) {
    console.log(`    ${id}: '${planId}',`);
  }
  console.log(`  },\n`);

  console.log('── Add to Cloudflare Pages → Settings → Environment variables ──────────\n');
  for (const [id, planId] of Object.entries(yearlyPlanIds)) {
    console.log(`  PAYPAL_PLAN_${id.toUpperCase().padEnd(8)}_YEARLY = ${planId}`);
  }
  console.log('\n' + divider);
}

main().catch(err => {
  console.error('\n❌  Unexpected error:', err.message);
  process.exit(1);
});
