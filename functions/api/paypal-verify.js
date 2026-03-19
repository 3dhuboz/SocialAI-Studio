/**
 * Cloudflare Pages Function — PayPal subscription verification
 * Available at: /api/paypal-verify
 *
 * Required env vars: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, VITE_AI_WORKER_URL
 */

const WORKER_URL = 'https://socialai-api.steve-700.workers.dev';
const PAYPAL_BASE = 'https://api-m.paypal.com';

async function getPayPalToken(env) {
  // btoa() works in CF Workers (no Buffer available)
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('Failed to obtain PayPal access token');
  return json.access_token;
}


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: corsHeaders });
  if (request.method !== 'POST') return jsonRes({ error: 'Method Not Allowed' }, 405);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400); }

  const { subscriptionId, uid, planId } = body;
  if (!subscriptionId || !planId) return jsonRes({ error: 'Missing subscriptionId or planId' }, 400);

  try {
    const token = await getPayPalToken(env);
    const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const subscription = await res.json();

    if (subscription.status !== 'ACTIVE') {
      return jsonRes({ error: `Subscription not yet active (status: ${subscription.status}). Please wait and try again.` }, 400);
    }

    const customerEmail = subscription.subscriber?.email_address || '';
    const payerId = subscription.subscriber?.payer_id || '';

    const workerUrl = env.VITE_AI_WORKER_URL || WORKER_URL;
    await fetch(`${workerUrl}/api/internal/activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planId, email: customerEmail, paypalSubscriptionId: subscriptionId, paypalCustomerId: payerId, activatedAt: new Date().toISOString() }),
    }).catch(e => console.error('D1 activation store failed:', e.message));

    return jsonRes({ success: true, plan: planId });
  } catch (err) {
    console.error('PayPal verify error:', err);
    return jsonRes({ error: 'Verification failed. Please contact support.' }, 500);
  }
}
