import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialise Firebase Admin (once per cold start)
function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

/**
 * Map a Stripe Price ID to a plan tier.
 * Set STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH, STRIPE_PRICE_PRO,
 * STRIPE_PRICE_AGENCY as Netlify env vars.
 */
function planFromPriceId(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_STARTER]: 'starter',
    [process.env.STRIPE_PRICE_GROWTH]: 'growth',
    [process.env.STRIPE_PRICE_PRO]: 'pro',
    [process.env.STRIPE_PRICE_AGENCY]: 'agency',
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
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const customerEmail = session.customer_details?.email || session.customer_email;
    const clientRef = session.client_reference_id; // format: "uid:plan" or just "plan"

    // Determine plan — prefer client_reference_id, fall back to price lookup
    let plan = null;
    let uid = null;

    if (clientRef) {
      if (clientRef.includes(':')) {
        [uid, plan] = clientRef.split(':');
      } else {
        plan = clientRef; // just a plan name passed directly
      }
    }

    // If no plan from client_reference_id, try to get from line items
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

    const db = getDb();

    // If we have a UID from client_reference_id, update directly
    if (uid) {
      await db.collection('users').doc(uid).set(
        { plan, setupStatus: 'live', stripeCustomerId: session.customer || null },
        { merge: true }
      );
      console.log(`Plan ${plan} activated for uid ${uid}`);
      return { statusCode: 200, body: 'OK' };
    }

    // Otherwise find the user by email
    if (!customerEmail) {
      console.warn('No customer email in session:', session.id);
      return { statusCode: 200, body: 'No email — skipped.' };
    }

    const usersSnap = await db.collection('users')
      .where('email', '==', customerEmail)
      .limit(1)
      .get();

    if (!usersSnap.empty) {
      await usersSnap.docs[0].ref.set(
        { plan, setupStatus: 'live', stripeCustomerId: session.customer || null },
        { merge: true }
      );
      console.log(`Plan ${plan} activated for ${customerEmail}`);
    } else {
      // Store pending activation — app picks it up on next login
      await db.collection('pending_activations').doc(customerEmail).set({
        plan,
        stripeCustomerId: session.customer || null,
        activatedAt: new Date().toISOString(),
      });
      console.log(`Pending activation stored for ${customerEmail}`);
    }
  }

  if (stripeEvent.type === 'customer.subscription.deleted') {
    const sub = stripeEvent.data.object;
    const customerId = sub.customer;
    if (customerId) {
      const usersSnap = await getDb().collection('users')
        .where('stripeCustomerId', '==', customerId)
        .limit(1)
        .get();
      if (!usersSnap.empty) {
        await usersSnap.docs[0].ref.set({ plan: null, setupStatus: 'cancelled' }, { merge: true });
        console.log(`Plan cancelled for customer ${customerId}`);
      }
    }
  }

  return { statusCode: 200, body: 'OK' };
};
