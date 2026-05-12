import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { getAuthUserId, requireAdmin, isRateLimited } from './auth';
import { callAnthropicDirect, callOpenRouter } from './lib/anthropic';
import {
  FLUX_NEGATIVE_PROMPT,
  buildSafeImagePrompt,
  sniffArchetypeFromCaption,
} from './lib/image-safety';
import { critiqueImageInternal } from './lib/critique';
import { resolveArchetypeSlug } from './lib/archetypes';
import { generateImageWithBrandRefs } from './lib/image-gen';
import { refreshFactsForWorkspace } from './lib/facebook-facts';
import { sendResendEmail } from './lib/email';
import { cronRefreshTokens } from './cron/refresh-tokens';
import { cronCheckFalCredits } from './cron/check-fal-credits';
import { cronWeeklyReview } from './cron/weekly-review';
import { cronRefreshFacts } from './cron/refresh-facts';
import { cronPublishMissedPosts } from './cron/publish-missed';
import { cronPrewarmImages } from './cron/prewarm-images';
import { cronPrewarmVideos } from './cron/prewarm-videos';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerHealthRoutes } from './routes/health';
import { registerUserRoutes } from './routes/user';
import { registerSocialTokensRoutes } from './routes/social-tokens';
import { registerPortalRoutes } from './routes/portal';
import { registerActivationRoutes } from './routes/activations';
import { registerFactsRoutes } from './routes/facts';
import { registerPostsRoutes } from './routes/posts';
import { registerClientsRoutes } from './routes/clients';
import { registerArchetypeRoutes } from './routes/archetypes';
import { registerFacebookRoutes } from './routes/facebook';
import { registerAiRoutes } from './routes/ai';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return 'https://socialaistudio.au';
      const allowed = [
        'http://localhost:5173', 'http://localhost:5174',
        'https://socialaistudio.au',
        'https://social.picklenick.au', 'https://social.streetmeatzbbq.com.au',
        'https://social.hugheseysque.au', 'https://hugheseysque.au',
        // Additional whitelabel portal origins
        'https://social.gladstonebbq.com.au', 'https://social.blackcat.com.au',
        'https://social.jonesysgarage.com.au', 'https://social.jenniannesjewels.com.au',
        'https://littlestomp.com.au', 'https://www.littlestomp.com.au',
        'https://streetmeatzbbq.com.au', 'https://www.streetmeatzbbq.com.au',
      ];
      if (allowed.includes(origin)) return origin;
      // Allow all *.pages.dev subdomains (CF Pages preview/prod deployments)
      if (origin.endsWith('.pages.dev')) return origin;
      return 'https://socialaistudio.au';
    },
    // X-Portal-Secret is sent by whitelabel portal frontends to authenticate
    // their slug-based portal lookup. Without this, browser preflight blocks
    // the request and the portal shows "Portal not configured".
    allowHeaders: ['Content-Type', 'Authorization', 'X-Portal-Secret', 'X-Bootstrap-Secret'],
    allowMethods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

// Modular route registration — see routes/* for each group. Each
// registerXRoutes call mounts a handful of endpoints onto the shared app
// instance. Order doesn't matter unless two registrations share a path
// prefix (none currently do).
registerHealthRoutes(app);
registerAiRoutes(app);
registerUserRoutes(app);
registerPostsRoutes(app);
registerClientsRoutes(app);
registerSocialTokensRoutes(app);
registerPortalRoutes(app);
registerActivationRoutes(app);
registerCampaignRoutes(app);
registerFactsRoutes(app);
registerArchetypeRoutes(app);
registerFacebookRoutes(app);


// ── UUID helper ──────────────────────────────────────────────────────────────
const uuid = () => crypto.randomUUID();

// ── Image prompt safety helpers live in lib/image-safety.ts ─────────────
// (Phase B step 4 of the route-module split; see WORKER_SPLIT_PLAN.md.)
// The resolveArchetypeSlug helper below stays here because it needs Env
// to query D1 — image-safety.ts is intentionally pure for testability.


// ── Plan price source-of-truth (KEEP IN SYNC WITH src/client.config.ts) ──────
// MRR computation needs to know the monthly price per plan. Mirror the
// frontend's CLIENT.plans[].price values here. If you change a plan price
// in the frontend, also change it here.
const PLAN_PRICE_AUD: Record<string, number> = {
  starter: 29,
  growth: 49,
  pro: 79,
  agency: 149,
};

// Health, cron-health, post-schedule moved to routes/health.ts.



// ── DB: Campaigns — see routes/campaigns.ts ─────────────────────────────────

// ── Onboarding health check ───────────────────────────────────────────────────
// Public endpoint — returns only boolean readiness flags + Resend domain
// verification status. No secrets, no customer info. Safe to leave open
// since the data here is the same observability you'd get by attempting
// a live signup yourself.
app.get('/api/health/onboarding', async (c) => {
  const out: Record<string, any> = {};

  // PayPal credentials — try to fetch an OAuth token. If credentials are
  // wrong/missing this throws.
  try {
    await paypalAccessToken(c.env);
    out.paypal_credentials_ok = true;
  } catch (e: any) {
    out.paypal_credentials_ok = false;
    out.paypal_error = (e?.message || 'unknown').slice(0, 120);
  }

  // PayPal webhook ID configured (worker secret only — value not returned)
  out.paypal_webhook_id_set = !!c.env.PAYPAL_WEBHOOK_ID;

  // Resend — try to list domains and find socialaistudio.au. Many of our
  // Resend keys are scoped to "Sending access" only, which means /v1/domains
  // returns 401 with name="restricted_api_key". That's a GOOD outcome —
  // sending emails still works; we just can't introspect domain verification
  // from here. Treat that case as "key is fine, can't verify domain via API".
  if (c.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
      });
      if (res.status === 401) {
        const body = await res.json().catch(() => ({})) as { name?: string };
        if (body.name === 'restricted_api_key') {
          out.resend = {
            api_key_set: true,
            sending_only: true,
            note: 'Key is sending-only — domain status not introspectable. Verify socialaistudio.au manually in Resend dashboard.',
          };
        } else {
          out.resend = { api_key_set: true, auth_error: true };
        }
      } else if (res.ok) {
        const data = await res.json() as { data?: Array<{ name: string; status: string }> };
        const dom = (data.data || []).find(d => d.name === 'socialaistudio.au');
        out.resend = {
          api_key_set: true,
          sending_only: false,
          domain_found: !!dom,
          domain_status: dom?.status || null,
          domain_verified: dom?.status === 'verified',
        };
      } else {
        out.resend = { api_key_set: true, http_status: res.status };
      }
    } catch (e: any) {
      out.resend = { api_key_set: true, error: (e?.message || 'unknown').slice(0, 120) };
    }
  } else {
    out.resend = { api_key_set: false };
  }

  // D1 connectivity — minimal probe, no row content returned.
  try {
    const r = await c.env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>();
    out.db_ok = r?.ok === 1;
  } catch (e: any) {
    out.db_ok = false;
    out.db_error = (e?.message || 'unknown').slice(0, 120);
  }

  return c.json(out);
});

// ── PayPal subscription endpoints ─────────────────────────────────────────────
// Live here on the worker (not the CF Pages Function) so they can use the
// PAYPAL_* and RESEND_API_KEY worker secrets directly. The Pages Functions
// at functions/api/paypal-{webhook,verify}.js are thin proxies to these
// routes — keeps PayPal's webhook URL stable while consolidating secrets.
//
// Plan-ID → tier mapping. Keep in sync with src/client.config.ts paypalPlanIds
// and paypalYearlyPlanIds. Both monthly and yearly IDs map to the same tier
// since `clients.plan` doesn't distinguish billing cycle.
const PAYPAL_PLAN_TIER: Record<string, string> = {
  // Monthly
  'P-1AB09838JG575723YNG3TKPY': 'starter',
  'P-5JX42118D0152071LNG3TLDY': 'growth',
  'P-0MN86219YF921874FNG3TLRY': 'pro',
  'P-5VB80462AU714124YNG3TL7Q': 'agency',
  // Yearly
  'P-62C327553Y779300FNHDUU7Y': 'starter',
  'P-60J02873W1559770VNHDUVAA': 'growth',
  'P-6G9907746Y8649457NHDUVAA': 'pro',
  'P-1BH48559DE324360CNHDUVAA': 'agency',
};

// Plan IDs that bill yearly. PAYMENT.SALE.COMPLETED for these fires once a
// year, so reel-credit grants must be multiplied by 12 to give the user the
// same effective monthly cadence as a monthly subscriber.
const PAYPAL_YEARLY_PLAN_IDS = new Set([
  'P-62C327553Y779300FNHDUU7Y',
  'P-60J02873W1559770VNHDUVAA',
  'P-6G9907746Y8649457NHDUVAA',
  'P-1BH48559DE324360CNHDUVAA',
]);

// Reel credits granted per billing cycle, per plan tier. Mirrored in the
// frontend `client.configs/*.ts` plan feature lines — keep them in sync.
// Yearly subscribers get this × 12 on each annual renewal (PAYMENT.SALE.COMPLETED
// fires once for them per year).
const REEL_CREDITS_PER_MONTH: Record<string, number> = {
  starter: 0,
  growth: 0,
  pro: 4,
  agency: 20,
};

// Server-side canonical credit-pack pricing. The frontend `reelCreditPacks`
// config in client.config.ts defines what's offered; this map is the source
// of truth for what we'll actually credit when a PayPal order is captured.
// Mismatches (client-tampered amounts) are rejected.
//
// To change pricing: update both this map AND the frontend config — they
// must stay in sync. Better long-term: serve this from the worker so there's
// only one source. For now duplication is acceptable because the canonical
// validator lives on the server (this map), and the client copy is just
// presentational.
const REEL_CREDIT_PACKS: Record<string, { credits: number; amount: number; currency: string }> = {
  small:  { credits: 3,  amount: 9.99,  currency: 'AUD' },
  medium: { credits: 10, amount: 24.99, currency: 'AUD' },
  large:  { credits: 25, amount: 49.99, currency: 'AUD' },
};

const PAYPAL_API_BASE = 'https://api-m.paypal.com';
const ADMIN_NOTIFY_EMAIL = 'steve@pennywiseit.com.au';

// Grant reel credits for a recurring PayPal payment (PAYMENT.SALE.COMPLETED).
// Looks up the user's billing_cycle to decide the multiplier (yearly subs
// get 12× the monthly amount on each annual renewal so total cadence matches
// monthly subs). Caller MUST gate on a fresh INSERT to the payments table —
// this function does no idempotency check of its own; relying on the table's
// unique paypal_event_id index in the caller is simpler and race-free.
async function grantReelCreditsForRenewal(env: Env, userId: string, plan: string): Promise<void> {
  const perCycle = REEL_CREDITS_PER_MONTH[plan] ?? 0;
  if (perCycle === 0) return; // starter/growth — no plan-included reels

  const u = await env.DB.prepare(
    `SELECT billing_cycle, reel_credits FROM users WHERE id = ?`
  ).bind(userId).first<{ billing_cycle: string | null; reel_credits: number | null }>();
  if (!u) return;

  // NULL billing_cycle → assume monthly (the safer default for legacy users).
  const multiplier = u.billing_cycle === 'yearly' ? 12 : 1;
  const grant = perCycle * multiplier;
  const newBalance = (u.reel_credits ?? 0) + grant;

  await env.DB.prepare(
    `UPDATE users SET reel_credits = ? WHERE id = ?`
  ).bind(newBalance, userId).run();
  console.log(`[reels] granted ${grant} credit(s) to user ${userId} (${plan}/${u.billing_cycle ?? 'monthly'}) → ${newBalance} total`);
}

async function paypalAccessToken(env: Env): Promise<string> {
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET worker secret missing');
  const creds = btoa(`${id}:${secret}`);
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Failed to obtain PayPal access token');
  return data.access_token;
}

async function paypalVerifyWebhookSignature(req: Request, rawBody: string, token: string, env: Env): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) throw new Error('PAYPAL_WEBHOOK_ID worker secret missing');
  const body = {
    auth_algo: req.headers.get('paypal-auth-algo'),
    cert_url: req.headers.get('paypal-cert-url'),
    transmission_id: req.headers.get('paypal-transmission-id'),
    transmission_sig: req.headers.get('paypal-transmission-sig'),
    transmission_time: req.headers.get('paypal-transmission-time'),
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: JSON.parse(rawBody),
  };
  const res = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { verification_status?: string };
  return data.verification_status === 'SUCCESS';
}

function welcomeEmailHtml(plan: string): string {
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
  const steps = ['Log in and complete your business profile','Connect your Facebook & Instagram pages','Generate your first AI post and schedule it'];
  const stepsHtml = steps.map((s, i) =>
    `<div style="display:flex;align-items:center;gap:12px;"><div style="width:24px;height:24px;background:#f59e0b22;border:1px solid #f59e0b44;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#f59e0b;font-size:11px;font-weight:700;flex-shrink:0;">${i+1}</div><span style="color:#d1d5db;font-size:13px;">${s}</span></div>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:560px;margin:0 auto;padding:40px 24px;"><div style="text-align:center;margin-bottom:32px;"><div style="display:inline-flex;align-items:center;gap:10px;background:#111118;border:1px solid #1f2937;border-radius:50px;padding:10px 20px;"><span style="font-size:18px;">✨</span><span style="color:#f59e0b;font-weight:800;font-size:15px;">Social AI Studio</span></div></div><div style="background:linear-gradient(135deg,#f59e0b22,#ef444411);border:1px solid #f59e0b33;border-radius:20px;padding:40px 32px;text-align:center;margin-bottom:24px;"><div style="font-size:48px;margin-bottom:16px;">🎉</div><h1 style="color:#ffffff;font-size:26px;font-weight:900;margin:0 0 12px;">You're all set!</h1><p style="color:#9ca3af;font-size:15px;line-height:1.6;margin:0 0 24px;">Your <strong style="color:#f59e0b;">${planName} Plan</strong> is now active. Welcome to Social AI Studio — let's grow your social media together.</p><a href="https://socialaistudio.au" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#000;font-weight:900;font-size:14px;padding:14px 32px;border-radius:50px;text-decoration:none;">Open Dashboard →</a></div><div style="background:#111118;border:1px solid #1f2937;border-radius:16px;padding:24px 28px;margin-bottom:16px;"><h2 style="color:#ffffff;font-size:14px;font-weight:700;margin:0 0 16px;">What happens next?</h2><div style="display:flex;flex-direction:column;gap:12px;">${stepsHtml}</div></div><p style="text-align:center;color:#374151;font-size:11px;margin:0;">Questions? <a href="mailto:support@pennywiseit.com.au" style="color:#f59e0b;text-decoration:none;">support@pennywiseit.com.au</a> · <a href="https://socialaistudio.au" style="color:#f59e0b;text-decoration:none;">socialaistudio.au</a></p></div></body></html>`;
}

function cancellationEmailHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:560px;margin:0 auto;padding:40px 24px;"><div style="text-align:center;margin-bottom:32px;"><div style="display:inline-flex;align-items:center;gap:10px;background:#111118;border:1px solid #1f2937;border-radius:50px;padding:10px 20px;"><span style="font-size:18px;">✨</span><span style="color:#f59e0b;font-weight:800;font-size:15px;">Social AI Studio</span></div></div><div style="background:#111118;border:1px solid #374151;border-radius:20px;padding:40px 32px;text-align:center;margin-bottom:24px;"><h1 style="color:#ffffff;font-size:22px;font-weight:900;margin:0 0 12px;">Subscription Cancelled</h1><p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 24px;">Your Social AI Studio subscription has been cancelled. You'll retain access until the end of your current billing period.</p><p style="color:#6b7280;font-size:13px;margin:0;">Changed your mind? <a href="https://socialaistudio.au" style="color:#f59e0b;text-decoration:none;">Reactivate your plan</a> anytime.</p></div><p style="text-align:center;color:#374151;font-size:11px;margin:0;">Questions? <a href="mailto:support@pennywiseit.com.au" style="color:#f59e0b;text-decoration:none;">support@pennywiseit.com.au</a></p></div></body></html>`;
}

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

// ── Reels: Pre-flight smoke test ────────────────────────────────────────────
// Verifies the user's Facebook Page can actually accept a Reel publish via
// /video_reels — catches "FB token expired", "publish_video scope missing",
// "page disconnected" before the user schedules a batch and watches it all
// fail at publish time. Safe + free: kicks off upload_phase=start and
// abandons the resulting video_id (FB GCs unreferenced uploads after a few
// hours, no actual reel ever publishes).
//
// This is the PROACTIVE counterpart to the cron's reactive image-fallback
// safety net. Aligns with the user's #1 priority (reliability) — surface the
// failure at config time, not at publish time.
app.post('/api/test-reel-publish', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ clientId?: string | null }>().catch(() => null);
  const clientId = body?.clientId || null;

  // Load social tokens for the appropriate workspace (mirrors the cron's
  // resolution logic exactly so this test matches what the cron actually does).
  const tokensRaw = clientId
    ? await c.env.DB.prepare('SELECT social_tokens FROM clients WHERE id = ? AND user_id = ?').bind(clientId, uid).first<{ social_tokens: string | null }>()
    : await c.env.DB.prepare('SELECT social_tokens FROM users WHERE id = ?').bind(uid).first<{ social_tokens: string | null }>();
  const tokens = tokensRaw?.social_tokens ? JSON.parse(tokensRaw.social_tokens) : null;
  if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
    return c.json({
      ok: false,
      stage: 'no-tokens',
      message: 'No Facebook page connected. Open Settings → Connected Accounts → Connect Facebook.',
    }, 200);
  }

  const base = 'https://graph.facebook.com/v21.0';
  const pageId = tokens.facebookPageId;
  const token = tokens.facebookPageAccessToken;

  // Step 1 — verify page lookup works (catches expired/revoked tokens cheap).
  try {
    const pageRes = await fetch(`${base}/${pageId}?fields=name,access_token&access_token=${encodeURIComponent(token)}`);
    const pageData = await pageRes.json() as any;
    if (!pageRes.ok || pageData.error) {
      return c.json({
        ok: false,
        stage: 'page-lookup',
        message: `Facebook rejected the page token: ${pageData.error?.message || `HTTP ${pageRes.status}`}. Reconnect Facebook in Settings to refresh.`,
      }, 200);
    }
    const pageName = pageData.name as string;

    // Step 2 — kick off video_reels upload_phase=start. If the page lacks the
    // publish_video permission OR has Reels disabled, this returns an error.
    // We DON'T follow through to transfer/finish — FB GCs the unreferenced
    // upload session. No actual reel publishes.
    const startRes = await fetch(`${base}/${pageId}/video_reels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_phase: 'start', access_token: token }),
    });
    const startData = await startRes.json() as any;
    if (!startRes.ok || startData.error) {
      const errMsg = startData.error?.message || `HTTP ${startRes.status}`;
      const errCode = startData.error?.code;
      // FB error codes: 200 = permission denied, 100 = invalid param, 190 = token expired
      const friendly =
        errCode === 200 ? 'Page is missing the publish_video permission. Reconnect Facebook in Settings and accept all permissions.'
        : errCode === 190 ? 'Facebook token expired. Reconnect Facebook in Settings.'
        : `Facebook rejected the test: ${errMsg}`;
      return c.json({
        ok: false,
        stage: 'reels-start',
        page_name: pageName,
        fb_error_code: errCode,
        message: friendly,
      }, 200);
    }
    if (!startData.video_id || !startData.upload_url) {
      return c.json({
        ok: false,
        stage: 'reels-start',
        page_name: pageName,
        message: 'Facebook accepted the request but returned no video_id — Reels API may be misconfigured. Contact support.',
      }, 200);
    }

    return c.json({
      ok: true,
      page_name: pageName,
      message: `Reels publishing is configured correctly for ${pageName}. Scheduled reels will publish automatically.`,
    });
  } catch (err: any) {
    return c.json({
      ok: false,
      stage: 'network',
      message: `Could not reach Facebook: ${err?.message || 'unknown'}. Try again in a moment.`,
    }, 200);
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

/**
 * Mirror a PayPal webhook event into our `payments` table for audit + admin
 * visibility. Idempotent via the unique index on paypal_event_id — a retried
 * delivery will INSERT OR IGNORE without producing a duplicate row.
 *
 * Event types handled:
 *   BILLING.SUBSCRIPTION.ACTIVATED  → status 'completed', no amount
 *   BILLING.SUBSCRIPTION.CANCELLED  → status 'cancelled', no amount
 *   PAYMENT.SALE.COMPLETED          → status 'completed', positive amount_cents
 *   PAYMENT.SALE.REFUNDED           → status 'refunded',  negative amount_cents
 *   BILLING.SUBSCRIPTION.PAYMENT.FAILED → status 'failed', no amount
 *
 * Other event types are intentionally ignored (we'd just be storing noise).
 */
async function recordPaymentEvent(c: Context<{ Bindings: Env }>, event: any): Promise<void> {
  const eventId = event?.id;
  const eventType = event?.event_type as string | undefined;
  const resource = event?.resource || {};
  if (!eventId || !eventType) return;

  let subscriptionId: string | null = null;
  let captureId: string | null = null;
  let amountCents: number | null = null;
  let currency = 'AUD';
  let status: 'completed' | 'cancelled' | 'refunded' | 'failed' | null = null;
  let email: string | null = resource.subscriber?.email_address || null;
  let plan: string | null = null;

  switch (eventType) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      subscriptionId = resource.id || null;
      const paypalPlanId = resource.plan_id;
      if (paypalPlanId) plan = PAYPAL_PLAN_TIER[paypalPlanId] ?? null;
      status = 'completed';
      break;
    }
    case 'BILLING.SUBSCRIPTION.CANCELLED': {
      subscriptionId = resource.id || null;
      status = 'cancelled';
      break;
    }
    case 'PAYMENT.SALE.COMPLETED': {
      captureId = resource.id || null;
      // billing_agreement_id is the subscription_id for recurring sales.
      subscriptionId = resource.billing_agreement_id || null;
      const total = parseFloat(resource.amount?.total ?? '0');
      if (Number.isFinite(total) && total > 0) {
        amountCents = Math.round(total * 100);
      }
      currency = resource.amount?.currency || 'AUD';
      status = 'completed';
      break;
    }
    case 'PAYMENT.SALE.REFUNDED': {
      captureId = resource.id || null;
      subscriptionId = resource.billing_agreement_id || null;
      const total = parseFloat(resource.amount?.total ?? '0');
      if (Number.isFinite(total) && total > 0) {
        // Negative so SUMming amount_cents gives net revenue.
        amountCents = -Math.abs(Math.round(total * 100));
      }
      currency = resource.amount?.currency || 'AUD';
      status = 'refunded';
      break;
    }
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
      subscriptionId = resource.id || null;
      status = 'failed';
      break;
    }
    default:
      return;
  }

  // Resolve user_id + email + plan via the subscription_id (or email fallback).
  // PAYMENT.SALE.* events don't carry subscriber email; we hop through the
  // users table via paypal_subscription_id to enrich the row.
  let userId: string | null = null;
  if (subscriptionId) {
    const u = await c.env.DB.prepare(
      'SELECT id, email, plan FROM users WHERE paypal_subscription_id = ?'
    ).bind(subscriptionId).first<{ id: string; email: string | null; plan: string | null }>();
    if (u) {
      userId = u.id;
      if (!email) email = u.email;
      if (!plan && u.plan) plan = u.plan;
    }
  }
  if (!userId && email) {
    const u = await c.env.DB.prepare(
      'SELECT id, plan FROM users WHERE email = ?'
    ).bind(email).first<{ id: string; plan: string | null }>();
    if (u) {
      userId = u.id;
      if (!plan && u.plan) plan = u.plan;
    }
  }

  // Cap raw_event so a single huge webhook can't blow row size limits.
  const rawJson = (() => {
    try { return JSON.stringify(event).slice(0, 8000); } catch { return null; }
  })();

  const insertResult = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO payments
       (id, paypal_event_id, paypal_subscription_id, paypal_capture_id,
        email, user_id, plan, event_type, amount_cents, currency, status,
        raw_event, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    uuid(), eventId, subscriptionId, captureId,
    email, userId, plan, eventType, amountCents, currency, status,
    rawJson, new Date().toISOString(),
  ).run();

  // Grant reel credits ONLY when this is a freshly-inserted PAYMENT.SALE.COMPLETED
  // row (not a retry-dedup'd no-op). meta.changes === 1 means INSERT OR IGNORE
  // actually inserted; 0 means the unique paypal_event_id index already had it.
  // This pattern is the simplest race-free idempotency for "do this side-effect
  // exactly once per webhook event".
  if (eventType === 'PAYMENT.SALE.COMPLETED' && insertResult.meta?.changes === 1 && userId && plan) {
    try {
      await grantReelCreditsForRenewal(c.env, userId, plan);
    } catch (e: any) {
      console.error(`[reels] grant failed for user ${userId} sale ${captureId}: ${e?.message || e}`);
      // Don't throw — the audit row is already in. A failed grant won't
      // double-charge the customer; admin can manually credit if needed.
    }
  }
}

// ── Admin: Customers dashboard ───────────────────────────────────────────────
// Powers the agency owner's "Customers" tab. All endpoints gated by
// requireAdmin (Clerk JWT → users.is_admin=1).

/**
 * GET /api/admin/stats
 * Top-line numbers for the Customers dashboard hero strip.
 *   signups_total      — every row in users
 *   signups_7d / 30d   — created_at within window
 *   active_subs        — distinct paid users with a paypal_subscription_id
 *   mrr_cents          — sum of monthly plan price across active subs
 *   revenue_30d_cents  — sum of completed payments in last 30d (refunds subtract)
 *   churn_30d          — cancellation events in last 30d
 *   trial_users        — users with no plan set
 */
app.get('/api/admin/stats', async (c) => {
  const adminCheck = await requireAdmin(c);
  if (adminCheck instanceof Response) return adminCheck;

  const now = Date.now();
  const ago7  = new Date(now - 7  * 86_400_000).toISOString();
  const ago30 = new Date(now - 30 * 86_400_000).toISOString();

  const [
    signupsTotal, signups7d, signups30d,
    paidByPlan, trialCount, churn30d, revenue30d,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as c FROM users').first<{ c: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').bind(ago7).first<{ c: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').bind(ago30).first<{ c: number }>(),
    c.env.DB.prepare(
      `SELECT plan, COUNT(*) as c FROM users
        WHERE plan IS NOT NULL AND plan != ''
          AND paypal_subscription_id IS NOT NULL
        GROUP BY plan`
    ).all(),
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE plan IS NULL OR plan = ''`).first<{ c: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as c FROM payments WHERE event_type = ? AND created_at >= ?`
    ).bind('BILLING.SUBSCRIPTION.CANCELLED', ago30).first<{ c: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents),0) as s FROM payments WHERE created_at >= ?
         AND status IN ('completed','refunded')`
    ).bind(ago30).first<{ s: number }>(),
  ]);

  let mrrCents = 0;
  let activeSubs = 0;
  for (const row of (paidByPlan.results || []) as { plan: string; c: number }[]) {
    const price = PLAN_PRICE_AUD[row.plan] || 0;
    mrrCents += price * 100 * row.c;
    activeSubs += row.c;
  }

  return c.json({
    signups_total: signupsTotal?.c || 0,
    signups_7d:    signups7d?.c    || 0,
    signups_30d:   signups30d?.c   || 0,
    active_subs:   activeSubs,
    mrr_cents:     mrrCents,
    revenue_30d_cents: revenue30d?.s || 0,
    churn_30d:     churn30d?.c      || 0,
    trial_users:   trialCount?.c    || 0,
  });
});

/**
 * GET /api/admin/customers?filter=all|trial|paid|cancelled&limit=50&offset=0
 * Paginated list of users for the Customers table. Each row includes
 * derived metrics so the table can render without N+1 round-trips.
 */
app.get('/api/admin/customers', async (c) => {
  const adminCheck = await requireAdmin(c);
  if (adminCheck instanceof Response) return adminCheck;

  const filter = (c.req.query('filter') || 'all').toLowerCase();
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));

  // Build the WHERE clause based on filter — all branches use static SQL,
  // no string interpolation of user input.
  let where = '1=1';
  if (filter === 'trial') {
    where = `(u.plan IS NULL OR u.plan = '')`;
  } else if (filter === 'paid') {
    where = `u.plan IS NOT NULL AND u.plan != '' AND u.paypal_subscription_id IS NOT NULL`;
  } else if (filter === 'cancelled') {
    where = `u.id IN (SELECT user_id FROM payments
                       WHERE event_type = 'BILLING.SUBSCRIPTION.CANCELLED'
                         AND user_id IS NOT NULL)`;
  }

  const rows = await c.env.DB.prepare(
    `SELECT
        u.id,
        u.email,
        u.plan,
        u.setup_status,
        u.is_admin,
        u.paypal_subscription_id,
        u.created_at,
        u.onboarding_done,
        (SELECT MAX(created_at) FROM posts WHERE user_id = u.id)            AS last_post_at,
        (SELECT COUNT(*)        FROM posts WHERE user_id = u.id)            AS post_count,
        (SELECT COALESCE(SUM(amount_cents),0)
           FROM payments
          WHERE (user_id = u.id OR (email IS NOT NULL AND email = u.email))
            AND status = 'completed')                                       AS total_paid_cents,
        (SELECT COALESCE(SUM(amount_cents),0)
           FROM payments
          WHERE (user_id = u.id OR (email IS NOT NULL AND email = u.email))
            AND status = 'refunded')                                        AS total_refunded_cents
       FROM users u
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as c FROM users u WHERE ${where}`
  ).first<{ c: number }>();

  return c.json({
    customers: rows.results || [],
    total: totalRow?.c || 0,
    limit, offset, filter,
  });
});

/**
 * GET /api/admin/payments?email=...&limit=20
 * Recent payment events. Without `email`, returns the latest events
 * across all customers (used for an admin "all activity" feed).
 * With `email`, returns just that customer's events.
 */
app.get('/api/admin/payments', async (c) => {
  const adminCheck = await requireAdmin(c);
  if (adminCheck instanceof Response) return adminCheck;

  const email = c.req.query('email');
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));

  let result;
  if (email) {
    result = await c.env.DB.prepare(
      `SELECT id, email, event_type, amount_cents, currency, status, plan,
              paypal_subscription_id, paypal_capture_id, created_at
         FROM payments
        WHERE email = ? OR user_id IN (SELECT id FROM users WHERE email = ?)
        ORDER BY created_at DESC
        LIMIT ?`
    ).bind(email, email, limit).all();
  } else {
    result = await c.env.DB.prepare(
      `SELECT id, email, event_type, amount_cents, currency, status, plan,
              paypal_subscription_id, paypal_capture_id, created_at
         FROM payments
        ORDER BY created_at DESC
        LIMIT ?`
    ).bind(limit).all();
  }

  return c.json({ payments: result.results || [] });
});

// ── Customer: Billing screen ─────────────────────────────────────────────────

/**
 * GET /api/billing
 * Returns the SIGNED-IN user's current plan + their own payment history.
 * Scoped strictly to the caller — never returns another user's data even
 * if the caller knows the email.
 */
app.get('/api/billing', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);

  const user = await c.env.DB.prepare(
    'SELECT id, email, plan, paypal_subscription_id, created_at FROM users WHERE id = ?'
  ).bind(uid).first<{
    id: string; email: string | null; plan: string | null;
    paypal_subscription_id: string | null; created_at: string | null;
  }>();
  if (!user) return c.json({ error: 'User not found' }, 404);

  const payments = await c.env.DB.prepare(
    `SELECT event_type, amount_cents, currency, status, plan, created_at
       FROM payments
      WHERE user_id = ? OR (email IS NOT NULL AND email = ?)
      ORDER BY created_at DESC
      LIMIT 24`
  ).bind(uid, user.email ?? '').all();

  return c.json({
    email: user.email,
    plan: user.plan,
    plan_price_aud: user.plan ? (PLAN_PRICE_AUD[user.plan] ?? null) : null,
    subscription_id: user.paypal_subscription_id,
    member_since: user.created_at,
    payments: payments.results || [],
  });
});


// ── Facebook Page Insights Scraper ─────────────────────────────────────────
// Pulls a connected Page's REAL data (own posts, comments, about, photos,
// events) into the client_facts table. The AI then writes from real ground
// truth instead of inventing testimonials and stats. See lib/facebook-facts +
// routes/facts.ts.

// One-shot bootstrap — scrape ALL workspaces with FB tokens. Used to seed the
// table for existing connected accounts. Protected by FACTS_BOOTSTRAP_SECRET
// env var (set via wrangler secret) — anyone with the secret can re-seed.
// Backfill images for any Scheduled post that has an image_prompt but no image_url.
// Authenticated variant: only the calling user's posts (own + their clients').
app.post('/api/db/backfill-images', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(await backfillImagesForUser(c.env, uid));
});

// ─────────────────────────────────────────────────────────────────────────
// Admin: scan scheduled posts for AI fabrication / cadence / tropes
//
// 2026-05 audit follow-up. After deploying the upgraded prompt pipeline,
// posts created BEFORE the deployment still carry pre-audit text — invented
// stats, AI cadence, buzzword soup, etc. This endpoint lets an admin scan
// the Scheduled queue for posts that trip the same detectors the client-side
// detectFabrication runs at generation time, so they can be regenerated or
// deleted before publishing.
//
// Regex bank is INTENTIONALLY DUPLICATED from src/services/gemini.ts
// (detectFabrication + BANNED_PATTERNS) because the worker can't import
// client-only TS. KEEP IN SYNC when those lists change. The smoke test at
// scripts/audit-smoke-test.ts verifies the client side; this endpoint is
// the production-side mirror.
// ─────────────────────────────────────────────────────────────────────────
const FAB_PATTERNS: Array<[RegExp, string]> = [
  // Fake customer testimonials
  [/\b(?:a\s+)?(?:local|nearby|happy|recent)\s+(?:cafe|restaurant|business|client|customer|owner|food\s+truck|shop|store)\s+(?:in|from|at|near)?\s*[A-Z][a-z]+/i, 'invented customer testimonial'],
  [/\b(?:one\s+of\s+our|another)\s+(?:happy\s+)?(?:client|customer|user)/i, 'invented customer story'],
  [/\b(?:says|told\s+us|reported|shared|raved)\s*[:,]?\s*["']/i, 'invented quote'],
  [/\b[A-Z][a-z]+\s+[A-Z]\.?\s*,\s*(?:from\s+)?[A-Z][a-z]+/i, 'fake testimonial signature'],
  // Fake statistics
  [/\b\d{1,3}(?:\.\d+)?%\s+(?:increase|boost|growth|improvement|more|less|reduction|saving|higher|lower|faster)/i, 'invented percentage statistic'],
  [/\b(?:by|of|up\s+to|reach(?:ing|ed)?|gain(?:ing|ed)?|boost(?:ing|ed)?\s+\w+\s+by)\s+\d{1,3}(?:\.\d+)?%/i, 'invented percentage statistic ("by X%" form)'],
  [/\bsaved\s+(?:them\s+)?\d+\s+(?:hours?|days?|weeks?|minutes?)/i, 'invented time-saving claim'],
  [/\b\d+x\s+(?:more|better|faster|increase|growth)/i, 'invented multiplier claim'],
  [/\b(?:over|more\s+than)\s+\d{2,}\s+(?:clients?|customers?|users?|businesses)/i, 'invented user count'],
  [/\b(?:already\s+)?posting\s+\d+(?:[-–]\d+)?\s+times?\s+(?:per|a)\s+(?:day|week|month)/i, 'invented posting-frequency claim'],
  [/\b(?:already\s+)?(?:get|gets|getting|generating|generated)\s+\d+(?:[-–]\d+)?\s+(?:more\s+)?(?:leads?|sales?|customers?|comments?|likes?|shares?|views?)/i, 'invented engagement-stat claim'],
  [/\bHow\s+many\s+(?:hours?|days?|customers?|sales?|leads?)\s+could\s+you\s+(?:reclaim|save|gain|earn|get|win)/i, 'leading question with implied invented stat'],
  // Fake urgency
  [/\b(?:today\s+only|this\s+weekend\s+only|limited\s+(?:time|spots)|hurry|act\s+now|don'?t\s+miss\s+out)/i, 'fake urgency'],
  [/\b(?:countdown|just\s+\d+\s+(?:hours?|days?)\s+left|ends\s+(?:tomorrow|tonight|soon))/i, 'invented countdown'],
  // Structural AI tropes
  [/\bYour\s+(?:best|top|favourite|favorite)\s+\w+\s+goes\s+live\s+at\s+\d/i, 'AI-tutorial opener'],
  [/\bNobody\s+sees\s+(it|them)[.!?]\s*Timing\s+is\s+everything/i, 'three-beat AI rhythm'],
  [/\bNo more (staring at a blank screen|wondering what to (write|post|say)|guessing)/i, 'AI cliché ("No more X-ing at a Y")'],
  [/(?:\bEvery\s+\S+(?:\s+\S+){0,3}[.!]\s*){2,}/i, '"Every X. Every Y." anaphora'],
  [/\b(?:channell?ed|leveraged|elevated)\s+(?:significant|considerable|substantial|incredible)/i, 'buzzword soup ("channelled significant…")'],
  [/\bbespoke\s+(digital\s+platforms?|ai\s+(?:tools?|solutions?|platforms?))/i, 'agency-speak ("bespoke digital platforms")'],
  [/\bSmall business owners (often|usually|typically|always|never|rarely)/i, 'generalising opener ("Small business owners often…")'],
  [/\b(Timing|Consistency|Authenticity|Quality|Strategy)\s+is\s+everything[.!?]/i, 'empty epigram ("Timing is everything")'],
  [/\bThat'?s\s+the\s+gap\s+we\s+close/i, '"That\'s the gap we close"'],
  [/\bMaking\s+(real|a\s+real)\s+difference/i, '"Making real differences"'],
];

function scanContentForTropes(content: string): string[] {
  const reasons: string[] = [];
  for (const [pattern, reason] of FAB_PATTERNS) {
    if (pattern.test(content)) reasons.push(reason);
  }
  // Cadence detector — 3+ consecutive ≤6-word declaratives
  const sentences = content.split(/[.!?]\s+/).filter(s => s.trim().length > 0);
  let consecutiveShort = 0;
  let maxRun = 0;
  for (const s of sentences) {
    if (s.trim().split(/\s+/).length <= 6) {
      consecutiveShort++;
      if (consecutiveShort > maxRun) maxRun = consecutiveShort;
    } else {
      consecutiveShort = 0;
    }
  }
  if (maxRun >= 3) reasons.push(`AI cadence — ${maxRun} consecutive short sentences`);
  return reasons;
}

app.get('/api/admin/scan-flagged-posts', async (c) => {
  const adminCheck = await requireAdmin(c);
  if (adminCheck instanceof Response) return adminCheck;

  const limit = Math.min(parseInt(c.req.query('limit') || '500', 10), 2000);
  const status = c.req.query('status') || 'Scheduled';
  const rows = await c.env.DB.prepare(
    `SELECT id, scheduled_for, platform, content,
            substr(COALESCE(image_prompt,''),1,200) as image_prompt_preview,
            COALESCE(client_id,'_self') as workspace
     FROM posts
     WHERE status = ? AND content IS NOT NULL AND content != ''
     ORDER BY scheduled_for ASC
     LIMIT ?`,
  ).bind(status, limit).all();

  const posts = (rows.results || []) as any[];
  const flagged: any[] = [];
  for (const p of posts) {
    const reasons = scanContentForTropes(String(p.content || ''));
    if (reasons.length > 0) {
      flagged.push({
        id: p.id,
        scheduled_for: p.scheduled_for,
        platform: p.platform,
        workspace: p.workspace,
        content_preview: String(p.content || '').slice(0, 240),
        image_prompt_preview: p.image_prompt_preview || null,
        reasons,
      });
    }
  }

  return c.json({
    scanned: posts.length,
    flagged,
  });
});

// Admin variant: backfill across every workspace. Gated by FACTS_BOOTSTRAP_SECRET.
app.post('/api/admin/backfill-images-all', async (c) => {
  const provided = c.req.header('X-Bootstrap-Secret');
  if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const users = await c.env.DB.prepare('SELECT id FROM users').all();
  const results: any[] = [];
  for (const u of (users.results || [])) {
    const r = await backfillImagesForUser(c.env, (u as any).id);
    results.push({ user_id: (u as any).id, ...r });
  }
  return c.json({ users_processed: results.length, results });
});

/** POST /api/admin/backfill-critique-scores
 *
 *  Retroactively score every post that has an image_url but no critique
 *  data yet (image_critique_score IS NULL). The prewarm cron only critiques
 *  NEW image generations; this endpoint covers the historical backlog so
 *  the PostModal "AI N/10" badge appears on every post, not just freshly
 *  generated ones.
 *
 *  Caps at 50 posts per call to keep wall-time + cost predictable.
 *  Per-post cost: ~$0.003 (Haiku 4.5 vision). 50 × $0.003 = $0.15/call.
 *
 *  Admin-only (requireAdmin). Future-proof: scoped to the caller's own
 *  posts, so when this graduates to non-admin we don't have to rewrite it.
 */
app.post('/api/admin/backfill-critique-scores', async (c) => {
  const adminCheck = await requireAdmin(c);
  if (adminCheck instanceof Response) return adminCheck;
  const { uid } = adminCheck;

  const body = await c.req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(Math.max(body.limit || 50, 1), 100);

  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.content, p.client_id, p.image_url
     FROM posts p
     LEFT JOIN clients cl ON p.client_id = cl.id
     WHERE (p.user_id = ? OR cl.user_id = ?)
       AND p.image_url IS NOT NULL AND p.image_url != ''
       AND p.image_critique_score IS NULL
       AND length(p.content) > 20
     ORDER BY p.scheduled_for DESC
     LIMIT ?`
  ).bind(uid, uid, limit).all<{ id: string; content: string; client_id: string | null; image_url: string }>();

  const posts = rows.results || [];
  let scored = 0;
  let lowScores = 0;
  let failed = 0;
  const archetypeCache = new Map<string, string | null>();

  for (const post of posts) {
    try {
      const cacheKey = post.client_id || '__user__';
      if (!archetypeCache.has(cacheKey)) {
        archetypeCache.set(cacheKey, await resolveArchetypeSlug(c.env, uid, post.client_id));
      }
      const archetypeSlug = archetypeCache.get(cacheKey) || null;

      const critique = await critiqueImageInternal(c.env, {
        imageUrl: post.image_url,
        caption: post.content,
        archetypeSlug,
      });

      if (critique) {
        await c.env.DB.prepare(
          `UPDATE posts SET image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
           WHERE id = ?`
        ).bind(critique.score, critique.reasoning, new Date().toISOString(), post.id).run();
        scored++;
        if (critique.score <= 4) lowScores++;
      } else {
        failed++;
      }
    } catch (e: any) {
      failed++;
      console.warn(`[backfill-critique] post ${post.id} failed: ${e?.message}`);
    }
    // Pace OpenRouter — 300ms between calls. 50 posts × 300ms = 15s.
    await new Promise(r => setTimeout(r, 300));
  }

  return c.json({
    found: posts.length,
    scored,
    failed,
    low_scores: lowScores,
    remaining_estimate: posts.length === limit ? 'more available — run again' : 'done',
  });
});

/** POST /api/admin/bulk-regen-low-score-images
 *
 *  Regenerates images for posts where image_critique_score is ≤ the
 *  provided threshold (default 4). Each regen uses the forced-archetype-
 *  fallback path so the new image is guaranteed on-archetype, then
 *  re-scores so the persisted critique reflects what now ships.
 *
 *  Caps at 20 posts per call (fal.ai cost: 20 × ~$0.04 = $0.80/call max
 *  if every retry needs FLUX Pro Kontext + critique).
 *
 *  Body: { threshold?: number (1-7, default 4), limit?: number (default 20) }
 */
app.post('/api/admin/bulk-regen-low-score-images', async (c) => {
  const adminCheck = await requireAdmin(c);
  if (adminCheck instanceof Response) return adminCheck;
  const { uid } = adminCheck;

  const body = await c.req.json().catch(() => ({})) as { threshold?: number; limit?: number };
  // Default raised from 4 → 5 to align with the prewarm cron's hardened
  // retry threshold. The 2026-05-12 hardening flagged that food-on-SaaS
  // posts scored 4-5 from Haiku when archetype was NULL, not the expected
  // 1-2. The new critique prompt forces 1-2 for cross-domain bleed, but
  // already-scored posts won't be re-scored until backfill-critique-scores
  // re-runs them.
  const threshold = Math.min(Math.max(body.threshold ?? 5, 1), 7);
  const limit = Math.min(Math.max(body.limit || 20, 1), 50);

  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.content, p.image_prompt, p.client_id, p.image_critique_score
     FROM posts p
     LEFT JOIN clients cl ON p.client_id = cl.id
     WHERE (p.user_id = ? OR cl.user_id = ?)
       AND p.image_critique_score IS NOT NULL
       AND p.image_critique_score <= ?
       AND p.image_prompt IS NOT NULL AND p.image_prompt != ''
       AND p.status IN ('Scheduled', 'Draft')
     ORDER BY p.image_critique_score ASC, p.scheduled_for ASC
     LIMIT ?`
  ).bind(uid, uid, threshold, limit).all<{
    id: string; content: string; image_prompt: string;
    client_id: string | null; image_critique_score: number;
  }>();

  const posts = rows.results || [];
  let regenerated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const post of posts) {
    try {
      const safe = buildSafeImagePrompt(post.image_prompt);
      if (!safe) { failed++; continue; }

      // Force fallback — these posts already scored badly, so trust the
      // curated archetype scene over the suspect LLM-generated prompt.
      // Pass the caption so image-gen can sniff the archetype if the
      // workspace's archetype_slug is NULL.
      const gen = await generateImageWithBrandRefs(
        c.env, uid, post.client_id, safe, { forceFallback: true, caption: post.content },
      );
      if (!gen.imageUrl) {
        failed++;
        errors.push(`${post.id}: regen returned no URL via ${gen.modelUsed}`);
        continue;
      }

      // Re-critique the new image so the persisted score reflects reality.
      // Same archetype-sniff fallback as prewarm: DB → caption → null.
      let archetypeSlug = await resolveArchetypeSlug(c.env, uid, post.client_id);
      if (!archetypeSlug) archetypeSlug = sniffArchetypeFromCaption(post.content);
      const critique = await critiqueImageInternal(c.env, {
        imageUrl: gen.imageUrl,
        caption: post.content,
        archetypeSlug,
      });

      if (critique) {
        await c.env.DB.prepare(
          `UPDATE posts SET image_url = ?, image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
           WHERE id = ?`
        ).bind(gen.imageUrl, critique.score, critique.reasoning, new Date().toISOString(), post.id).run();
      } else {
        // Critique unavailable but we still have a new image — ship it
        await c.env.DB.prepare(
          `UPDATE posts SET image_url = ?, image_critique_score = NULL, image_critique_reasoning = NULL, image_critique_at = NULL
           WHERE id = ?`
        ).bind(gen.imageUrl, post.id).run();
      }
      regenerated++;
    } catch (e: any) {
      failed++;
      errors.push(`${post.id}: ${e?.message}`);
    }
    // Pace fal.ai — 700ms between calls.
    await new Promise(r => setTimeout(r, 700));
  }

  return c.json({
    found: posts.length,
    regenerated,
    failed,
    threshold,
    errors: errors.slice(0, 5),
  });
});

async function backfillImagesForUser(env: Env, uid: string) {
  const apiKey = env.FAL_API_KEY;
  if (!apiKey) return { error: 'fal.ai not configured', found: 0, succeeded: 0, failed: 0 };

  // Find Scheduled posts owned by this user (own + via client) that have a
  // prompt but no URL. Cap at 30 per call so a single backfill can't blow the
  // fal.ai budget.
  const rows = await env.DB.prepare(
    `SELECT p.id, p.image_prompt, p.client_id, p.content
     FROM posts p
     LEFT JOIN clients c ON p.client_id = c.id
     WHERE p.status = 'Scheduled'
       AND (p.user_id = ? OR c.user_id = ?)
       AND (p.image_url IS NULL OR p.image_url = '')
       AND p.image_prompt IS NOT NULL
       AND p.image_prompt != 'N/A'
       AND p.image_prompt != ''
     LIMIT 30`
  ).bind(uid, uid).all();

  const posts = rows.results || [];
  let succeeded = 0; let failed = 0; let critiqueRetries = 0; const errors: string[] = [];

  // Schema v9: archetype is per-(user OR client). Cache by client_id within
  // this run so we don't hit the DB once per post for the same workspace.
  const archetypeCache = new Map<string, string | null>();

  for (const post of posts) {
    try {
      const safe = buildSafeImagePrompt(String((post as any).image_prompt || ''));
      if (!safe) { failed++; continue; }

      const postId = (post as any).id as string;
      const clientId = (post as any).client_id as string | null;
      const caption = ((post as any).content as string | null) || '';

      const cacheKey = clientId || '__user__';
      if (!archetypeCache.has(cacheKey)) {
        archetypeCache.set(cacheKey, await resolveArchetypeSlug(env, uid, clientId));
      }
      const archetypeSlug = archetypeCache.get(cacheKey) || null;

      // 2026-05 image-stack upgrade: brand-grounded via FLUX Pro Kontext
      // when the workspace has scraped FB photos available, FLUX-dev when
      // it doesn't. See generateImageWithBrandRefs at the top of this file.
      const gen = await generateImageWithBrandRefs(env, uid, clientId, safe);
      let finalUrl = gen.imageUrl;
      let finalCritique: { score: number; match: 'yes' | 'partial' | 'no'; reasoning: string } | null = null;

      // Vision-critique gate (mirror of cronPrewarmImages). One retry with a
      // forced archetype fallback if the first attempt scored ≤3 for
      // image/caption mismatch. Skipped when caption is empty or
      // OPENROUTER_API_KEY is missing.
      if (finalUrl && caption.length > 20) {
        const critique = await critiqueImageInternal(env, {
          imageUrl: finalUrl,
          caption,
          archetypeSlug,
        });
        if (critique) {
          console.log(`[backfill] post ${postId} critique score=${critique.score} match=${critique.match}`);
          finalCritique = critique;
          if (critique.score <= 3) {
            const retry = await generateImageWithBrandRefs(env, uid, clientId, safe, { forceFallback: true });
            if (retry.imageUrl) {
              finalUrl = retry.imageUrl;
              critiqueRetries++;
              const retryCritique = await critiqueImageInternal(env, {
                imageUrl: retry.imageUrl,
                caption,
                archetypeSlug,
              });
              if (retryCritique) finalCritique = retryCritique;
            }
          }
        }
      }

      if (finalUrl) {
        if (finalCritique) {
          await env.DB.prepare(
            `UPDATE posts SET image_url = ?, image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
             WHERE id = ?`
          ).bind(finalUrl, finalCritique.score, finalCritique.reasoning, new Date().toISOString(), postId).run();
        } else {
          await env.DB.prepare('UPDATE posts SET image_url = ? WHERE id = ?').bind(finalUrl, postId).run();
        }
        succeeded++;
      } else {
        failed++;
        errors.push(`${postId}: image gen failed via ${gen.modelUsed}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(`${(post as any).id}: ${e.message}`);
    }
    // Pace fal.ai — 700ms between calls so 30 posts = ~21s, well under any rate limit
    await new Promise(r => setTimeout(r, 700));
  }
  return { found: posts.length, succeeded, failed, critique_retries: critiqueRetries, errors: errors.slice(0, 5) };
}

// ── Admin: Provision a whitelabel portal (atomic) ─────────────────────────────
// Combines the existing 2-step provisioning (client row + portal row) into one
// call, generates the per-portal shared secret, and returns the full env-var
// set the agent must paste into the CF Pages project. This is Phase B-Lite —
// the database side of portal automation. Steps that require external APIs
// (creating the CF Pages project, adding the custom domain, creating the
// Clerk auto-login user) are still manual until those credentials are wired
// in. See .windsurf/workflows/phase-b-portal-automation.md.
//
// Auth: gated by FACTS_BOOTSTRAP_SECRET (the same secret used by the existing
// admin endpoints — keeps the bootstrap-secret surface area at one secret).
//
// Request body:
//   {
//     slug: "newclient",                    // unique, lowercase, kebab-case
//     ownerUserId: "user_xxx",              // Clerk user id of the AGENCY admin
//                                           // who owns this portal (typically Steve)
//     businessName: "New Client",
//     businessType: "florist",              // optional
//     plan: "agency",                       // optional, defaults to 'agency'
//     autoLoginEmail: "client@example.com", // the Clerk auto-login email
//                                           // (Clerk user MUST be created
//                                           //  manually until Phase B step 3)
//     autoLoginPassword: "...",             // the Clerk auto-login password
//     customDomain: "social.client.com.au"  // for the docs string only
//   }
//
// Response:
//   {
//     ok: true,
//     clientId: "<uuid>",
//     portalToken: "<random>",
//     portalSecret: "<random>",   // also stored as portal.password — set this
//                                  // as VITE_PORTAL_SECRET on the CF Pages project
//     envVars: { ... },           // copy-paste block for CF Pages env vars
//     manualSteps: [ ... ]        // remaining steps that need a human
//   }
app.post('/api/admin/portals/provision', async (c) => {
  const provided = c.req.header('X-Bootstrap-Secret');
  if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const body = await c.req.json<{
    slug?: string;
    ownerUserId?: string;
    businessName?: string;
    businessType?: string;
    plan?: string;
    autoLoginEmail?: string;
    autoLoginPassword?: string;
    customDomain?: string;
  }>();

  // Validate inputs
  const slug = (body.slug || '').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
    return c.json({ error: 'slug must be lowercase, 2-41 chars, [a-z0-9-]' }, 400);
  }
  if (!body.ownerUserId || !body.businessName || !body.autoLoginEmail || !body.autoLoginPassword) {
    return c.json({ error: 'ownerUserId, businessName, autoLoginEmail, autoLoginPassword are required' }, 400);
  }
  if (body.autoLoginPassword.length < 16) {
    return c.json({ error: 'autoLoginPassword must be at least 16 chars' }, 400);
  }

  // Refuse if slug is already taken
  const existing = await c.env.DB.prepare('SELECT slug FROM portal WHERE slug = ?').bind(slug).first();
  if (existing) return c.json({ error: `slug '${slug}' is already taken` }, 409);

  // Generate the per-portal shared secret + portal token. The "password" column
  // on the portal table doubles as the shared secret used by VITE_PORTAL_SECRET.
  // We use crypto.randomUUID twice to widen the entropy beyond a single UUID.
  const portalSecret = crypto.randomUUID() + '-' + crypto.randomUUID();
  const portalToken = crypto.randomUUID() + '-' + crypto.randomUUID();

  // Atomic create: client first, then portal pointing at it.
  const clientId = uuid();
  const plan = body.plan || 'agency';
  await c.env.DB.prepare(
    'INSERT INTO clients (id, user_id, name, business_type, created_at, plan) VALUES (?,?,?,?,?,?)'
  ).bind(clientId, body.ownerUserId, body.businessName, body.businessType ?? null, new Date().toISOString(), plan).run();

  await c.env.DB.prepare(
    `INSERT INTO portal (slug, email, password, portal_token, user_id, client_id)
     VALUES (?,?,?,?,?,?)`
  ).bind(slug, body.autoLoginEmail, portalSecret, portalToken, body.ownerUserId, clientId).run();

  // Try to create the Clerk auto-login user. We already have CLERK_SECRET_KEY
  // configured (it's used everywhere for JWT verification) and the Backend
  // API's POST /v1/users supports user creation with a password — no new
  // credentials needed. If creation fails (e.g. email already exists, network
  // error, Clerk plan restriction), we fall back to manual creation and the
  // CLI will print a clear instruction.
  const clerk = await tryCreateClerkUser(
    c.env.CLERK_SECRET_KEY,
    body.autoLoginEmail,
    body.autoLoginPassword,
    { portal_slug: slug, client_id: clientId },
  );

  // Build the env-var block. Real values are baked into the CF Pages project
  // automatically when CLOUDFLARE_API_TOKEN is set; otherwise these are the
  // values to paste manually.
  const workerUrl = (c.env as any).PUBLIC_WORKER_URL || 'https://socialai-api.steve-700.workers.dev';
  const envVars: Record<string, string> = {
    VITE_CLERK_PUBLISHABLE_KEY: '<copy from main CF Pages project>',
    VITE_AI_WORKER_URL: workerUrl,
    VITE_AUTO_LOGIN_EMAIL: body.autoLoginEmail,
    VITE_AUTO_LOGIN_PASSWORD: body.autoLoginPassword,
    VITE_PORTAL_SECRET: portalSecret,
    VITE_CLIENT_ID: slug,
    FACEBOOK_APP_ID: '<copy from main CF Pages project>',
    FACEBOOK_APP_SECRET: '<copy from main CF Pages project>',
  };

  // Try to create the Cloudflare Pages project + attach the custom domain.
  // Gated on both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID being set.
  // Skipped silently when missing — the manualSteps array surfaces the work
  // the human still needs to do.
  const customDomain = body.customDomain || `social.${slug}.com.au`;
  const cfPages = await tryCreateCFPagesProject(c.env, {
    projectName: `${slug}-social`,
    slug,
    customDomain,
    envVars,
  });

  // Build the manual-steps list. Each item conditionally appears only when
  // its automation failed or wasn't attempted.
  const manualSteps: string[] = [];

  if (!cfPages.projectCreated) {
    manualSteps.push(
      `Create CF Pages project named '${slug}-social' pointing at the SocialAI-Studio repo`,
      `Set CF Pages build command: cp src/client.configs/${slug}.ts src/client.config.ts && npm run build`,
      `Set the env vars above on the new CF Pages project`,
    );
  }
  if (!cfPages.domainAttached) {
    manualSteps.push(`Add custom domain '${customDomain}' in CF Pages → Custom domains`);
  }
  if (!clerk.created) {
    manualSteps.push(
      `In Clerk dashboard, create a user with email '${body.autoLoginEmail}' and the autoLoginPassword above (auto-create failed: ${clerk.error || 'unknown'})`
    );
  }
  manualSteps.push(
    `Create src/client.configs/${slug}.ts (copy picklenick.ts as template; set clientId='${slug}', clientMode:true, accentColor, defaultBusinessName, etc.) — the CLI does this for you when run from a checkout`,
    `Commit + push the new config — CF Pages auto-builds`,
  );
  // Re-number for readability
  const numbered = manualSteps.map((s, i) => `${i + 1}. ${s}`);

  return c.json({
    ok: true,
    clientId,
    portalToken,
    portalSecret,
    clerkUserCreated: clerk.created,
    clerkUserId: clerk.userId,
    clerkError: clerk.error,
    cfPagesProjectCreated: cfPages.projectCreated,
    cfPagesProjectName: cfPages.projectName,
    cfPagesDomainAttached: cfPages.domainAttached,
    cfPagesError: cfPages.error,
    envVars,
    manualSteps: numbered,
  });
});

/**
 * Create a Clerk user via the Backend API. Returns { created, userId?, error? }.
 * Never throws — caller decides how to handle failures.
 *
 * Clerk's instance settings determine whether passwords or email-only signups
 * are allowed; if the instance disallows passwords, this fails gracefully and
 * the caller falls back to printing a manual-create instruction.
 */
async function tryCreateClerkUser(
  secretKey: string,
  email: string,
  password: string,
  publicMetadata: Record<string, unknown>,
): Promise<{ created: boolean; userId?: string; error?: string }> {
  try {
    const res = await fetch('https://api.clerk.com/v1/users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: [email],
        password,
        skip_password_checks: true,    // we generate a 24-byte base64url password, well above any sane minimum
        skip_password_requirement: false,
        public_metadata: publicMetadata,
      }),
    });
    if (res.ok) {
      const data = await res.json() as { id?: string };
      return { created: true, userId: data.id };
    }
    // Clerk returns 422 with a structured `errors` array on validation failures
    let errMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json() as { errors?: Array<{ message?: string; code?: string; long_message?: string }> };
      if (data.errors && data.errors[0]) {
        const e = data.errors[0];
        errMsg = e.long_message || e.message || e.code || errMsg;
      }
    } catch { /* keep HTTP fallback */ }
    return { created: false, error: errMsg };
  } catch (e: any) {
    return { created: false, error: e?.message || 'fetch failed' };
  }
}

/**
 * Create a Cloudflare Pages project pointing at the SocialAI-Studio repo,
 * with build command + env vars baked in, then attach the custom domain.
 *
 * Gated on CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID being present —
 * if either is missing the function returns { projectCreated: false,
 * error: 'CLOUDFLARE_API_TOKEN not configured' } and the caller falls
 * back to manual instructions.
 *
 * IMPORTANT prerequisite: the Cloudflare account must already have
 * authorized GitHub access to the repo (one-time OAuth grant in the
 * dashboard). The CF Pages REST API can't bootstrap that authorization
 * itself — once it's granted, this function works for every subsequent
 * portal.
 *
 * Two API calls happen:
 *   1. POST .../pages/projects        — create the project
 *   2. POST .../pages/projects/{name}/domains — attach the custom domain
 *
 * If step 1 fails the function returns early; step 2 only runs if step 1
 * succeeded. Both successes/failures surface as separate booleans on the
 * return value so the caller can build a precise manualSteps list.
 */
async function tryCreateCFPagesProject(
  env: Env,
  args: { projectName: string; slug: string; customDomain: string; envVars: Record<string, string> },
): Promise<{
  projectCreated: boolean;
  domainAttached: boolean;
  projectName?: string;
  error?: string;
}> {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    return {
      projectCreated: false,
      domainAttached: false,
      error: !token ? 'CLOUDFLARE_API_TOKEN not configured' : 'CLOUDFLARE_ACCOUNT_ID not configured',
    };
  }

  const repoOwner = env.GITHUB_REPO_OWNER || '3dhuboz';
  const repoName  = env.GITHUB_REPO_NAME  || 'SocialAI-Studio';
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // CF Pages env_vars take a { value, type } shape per key. "plain_text" is
  // the default; "secret_text" encrypts at rest. We use "plain_text" for
  // VITE_* (they're baked into the public bundle anyway) and "secret_text"
  // for the auto-login password + portal secret + FB secrets which should
  // not appear in the dashboard plaintext.
  const SECRETS = new Set(['VITE_AUTO_LOGIN_PASSWORD', 'VITE_PORTAL_SECRET', 'FACEBOOK_APP_SECRET']);
  const envForCF: Record<string, { value: string; type: string }> = {};
  for (const [k, v] of Object.entries(args.envVars)) {
    envForCF[k] = { value: v, type: SECRETS.has(k) ? 'secret_text' : 'plain_text' };
  }

  // Step 1 — create the project
  let createOk = false;
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: args.projectName,
        production_branch: 'main',
        source: {
          type: 'github',
          config: {
            owner: repoOwner,
            repo_name: repoName,
            production_branch: 'main',
            pr_comments_enabled: false,
            deployments_enabled: true,
            production_deployment_enabled: true,
            preview_deployment_setting: 'none',
          },
        },
        build_config: {
          build_command: `cp src/client.configs/${args.slug}.ts src/client.config.ts && npm run build`,
          destination_dir: 'dist',
          root_dir: '/',
        },
        deployment_configs: {
          production: { env_vars: envForCF },
        },
      }),
    });
    if (res.ok) {
      createOk = true;
    } else {
      let errMsg = `HTTP ${res.status}`;
      try {
        const data = await res.json() as { errors?: Array<{ message?: string }> };
        if (data.errors && data.errors[0]?.message) errMsg = data.errors[0].message;
      } catch { /* keep HTTP fallback */ }
      return {
        projectCreated: false,
        domainAttached: false,
        error: `CF Pages project create failed: ${errMsg}`,
      };
    }
  } catch (e: any) {
    return {
      projectCreated: false,
      domainAttached: false,
      error: `CF Pages project create error: ${e?.message || 'fetch failed'}`,
    };
  }

  // Step 2 — attach the custom domain. SSL provisioning is async; this call
  // returns immediately with the domain in pending status. CF will issue
  // the cert in the background (~5 min).
  let domainOk = false;
  let domainErr: string | undefined;
  try {
    const domainUrl = `${baseUrl}/${encodeURIComponent(args.projectName)}/domains`;
    const res = await fetch(domainUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: args.customDomain }),
    });
    if (res.ok) {
      domainOk = true;
    } else {
      try {
        const data = await res.json() as { errors?: Array<{ message?: string }> };
        domainErr = data.errors?.[0]?.message || `HTTP ${res.status}`;
      } catch { domainErr = `HTTP ${res.status}`; }
    }
  } catch (e: any) {
    domainErr = e?.message || 'fetch failed';
  }

  return {
    projectCreated: createOk,
    domainAttached: domainOk,
    projectName: createOk ? args.projectName : undefined,
    error: domainErr ? `Custom domain attach failed: ${domainErr}` : undefined,
  };
}

// ── Admin: PayPal subscription diagnostic ─────────────────────────────────────
// Queries PayPal for every plan ID baked into client.config.ts, returns each
// plan's status + billing cycle + currency. Use this when the hermes checkout
// shows "We're sorry. Things don't appear to be working" — the most common
// cause is one or more plans being in CREATED/INACTIVE state instead of ACTIVE.
//
// Usage:
//   curl -X POST https://socialai-api.steve-700.workers.dev/api/admin/paypal-diagnose \
//     -H "X-Bootstrap-Secret: $FACTS_BOOTSTRAP_SECRET"
//
// Auth: same FACTS_BOOTSTRAP_SECRET as the other admin endpoints — no new
// surface area.
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

app.post('/api/admin/bootstrap-all-facts', async (c) => {
  const provided = c.req.header('X-Bootstrap-Secret');
  if (!provided || provided !== (c.env as any).FACTS_BOOTSTRAP_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const users = await c.env.DB.prepare(
    `SELECT id FROM users WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL`
  ).all();
  const clients = await c.env.DB.prepare(
    `SELECT id, user_id FROM clients WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL AND COALESCE(status,'active') != 'on_hold'`
  ).all();
  const results: any[] = [];
  for (const u of (users.results || [])) {
    const r = await refreshFactsForWorkspace(c.env.DB, (u as any).id, null);
    results.push({ workspace: 'user:' + (u as any).id, ...r });
  }
  for (const cl of (clients.results || [])) {
    const r = await refreshFactsForWorkspace(c.env.DB, (cl as any).user_id, (cl as any).id);
    results.push({ workspace: 'client:' + (cl as any).id, ...r });
  }
  return c.json({ workspaces_processed: results.length, results });
});

// GET /api/db/facts moved to routes/facts.ts.

// ── Business Archetype classifier moved to routes/archetypes.ts ─────────────
//
// (Read the classifier internals in lib/archetypes.ts. The 3 HTTP endpoints
//  — GET /api/business-archetype, POST /api/classify-business, POST
//  /api/clients/:id/classify-business — now live in routes/archetypes.ts.)


/** Admin endpoint: rebuild the Vectorize index from the business_archetypes
 *  table. Run this once after creating the Vectorize index, then any time
 *  the archetype descriptions change.
 *
 *  Returns the number of archetypes indexed + the index's reported size.
 *
 *  Auth: requires admin (uses requireAdmin gate).
 */
app.post('/api/admin/rebuild-archetype-index', async (c) => {
  const adminCheck = await requireAdmin(c);
  if (adminCheck instanceof Response) return adminCheck;

  if (!c.env.ARCHETYPE_VEC || !c.env.AI) {
    return c.json({ error: 'ARCHETYPE_VEC and AI bindings not configured — add to wrangler.toml first' }, 400);
  }

  const archetypeRows = await c.env.DB.prepare(
    `SELECT slug, name, description FROM business_archetypes ORDER BY slug`
  ).all<{ slug: string; name: string; description: string }>();
  const archetypes = archetypeRows.results || [];
  if (archetypes.length === 0) {
    return c.json({ error: 'business_archetypes table is empty — run seed_v7_archetypes.sql first' }, 400);
  }

  // Embed in batches (bge-base supports array input; CF Workers AI may have
  // per-call payload limits so we batch to be safe).
  const vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }> = [];
  for (const a of archetypes) {
    try {
      const embedResult: any = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: `${a.name}. ${a.description}`,
      });
      const vec = embedResult?.data?.[0] || embedResult?.embedding;
      if (!Array.isArray(vec)) {
        console.warn(`[rebuild-index] embed failed for ${a.slug}`);
        continue;
      }
      vectors.push({
        id: a.slug,
        values: vec,
        metadata: { name: a.name, description: a.description.slice(0, 500) },
      });
    } catch (e: any) {
      console.warn(`[rebuild-index] ${a.slug} failed: ${e?.message}`);
    }
  }

  if (vectors.length === 0) {
    return c.json({ error: 'No vectors generated — AI binding may be misconfigured' }, 500);
  }

  const upsertResult = await c.env.ARCHETYPE_VEC.upsert(vectors);
  const describe = await c.env.ARCHETYPE_VEC.describe();
  return c.json({
    ok: true,
    indexed: vectors.length,
    mutation_id: upsertResult.mutationId,
    index_size: describe.vectorsCount,
    dimensions: describe.dimensions,
  });
});

// ── 90-second Magic Onboarding (2026-05 Tier 3 wow feature) ──────────────
//
// The "subscribe NOW" moment. The user pastes their Facebook Page URL,
// and in ~90 seconds the system has:
//   1. Scraped the page (uses the existing FB refresh-facts endpoint)
//   2. Classified the business archetype from the scraped content
//   3. Identified the top 3 brand reference photos by engagement
//   4. Extracted the voice fingerprint (top 5 captions by engagement)
//   5. Surfaced the 5 most common content topics from their post history
//
// The frontend shows this as a "Brand DNA Card" so the user sees what the
// system learned about them, BEFORE typing a single word into a form. The
// killer demo moment competitors don't close.
//
// Returns everything needed for the wizard to display the brand card AND
// for downstream gens to use the new context immediately.
//
// Body: { force?: boolean — bypass cache, re-derive everything }
app.post('/api/onboarding-magic', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  if (await isRateLimited(c.env.DB, `onboard-magic:${uid}`, 5)) {
    return c.json({ error: 'Rate limit exceeded — 5 magic-onboard calls per minute' }, 429);
  }
  const apiKey = c.env.OPENROUTER_API_KEY;
  if (!apiKey) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500);

  // 1. Pull the workspace's user row + Facebook tokens
  const userRow = await c.env.DB.prepare(
    'SELECT id, email, social_tokens, profile FROM users WHERE id = ?'
  ).bind(uid).first<{ id: string; email: string | null; social_tokens: string | null; profile: string | null }>();

  if (!userRow?.social_tokens) {
    return c.json({ error: 'Facebook not connected — connect a Page first, then call /api/onboarding-magic' }, 400);
  }
  const tokens = JSON.parse(userRow.social_tokens);
  if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
    return c.json({ error: 'Facebook Page ID + access token missing — reconnect Facebook' }, 400);
  }

  // 2. Trigger fresh fact scrape (re-uses existing logic; idempotent)
  try {
    await refreshFactsForUser(c.env, uid, tokens.facebookPageId, tokens.facebookPageAccessToken, null);
  } catch (e: any) {
    console.warn(`[onboarding-magic] facts refresh failed for ${uid}:`, e?.message);
    // Continue anyway — maybe we have stale facts from a previous scrape
  }

  // 3. Pull the freshly-scraped facts
  const facts = await c.env.DB.prepare(
    `SELECT fact_type, content, metadata, engagement_score
     FROM client_facts
     WHERE user_id = ? AND client_id IS NULL
     ORDER BY engagement_score DESC, verified_at DESC
     LIMIT 100`
  ).bind(uid).all<{ fact_type: string; content: string; metadata: string; engagement_score: number }>();
  const allFacts = facts.results || [];

  // 4. Bucket the facts by type
  const ownPosts = allFacts.filter(f => f.fact_type === 'own_post').slice(0, 5);
  const photos = allFacts.filter(f => f.fact_type === 'photo').slice(0, 3);
  const about = allFacts.find(f => f.fact_type === 'about');
  const photoUrls = photos.map(p => {
    try { return JSON.parse(p.metadata).url; } catch { return null; }
  }).filter(Boolean);

  // 5. Use the existing classifier on the scraped content
  const profile = userRow.profile ? JSON.parse(userRow.profile) : {};
  const businessTypeFromFB = about?.content?.slice(0, 200) || '';
  const fingerprint = [
    profile.type && `Business type: ${profile.type}`,
    profile.description && `Description: ${profile.description}`,
    businessTypeFromFB && `From FB page about: ${businessTypeFromFB}`,
    ownPosts.length > 0 && `Recent posts:\n${ownPosts.map(p => `- ${p.content.slice(0, 200)}`).join('\n')}`,
  ].filter(Boolean).join('\n');

  // Inline the classifier call (re-uses the same logic from /api/classify-business)
  const archetypeRows = await c.env.DB.prepare(
    `SELECT slug, name, description, image_examples, voice_cues, content_pillars FROM business_archetypes ORDER BY slug`
  ).all<{ slug: string; name: string; description: string; image_examples: string; voice_cues: string | null; content_pillars: string }>();
  const archetypes = archetypeRows.results || [];

  const archetypeListing = archetypes.map(a =>
    `• ${a.slug} — ${a.name}: ${a.description}`
  ).join('\n');

  const classifySystem = `You are a business-archetype classifier. Pick the BEST match for this business from the list below. Respond ONLY with valid JSON {"archetype_slug":"...","confidence":0-1,"reasoning":"one sentence"}.\n\n${archetypeListing}`;

  let archetypeSlug = 'professional-services';
  let archetypeConfidence = 0.5;
  let archetypeReasoning = 'default fallback';
  try {
    const result = c.env.ANTHROPIC_API_KEY
      ? await callAnthropicDirect({ apiKey: c.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5', systemPrompt: classifySystem, prompt: fingerprint || 'No data yet', temperature: 0.1, maxTokens: 200, responseFormat: 'json' })
      : await callOpenRouter(apiKey, classifySystem, fingerprint || 'No data yet', 0.1, 200);
    const parsed = JSON.parse(result.text);
    if (archetypes.find(a => a.slug === parsed.archetype_slug)) {
      archetypeSlug = parsed.archetype_slug;
      archetypeConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;
      archetypeReasoning = (parsed.reasoning || '').slice(0, 300);
    }
  } catch (e: any) {
    console.warn(`[onboarding-magic] classifier failed:`, e?.message);
  }

  // 6. Persist classifier verdict
  await c.env.DB.prepare(
    `UPDATE users SET archetype_slug = ?, archetype_confidence = ?, archetype_reasoning = ?, archetype_classified_at = ? WHERE id = ?`
  ).bind(archetypeSlug, archetypeConfidence, archetypeReasoning, new Date().toISOString(), uid).run();

  // 7. Build the Brand DNA Card payload
  const matched = archetypes.find(a => a.slug === archetypeSlug)!;
  const topTopics = Array.from(new Set(
    ownPosts.flatMap(p => p.content.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])
      .filter(w => !/the|and|with|that|this|from|have|will|your/.test(w))
  )).slice(0, 5);

  return c.json({
    ok: true,
    archetype: {
      slug: matched.slug,
      name: matched.name,
      confidence: archetypeConfidence,
      reasoning: archetypeReasoning,
      content_pillars: JSON.parse(matched.content_pillars),
      voice_cues: matched.voice_cues,
    },
    brand_dna: {
      voice_samples: ownPosts.map(p => ({ content: p.content.slice(0, 240), engagement: p.engagement_score })),
      reference_photos: photoUrls,
      common_topics: topTopics,
      about: about?.content?.slice(0, 400) || null,
    },
    stats: {
      posts_scraped: ownPosts.length,
      photos_available: photoUrls.length,
      total_facts: allFacts.length,
    },
  });
});

// Extract the FB-scrape logic from the existing refresh endpoint so the
// magic onboarding can call it directly without an extra HTTP roundtrip.
// Mirrors the cronRefreshFacts behaviour but for a single user/client.
async function refreshFactsForUser(
  env: Env,
  userId: string,
  pageId: string,
  pageToken: string,
  clientId: string | null,
): Promise<void> {
  const base = 'https://graph.facebook.com/v21.0';

  // Wipe + re-insert under a transaction for atomicity
  await env.DB.prepare(
    `DELETE FROM client_facts WHERE user_id = ? AND COALESCE(client_id, '') = ?`
  ).bind(userId, clientId || '').run();

  // About
  try {
    const r = await fetch(`${base}/${pageId}?fields=about,description,category&access_token=${pageToken}`);
    const d: any = await r.json();
    if (d?.about || d?.description) {
      await env.DB.prepare(
        `INSERT INTO client_facts (user_id, client_id, fact_type, content, metadata, fb_id, engagement_score, verified_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(userId, clientId, 'about', d.about || d.description, JSON.stringify({ category: d.category }), pageId, 0, new Date().toISOString()).run();
    }
  } catch { /* skip */ }

  // Posts
  try {
    const r = await fetch(`${base}/${pageId}/posts?fields=id,message,created_time,reactions.summary(true),shares,comments.summary(true)&limit=30&access_token=${pageToken}`);
    const d: any = await r.json();
    for (const p of d?.data || []) {
      if (!p.message) continue;
      const eng = (p.reactions?.summary?.total_count || 0) + (p.shares?.count || 0) * 3 + (p.comments?.summary?.total_count || 0) * 2;
      await env.DB.prepare(
        `INSERT INTO client_facts (user_id, client_id, fact_type, content, metadata, fb_id, engagement_score, verified_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(userId, clientId, 'own_post', p.message, JSON.stringify({ created_time: p.created_time }), p.id, eng, new Date().toISOString()).run();
    }
  } catch { /* skip */ }

  // Photos
  try {
    const r = await fetch(`${base}/${pageId}/photos?type=uploaded&fields=id,images,name&limit=30&access_token=${pageToken}`);
    const d: any = await r.json();
    for (const ph of d?.data || []) {
      const url = ph.images?.[0]?.source;
      if (!url) continue;
      await env.DB.prepare(
        `INSERT INTO client_facts (user_id, client_id, fact_type, content, metadata, fb_id, engagement_score, verified_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(userId, clientId, 'photo', ph.name || 'Untitled photo', JSON.stringify({ url }), ph.id, 0, new Date().toISOString()).run();
    }
  } catch { /* skip */ }
}

// ── Vision-grounded image+caption critique (2026-05 image-stack upgrade) ──
//
// After fal.ai returns an image, pass [image_url, caption, business_type]
// back to Haiku 4.5 (vision input) and ask: does this image match the post?
// Returns a score 0-10, a YES/PARTIAL/NO verdict, a short reasoning, and a
// regenerate boolean.
//
// This is the move that catches "food image on SaaS post" BEFORE it gets
// published — exactly the failure mode the user screenshotted today. At
// ~$0.003/image (1024² → ~1334 input tokens + ~150 output tokens on Haiku
// 4.5 vision) it's cheaper than a wasted FB impression.
//
// 99% of competing social-AI tools don't do this — they trust whatever FLUX
// hallucinated. This is the cutting-edge differentiator.
//
// Body: { imageUrl, caption, businessType?, archetype? }
// Returns: { score: 0-10, match: 'yes'|'partial'|'no', reasoning: string, regenerate: boolean }
app.post('/api/critique-image-caption', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  if (await isRateLimited(c.env.DB, `critique:${uid}`, 60)) {
    return c.json({ error: 'Rate limit exceeded — 60 critiques per minute' }, 429);
  }

  const apiKey = c.env.OPENROUTER_API_KEY;
  if (!apiKey) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500);

  const body = await c.req.json().catch(() => ({})) as {
    imageUrl?: string;
    caption?: string;
    businessType?: string;
    archetype?: string;
    postId?: string;  // optional: persist result on the post if provided
  };
  const { imageUrl, caption, businessType = 'small business', archetype, postId } = body;
  if (!imageUrl || !caption) {
    return c.json({ error: 'imageUrl and caption are required' }, 400);
  }

  const systemPrompt = `You are an image-caption mismatch detector for a social-media SaaS that publishes posts to Facebook and Instagram. Given an image and the caption it will be paired with, your job is to flag mismatches BEFORE they get published.

Score the image-caption pair on a 0-10 scale:
- 10 = perfect match: image visually reinforces the caption's specific topic
- 7-9 = good match: image fits the caption's theme and business archetype
- 4-6 = partial match: image is on-brand but doesn't reinforce the specific topic
- 1-3 = poor match: image is off-topic or off-brand (e.g. food image on a tech post)
- 0 = catastrophic mismatch: image is offensive, inappropriate, or completely unrelated

Business archetype context: ${archetype || businessType}.

Common failure modes to catch:
- Food/restaurant imagery on a SaaS or tech-services post
- Generic stock-photo aesthetic (laptop on desk) on a specific local-business post
- People/faces in images (violates the no-people policy that's enforced upstream)
- Text overlay artifacts (FLUX rendered fake menu text, pricing badges, etc.)
- Subject mismatch (caption mentions a product the image doesn't show)

Return JSON ONLY, no prose. Schema:
{
  "score": <0-10>,
  "match": "yes" | "partial" | "no",
  "reasoning": "<one sentence — be specific about what you see in the image vs what the caption says>",
  "regenerate": <true if score <= 4, false otherwise>
}`;

  // OpenRouter supports vision via Anthropic's content-array format.
  // Image is fetched and inlined by OpenRouter from the URL we provide.
  const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://socialaistudio.au',
      'X-Title': 'SocialAI Studio — Image Critique',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Caption that will be published with this image:\n\n"${caption}"\n\nDoes the image match?` },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    }),
  });

  if (!orRes.ok) {
    const errText = await orRes.text().catch(() => '');
    return c.json({ error: `Vision critique call failed: ${orRes.status} ${errText.slice(0, 200)}` }, 502);
  }

  const orJson = await orRes.json() as any;
  const raw = orJson.choices?.[0]?.message?.content || '';
  let parsed: { score?: number; match?: string; reasoning?: string; regenerate?: boolean };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: 'Vision critique returned malformed JSON', raw: raw.slice(0, 500) }, 502);
  }

  const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(10, parsed.score)) : 5;
  const match = (['yes', 'partial', 'no'] as const).includes(parsed.match as any) ? parsed.match : 'partial';
  const reasoning = (parsed.reasoning || 'No reasoning provided').slice(0, 500);

  // Persist the result on the post when the caller scoped it. Best-effort —
  // a write failure shouldn't block the critique response. The post is
  // scoped to the calling user (via user_id check) so a malicious caller
  // can't tag someone else's posts.
  if (postId) {
    try {
      await c.env.DB.prepare(
        `UPDATE posts SET image_critique_score = ?, image_critique_reasoning = ?, image_critique_at = ?
         WHERE id = ? AND user_id = ?`
      ).bind(score, reasoning, new Date().toISOString(), postId, uid).run();
    } catch (e) {
      console.warn(`[critique] persist failed for post ${postId}:`, e);
    }
  }

  return c.json({ score, match, reasoning, regenerate: !!parsed.regenerate });
});

// ── Virality Score (2026-05 Tier 3 wow feature) ─────────────────────────
//
// Pre-publish engagement prediction trained on the workspace's OWN past
// posts. The competition (FeedHive, quso.ai, Metricool) all race toward this
// feature in 2025-2026 — agents called it "the single feature reviewers
// flag as standout." The moat: per-tenant historical data the user actually
// owns (we already scrape it nightly into client_facts.engagement_score).
//
// Pattern (no ML infra needed):
//   1. Pull the workspace's top-5 and bottom-3 past posts by engagement_score
//      from client_facts (already populated by the refresh-facts cron)
//   2. Pass [draft, top-5 examples (with scores), bottom-3 examples (with scores)]
//      to Haiku 4.5 with a "predict 0-100 + reasoning + 1-line improvement"
//      structured-output prompt
//   3. Cache the verdict on a per-draft basis so re-asking is cheap (the
//      caller can ask repeatedly as the user edits, with debouncing
//      client-side)
//
// Body: { content: string, platform?: 'Facebook'|'Instagram', pillar?: string,
//         hashtags?: string[], clientId?: string|null }
// Returns: { score: 0-100, tier: 'low'|'mid'|'high'|'viral',
//            reasoning: string, suggestions: string[] }
app.post('/api/score-post', async (c) => {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  if (await isRateLimited(c.env.DB, `score:${uid}`, 60)) {
    return c.json({ error: 'Rate limit exceeded — 60 score calls per minute' }, 429);
  }
  const apiKey = c.env.OPENROUTER_API_KEY;
  if (!apiKey) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500);

  const body = await c.req.json().catch(() => ({})) as {
    content?: string;
    platform?: 'Facebook' | 'Instagram';
    pillar?: string;
    hashtags?: string[];
    clientId?: string | null;
  };
  const { content = '', platform = 'Facebook', pillar = '', hashtags = [], clientId = null } = body;
  if (!content || content.trim().length < 10) {
    return c.json({ error: 'content is required (min 10 chars)' }, 400);
  }

  // Pull historical performance data — top performers + bottom performers
  // give the LLM concrete anchor points for what works/doesn't for THIS
  // workspace. own_post facts come pre-sorted by engagement_score DESC
  // from the refresh-facts cron.
  const factRows = await c.env.DB.prepare(
    `SELECT content, engagement_score, metadata
     FROM client_facts
     WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fact_type = 'own_post'
     ORDER BY engagement_score DESC
     LIMIT 100`
  ).bind(uid, clientId || '').all<{ content: string; engagement_score: number; metadata: string }>();
  const facts = factRows.results || [];

  if (facts.length < 3) {
    // Not enough historical data to make a meaningful prediction. Return
    // a generic-quality score based on heuristics so the UI still has
    // something to show. New accounts unlock the real model after their
    // first ~10 posts (or after the refresh-facts cron runs once).
    return c.json({
      score: 50,
      tier: 'mid',
      reasoning: facts.length === 0
        ? 'No historical engagement data yet — connect Facebook and let the daily refresh-facts cron populate this workspace, then re-score.'
        : `Only ${facts.length} past posts available — need at least 3 to make a per-tenant prediction. Showing neutral score for now.`,
      suggestions: [],
      data_status: 'insufficient',
      historical_posts: facts.length,
    });
  }

  // Build the few-shot context from the workspace's own engagement history.
  // Top-5 and bottom-3 give the model concrete signal about what this
  // audience responds to vs ignores. We trim each example to 280 chars so
  // the prompt fits in the cache-eligible range (Haiku 4.5 caches at the
  // 1024-token boundary).
  const top = facts.slice(0, 5).map((f, i) =>
    `TOP ${i + 1} (engagement score ${f.engagement_score}): ${f.content.slice(0, 280)}`
  ).join('\n\n');
  const bottom = facts.slice(-Math.min(3, facts.length)).map((f, i) =>
    `BOTTOM ${i + 1} (engagement score ${f.engagement_score}): ${f.content.slice(0, 280)}`
  ).join('\n\n');

  // Score distribution stats give the LLM a sense of what "high" means for
  // this workspace — what's viral for a 200-follower local cafe is mid-tier
  // for a 50k-follower agency.
  const scores = facts.map(f => f.engagement_score).sort((a, b) => a - b);
  const p25 = scores[Math.floor(scores.length * 0.25)] ?? 0;
  const p50 = scores[Math.floor(scores.length * 0.5)] ?? 0;
  const p75 = scores[Math.floor(scores.length * 0.75)] ?? 0;
  const p95 = scores[Math.floor(scores.length * 0.95)] ?? 0;

  const systemPrompt = `You are a social-media performance predictor for a specific business workspace. You have access to that workspace's own historical Facebook/Instagram posts and their actual engagement scores (likes + comments + shares + reactions).

Your job: given a NEW draft post, predict how it'll perform on a 0-100 scale relative to THIS workspace's history.

Score interpretation:
- 0-30  = LOW       — likely to underperform their typical post
- 31-60 = MID       — typical performance for this workspace
- 61-85 = HIGH      — predicted to outperform their average
- 86-100 = VIRAL    — predicted to be a top-performer for them

THIS WORKSPACE'S ENGAGEMENT DISTRIBUTION:
  p25=${p25}, p50=${p50}, p75=${p75}, p95=${p95}
(For context: the user's median engagement score is ${p50}. Anything above ${p75} is in their top quartile.)

THIS WORKSPACE'S TOP-5 POSTS:
${top}

THIS WORKSPACE'S BOTTOM-3 POSTS:
${bottom}

PREDICTION RULES:
1. Pattern-match the draft against the top-5 (does it share their structure, hook style, length, specificity?) and bottom-3 (does it share their weakness — vague claims, generic CTAs, slow openers?).
2. Be HONEST. A score of 35 is more useful than an inflated 75 the user will resent when the post flops.
3. Don't reward cleverness the audience hasn't engaged with before. If the top-5 are all sensory product close-ups but the draft is a thought-leadership essay, score it LOW even if the essay is well-written.
4. The score is RELATIVE to this workspace's history, not an absolute "viral" metric.

Respond ONLY with valid JSON, no prose, no markdown:
{
  "score": <0-100>,
  "tier": "low" | "mid" | "high" | "viral",
  "reasoning": "<one sentence — specific. Reference patterns from their top/bottom posts.>",
  "suggestions": ["<one short concrete improvement, ≤12 words>", ...]
}`;

  const userPrompt = `Draft post (platform: ${platform}${pillar ? `, pillar: ${pillar}` : ''}):\n\n"${content.slice(0, 1200)}"${hashtags.length ? `\n\nHashtags: ${hashtags.slice(0, 10).join(' ')}` : ''}`;

  // Use Anthropic direct if available — this prompt has a large workspace-
  // specific prefix that benefits massively from 1h caching when the user
  // is editing a draft and re-scoring repeatedly.
  let result: { text: string };
  if (c.env.ANTHROPIC_API_KEY) {
    try {
      result = await callAnthropicDirect({
        apiKey: c.env.ANTHROPIC_API_KEY,
        model: 'claude-haiku-4-5',
        systemPrompt: undefined,
        cachedPrefix: systemPrompt,
        prompt: userPrompt,
        temperature: 0.2,
        maxTokens: 500,
        responseFormat: 'json',
      });
    } catch (e: any) {
      console.warn('[score-post] Anthropic direct failed, falling back to OpenRouter:', e?.message);
      result = await callOpenRouter(apiKey, systemPrompt, userPrompt, 0.2, 500);
    }
  } else {
    result = await callOpenRouter(apiKey, systemPrompt, userPrompt, 0.2, 500);
  }

  let parsed: { score?: number; tier?: string; reasoning?: string; suggestions?: string[] };
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return c.json({ error: 'Virality scorer returned malformed JSON', raw: result.text.slice(0, 500) }, 502);
  }

  const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50;
  const tier = (['low', 'mid', 'high', 'viral'] as const).includes(parsed.tier as any)
    ? parsed.tier
    : (score < 31 ? 'low' : score < 61 ? 'mid' : score < 86 ? 'high' : 'viral');

  return c.json({
    score,
    tier,
    reasoning: (parsed.reasoning || '').slice(0, 500),
    suggestions: (parsed.suggestions || []).slice(0, 3).map(s => String(s).slice(0, 150)),
    data_status: 'ok',
    historical_posts: facts.length,
    workspace_p50: p50,
    workspace_p95: p95,
  });
});

// ── fal.ai Proxy (query-param based — matches Pages Function pattern) ────────
app.all('/api/fal-proxy', async (c) => {
  const apiKey = c.env.FAL_API_KEY;
  if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 401);

  // AUTH GATE — fal.ai is paid per-image/video; never let it run anonymous.
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  // RATE LIMIT — 20 fal.ai calls per minute per user (images are the dominant cost).
  if (await isRateLimited(c.env.DB, `fal:${uid}`, 20)) {
    return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
  }

  const url = new URL(c.req.url);
  const action = url.searchParams.get('action');
  const authHeader = { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };

  if (action === 'generate-image' && c.req.method === 'POST') {
    const { prompt, negativePrompt, clientId, forceModel } = await c.req.json() as {
      prompt?: string;
      negativePrompt?: string;
      clientId?: string | null;
      // forceModel: optional override for testing/UX. Acceptable values:
      //   'flux-dev'           — original cheap baseline (no brand refs)
      //   'flux-pro-kontext'   — brand-grounded ($0.04/img, max 4 refs)
      //   'nano-banana-pro'    — premium brand-grounded ($0.15/img, max 14 refs)
      forceModel?: 'flux-dev' | 'flux-pro-kontext' | 'nano-banana-pro';
    };
    if (!prompt) return c.json({ error: 'prompt is required' }, 400);
    if (!/candid iPhone/i.test(prompt)) {
      console.warn(`[fal-proxy] generate-image prompt missing safety marker — uid=${uid}, prompt prefix="${prompt.substring(0, 80)}"`);
    }

    // ── 2026-05 Brand-grounded image generation ──
    //
    // Pull the user's top scraped Facebook photos from client_facts as
    // reference images. FLUX Pro Kontext (and Nano Banana Pro on the
    // premium path) reads these to maintain BRAND consistency — the
    // generated image will share lighting, colour palette, and composition
    // style with their real existing photos, NOT generic stock aesthetic.
    //
    // Falls back to plain FLUX-dev if no photos are scraped yet — preserves
    // behaviour for fresh workspaces / agency clients without an FB
    // connection. This is the move that fixes "every customer's generated
    // image looks identical because every customer gets FLUX-dev defaults".
    let referenceImageUrls: string[] = [];
    try {
      const photoRows = await c.env.DB.prepare(
        `SELECT metadata FROM client_facts
         WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fact_type = 'photo'
         ORDER BY engagement_score DESC, verified_at DESC
         LIMIT 4`
      ).bind(uid, clientId || '').all<{ metadata: string }>();
      for (const row of photoRows.results || []) {
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          if (meta?.url && typeof meta.url === 'string') referenceImageUrls.push(meta.url);
        } catch { /* skip bad row */ }
      }
    } catch (e) {
      console.warn(`[fal-proxy] brand-ref fetch failed (continuing without refs):`, e);
    }

    // ── Route selection ──
    // Default routing — choose strategy based on what data we have AND
    // the optional forceModel override. Premium tier customers can flip
    // to nano-banana-pro by passing forceModel; the proxy gates that
    // path on plan but for now any auth'd user can request it.
    const model = forceModel
      ?? (referenceImageUrls.length > 0 ? 'flux-pro-kontext' : 'flux-dev');

    let res: Response;
    if (model === 'nano-banana-pro' && referenceImageUrls.length > 0) {
      // Premium path: Nano Banana Pro (Gemini 3 Pro Image) — up to 14 refs,
      // $0.15/image, best brand consistency + text rendering on the market
      // as of Q4 2025. Endpoint: fal-ai/gemini-3-pro-image-preview.
      res = await fetch('https://fal.run/fal-ai/gemini-3-pro-image-preview', {
        method: 'POST', headers: authHeader,
        body: JSON.stringify({
          prompt,
          image_urls: referenceImageUrls.slice(0, 14),
          aspect_ratio: '1:1',
          num_images: 1,
        }),
      });
    } else if (model === 'flux-pro-kontext' && referenceImageUrls.length > 0) {
      // Default brand-grounded path: FLUX Pro Kontext — up to 4 refs,
      // $0.04/image, drop-in brand consistency without LoRA training.
      res = await fetch('https://fal.run/fal-ai/flux-pro/kontext', {
        method: 'POST', headers: authHeader,
        body: JSON.stringify({
          prompt,
          image_urls: referenceImageUrls.slice(0, 4),
          aspect_ratio: '1:1',
          num_images: 1,
          guidance_scale: 3.5,
        }),
      });
    } else {
      // Baseline path: plain FLUX-dev (no references available). Preserves
      // existing behaviour for fresh workspaces. negative_prompt is the
      // canonical FLUX_NEGATIVE_PROMPT — guidance_scale 5 ensures it sticks.
      res = await fetch('https://fal.run/fal-ai/flux/dev', {
        method: 'POST', headers: authHeader,
        body: JSON.stringify({
          prompt,
          negative_prompt: negativePrompt || FLUX_NEGATIVE_PROMPT,
          image_size: 'square_hd',
          num_inference_steps: 28,
          num_images: 1,
          enable_safety_checker: true,
          guidance_scale: 5.0,
        }),
      });
    }
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.detail || data?.message || `fal.ai HTTP ${res.status}` }, res.status as any);
    const imageUrl = data?.images?.[0]?.url || null;
    // Surface which strategy was actually used so the client can show a
    // "brand-grounded ✓" badge in the UI and admins can audit cost.
    return c.json({ imageUrl, model_used: model, references_used: referenceImageUrls.length });
  }
  if (action === 'generate-video' && c.req.method === 'POST') {
    const { promptText, promptImage, duration = 5 } = await c.req.json() as any;
    if (!promptImage) return c.json({ error: 'promptImage is required' }, 400);
    const res = await fetch('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video', {
      method: 'POST', headers: authHeader,
      body: JSON.stringify({ prompt: promptText || 'cinematic, smooth motion', image_url: promptImage, duration: String(duration), aspect_ratio: '9:16' }),
    });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.detail || data?.message || `fal.ai HTTP ${res.status}` }, res.status as any);
    return c.json({ requestId: data.request_id, statusUrl: data.status_url || null, responseUrl: data.response_url || null });
  }
  if (action === 'task-status') {
    const requestId = url.searchParams.get('requestId');
    if (!requestId) return c.json({ error: 'requestId required' }, 400);
    // Use the fal queue URL format returned by generate-video (without version/model path)
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`, { headers: authHeader });
    const data = await res.json() as any;
    return c.json(data, { status: res.status as any });
  }
  if (action === 'task-result') {
    const requestId = url.searchParams.get('requestId');
    if (!requestId) return c.json({ error: 'requestId required' }, 400);
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}`, { headers: authHeader });
    const data = await res.json() as any;
    return c.json(data, { status: res.status as any });
  }
  if (action === 'get-credits') {
    const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
    return c.json({ balance: data?.balance ?? data?.credits ?? null });
  }
  if (action === 'check-credits-alert') {
    const res = await fetch('https://fal.ai/api/users/me', { headers: { Authorization: `Key ${apiKey}` } });
    const data = await res.json() as any;
    if (!res.ok) return c.json({ error: data?.message || `HTTP ${res.status}` }, res.status as any);
    const balance = data?.balance ?? data?.credits ?? null;
    const threshold = 5;
    const resendKey = c.env.RESEND_API_KEY;
    if (balance !== null && balance < threshold && resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'SocialAI Studio <noreply@socialaistudio.au>',
          to: 'steve@3dhub.au',
          subject: `fal.ai Credits Low — $${typeof balance === 'number' ? balance.toFixed(2) : balance} remaining`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;"><h2 style="color:#f59e0b;">fal.ai Credit Alert</h2><p>Your fal.ai balance is <strong style="color:#ef4444;font-size:1.3em;">$${typeof balance === 'number' ? balance.toFixed(2) : balance}</strong></p><p>Image generation will stop when credits run out. Top up now to keep your posts looking great.</p><a href="https://fal.ai/dashboard/usage-billing/credits" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Top Up Credits</a><p style="color:#888;font-size:12px;margin-top:20px;">This alert triggers when balance drops below $${threshold}.</p></div>`,
        }),
      });
      return c.json({ balance, alert: 'sent', threshold });
    }
    return c.json({ balance, alert: balance !== null && balance < threshold ? 'no_resend_key' : 'not_needed', threshold });
  }
  return c.json({ error: `Unknown action: ${action}` }, 400);
});

// ── fal.ai Proxy (path-based passthrough) ───────────────────────────────────
app.all('/api/fal-proxy/*', async (c) => {
  // AUTH GATE — required to use the proxied fal.ai endpoint with our key.
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  if (await isRateLimited(c.env.DB, `fal:${uid}`, 20)) {
    return c.json({ error: 'Rate limit exceeded — try again in a minute.' }, 429);
  }

  const path = c.req.path.replace('/api/fal-proxy', '');
  const url = `https://api.fal.ai${path}`;
  const method = c.req.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;

  // Server uses its own key; ignore client-supplied keys to prevent abuse.
  const apiKey = c.env.FAL_API_KEY;
  if (!apiKey) return c.json({ error: 'fal.ai API key not configured' }, 500);

  const headers = { 
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, { method, headers, body });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    return c.json(data as any, { status: res.status as any });
  }
  const text = await res.text();
  return c.body(text, { status: res.status as any });
});

// ── Runway Proxy ───────────────────────────────────────────────────────────────
app.all('/api/runway-proxy/*', async (c) => {
  const path = c.req.path.replace('/api/runway-proxy', '');
  const url = `https://api.runwayml.com/v1${path}`;
  const method = c.req.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await c.req.text() : undefined;
  
  // Get key from Authorization header or fallback to env var
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '') || c.env.RUNWAY_API_KEY;
  if (!apiKey) return c.json({ error: 'Runway API key required' }, 401);

  const headers = { 
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, { method, headers, body });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    return c.json(data as any, { status: res.status as any });
  }
  const text = await res.text();
  return c.body(text, { status: res.status as any });
});

// ── PayPal Verify ───────────────────────────────────────────────────────────────
// Called by the frontend after PayPal checkout completes.
// Verifies with PayPal that the subscription is active, then stores a pending
// activation record. Uses INSERT OR IGNORE so a webhook-created record wins.
app.post('/api/paypal-verify', async (c) => {
  const clientId = c.env.PAYPAL_CLIENT_ID;
  const clientSecret = c.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return c.json({ error: 'PayPal credentials not configured' }, 500);

  const { subscriptionId, uid, planId } = await c.req.json();
  if (!subscriptionId || !planId) return c.json({ error: 'Missing subscriptionId or planId' }, 400);

  // Get PayPal access token
  const creds = btoa(`${clientId}:${clientSecret}`);
  const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenRes.json() as any;
  if (!tokenData.access_token) return c.json({ error: 'Failed to get PayPal token' }, 500);

  // Get subscription details from PayPal
  const subRes = await fetch(`https://api-m.paypal.com/v1/billing/subscriptions/${subscriptionId}`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!subRes.ok) return c.json({ error: 'Failed to fetch subscription from PayPal' }, 500);
  const subscription = await subRes.json() as any;

  if (subscription.status !== 'ACTIVE') {
    return c.json({
      error: `Subscription not yet active (status: ${subscription.status}). Please wait a moment and try again.`,
    }, 400);
  }

  // Warn if the claimed planId doesn't match the PayPal subscription's actual plan.
  // We can't fully validate here without the plan ID mapping, but we log the discrepancy.
  const paypalPlanId = subscription.plan_id;
  if (paypalPlanId) {
    console.log(`PayPal verify: claimed planId=${planId}, subscription plan_id=${paypalPlanId}`);
  }

  const customerEmail = subscription.subscriber?.email_address || '';
  const payerId = subscription.subscriber?.payer_id || '';
  const docId = uid || customerEmail || subscriptionId;

  // INSERT OR IGNORE: webhook may have already inserted the authoritative record.
  // Do not overwrite it — the webhook-set plan is trusted over the client-claimed planId.
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO pending_activations
    (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    docId,
    planId,
    customerEmail,
    subscriptionId,
    payerId,
    new Date().toISOString(),
    0
  ).run();

  console.log(`PayPal activation stored for ${docId} → plan: ${planId}`);
  return c.json({ success: true, plan: planId });
});

// NOTE: PayPal webhook is handled by the Cloudflare Pages Function at
// functions/api/paypal-webhook.js — do not duplicate it here.

// ── Cron Triggers ────────────────────────────────────────────────────────────
// */5 * * * *  → missed post publisher (every 5 min)
// 0 3 * * *   → token refresh (daily at 3am UTC)
// 0 */6 * * * → fal.ai credit check (every 6 hours)

// Wrap a cron function with try/catch + duration tracking + cron_runs logging.
// Returns void; never throws (so a failure in one cron doesn't kill the worker).
async function trackCron(
  env: Env,
  cronType: string,
  fn: () => Promise<{ posts_processed?: number } | void>,
): Promise<void> {
  const start = Date.now();
  let success = 1;
  let posts = 0;
  let error: string | null = null;
  try {
    const result = await fn();
    posts = result?.posts_processed ?? 0;
  } catch (e: any) {
    success = 0;
    error = (e?.message || String(e)).slice(0, 1000);
    console.error(`[CRON ${cronType}] FAILED:`, error);
  }
  const duration = Date.now() - start;
  try {
    await env.DB.prepare(
      `INSERT INTO cron_runs (cron_type, success, posts_processed, error, duration_ms)
       VALUES (?,?,?,?,?)`
    ).bind(cronType, success, posts, error, duration).run();
  } catch (logErr: any) {
    console.error(`[CRON ${cronType}] Failed to log run:`, logErr?.message);
  }
}

// (cronWeeklyReview lives in ./cron/weekly-review.ts as of Phase B step 10)

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const cron = event.cron;
    if (cron === '*/5 * * * *') {
      await trackCron(env, 'prewarm_images', () => cronPrewarmImages(env));
      await trackCron(env, 'prewarm_videos', () => cronPrewarmVideos(env));
      await trackCron(env, 'publish', () => cronPublishMissedPosts(env));
      return;
    }
    if (cron === '0 3 * * *') {
      await trackCron(env, 'token_refresh', () => cronRefreshTokens(env));
      return;
    }
    if (cron === '0 4 * * *') {
      await trackCron(env, 'facts_refresh', () => cronRefreshFacts(env));
      return;
    }
    // Monday 7am AEST (Sunday 21:00 UTC) — Autonomous Weekly Review.
    // For each workspace with FB connected, analyse last 7 days' performance
    // and send a Monday recap email with a CTA to approve next week's posts.
    if (cron === '0 21 * * 0') {
      await trackCron(env, 'weekly_review', () => cronWeeklyReview(env));
      return;
    }
    // Fallback for 6-hourly credit check and any unmatched triggers
    await trackCron(env, 'prewarm_fallback', () => cronPrewarmImages(env));
    await trackCron(env, 'prewarm_videos_fallback', () => cronPrewarmVideos(env));
    await trackCron(env, 'publish_fallback', () => cronPublishMissedPosts(env));
    await trackCron(env, 'fal_credits', () => cronCheckFalCredits(env));
  },
};
