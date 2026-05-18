// Shared billing-status gate for paid AI endpoints.
//
// The pattern is: any endpoint that burns money on a third-party provider
// (fal.ai images/video, Anthropic vision critique, etc.) must refuse to
// run for users whose subscription is in 'past_due' state — that's the
// flag the PayPal webhook sets when a renewal payment fails. Without this,
// a customer with a declined card keeps generating images on our dime
// until we manually intervene.
//
// Pre-fix (security audit 2026-05-19) the gate was only applied to
// /api/ai/generate. fal-proxy (the most expensive endpoint at $0.025-$0.15
// per image), critique-image-caption, score-post, and poster image-gen
// all ran unconditionally. Customers in past_due could burn through
// provider credit until their plan eventually CANCELLED.
//
// Returns a Response (the 402 to bail with) when the user is past_due,
// or null to let the caller proceed. Use:
//
//   const denied = await checkBillingGate(c, uid);
//   if (denied) return denied;
//
// Free-tier users (no subscription yet) are NOT past_due — only customers
// with a SUSPENDED or PAYMENT.FAILED PayPal event hit this gate.

import type { Context } from 'hono';
import type { Env } from '../env';
import { SUBSCRIPTION_STATUS } from './pricing';

export async function checkBillingGate(
  c: Context<{ Bindings: Env }>,
  uid: string,
): Promise<Response | null> {
  const row = await c.env.DB.prepare('SELECT subscription_status FROM users WHERE id = ?')
    .bind(uid).first<{ subscription_status: string | null }>();
  if (row?.subscription_status === SUBSCRIPTION_STATUS.PAST_DUE) {
    return c.json({
      error: 'Your subscription payment has failed. Please update your billing details to continue using AI features.',
      code: 'PAYMENT_PAST_DUE',
    }, 402);
  }
  return null;
}
