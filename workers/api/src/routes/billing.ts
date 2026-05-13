// Billing endpoint — the SIGNED-IN user's own plan + payment history.
//
// GET /api/billing — Clerk-auth. Returns the caller's plan, subscription
//                    ID, member-since date, and recent payment events.
//                    Scoped strictly to the caller — never returns
//                    another user's data even if the caller knows the
//                    email (defense-in-depth: WHERE user_id = uid OR
//                    email = ours).
//
// Powers the Settings → Billing screen. Read-only.
//
// Extracted from src/index.ts as Phase B step 20 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';
import { PLAN_PRICE_AUD } from '../lib/pricing';

export function registerBillingRoutes(app: Hono<{ Bindings: Env }>): void {
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
}
