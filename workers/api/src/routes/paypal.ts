// PayPal subscription + credit-pack HTTP endpoints.
//
// POST /api/paypal-verify             — frontend onApprove → verify with PayPal,
//                                        insert pending_activations, send welcome email
// POST /api/paypal-credit-pack-confirm — one-shot credit pack purchase (verify
//                                        order, credit reel_credits, audit-log)
// POST /api/paypal-webhook            — PayPal-side lifecycle signal (ACTIVATED,
//                                        CANCELLED, SALE.COMPLETED). Signature-
//                                        verified. Mirrors event into payments
//                                        via recordPaymentEvent for audit
// POST /api/admin/paypal-diagnose     — admin tool: queries every configured plan
//                                        and surfaces ACTIVE/inactive + currency
//                                        mismatches (caught the "hermes 'We're
//                                        sorry'" failure mode in production)
//
// All shared helpers (auth, sig verify, plan maps, payment mirror) live in
// lib/paypal.ts. /api/health/onboarding still depends on paypalAccessToken —
// that move follows in the same commit as part of the routes/health.ts update.
//
// Dropped: a stale duplicate /api/paypal-verify at line ~2774 of pre-extract
// index.ts. Hono first-match wins, so the second registration was dead code.
//
// Extracted from src/index.ts as Phase B step 19 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';
import { sendResendEmail } from '../lib/email';
import {
  PAYPAL_API_BASE,
  PAYPAL_PLAN_TIER,
  PAYPAL_YEARLY_PLAN_IDS,
  REEL_CREDIT_PACKS,
  ADMIN_NOTIFY_EMAIL,
  paypalAccessToken,
  paypalVerifyWebhookSignature,
  recordPaymentEvent,
  welcomeEmailHtml,
  cancellationEmailHtml,
} from '../lib/paypal';

const uuid = () => crypto.randomUUID();

export function registerPaypalRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── PayPal: Verify subscription ─────────────────────────────────────────────
  // Called from the frontend (PricingTable.tsx) immediately after PayPal's
  // onApprove fires. Confirms with PayPal that the subscription is active,
  // stores a pending activation in D1 (consumed by App.tsx on the user's
  // next render), and sends the welcome email so it goes out even when the
  // PayPal webhook doesn't fire (or fires late).
  app.post('/api/paypal-verify', async (c) => {
    const body = await c.req.json<{ subscriptionId?: string; uid?: string | null; planId?: string }>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);
    const { subscriptionId, planId } = body;
    if (!subscriptionId || !planId) return c.json({ error: 'Missing subscriptionId or planId' }, 400);

    try {
      const token = await paypalAccessToken(c.env);
      const res = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const sub = await res.json() as { status?: string; subscriber?: { email_address?: string; payer_id?: string } };
      if (sub.status !== 'ACTIVE') {
        return c.json({ error: `Subscription not yet active (status: ${sub.status}). Please wait and try again.` }, 400);
      }

      const email = sub.subscriber?.email_address || '';
      const payerId = sub.subscriber?.payer_id || '';
      const id = uuid();
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO pending_activations (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed)
         VALUES (?,?,?,?,?,?,0)`
      ).bind(id, planId, email, subscriptionId, payerId, new Date().toISOString()).run();

      // Send welcome email here (don't wait for the webhook — it's the safety net,
      // not the primary signal). Skipped silently if RESEND_API_KEY isn't set.
      if (email) {
        await sendResendEmail(c.env, {
          to: email,
          subject: `Welcome to Social AI Studio — your ${planId} plan is active!`,
          html: welcomeEmailHtml(planId),
        });
        await sendResendEmail(c.env, {
          to: ADMIN_NOTIFY_EMAIL,
          subject: `New subscriber: ${email} — ${planId} plan`,
          html: `<p>New PayPal subscription activated.</p><p><strong>Email:</strong> ${email}<br><strong>Plan:</strong> ${planId}<br><strong>Subscription ID:</strong> ${subscriptionId}</p>`,
        });
      }

      return c.json({ success: true, plan: planId });
    } catch (err: any) {
      console.error('PayPal verify error:', err?.message || err);
      return c.json({ error: 'Verification failed. Please contact support.' }, 500);
    }
  });

  // ── PayPal: Credit pack capture confirmation ─────────────────────────────────
  // Frontend's PayPal Smart Buttons render an order client-side and onApprove
  // hands us the orderID. Trust nothing from the client — fetch the order from
  // PayPal directly, verify it's actually paid and the amount matches our
  // canonical price for the requested pack size, then credit the user.
  //
  // Idempotency: payments.paypal_capture_id is the unique key (PayPal order_id
  // for captures). Replays of the same orderID won't double-credit.
  app.post('/api/paypal-credit-pack-confirm', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json<{ orderId?: string; packId?: string; clientId?: string | null }>().catch(() => null);
    if (!body?.orderId || !body?.packId) return c.json({ error: 'Missing orderId or packId' }, 400);
    const pack = REEL_CREDIT_PACKS[body.packId];
    if (!pack) return c.json({ error: `Unknown pack: ${body.packId}` }, 400);

    // Idempotency check — if we've already processed this order, return success
    // without re-crediting. Lets the frontend safely retry on flaky network.
    const existing = await c.env.DB.prepare(
      `SELECT 1 FROM payments WHERE paypal_capture_id = ? LIMIT 1`
    ).bind(body.orderId).first();
    if (existing) {
      console.log(`[credit-pack] order ${body.orderId} already processed — idempotent return`);
      return c.json({ success: true, credits_added: 0, already_processed: true });
    }

    try {
      const token = await paypalAccessToken(c.env);
      const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${body.orderId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const order = await orderRes.json() as any;
      if (!orderRes.ok) {
        console.error(`[credit-pack] PayPal lookup ${body.orderId} returned ${orderRes.status}: ${JSON.stringify(order)}`);
        return c.json({ error: 'Could not verify order with PayPal — please contact support if you were charged.' }, 502);
      }
      if (order.status !== 'COMPLETED' && order.status !== 'APPROVED') {
        return c.json({ error: `Order not yet captured (status: ${order.status}). Try again in a moment.` }, 400);
      }
      // Validate amount + currency against canonical pack price.
      const unit = order.purchase_units?.[0];
      const captureAmount = unit?.payments?.captures?.[0]?.amount || unit?.amount;
      const paidValue = parseFloat(captureAmount?.value ?? '0');
      const paidCurrency = captureAmount?.currency_code || '';
      if (!Number.isFinite(paidValue) || Math.abs(paidValue - pack.amount) > 0.01 || paidCurrency !== pack.currency) {
        console.warn(`[credit-pack] amount mismatch for ${body.orderId}: paid ${paidValue} ${paidCurrency}, expected ${pack.amount} ${pack.currency}`);
        return c.json({ error: 'Order amount does not match pack price. If you were charged, please contact support.' }, 400);
      }

      // Credit the appropriate workspace — client_id passed by frontend if the
      // user is in an agency-managed client view (Agency plan); otherwise the
      // user's own balance. Both columns share the same semantics.
      const targetClientId = body.clientId || null;
      if (targetClientId) {
        // Verify client belongs to this user before crediting (no privilege escalation).
        const ok = await c.env.DB.prepare(`SELECT 1 FROM clients WHERE id = ? AND user_id = ? LIMIT 1`)
          .bind(targetClientId, uid).first();
        if (!ok) return c.json({ error: 'Invalid clientId for this user.' }, 403);
        await c.env.DB.prepare(
          `UPDATE clients SET reel_credits = COALESCE(reel_credits, 0) + ? WHERE id = ? AND user_id = ?`
        ).bind(pack.credits, targetClientId, uid).run();
      } else {
        await c.env.DB.prepare(
          `UPDATE users SET reel_credits = COALESCE(reel_credits, 0) + ? WHERE id = ?`
        ).bind(pack.credits, uid).run();
      }

      // Audit-trail row in payments. Reuse the existing schema: event_type
      // 'CREDIT_PACK_PURCHASE' is new but the column is free-form text.
      const captureId = unit?.payments?.captures?.[0]?.id || body.orderId;
      const email = order.payer?.email_address || null;
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO payments
           (id, paypal_event_id, paypal_subscription_id, paypal_capture_id,
            email, user_id, plan, event_type, amount_cents, currency, status,
            raw_event, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        uuid(), `credit_pack:${captureId}`, null, body.orderId,
        email, uid, null, 'CREDIT_PACK_PURCHASE',
        Math.round(pack.amount * 100), pack.currency, 'completed',
        JSON.stringify({ pack: body.packId, credits: pack.credits, clientId: targetClientId }).slice(0, 8000),
        new Date().toISOString(),
      ).run();

      console.log(`[credit-pack] credited ${pack.credits} reels to ${targetClientId ? `client ${targetClientId}` : `user ${uid}`} (pack: ${body.packId}, order: ${body.orderId})`);
      return c.json({ success: true, credits_added: pack.credits });
    } catch (err: any) {
      console.error('[credit-pack] confirm error:', err?.message || err);
      return c.json({ error: 'Server error confirming purchase. If you were charged, please contact support.' }, 500);
    }
  });

  // ── PayPal: Webhook (subscription lifecycle from PayPal) ────────────────────
  // PayPal posts subscription events (ACTIVATED, CANCELLED) here. Public
  // endpoint — protected by signature verification against PAYPAL_WEBHOOK_ID.
  // Acts as the safety-net for /api/paypal-verify in case the user closes the
  // browser tab mid-flow.
  app.post('/api/paypal-webhook', async (c) => {
    const rawBody = await c.req.raw.text();
    let event: any;
    try { event = JSON.parse(rawBody); } catch { return c.text('Invalid JSON', 400); }

    try {
      const token = await paypalAccessToken(c.env);
      const valid = await paypalVerifyWebhookSignature(c.req.raw, rawBody, token, c.env);
      if (!valid) {
        console.error('PayPal webhook signature verification failed');
        return c.text('Webhook signature invalid', 400);
      }
    } catch (err: any) {
      console.error('Webhook verification error:', err?.message || err);
      return c.text('Webhook verification failed', 400);
    }

    const resource = event.resource || {};
    const eventType = event.event_type;

    if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      const subscriptionId = resource.id;
      const paypalPlanId = resource.plan_id;
      const email = resource.subscriber?.email_address || '';
      const payerId = resource.subscriber?.payer_id || '';
      const plan = PAYPAL_PLAN_TIER[paypalPlanId];
      if (!plan) {
        console.warn('No plan matched for PayPal plan ID:', paypalPlanId);
        return c.text('No plan matched — skipped.', 200);
      }
      const billingCycle = PAYPAL_YEARLY_PLAN_IDS.has(paypalPlanId) ? 'yearly' : 'monthly';

      const id = uuid();
      // INSERT OR IGNORE — verify endpoint may have already created the row.
      // Keying on subscription_id would be cleaner but the existing schema uses
      // a uuid primary key; the consumed flag handles double-consumption.
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO pending_activations (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed, billing_cycle)
         VALUES (?,?,?,?,?,?,0,?)`
      ).bind(id, plan, email, subscriptionId, payerId, new Date().toISOString(), billingCycle).run();
      // If a verify-endpoint row already exists, patch in billing_cycle so the
      // frontend's consumeActivation flow propagates it to the users row.
      await c.env.DB.prepare(
        `UPDATE pending_activations SET billing_cycle = COALESCE(billing_cycle, ?)
         WHERE paypal_subscription_id = ? AND consumed = 0`
      ).bind(billingCycle, subscriptionId).run();
      console.log(`PayPal activation stored for ${email || subscriptionId} → plan: ${plan} (${billingCycle})`);

      if (email) {
        await sendResendEmail(c.env, { to: email, subject: `Welcome to Social AI Studio — your ${plan} plan is active!`, html: welcomeEmailHtml(plan) });
        await sendResendEmail(c.env, { to: ADMIN_NOTIFY_EMAIL, subject: `New subscriber: ${email} — ${plan} plan`, html: `<p>New PayPal subscription activated.</p><p><strong>Email:</strong> ${email}<br><strong>Plan:</strong> ${plan} (${billingCycle})<br><strong>Subscription ID:</strong> ${subscriptionId}</p>` });
      }
    }

    // PAYMENT.SALE.COMPLETED grants reel credits — but the grant is gated on
    // the audit-trail INSERT below (recordPaymentEvent) actually inserting a
    // new row. PayPal retries the same webhook up to 25 times; without that
    // gate we'd double-grant on every retry. See recordPaymentEvent for the
    // gating logic.

    if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
      const subscriptionId = resource.id;
      const email = resource.subscriber?.email_address || '';
      const id = uuid();
      await c.env.DB.prepare(
        `INSERT INTO pending_cancellations (id, email, paypal_subscription_id, cancelled_at, consumed)
         VALUES (?,?,?,?,0)`
      ).bind(id, email ?? null, subscriptionId ?? null, new Date().toISOString()).run();
      console.log(`PayPal cancellation stored for ${email || subscriptionId}`);

      if (email) {
        await sendResendEmail(c.env, { to: email, subject: 'Your Social AI Studio subscription has been cancelled', html: cancellationEmailHtml() });
        await sendResendEmail(c.env, { to: ADMIN_NOTIFY_EMAIL, subject: `Cancellation: ${email}`, html: `<p>PayPal subscription cancelled.</p><p><strong>Email:</strong> ${email}<br><strong>Subscription ID:</strong> ${subscriptionId}</p>` });
      }
    }

    // Audit-trail mirror — every event we care about gets a row in `payments`.
    // Append-only, dedup'd by paypal_event_id. The admin Customers dashboard
    // and the customer Billing screen read from this table; the `pending_*`
    // tables stay short-lived (consumed-then-ignored).
    try {
      await recordPaymentEvent(c, event);
    } catch (e) {
      console.error('recordPaymentEvent failed (webhook continues):', String(e));
    }

    return c.text('OK', 200);
  });

  // ── Admin: PayPal Diagnose ──────────────────────────────────────────────────
  // Queries every configured PayPal plan and surfaces ACTIVE/inactive +
  // currency mismatches. Caught the "hermes 'We're sorry'" failure mode in
  // production (one plan was created in USD instead of AUD). Protected by
  // FACTS_BOOTSTRAP_SECRET — repurposed; rename if you re-key it.
  app.post('/api/admin/paypal-diagnose', async (c) => {
    const provided = c.req.header('X-Bootstrap-Secret');
    if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const clientId = c.env.PAYPAL_CLIENT_ID;
    const clientSecret = c.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return c.json({ error: 'PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET worker secret missing' }, 500);
    }

    // PayPal plan IDs — keep in sync with src/client.config.ts
    const PLAN_IDS = {
      monthly: {
        starter: 'P-1AB09838JG575723YNG3TKPY',
        growth:  'P-5JX42118D0152071LNG3TLDY',
        pro:     'P-0MN86219YF921874FNG3TLRY',
        agency:  'P-5VB80462AU714124YNG3TL7Q',
      },
      yearly: {
        starter: 'P-62C327553Y779300FNHDUU7Y',
        growth:  'P-60J02873W1559770VNHDUVAA',
        pro:     'P-6G9907746Y8649457NHDUVAA',
        agency:  'P-1BH48559DE324360CNHDUVAA',
      },
    };

    // Get OAuth token
    const creds = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      return c.json({ error: 'PayPal auth failed', detail: tokenData }, 500);
    }
    const token = tokenData.access_token;
    const appId = tokenData.app_id || null;

    // Query each plan
    type PlanStatus = {
      label: string;
      planId: string;
      httpStatus: number;
      status?: string;
      interval?: string;
      price?: string;
      currency?: string;
      setupFee?: string;
      productId?: string;
      error?: string;
    };
    const results: PlanStatus[] = [];
    const issues: string[] = [];

    const checkPlan = async (label: string, planId: string) => {
      const res = await fetch(`https://api-m.paypal.com/v1/billing/plans/${planId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const r: PlanStatus = { label, planId, httpStatus: res.status };
      if (!res.ok) {
        try {
          const err = await res.json() as any;
          r.error = err?.details?.[0]?.description || err?.message || `HTTP ${res.status}`;
        } catch {
          r.error = `HTTP ${res.status}`;
        }
        issues.push(`${label} (${planId}) — ${r.error}`);
        results.push(r);
        return;
      }
      const plan = await res.json() as any;
      const billingCycle = plan.billing_cycles?.[0];
      const price = billingCycle?.pricing_scheme?.fixed_price;
      const setupFee = plan.payment_preferences?.setup_fee;
      r.status = plan.status;
      r.interval = billingCycle?.frequency
        ? `${billingCycle.frequency.interval_count} ${billingCycle.frequency.interval_unit}`
        : undefined;
      r.price = price ? price.value : undefined;
      r.currency = price ? price.currency_code : undefined;
      r.setupFee = setupFee ? `${setupFee.value} ${setupFee.currency_code}` : 'none';
      r.productId = plan.product_id;
      if (plan.status !== 'ACTIVE') {
        issues.push(`${label} (${planId}) is ${plan.status} — must be ACTIVE. Run: POST /v1/billing/plans/${planId}/activate`);
      }
      if (r.currency && r.currency !== 'AUD') {
        issues.push(`${label} (${planId}) is in ${r.currency} not AUD — currency mismatch causes hermes to fail`);
      }
      results.push(r);
    };

    for (const [label, id] of Object.entries(PLAN_IDS.monthly)) await checkPlan(label, id);
    for (const [label, id] of Object.entries(PLAN_IDS.yearly)) await checkPlan(`${label}-yearly`, id);

    return c.json({
      paypalAppId: appId,
      plans: results,
      issues,
      verdict: issues.length === 0
        ? 'All plans look healthy. The hermes "We\'re sorry" error is likely browser-anti-fraud (CDP debugging attached) or PayPal app domain restriction missing socialaistudio.au. Check developer.paypal.com → your live app → return URLs / domains.'
        : 'Plan-level issues found — see "issues" array. Fix those first before assuming it\'s a browser/domain problem.',
    });
  });
}
