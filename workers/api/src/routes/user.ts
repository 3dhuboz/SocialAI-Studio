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
import { deleteLearningUserData } from '../lib/learning/deletion';
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
    //   isAdmin               → flipped manually via wrangler d1 / admin tooling
    //   plan                  → set by PayPal webhook (lib/paypal.ts) on subscription activate
    //   billingCycle          → set by PayPal webhook alongside plan
    //   reelCredits           → set by PayPal webhook (renewal grant) or admin-actions credit-grant
    //   posterCredits         → same as reelCredits (already absent from field map, but listed
    //                           here so future devs don't add it back)
    //   agencyBillingUrl      → admin-only — passed via admin onboarding flow
    //   paypalSubscriptionId  → webhook-only / activation-consume-only — removed from field
    //                           map 2026-05-22 (audit P1) so a client cannot steal another
    //                           user's PayPal link by POSTing { paypalSubscriptionId: "sub_..." }.
    //                           Set by lib/paypal.ts on ACTIVATED webhook + routes/activations.ts
    //                           consume path.
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
        body.falApiKey ?? null,
        null,                                         // paypal_subscription_id — webhook-only
        JSON.stringify(body.profile ?? {}), JSON.stringify(body.stats ?? {}),
        body.insightReport ? JSON.stringify(body.insightReport) : null,
        null,                                         // billing_cycle — webhook-only
      ).run();
    } else {
      const sets: string[] = [];
      const vals: unknown[] = [];
      // NOTE: isAdmin / plan / billingCycle / reelCredits / agencyBillingUrl /
      // paypalSubscriptionId are deliberately absent — see the privileged-
      // fields comment above.
      const fieldMap: Record<string, string> = {
        email: 'email', setupStatus: 'setup_status',
        onboardingDone: 'onboarding_done', intakeFormDone: 'intake_form_done',
        lateProfileId: 'late_profile_id',
        lateConnectedPlatforms: 'late_connected_platforms', lateAccountIds: 'late_account_ids',
        falApiKey: 'fal_api_key',
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

  // DELETE /api/db/user — full GDPR account deletion.
  //
  // Audit P0-5 (2026-05-22): D1 doesn't enable PRAGMA foreign_keys per
  // statement (documented in schema_v19_brands.sql L23-27), so the
  // `FOREIGN KEY ... ON DELETE CASCADE` declarations never fire. Before
  // this fix, `DELETE FROM users` orphaned every owned row: posts (with
  // captions + image URLs), clients (with business profiles), social_tokens
  // (raw FB Page access tokens), portal (whitelabel passwords), scraped FB
  // engagement data, posters in R2, etc. That's a GDPR Article 17
  // violation — the customer's "right to erasure" was a silent no-op.
  //
  // We now mirror the Shopify shop/redact pattern (routes/shopify-oauth.ts:830-882):
  // explicit per-table DELETEs in dependency order, with the users row
  // last. PII-bearing tables first; admin / audit tables that may keep
  // anonymized references for billing reconciliation are addressed in
  // followups.
  //
  // Tables covered:
  //   - posts (content, image_url, scheduled_for, reasoning)
  //   - clients (name, business profile JSON)
  //   - posters + poster_brand_kit (logo/brand assets)
  //   - campaigns (marketing copy)
  //   - client_facts (scraped FB engagement history)
  //   - postproxy_profiles (FB Page IDs + Postproxy mapping)
  //   - portal (whitelabel slug + admin password)
  //   - pending_activations / pending_cancellations (via email)
  //   - ai_usage (per-call metadata, contains caption/prompt fragments)
  //   - rate_limit_log (per-uid counters)
  //   - onboarding_state (intake form free-text)
  //
  // R2 poster bytes are NOT purged here yet — tracked as a P1 follow-up
  // since it requires the SELECT-keys-then-delete-objects pattern
  // (shopify-oauth.ts:842-849). Documented in the PR body so Steve can
  // run a one-shot wrangler r2 lifecycle if needed.
  app.delete('/api/db/user', async (c) => {
    const uid = c.get('uid');

    // Resolve email + active PayPal subscription_id up-front — pending_*
    // rows are keyed by email, and the PayPal cancel call needs the
    // subscription_id before we DELETE the users row.
    const userRow = await c.env.DB.prepare(
      'SELECT email, paypal_subscription_id FROM users WHERE id = ?'
    ).bind(uid).first<{ email: string | null; paypal_subscription_id: string | null }>();
    const email = userRow?.email ?? null;
    const paypalSubId = userRow?.paypal_subscription_id ?? null;

    // Collect R2 poster keys BEFORE we DELETE FROM posters (otherwise the
    // pointer rows are gone and we leak bucket bytes). The actual R2 delete
    // loop happens at the bottom after the D1 purge — DB is source of truth.
    const posterKeyRows = await c.env.DB.prepare(
      `SELECT image_r2_key FROM posters WHERE user_id = ? AND image_r2_key IS NOT NULL`
    ).bind(uid).all<{ image_r2_key: string | null }>();
    const posterKeys = (posterKeyRows.results ?? [])
      .map((r) => r.image_r2_key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);

    // ── Cancel active PayPal subscription first (audit P0-7, 2026-05-22) ──
    // Pre-fix: the delete-account flow purged the user's data but left
    // PayPal billing them forever. Customer lost data AND kept getting
    // charged — direct refund-magnet scenario.
    // Now: cancel via PayPal Billing API before purging D1. Failures
    // here are NON-fatal so a transient PayPal outage doesn't block the
    // GDPR delete — we log + continue, and the customer can dispute the
    // charge if PayPal really didn't honour the cancel.
    if (paypalSubId) {
      try {
        const { cancelPayPalSubscription } = await import('../lib/paypal');
        const result = await cancelPayPalSubscription(c.env, paypalSubId, 'user_account_deleted');
        console.log(`[user-delete] PayPal sub ${paypalSubId} → cancelled=${result.cancelled} alreadyTerminal=${result.alreadyTerminal}`);
      } catch (e: any) {
        console.warn(`[user-delete] PayPal cancel failed for ${paypalSubId}: ${e?.message || e} — proceeding with D1 purge anyway`);
      }
    }

    await deleteLearningUserData(c.env.DB, uid);

    // Per-table purges. Wrap each in try/catch so a missing table (e.g.
    // a future schema rename) doesn't abort the whole delete. Order
    // matters loosely — child rows first, then parent, but D1's lack of
    // active FK enforcement means we mostly just need everything gone.
    const purges: Array<{ name: string; sql: string; binds: unknown[] }> = [
      { name: 'posts',                 sql: `DELETE FROM posts WHERE user_id = ?`,                 binds: [uid] },
      { name: 'campaigns',             sql: `DELETE FROM campaigns WHERE user_id = ?`,             binds: [uid] },
      { name: 'client_facts',          sql: `DELETE FROM client_facts WHERE user_id = ?`,          binds: [uid] },
      { name: 'posters',               sql: `DELETE FROM posters WHERE user_id = ?`,               binds: [uid] },
      { name: 'poster_brand_kit',      sql: `DELETE FROM poster_brand_kit WHERE user_id = ?`,      binds: [uid] },
      { name: 'postproxy_profiles',    sql: `DELETE FROM postproxy_profiles WHERE user_id = ?`,    binds: [uid] },
      { name: 'portal',                sql: `DELETE FROM portal WHERE user_id = ?`,                binds: [uid] },
      { name: 'clients',               sql: `DELETE FROM clients WHERE user_id = ?`,               binds: [uid] },
      { name: 'ai_usage',              sql: `DELETE FROM ai_usage WHERE user_id = ?`,              binds: [uid] },
      { name: 'rate_limit_log',        sql: `DELETE FROM rate_limit_log WHERE key LIKE ?`,         binds: [`%:${uid}`] },
      { name: 'onboarding_state',      sql: `DELETE FROM onboarding_state WHERE user_id = ?`,      binds: [uid] },
    ];
    if (email) {
      purges.push(
        { name: 'pending_activations',   sql: `DELETE FROM pending_activations WHERE email = ?`,   binds: [email] },
        { name: 'pending_cancellations', sql: `DELETE FROM pending_cancellations WHERE email = ?`, binds: [email] },
      );
    }

    for (const p of purges) {
      try {
        await c.env.DB.prepare(p.sql).bind(...p.binds).run();
      } catch (e: any) {
        // Likely "no such table" or "no such column" against a schema
        // we haven't actually applied yet. Log and continue — partial
        // purge is better than a 500 that aborts the whole delete.
        console.warn(`[user-delete] ${p.name} purge skipped: ${e?.message || e}`);
      }
    }

    // Finally the users row itself.
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid).run();

    // R2 poster-bytes purge (audit P1 follow-up, 2026-05-22). Best-effort
    // — D1 is already consistent above, so an R2 failure here doesn't
    // roll the delete back. Mirrors the shop/redact pattern. R2 deletes
    // are cheap (no quota cost) and the customer expects their data
    // gone, so we just iterate.
    if (c.env.POSTER_ASSETS && posterKeys.length > 0) {
      for (const key of posterKeys) {
        try {
          await c.env.POSTER_ASSETS.delete(key);
        } catch (e: any) {
          console.warn(`[user-delete] R2 delete ${key} skipped: ${e?.message || e}`);
        }
      }
      console.log(`[user-delete] purged ${posterKeys.length} R2 objects for uid=${uid}`);
    }

    console.log(`[user-delete] purged uid=${uid} email=${email ?? 'null'}`);
    return c.json({ ok: true });
  });
}
