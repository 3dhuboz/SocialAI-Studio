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
import { requireAuth } from '../middleware/auth';

export function registerUserRoutes(app: Hono<{ Bindings: Env }>): void {
  // Apply requireAuth to every /api/db/user* endpoint in one shot — the
  // pre-middleware version inlined the same 2-line getAuthUserId call at
  // the top of every handler. With the middleware, handlers can assume
  // `c.get('uid')` is set; unauthenticated requests get a JSON 401 with
  // the request id before the handler runs.
  app.use('/api/db/user', requireAuth);

  app.get('/api/db/user', async (c) => {
    const uid = c.get('uid');
    const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first();
    return c.json({ user: row ?? null });
  });

  app.put('/api/db/user', async (c) => {
    const uid = c.get('uid');
    const body = await c.req.json<Record<string, unknown>>();

    // ── Privileged fields — never settable by the caller ───────────────────
    // Pre-2026-05 these were on the PUT field map, which meant any JWT
    // holder could curl `{ "isAdmin": true, "plan": "agency", "reelCredits":
    // 9999 }` and self-promote. Now they're admin-only / webhook-only:
    //
    //   isAdmin         → flipped manually via wrangler d1 / admin tooling
    //   plan            → set by PayPal webhook (lib/paypal.ts) on subscription activate
    //   billingCycle    → set by PayPal webhook alongside plan
    //   reelCredits     → set by PayPal webhook (renewal grant) or admin-actions credit-grant
    //   posterCredits   → same as reelCredits (already absent from field map, but listed
    //                     here so future devs don't add it back)
    //   agencyBillingUrl→ admin-only — passed via admin onboarding flow
    //
    // The frontend (App.tsx) tries to send `isAdmin: true` for admin-email
    // accounts, but that determination is client-side and trivially spoofed.
    // True admin promotion now flows through `wrangler d1 execute … UPDATE
    // users SET is_admin = 1 WHERE id = ?`.
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO users (id, email, plan, setup_status, is_admin, onboarding_done, intake_form_done,
          agency_billing_url, late_profile_id, late_connected_platforms, late_account_ids,
          fal_api_key, paypal_subscription_id, profile, stats, insight_report, billing_cycle)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        uid,
        body.email ?? null,
        null,                                         // plan        — webhook-only
        body.setupStatus ?? null,
        0,                                            // is_admin    — admin-only (see comment above)
        body.onboardingDone ? 1 : 0, body.intakeFormDone ? 1 : 0,
        null,                                         // agency_billing_url — admin-only
        body.lateProfileId ?? null,
        JSON.stringify(body.lateConnectedPlatforms ?? []),
        JSON.stringify(body.lateAccountIds ?? {}),
        body.falApiKey ?? null, body.paypalSubscriptionId ?? null,
        JSON.stringify(body.profile ?? {}), JSON.stringify(body.stats ?? {}),
        body.insightReport ? JSON.stringify(body.insightReport) : null,
        null,                                         // billing_cycle — webhook-only
      ).run();
    } else {
      const sets: string[] = [];
      const vals: unknown[] = [];
      // NOTE: isAdmin / plan / billingCycle / reelCredits / agencyBillingUrl
      // are deliberately absent — see the privileged-fields comment above.
      const fieldMap: Record<string, string> = {
        email: 'email', setupStatus: 'setup_status',
        onboardingDone: 'onboarding_done', intakeFormDone: 'intake_form_done',
        lateProfileId: 'late_profile_id',
        lateConnectedPlatforms: 'late_connected_platforms', lateAccountIds: 'late_account_ids',
        falApiKey: 'fal_api_key', paypalSubscriptionId: 'paypal_subscription_id',
        profile: 'profile', stats: 'stats', insightReport: 'insight_report',
      };
      const jsonFields = new Set(['lateConnectedPlatforms', 'lateAccountIds', 'profile', 'stats', 'insightReport']);
      const boolFields = new Set(['onboardingDone', 'intakeFormDone']);
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
    const uid = c.get('uid');
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid).run();
    return c.json({ ok: true });
  });
}
