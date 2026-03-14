/**
 * PayPal Webhook — subscription lifecycle events
 * Handles: BILLING.SUBSCRIPTION.ACTIVATED, BILLING.SUBSCRIPTION.CANCELLED
 *
 * Required Netlify env vars:
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *   PAYPAL_WEBHOOK_ID
 *   PAYPAL_PLAN_STARTER, PAYPAL_PLAN_GROWTH, PAYPAL_PLAN_PRO, PAYPAL_PLAN_AGENCY
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

async function verifyWebhookSignature(event, token) {
  const h = event.headers;
  const body = {
    auth_algo:         h['paypal-auth-algo'],
    cert_url:          h['paypal-cert-url'],
    transmission_id:   h['paypal-transmission-id'],
    transmission_sig:  h['paypal-transmission-sig'],
    transmission_time: h['paypal-transmission-time'],
    webhook_id:        process.env.PAYPAL_WEBHOOK_ID,
    webhook_event:     JSON.parse(event.body),
  };
  const res = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return json.verification_status === 'SUCCESS';
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

function planFromPayPalId(planId) {
  const map = {
    [process.env.PAYPAL_PLAN_STARTER]: 'starter',
    [process.env.PAYPAL_PLAN_GROWTH]:  'growth',
    [process.env.PAYPAL_PLAN_PRO]:     'pro',
    [process.env.PAYPAL_PLAN_AGENCY]:  'agency',
  };
  return map[planId] || null;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let webhookEvent;
  try {
    webhookEvent = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Verify webhook signature
  try {
    const token = await getPayPalToken();
    const valid = await verifyWebhookSignature(event, token);
    if (!valid) {
      console.error('PayPal webhook signature verification failed');
      return { statusCode: 400, body: 'Webhook signature invalid' };
    }
  } catch (err) {
    console.error('Webhook verification error:', err.message);
    return { statusCode: 400, body: `Verification error: ${err.message}` };
  }

  const resource  = webhookEvent.resource || {};
  const eventType = webhookEvent.event_type;

  // ── BILLING.SUBSCRIPTION.ACTIVATED ──────────────────────────────────────
  if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const subscriptionId = resource.id;
    const paypalPlanId   = resource.plan_id;
    const email          = resource.subscriber?.email_address || '';
    const payerId        = resource.subscriber?.payer_id || '';
    const plan           = planFromPayPalId(paypalPlanId);

    if (!plan) {
      console.warn('No plan matched for PayPal plan ID:', paypalPlanId);
      return { statusCode: 200, body: 'No plan matched — skipped.' };
    }

    const docId = email || subscriptionId;
    await fsSet('pending_activations', docId, {
      plan,
      email,
      paypalSubscriptionId: subscriptionId,
      paypalCustomerId:     payerId,
      activatedAt:          new Date().toISOString(),
      consumed:             false,
    });
    console.log(`PayPal activation stored for ${docId} → plan: ${plan}`);
  }

  // ── BILLING.SUBSCRIPTION.CANCELLED ──────────────────────────────────────
  if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
    const subscriptionId = resource.id;
    const email          = resource.subscriber?.email_address || '';
    const docId          = email || subscriptionId;

    await fsSet('pending_cancellations', docId, {
      paypalSubscriptionId: subscriptionId,
      cancelledAt:          new Date().toISOString(),
      consumed:             false,
    });
    console.log(`PayPal cancellation stored for ${docId}`);
  }

  return { statusCode: 200, body: 'OK' };
};
