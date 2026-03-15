/**
 * Cloudflare Pages Function — PayPal webhook (subscription lifecycle)
 * Available at: /api/paypal-webhook
 *
 * Required env vars: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID,
 *                    PAYPAL_PLAN_STARTER, PAYPAL_PLAN_GROWTH, PAYPAL_PLAN_PRO, PAYPAL_PLAN_AGENCY,
 *                    FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY
 */

const PAYPAL_BASE = 'https://api-m.paypal.com';
const FROM = 'Social AI Studio <noreply@socialaistudio.au>';
const ADMIN_EMAIL = 'steve@pennywiseit.com.au';

async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
  } catch (e) { console.error('Email send error:', e.message); }
}

function welcomeHtml(email, plan) {
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-flex;align-items:center;gap:10px;background:#111118;border:1px solid #1f2937;border-radius:50px;padding:10px 20px;">
        <span style="font-size:18px;">✨</span>
        <span style="color:#f59e0b;font-weight:800;font-size:15px;">Social AI Studio</span>
      </div>
    </div>
    <div style="background:linear-gradient(135deg,#f59e0b22,#ef444411);border:1px solid #f59e0b33;border-radius:20px;padding:40px 32px;text-align:center;margin-bottom:24px;">
      <div style="font-size:48px;margin-bottom:16px;">🎉</div>
      <h1 style="color:#ffffff;font-size:26px;font-weight:900;margin:0 0 12px;">You're all set!</h1>
      <p style="color:#9ca3af;font-size:15px;line-height:1.6;margin:0 0 24px;">Your <strong style="color:#f59e0b;">${planName} Plan</strong> is now active. Welcome to Social AI Studio — let's grow your social media together.</p>
      <a href="https://socialaistudio.au" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#000;font-weight:900;font-size:14px;padding:14px 32px;border-radius:50px;text-decoration:none;">Open Dashboard →</a>
    </div>
    <div style="background:#111118;border:1px solid #1f2937;border-radius:16px;padding:24px 28px;margin-bottom:16px;">
      <h2 style="color:#ffffff;font-size:14px;font-weight:700;margin:0 0 16px;">What happens next?</h2>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${['Log in and complete your business profile','Connect your Facebook &amp; Instagram pages','Generate your first AI post and schedule it'].map((s,i) => `<div style="display:flex;align-items:center;gap:12px;"><div style="width:24px;height:24px;background:#f59e0b22;border:1px solid #f59e0b44;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#f59e0b;font-size:11px;font-weight:700;flex-shrink:0;">${i+1}</div><span style="color:#d1d5db;font-size:13px;">${s}</span></div>`).join('')}
      </div>
    </div>
    <p style="text-align:center;color:#374151;font-size:11px;margin:0;">Questions? <a href="mailto:support@pennywiseit.com.au" style="color:#f59e0b;text-decoration:none;">support@pennywiseit.com.au</a> · <a href="https://socialaistudio.au" style="color:#f59e0b;text-decoration:none;">socialaistudio.au</a></p>
  </div>
</body></html>`;
}

function cancellationHtml(email) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-flex;align-items:center;gap:10px;background:#111118;border:1px solid #1f2937;border-radius:50px;padding:10px 20px;">
        <span style="font-size:18px;">✨</span>
        <span style="color:#f59e0b;font-weight:800;font-size:15px;">Social AI Studio</span>
      </div>
    </div>
    <div style="background:#111118;border:1px solid #374151;border-radius:20px;padding:40px 32px;text-align:center;margin-bottom:24px;">
      <h1 style="color:#ffffff;font-size:22px;font-weight:900;margin:0 0 12px;">Subscription Cancelled</h1>
      <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 24px;">Your Social AI Studio subscription has been cancelled. You'll retain access until the end of your current billing period.</p>
      <p style="color:#6b7280;font-size:13px;margin:0;">Changed your mind? <a href="https://socialaistudio.au" style="color:#f59e0b;text-decoration:none;">Reactivate your plan</a> anytime.</p>
    </div>
    <p style="text-align:center;color:#374151;font-size:11px;margin:0;">Questions? <a href="mailto:support@pennywiseit.com.au" style="color:#f59e0b;text-decoration:none;">support@pennywiseit.com.au</a></p>
  </div>
</body></html>`;
}

function getFirebaseBase(env) {
  const project = env.FIREBASE_PROJECT_ID;
  const key = env.FIREBASE_WEB_API_KEY;
  if (!project || !key) throw new Error('FIREBASE_PROJECT_ID and FIREBASE_WEB_API_KEY env vars are required');
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
    if (email) {
      await sendEmail(env, { to: email, subject: `Welcome to Social AI Studio — your ${plan} plan is active!`, html: welcomeHtml(email, plan) });
      await sendEmail(env, { to: ADMIN_EMAIL, subject: `New subscriber: ${email} — ${plan} plan`, html: `<p>New PayPal subscription activated.</p><p><strong>Email:</strong> ${email}<br><strong>Plan:</strong> ${plan}<br><strong>Subscription ID:</strong> ${subscriptionId}</p>` });
    }
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
    if (email) {
      await sendEmail(env, { to: email, subject: 'Your Social AI Studio subscription has been cancelled', html: cancellationHtml(email) });
      await sendEmail(env, { to: ADMIN_EMAIL, subject: `Cancellation: ${email}`, html: `<p>PayPal subscription cancelled.</p><p><strong>Email:</strong> ${email}<br><strong>Subscription ID:</strong> ${subscriptionId}</p>` });
    }
  }

  return new Response('OK', { status: 200 });
}
