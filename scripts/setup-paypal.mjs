/**
 * SocialAI Studio — PayPal Subscription Setup Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Automatically creates:
 *   1. A PayPal Product ("SocialAI Studio")
 *   2. Four subscription plans (Starter, Growth, Pro, Agency)
 *      each with a $99 one-time setup fee for new subscribers
 *
 * Usage:
 *   PAYPAL_CLIENT_ID=<id> PAYPAL_CLIENT_SECRET=<secret> node scripts/setup-paypal.mjs
 *
 * Or create a .env file in the project root with those two variables and run:
 *   node -r dotenv/config scripts/setup-paypal.mjs
 *
 * Outputs the exact paypalClientId + paypalPlanIds block to paste into
 * src/client.config.ts, plus the Netlify env var block to add to your dashboard.
 *
 * ⚠️  Use LIVE credentials for production.
 *     Swap PAYPAL_BASE to https://api-m.sandbox.paypal.com for sandbox testing.
 */

const PAYPAL_BASE = 'https://api-m.paypal.com'; // ← change to sandbox URL for testing
const SETUP_FEE   = '99.00';
const CURRENCY    = 'AUD';

const PLANS = [
  { id: 'starter', name: 'Starter',  price: '29.00', description: 'Up to 7 posts/week · AI captions · Facebook & Instagram scheduling' },
  { id: 'growth',  name: 'Growth',   price: '49.00', description: 'Up to 14 posts/week · AI images · Smart Scheduler' },
  { id: 'pro',     name: 'Pro',      price: '79.00', description: 'Up to 21 posts/week · AI images · Smart Scheduler + Saturation Mode · Video scripts' },
  { id: 'agency',  name: 'Agency',   price: '149.00', description: 'Up to 5 client workspaces · All Pro features per client · Priority support' },
];

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const clientId     = required('PAYPAL_CLIENT_ID');
  const clientSecret = required('PAYPAL_CLIENT_SECRET');

  console.log('\n🔑  Authenticating with PayPal…');
  const token = await getToken(clientId, clientSecret);
  console.log('    ✓ Token obtained\n');

  // 1 ── Create Product ──────────────────────────────────────────────────────
  console.log('📦  Creating PayPal Product "SocialAI Studio"…');
  const product = await ppPost('/v1/catalogs/products', {
    name:        'SocialAI Studio',
    description: 'AI-powered social media management — done for you.',
    type:        'SERVICE',
    category:    'SOFTWARE',
  }, token);
  console.log(`    ✓ Product created → ID: ${product.id}\n`);

  // 2 ── Create Subscription Plans ──────────────────────────────────────────
  const planIds = {};

  for (const plan of PLANS) {
    console.log(`💳  Creating "${plan.name}" plan ($${plan.price}/mo + $${SETUP_FEE} setup)…`);
    const result = await ppPost('/v1/billing/plans', {
      product_id:  product.id,
      name:        `SocialAI Studio — ${plan.name}`,
      description: plan.description,
      status:      'ACTIVE',
      billing_cycles: [
        {
          // ── one-time setup fee (charged on first billing cycle) ──
          tenure_type:    'TRIAL',
          sequence:       1,
          total_cycles:   1,
          pricing_scheme: {
            fixed_price: { value: SETUP_FEE, currency_code: CURRENCY },
          },
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
        },
        {
          // ── recurring monthly subscription ──
          tenure_type:    'REGULAR',
          sequence:       2,
          total_cycles:   0, // 0 = infinite
          pricing_scheme: {
            fixed_price: { value: plan.price, currency_code: CURRENCY },
          },
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding:     true,
        setup_fee_failure_action:  'CANCEL',
        payment_failure_threshold: 1,
      },
    }, token);

    planIds[plan.id] = result.id;
    console.log(`    ✓ ${plan.name} → ${result.id}\n`);
  }

  // 3 ── Print results ───────────────────────────────────────────────────────
  const divider = '─'.repeat(70);

  console.log(divider);
  console.log('🎉  All plans created successfully!\n');

  console.log('── Paste this into src/client.config.ts ─────────────────────────────────\n');
  console.log(`  paypalClientId: '${clientId}',`);
  console.log(`\n  paypalPlanIds: {`);
  for (const [id, planId] of Object.entries(planIds)) {
    console.log(`    ${id}: '${planId}',`);
  }
  console.log(`  },\n`);

  console.log('── Add these to Netlify → Site Settings → Env Vars ─────────────────────\n');
  console.log(`  PAYPAL_CLIENT_ID      = ${clientId}`);
  console.log(`  PAYPAL_CLIENT_SECRET  = ${clientSecret}`);
  for (const [id, planId] of Object.entries(planIds)) {
    console.log(`  PAYPAL_PLAN_${id.toUpperCase().padEnd(8)} = ${planId}`);
  }
  console.log('\n  PAYPAL_WEBHOOK_ID     = <paste after creating webhook below>\n');

  console.log('── Set up your PayPal Webhook ────────────────────────────────────────────\n');
  console.log('  1. Go to: https://developer.paypal.com/dashboard/webhooks');
  console.log('  2. Click "Add Webhook"');
  console.log('  3. URL: https://socialaistudio.au/.netlify/functions/paypal-webhook');
  console.log('  4. Events to subscribe:');
  console.log('       • BILLING.SUBSCRIPTION.ACTIVATED');
  console.log('       • BILLING.SUBSCRIPTION.CANCELLED');
  console.log('  5. Copy the Webhook ID → add as PAYPAL_WEBHOOK_ID in Netlify env vars\n');
  console.log(divider);
}

main().catch(err => {
  console.error('\n❌  Unexpected error:', err.message);
  process.exit(1);
});
