// PayPal helpers — auth, webhook signature verify, recurring-credit grants,
// payments-audit-trail insert, and the two HTML email templates that ship
// when a subscription activates or cancels.
//
// Shared by:
//   - routes/paypal.ts (verify / credit-pack-confirm / webhook / admin-diagnose)
//   - routes/health.ts (/api/health/onboarding probes paypalAccessToken)
//
// Plan-ID → tier mappings (PAYPAL_PLAN_TIER, PAYPAL_YEARLY_PLAN_IDS) are
// kept in sync with src/client.config.ts paypalPlanIds + paypalYearlyPlanIds.
// Both monthly and yearly IDs map to the same tier since `clients.plan`
// doesn't distinguish billing cycle — REEL_CREDITS_PER_MONTH × 12 covers
// the yearly cadence multiplier.
//
// Extracted from src/index.ts as Phase B step 19 of the route-module split.

import type { Context } from 'hono';
import type { Env } from '../env';
import { SUBSCRIPTION_STATUS } from './pricing';
import type { Brand } from './brand';

const uuid = () => crypto.randomUUID();

export const PAYPAL_API_BASE = 'https://api-m.paypal.com';

// ADMIN_NOTIFY_EMAIL is the platform-wide ops inbox for the default brand.
// Kept exported for legacy callers; per-brand admin emails are now resolved
// via loadBrandForUser(env, userId).adminNotifyEmail and that should be
// preferred going forward. See TODO_WHITELABEL.md.
export const ADMIN_NOTIFY_EMAIL = 'steve@pennywiseit.com.au';

// Plan-ID → tier mapping. Keep in sync with src/client.config.ts paypalPlanIds
// and paypalYearlyPlanIds. Both monthly and yearly IDs map to the same tier
// since `clients.plan` doesn't distinguish billing cycle.
export const PAYPAL_PLAN_TIER: Record<string, string> = {
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
export const PAYPAL_YEARLY_PLAN_IDS = new Set([
  'P-62C327553Y779300FNHDUU7Y',
  'P-60J02873W1559770VNHDUVAA',
  'P-6G9907746Y8649457NHDUVAA',
  'P-1BH48559DE324360CNHDUVAA',
]);

// Reel credits granted per billing cycle, per plan tier. Mirrored in the
// frontend `client.configs/*.ts` plan feature lines — keep them in sync.
// Yearly subscribers get this × 12 on each annual renewal (PAYMENT.SALE.COMPLETED
// fires once for them per year).
export const REEL_CREDITS_PER_MONTH: Record<string, number> = {
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
export const REEL_CREDIT_PACKS: Record<string, { credits: number; amount: number; currency: string }> = {
  small:  { credits: 3,  amount: 9.99,  currency: 'AUD' },
  medium: { credits: 10, amount: 24.99, currency: 'AUD' },
  large:  { credits: 25, amount: 49.99, currency: 'AUD' },
};

// Grant reel credits for a recurring PayPal payment (PAYMENT.SALE.COMPLETED).
// Looks up the user's billing_cycle to decide the multiplier (yearly subs
// get 12× the monthly amount on each annual renewal so total cadence matches
// monthly subs). Caller MUST gate on a fresh INSERT to the payments table —
// this function does no idempotency check of its own; relying on the table's
// unique paypal_event_id index in the caller is simpler and race-free.
export async function grantReelCreditsForRenewal(env: Env, userId: string, plan: string): Promise<void> {
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

export async function paypalAccessToken(env: Env): Promise<string> {
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

export async function paypalVerifyWebhookSignature(req: Request, rawBody: string, token: string, env: Env): Promise<boolean> {
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

// Welcome email rendered for a new PayPal subscriber. Brand-aware: every
// surface that used to hardcode "Social AI Studio" / #f59e0b / #0a0a0f /
// socialaistudio.au / support@pennywiseit.com.au now reads from `brand`.
//
// Brand resolution lives in lib/brand.ts — callers should pass the result
// of `loadBrandForUser(env, userId)` (or `loadDefaultBrand(env)` when the
// user_id is unknown, e.g. webhook-only flows before the activation is
// consumed).
export function welcomeEmailHtml(brand: Brand, plan: string): string {
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
  const steps = ['Log in and complete your business profile','Connect your Facebook & Instagram pages','Generate your first AI post and schedule it'];
  const accent = brand.accentColor;
  const bg = brand.bgColor;
  const appName = brand.appName;
  const dashUrl = `https://${brand.domain}`;
  const supportEmail = brand.supportEmail;
  const stepsHtml = steps.map((s, i) =>
    `<div style="display:flex;align-items:center;gap:12px;"><div style="width:24px;height:24px;background:${accent}22;border:1px solid ${accent}44;border-radius:50%;display:flex;align-items:center;justify-content:center;color:${accent};font-size:11px;font-weight:700;flex-shrink:0;">${i+1}</div><span style="color:#d1d5db;font-size:13px;">${s}</span></div>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:560px;margin:0 auto;padding:40px 24px;"><div style="text-align:center;margin-bottom:32px;"><div style="display:inline-flex;align-items:center;gap:10px;background:#111118;border:1px solid #1f2937;border-radius:50px;padding:10px 20px;"><span style="font-size:18px;">✨</span><span style="color:${accent};font-weight:800;font-size:15px;">${appName}</span></div></div><div style="background:linear-gradient(135deg,${accent}22,#ef444411);border:1px solid ${accent}33;border-radius:20px;padding:40px 32px;text-align:center;margin-bottom:24px;"><div style="font-size:48px;margin-bottom:16px;">🎉</div><h1 style="color:#ffffff;font-size:26px;font-weight:900;margin:0 0 12px;">You're all set!</h1><p style="color:#9ca3af;font-size:15px;line-height:1.6;margin:0 0 24px;">Your <strong style="color:${accent};">${planName} Plan</strong> is now active. Welcome to ${appName} — let's grow your social media together.</p><a href="${dashUrl}" style="display:inline-block;background:linear-gradient(135deg,${accent},#ef4444);color:#000;font-weight:900;font-size:14px;padding:14px 32px;border-radius:50px;text-decoration:none;">Open Dashboard →</a></div><div style="background:#111118;border:1px solid #1f2937;border-radius:16px;padding:24px 28px;margin-bottom:16px;"><h2 style="color:#ffffff;font-size:14px;font-weight:700;margin:0 0 16px;">What happens next?</h2><div style="display:flex;flex-direction:column;gap:12px;">${stepsHtml}</div></div><p style="text-align:center;color:#374151;font-size:11px;margin:0;">Questions? <a href="mailto:${supportEmail}" style="color:${accent};text-decoration:none;">${supportEmail}</a> · <a href="${dashUrl}" style="color:${accent};text-decoration:none;">${brand.domain}</a></p></div></body></html>`;
}

// Cancellation email — same brand-aware shape as welcomeEmailHtml.
export function cancellationEmailHtml(brand: Brand): string {
  const accent = brand.accentColor;
  const bg = brand.bgColor;
  const appName = brand.appName;
  const dashUrl = `https://${brand.domain}`;
  const supportEmail = brand.supportEmail;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:560px;margin:0 auto;padding:40px 24px;"><div style="text-align:center;margin-bottom:32px;"><div style="display:inline-flex;align-items:center;gap:10px;background:#111118;border:1px solid #1f2937;border-radius:50px;padding:10px 20px;"><span style="font-size:18px;">✨</span><span style="color:${accent};font-weight:800;font-size:15px;">${appName}</span></div></div><div style="background:#111118;border:1px solid #374151;border-radius:20px;padding:40px 32px;text-align:center;margin-bottom:24px;"><h1 style="color:#ffffff;font-size:22px;font-weight:900;margin:0 0 12px;">Subscription Cancelled</h1><p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 24px;">Your ${appName} subscription has been cancelled. You'll retain access until the end of your current billing period.</p><p style="color:#6b7280;font-size:13px;margin:0;">Changed your mind? <a href="${dashUrl}" style="color:${accent};text-decoration:none;">Reactivate your plan</a> anytime.</p></div><p style="text-align:center;color:#374151;font-size:11px;margin:0;">Questions? <a href="mailto:${supportEmail}" style="color:${accent};text-decoration:none;">${supportEmail}</a></p></div></body></html>`;
}

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
export async function recordPaymentEvent(c: Context<{ Bindings: Env }>, event: any): Promise<void> {
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
    // Successful payment — clear any past_due flag so AI generation
    // resumes. Scoped to 'past_due' so we don't stomp a NULL unnecessarily.
    try {
      await c.env.DB.prepare(
        `UPDATE users SET subscription_status = NULL WHERE id = ? AND subscription_status = ?`
      ).bind(userId, SUBSCRIPTION_STATUS.PAST_DUE).run();
    } catch { /* non-critical — gate will clear on next successful call */ }
  }

  // Failed payment — mark the user past_due so AI generation is gated
  // until billing is resolved. Gates in routes/ai.ts check this column.
  if (eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' && userId) {
    try {
      await c.env.DB.prepare(
        `UPDATE users SET subscription_status = ? WHERE id = ?`
      ).bind(SUBSCRIPTION_STATUS.PAST_DUE, userId).run();
      console.log(`[billing] user ${userId} marked past_due — payment failed`);
    } catch (e: any) {
      console.warn(`[billing] failed to mark user ${userId} past_due:`, e?.message);
    }
  }
}
