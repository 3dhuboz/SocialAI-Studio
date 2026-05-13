// Pending activations + cancellations — the bridge between the PayPal
// webhook (which runs unauthenticated, in a Pages Function) and the
// authenticated Clerk session.
//
// Flow:
//   1. PayPal webhook receives BILLING.SUBSCRIPTION.ACTIVATED → calls
//      POST /api/internal/activation to insert a row with the buyer's
//      email + plan + paypal_subscription_id (consumed=0).
//   2. Buyer comes back to the site, signs in (or signs up) — frontend
//      polls GET /api/db/activations?email=... while authenticated.
//      First match wins.
//   3. Frontend stamps the row consumed=1 via PUT /api/db/activations/:id/consume
//      and posts the plan onto the user record.
//
// Cancellations follow the same shape so the user sees a "subscription
// cancelled — reactivate?" notice on next sign-in, then we consume the
// pending row to suppress the prompt forever.
//
// Internal POSTs are NOT Clerk-authenticated — they're trusted because
// inserting "pending" rows can't reach a user account directly; only a
// signed-in caller can consume them. The CF Pages Function at
// functions/api/paypal-webhook.js verifies PayPal's signature before
// forwarding.
//
// Extracted from src/index.ts as Phase B step 17 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';

const uuid = () => crypto.randomUUID();

export function registerActivationRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/db/activations', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const email = c.req.query('email') ?? null;
    const byUid = await c.env.DB.prepare('SELECT * FROM pending_activations WHERE id = ? AND consumed = 0').bind(uid).first();
    const byEmail = email ? await c.env.DB.prepare('SELECT * FROM pending_activations WHERE email = ? AND consumed = 0').bind(email).first() : null;
    const row = byUid ?? byEmail ?? null;
    return c.json({ activation: row });
  });

  app.put('/api/db/activations/:id/consume', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const id = c.req.param('id');
    await c.env.DB.prepare('UPDATE pending_activations SET consumed = 1 WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  });

  app.get('/api/db/cancellations', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const email = c.req.query('email') ?? null;
    const byUid = await c.env.DB.prepare('SELECT * FROM pending_cancellations WHERE id = ? AND consumed = 0').bind(uid).first();
    const byEmail = email ? await c.env.DB.prepare('SELECT * FROM pending_cancellations WHERE email = ? AND consumed = 0').bind(email).first() : null;
    const row = byUid ?? byEmail ?? null;
    return c.json({ cancellation: row });
  });

  app.put('/api/db/cancellations/:id/consume', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const id = c.req.param('id');
    await c.env.DB.prepare('UPDATE pending_cancellations SET consumed = 1 WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  });

  // Internal: Create pending activation (called from Pages Function PayPal webhook).
  // No Clerk auth — protected by the fact it only creates "pending" rows,
  // which require a valid authenticated user to consume.
  app.post('/api/internal/activation', async (c) => {
    const { plan, email, paypalSubscriptionId, paypalCustomerId, activatedAt } = await c.req.json<Record<string, string>>();
    if (!plan || !email) return c.json({ error: 'plan and email required' }, 400);
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO pending_activations (id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed)
       VALUES (?,?,?,?,?,?,0)`
    ).bind(id, plan, email, paypalSubscriptionId ?? null, paypalCustomerId ?? null, activatedAt ?? new Date().toISOString()).run();
    return c.json({ ok: true, id });
  });

  app.post('/api/internal/cancellation', async (c) => {
    const { email, paypalSubscriptionId, cancelledAt } = await c.req.json<Record<string, string>>();
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO pending_cancellations (id, email, paypal_subscription_id, cancelled_at, consumed)
       VALUES (?,?,?,?,0)`
    ).bind(id, email ?? null, paypalSubscriptionId ?? null, cancelledAt ?? new Date().toISOString()).run();
    return c.json({ ok: true, id });
  });
}
