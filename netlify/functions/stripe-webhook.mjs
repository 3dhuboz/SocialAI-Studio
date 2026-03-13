import Stripe from 'stripe';

/**
 * Stripe Webhook — Firestore REST API edition
 * No Firebase Admin SDK / service account keys required.
 * Uses Firestore REST API with the public web API key.
 * Writes to pending_activations / pending_cancellations collections
 * which the client app picks up on next login.
 *
 * Required Netlify env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH, STRIPE_PRICE_PRO, STRIPE_PRICE_AGENCY
 *   FIREBASE_PROJECT_ID     (socialai-e22c2)
 *   FIREBASE_WEB_API_KEY    (public web API key — already in frontend)
 */

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || 'socialai-e22c2';
const FIREBASE_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDEBOsFhVSuP2jjDU6RR6IcNNmW4o8n6fA';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

/** Convert a flat JS object → Firestore REST field map */
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

/** PATCH (merge) a Firestore document via REST */
async function fsSet(collection, docId, data) {
  const mask = Object.keys(data).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
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

/** Map Stripe Price ID → plan tier */
function planFromPriceId(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_STARTER]: 'starter',
    [process.env.STRIPE_PRICE_GROWTH]:  'growth',
    [process.env.STRIPE_PRICE_PRO]:     'pro',
    [process.env.STRIPE_PRICE_AGENCY]:  'agency',
  };
  return map[priceId] || null;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });
  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // ── checkout.session.completed → activate plan ──────────────────────────
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const customerEmail = session.customer_details?.email || session.customer_email || null;
    const clientRef = session.client_reference_id || '';

    let plan = null;
    let uid = null;

    if (clientRef.includes(':')) {
      [uid, plan] = clientRef.split(':');
    } else if (clientRef) {
      plan = clientRef;
    }

    if (!plan) {
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
        for (const item of lineItems.data) {
          const found = planFromPriceId(item.price?.id);
          if (found) { plan = found; break; }
        }
      } catch (e) {
        console.warn('Could not fetch line items:', e.message);
      }
    }

    if (!plan) {
      console.warn('No plan found for session:', session.id);
      return { statusCode: 200, body: 'No plan identified — skipped.' };
    }

    const payload = {
      plan,
      email: customerEmail || '',
      stripeCustomerId: session.customer || '',
      stripeEventId: stripeEvent.id,
      activatedAt: new Date().toISOString(),
      consumed: false,
    };

    // Key by UID if we have it, otherwise by email
    const docId = uid || customerEmail || session.id;
    await fsSet('pending_activations', docId, payload);
    console.log(`Pending activation stored for ${docId} → plan: ${plan}`);
  }

  // ── customer.subscription.deleted → cancel plan ─────────────────────────
  if (stripeEvent.type === 'customer.subscription.deleted') {
    const sub = stripeEvent.data.object;
    const customerId = sub.customer;
    if (customerId) {
      await fsSet('pending_cancellations', customerId, {
        stripeCustomerId: customerId,
        cancelledAt: new Date().toISOString(),
        consumed: false,
      });
      console.log(`Pending cancellation stored for ${customerId}`);
    }
  }

  return { statusCode: 200, body: 'OK' };
};
