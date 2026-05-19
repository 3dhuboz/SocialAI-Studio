// Shopify subscription reconciliation cron.
//
// Expected schedule: */15 * * * * (every 15 minutes). Wire up in
// wrangler.toml as a new [[triggers].crons] entry — another agent owns
// that change.
//
// Purpose: webhooks from Shopify (app_subscriptions/update) are the
// primary source of subscription state, but webhooks get dropped (network
// blips, App Bridge race conditions on approval redirect, Shopify-side
// outages). This cron is the safety net — for any shopify_stores row in
// a suspicious state, it asks Shopify's Admin GraphQL API for the truth
// and reconciles the DB to match.
//
// Two flavours of "suspicious":
//   1. subscription_status = 'PENDING' AND installed_at < now - 1h.
//      PENDING is supposed to last sub-second; if it's still PENDING an
//      hour after install, the approval webhook never landed.
//   2. subscription_status = 'ACTIVE' AND current_period_end < now.
//      The renewal webhook should have fired by now. Either it dropped
//      or the merchant's payment failed and Shopify cancelled silently.
//
// Each shop is wrapped in try/catch so one bad shop doesn't break the
// batch. Limited to 50 per run — at 15-min cadence that's 4800/day,
// way more headroom than the entire merchant base.
//
// Limitations:
//   - If the stored access_token is expired (401 from Shopify), we log
//     a warning and leave the row alone. Token refresh requires a fresh
//     session token from App Bridge, which only the embedded frontend
//     can generate.
//   - If the subscription_id doesn't exist on Shopify's side (node()
//     returns null), we mark the row CANCELLED — Shopify has forgotten
//     about it so we must too.

import type { Env } from '../env';
import { decryptToken } from '../lib/crypto';

const SHOPIFY_API_VERSION = '2025-01';
const BATCH_LIMIT = 50;

interface StoreRow {
  shop_domain: string;
  access_token: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  installed_at: string | null;
}

interface AppSubscriptionNode {
  id: string;
  status: string;
  currentPeriodEnd: string | null;
  trialDays: number | null;
  createdAt: string | null;
}

const RECONCILE_QUERY = `
  query ReconcileSubscription($subId: ID!) {
    node(id: $subId) {
      ... on AppSubscription {
        id
        status
        currentPeriodEnd
        trialDays
        createdAt
      }
    }
  }
`;

export async function reconcileSubscriptions(env: Env): Promise<void> {
  const nowIso = new Date().toISOString();
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Pull suspicious rows. SQLite compares ISO-8601 strings lexicographically
  // which gives correct chronological order (Z-suffixed UTC throughout).
  const rs = await env.DB.prepare(
    `SELECT shop_domain, access_token, subscription_id, subscription_status,
            current_period_end, installed_at
       FROM shopify_stores
      WHERE uninstalled_at IS NULL
        AND subscription_id IS NOT NULL
        AND (
              (subscription_status = 'PENDING' AND installed_at < ?)
           OR (subscription_status = 'ACTIVE'  AND current_period_end IS NOT NULL AND current_period_end < ?)
        )
      LIMIT ?`,
  ).bind(oneHourAgoIso, nowIso, BATCH_LIMIT).all<StoreRow>();

  const rows = rs.results ?? [];
  console.log(`[CRON reconcile_subscriptions] examining ${rows.length} suspicious shop(s)`);

  let reconciled = 0;
  let orphaned = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (!row.access_token) {
        console.warn(`[CRON reconcile_subscriptions] ${row.shop_domain}: no access_token — skipping`);
        skipped++;
        continue;
      }
      if (!row.subscription_id) {
        // Filtered out by SQL above, but TypeScript can't see that.
        skipped++;
        continue;
      }

      // Decrypt the stored access_token. decryptToken handles legacy
      // plaintext rows transparently (no "v1:" prefix → returned as-is),
      // so this works during the rollout window where some rows have been
      // migrated and others haven't. If MASTER_ENCRYPTION_KEY is unset but
      // the row IS encrypted, we skip (can't talk to Shopify without it).
      let accessToken: string;
      try {
        if (!env.MASTER_ENCRYPTION_KEY) {
          if (row.access_token.startsWith('v1:')) {
            console.warn(`[CRON reconcile_subscriptions] ${row.shop_domain}: encrypted token but MASTER_ENCRYPTION_KEY unset — skipping`);
            skipped++;
            continue;
          }
          accessToken = row.access_token;
        } else {
          accessToken = await decryptToken(env.MASTER_ENCRYPTION_KEY, row.access_token);
        }
      } catch (e: any) {
        console.error(`[CRON reconcile_subscriptions] ${row.shop_domain}: decrypt failed: ${e?.message ?? String(e)}`);
        failed++;
        continue;
      }

      const url = `https://${row.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ query: RECONCILE_QUERY, variables: { subId: row.subscription_id } }),
        });
      } catch (e: any) {
        console.error(`[CRON reconcile_subscriptions] ${row.shop_domain}: network error: ${e?.message ?? String(e)}`);
        failed++;
        continue;
      }

      // 401 = token revoked or expired. We can't refresh from a cron (App
      // Bridge session token required), so leave the row alone and log.
      if (res.status === 401) {
        console.warn(`[CRON reconcile_subscriptions] ${row.shop_domain}: 401 from Shopify — token expired/revoked, leaving row`);
        skipped++;
        continue;
      }

      if (!res.ok) {
        console.warn(`[CRON reconcile_subscriptions] ${row.shop_domain}: HTTP ${res.status} from Shopify`);
        failed++;
        continue;
      }

      let body: any;
      try {
        body = await res.json();
      } catch {
        console.warn(`[CRON reconcile_subscriptions] ${row.shop_domain}: non-JSON response (HTTP ${res.status})`);
        failed++;
        continue;
      }

      // Defensive parse — Shopify sometimes returns errors as a single
      // object instead of an array (mirrors shopify-billing.ts).
      if (body.errors) {
        const errs = Array.isArray(body.errors) ? body.errors : [body.errors];
        const msg = errs
          .map((e: any) => (typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e))))
          .join('; ');
        console.warn(`[CRON reconcile_subscriptions] ${row.shop_domain}: GraphQL errors: ${msg}`);
        failed++;
        continue;
      }

      const node = body.data?.node as AppSubscriptionNode | null | undefined;

      // node === null means Shopify has no AppSubscription with that GID.
      // The merchant may have uninstalled directly through the Shopify
      // admin (which can race with the uninstall webhook) or Shopify
      // garbage-collected an old cancelled sub. Mark CANCELLED.
      if (!node) {
        await env.DB.prepare(
          `UPDATE shopify_stores
              SET subscription_status = 'CANCELLED'
            WHERE shop_domain = ?`,
        ).bind(row.shop_domain).run();
        await env.DB.prepare(
          `INSERT INTO shopify_billing_events
             (shop_domain, event_type, subscription_id, status_from, status_to, payload, created_at)
           VALUES (?, 'cron_orphan_subscription', ?, ?, 'CANCELLED', ?, ?)`,
        ).bind(
          row.shop_domain,
          row.subscription_id,
          row.subscription_status,
          truncatePayload(JSON.stringify(body)),
          new Date().toISOString(),
        ).run();
        console.log(`[CRON reconcile_subscriptions] ${row.shop_domain}: orphan subscription ${row.subscription_id} — marked CANCELLED`);
        orphaned++;
        continue;
      }

      const shopifyStatus = node.status;
      if (!shopifyStatus) {
        console.warn(`[CRON reconcile_subscriptions] ${row.shop_domain}: node missing status field`);
        failed++;
        continue;
      }

      // Same status — nothing to reconcile. (The row may have stale
      // current_period_end but Shopify hasn't rolled the period yet
      // either; we'll re-check next tick.)
      if (shopifyStatus === row.subscription_status) {
        unchanged++;
        continue;
      }

      // Drift detected. Update DB to mirror Shopify's truth + audit.
      await env.DB.prepare(
        `UPDATE shopify_stores
            SET subscription_status = ?,
                current_period_end = COALESCE(?, current_period_end)
          WHERE shop_domain = ?`,
      ).bind(shopifyStatus, node.currentPeriodEnd ?? null, row.shop_domain).run();

      await env.DB.prepare(
        `INSERT INTO shopify_billing_events
           (shop_domain, event_type, subscription_id, status_from, status_to, payload, created_at)
         VALUES (?, 'cron_reconciled', ?, ?, ?, ?, ?)`,
      ).bind(
        row.shop_domain,
        row.subscription_id,
        row.subscription_status,
        shopifyStatus,
        truncatePayload(JSON.stringify(body)),
        new Date().toISOString(),
      ).run();

      console.log(`[CRON reconcile_subscriptions] ${row.shop_domain}: ${row.subscription_status} -> ${shopifyStatus} (reconciled)`);
      reconciled++;
    } catch (e: any) {
      // Per-shop catch — one bad shop must not break the batch.
      console.error(`[CRON reconcile_subscriptions] ${row.shop_domain}: unexpected error: ${e?.message ?? String(e)}`);
      failed++;
    }
  }

  console.log(
    `[CRON reconcile_subscriptions] complete: ${reconciled} reconciled, ${orphaned} orphaned, ${unchanged} unchanged, ${skipped} skipped, ${failed} failed (of ${rows.length})`,
  );
}

// Match the 64KB payload cap documented in schema_v18.sql on
// shopify_billing_events.payload.
function truncatePayload(s: string): string {
  const MAX = 64 * 1024;
  return s.length > MAX ? s.slice(0, MAX) : s;
}
