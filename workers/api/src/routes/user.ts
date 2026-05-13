// User CRUD — `users` table.
//
// GET  /api/db/user   — fetch the caller's row
// PUT  /api/db/user   — UPSERT — insert if missing, otherwise patch fields
//                       listed in fieldMap. Required because Clerk users
//                       authenticate before the worker has any row for them.
// DELETE /api/db/user — wipe the caller's row (cascade rules in schema
//                       handle dependents)
//
// All authenticated via Clerk. Field map matches the camelCase frontend
// shape → snake_case D1 columns. JSON-blob fields (profile/stats/late*) are
// stringified on write; the GET returns them as raw JSON strings — the
// frontend parses on receipt.
//
// Extracted from src/index.ts as Phase B step 17 of the route-module split.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';

export function registerUserRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/db/user', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first();
    return c.json({ user: row ?? null });
  });

  app.put('/api/db/user', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json<Record<string, unknown>>();

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO users (id, email, plan, setup_status, is_admin, onboarding_done, intake_form_done,
          agency_billing_url, late_profile_id, late_connected_platforms, late_account_ids,
          fal_api_key, paypal_subscription_id, profile, stats, insight_report, billing_cycle)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        uid,
        body.email ?? null, body.plan ?? null, body.setupStatus ?? null,
        body.isAdmin ? 1 : 0, body.onboardingDone ? 1 : 0, body.intakeFormDone ? 1 : 0,
        body.agencyBillingUrl ?? null, body.lateProfileId ?? null,
        JSON.stringify(body.lateConnectedPlatforms ?? []),
        JSON.stringify(body.lateAccountIds ?? {}),
        body.falApiKey ?? null, body.paypalSubscriptionId ?? null,
        JSON.stringify(body.profile ?? {}), JSON.stringify(body.stats ?? {}),
        body.insightReport ? JSON.stringify(body.insightReport) : null,
        body.billingCycle ?? null
      ).run();
    } else {
      const sets: string[] = [];
      const vals: unknown[] = [];
      const fieldMap: Record<string, string> = {
        email: 'email', plan: 'plan', setupStatus: 'setup_status', isAdmin: 'is_admin',
        onboardingDone: 'onboarding_done', intakeFormDone: 'intake_form_done',
        agencyBillingUrl: 'agency_billing_url', lateProfileId: 'late_profile_id',
        lateConnectedPlatforms: 'late_connected_platforms', lateAccountIds: 'late_account_ids',
        falApiKey: 'fal_api_key', paypalSubscriptionId: 'paypal_subscription_id',
        profile: 'profile', stats: 'stats', insightReport: 'insight_report',
        // v5 — reel credits balance. Plan grants (PayPal webhook on renewal)
        // and one-off credit-pack purchases both increment this column.
        reelCredits: 'reel_credits',
        // v6 — 'monthly' | 'yearly'. Set when consuming a pending_activations
        // row; drives the renewal grant multiplier (×1 or ×12) so yearly subs
        // get the same total credits/year as monthly subs.
        billingCycle: 'billing_cycle',
      };
      const jsonFields = new Set(['lateConnectedPlatforms', 'lateAccountIds', 'profile', 'stats', 'insightReport']);
      const boolFields = new Set(['isAdmin', 'onboardingDone', 'intakeFormDone']);
      for (const [k, col] of Object.entries(fieldMap)) {
        if (!(k in body)) continue;
        sets.push(`${col} = ?`);
        const v = body[k];
        if (jsonFields.has(k)) vals.push(v != null ? JSON.stringify(v) : null);
        else if (boolFields.has(k)) vals.push(v ? 1 : 0);
        else vals.push(v ?? null);
      }
      if (sets.length) {
        vals.push(uid);
        await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      }
    }
    return c.json({ ok: true });
  });

  app.delete('/api/db/user', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid).run();
    return c.json({ ok: true });
  });
}
