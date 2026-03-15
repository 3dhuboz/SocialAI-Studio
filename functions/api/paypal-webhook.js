/**
 * Cloudflare Pages Function — PayPal webhook (subscription lifecycle)
 * Available at: /api/paypal-webhook
 *
 * Required env vars: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID,
 *                    PAYPAL_PLAN_STARTER, PAYPAL_PLAN_GROWTH, PAYPAL_PLAN_PRO, PAYPAL_PLAN_AGENCY,
 *                    FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY
 */

const PAYPAL_BASE = 'https://api-m.paypal.com';

function getFirebaseBase(env) {
  const project = env.FIREBASE_PROJECT_ID || 'socialai-e22c2';
  const key = env.FIREBASE_WEB_API_KEY || 'AIzaSyDEBOsFhVSuP2jjDU6RR6IcNNmW4o8n6fA';
  return { base: `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`, key };
}

async function getPayPalToken(env) {
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to obtain PayPal access token');
  return data.access_token;
}

async function verifyWebhookSignature(request, rawBody, token, env) {
  const body = {
    auth_algo:         request.headers.get('paypal-auth-algo'),
    cert_url:          request.headers.get('paypal-cert-url'),
    transmission_id:   request.headers.get('paypal-transmission-id'),
    transmission_sig:  request.headers.get('paypal-transmission-sig'),
    transmission_time: request.headers.get('paypal-transmission-time'),
    webhook_id:        env.PAYPAL_WEBHOOK_ID,
    webhook_event:     JSON.parse(rawBody),
  };
  const res = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
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

function planFromPayPalId(planId, env) {
  const map = {
    [env.PAYPAL_PLAN_STARTER]: 'starter',
    [env.PAYPAL_PLAN_GROWTH]:  'growth',
    [env.PAYPAL_PLAN_PRO]:     'pro',
    [env.PAYPAL_PLAN_AGENCY]:  'agency',
  };
  return map[planId] || null;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const rawBody = await request.text();
  let webhookEvent;
  try { webhookEvent = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }

  try {
    const token = await getPayPalToken(env);
    const valid = await verifyWebhookSignature(request, rawBody, token, env);
    if (!valid) {
      console.error('PayPal webhook signature verification failed');
      return new Response('Webhook signature invalid', { status: 400 });
    }
  } catch (err) {
    console.error('Webhook verification error:', err.message);
    return new Response(`Verification error: ${err.message}`, { status: 400 });
  }

  const resource  = webhookEvent.resource || {};
  const eventType = webhookEvent.event_type;

  if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const subscriptionId = resource.id;
    const paypalPlanId   = resource.plan_id;
    const email          = resource.subscriber?.email_address || '';
    const payerId        = resource.subscriber?.payer_id || '';
    const plan           = planFromPayPalId(paypalPlanId, env);

    if (!plan) {
      console.warn('No plan matched for PayPal plan ID:', paypalPlanId);
      return new Response('No plan matched — skipped.', { status: 200 });
    }

    const docId = email || subscriptionId;
    await fsSet(env, 'pending_activations', docId, {
      plan, email,
      paypalSubscriptionId: subscriptionId,
      paypalCustomerId: payerId,
      activatedAt: new Date().toISOString(),
      consumed: false,
    });
    console.log(`PayPal activation stored for ${docId} → plan: ${plan}`);
  }

  if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
    const subscriptionId = resource.id;
    const email          = resource.subscriber?.email_address || '';
    const docId          = email || subscriptionId;

    await fsSet(env, 'pending_cancellations', docId, {
      paypalSubscriptionId: subscriptionId,
      cancelledAt: new Date().toISOString(),
      consumed: false,
    });
    console.log(`PayPal cancellation stored for ${docId}`);
  }

  return new Response('OK', { status: 200 });
}
