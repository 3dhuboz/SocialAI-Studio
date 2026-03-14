/**
 * PayPal Verify — subscription activation
 * POST body: { subscriptionId, uid, planId }
 *
 * Calls the PayPal REST API to confirm the subscription is ACTIVE,
 * then writes a pending_activations record to Firestore so the client
 * app can pick it up on next login (same pattern as the old Stripe webhook).
 *
 * Required Netlify env vars:
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *   FIREBASE_PROJECT_ID   (socialai-e22c2)
 *   FIREBASE_WEB_API_KEY  (public web API key)
 */

const PAYPAL_BASE = 'https://api-m.paypal.com';
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || 'socialai-e22c2';
const FIREBASE_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDEBOsFhVSuP2jjDU6RR6IcNNmW4o8n6fA';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

async function getPayPalToken() {
  const creds = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('Failed to obtain PayPal access token');
  return json.access_token;
}

async function getSubscription(subscriptionId, token) {
  const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return res.json();
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

async function fsSet(collection, docId, data) {
  const mask = Object.keys(data)
    .map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');
  const url = `${FS_BASE}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}&${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toFields(data)),
  });
  const json = await res.json();
  if (json.error) console.error('Firestore write error:', json.error);
  return json;
}

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { subscriptionId, uid, planId } = body;
  if (!subscriptionId || !planId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing subscriptionId or planId' }),
    };
  }

  try {
    const token = await getPayPalToken();
    const subscription = await getSubscription(subscriptionId, token);

    if (subscription.status !== 'ACTIVE') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: `Subscription not yet active (status: ${subscription.status}). Please wait a moment and try again.`,
        }),
      };
    }

    const customerEmail = subscription.subscriber?.email_address || '';
    const payerId = subscription.subscriber?.payer_id || '';
    const docId = uid || customerEmail || subscriptionId;

    await fsSet('pending_activations', docId, {
      plan: planId,
      email: customerEmail,
      paypalSubscriptionId: subscriptionId,
      paypalCustomerId: payerId,
      activatedAt: new Date().toISOString(),
      consumed: false,
    });

    console.log(`PayPal activation stored for ${docId} → plan: ${planId}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, plan: planId }),
    };
  } catch (err) {
    console.error('PayPal verify error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Verification failed. Please contact support.' }),
    };
  }
};
