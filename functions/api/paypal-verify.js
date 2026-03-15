/**
 * Cloudflare Pages Function — PayPal subscription verification
 * Available at: /api/paypal-verify
 *
 * Required env vars: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
 *                    FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY
 */

const PAYPAL_BASE = 'https://api-m.paypal.com';

function getFirebaseBase(env) {
  const project = env.FIREBASE_PROJECT_ID || 'socialai-e22c2';
  const key = env.FIREBASE_WEB_API_KEY || 'AIzaSyDEBOsFhVSuP2jjDU6RR6IcNNmW4o8n6fA';
  return { base: `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`, key };
}

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

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else fields[k] = { stringValue: String(v) };
  }
  return { fields };
}

async function fsSet(env, collection, docId, data) {
  const { base, key } = getFirebaseBase(env);
  const mask = Object.keys(data).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${base}/${collection}/${encodeURIComponent(docId)}?key=${key}&${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toFields(data)),
  });
  const json = await res.json();
  if (json.error) console.error('Firestore write error:', json.error);
  return json;
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
    const docId = uid || customerEmail || subscriptionId;

    await fsSet(env, 'pending_activations', docId, {
      plan: planId,
      email: customerEmail,
      paypalSubscriptionId: subscriptionId,
      paypalCustomerId: payerId,
      activatedAt: new Date().toISOString(),
      consumed: false,
    });

    return jsonRes({ success: true, plan: planId });
  } catch (err) {
    console.error('PayPal verify error:', err);
    return jsonRes({ error: 'Verification failed. Please contact support.' }, 500);
  }
}
