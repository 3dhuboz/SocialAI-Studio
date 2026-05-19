// Admin endpoints for the Shopify Stores tab.
//
// All gated by requireAdmin (Clerk JWT → users.is_admin=1), same pattern as
// admin-stats.ts. Returns aggregated views over shopify_stores +
// shopify_billing_events so the admin dashboard can render:
//
//   GET /api/admin/shopify-stores              → list with subscription summary
//   GET /api/admin/shopify-stores/:domain      → one shop + recent billing events
//
// shop_domain is treated as the resource identifier — we URL-decode it in
// the path handler.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { requireAdmin } from '../auth';
import { PLAN_INFO } from '../lib/shopify-billing';
import { sanitizeShopDomain } from '../lib/shopify-auth';

interface ShopifyStoreRow {
  shop_domain: string;
  shop_name: string | null;
  shop_email: string | null;
  country_code: string | null;
  currency: string | null;
  plan_name: string | null;
  scopes: string;
  installed_at: string;
  uninstalled_at: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  price_amount: string | null;
  price_currency: string | null;
  is_test_subscription: number;
}

export function registerAdminShopifyRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── GET /api/admin/shopify-stores ────────────────────────────────────
  // Lists every shop that's ever installed the app — including uninstalled.
  // Frontend filters/sorts client-side. Returns the plan info too so the UI
  // can render "what we charge" without hard-coding.
  app.get('/api/admin/shopify-stores', async (c) => {
    const adminCheck = await requireAdmin(c);
    if (adminCheck instanceof Response) return adminCheck;

    // Audit log — non-fatal: never fail the request if the insert errors.
    try {
      await c.env.DB.prepare(
        `INSERT INTO shopify_admin_audit (admin_uid, admin_email, action, target_shop, created_at)
         VALUES (?, ?, 'list_stores', NULL, datetime('now'))`,
      ).bind(adminCheck.uid, adminCheck.email).run();
    } catch (_err) {
      // Swallow — audit failure must not block admin observability.
    }

    // LIMIT 500 caps the result set; if any deployment exceeds this we will
    // need real pagination (cursor on installed_at) here and in the frontend.
    const rows = await c.env.DB.prepare(
      `SELECT shop_domain, shop_name, shop_email, country_code, currency,
              plan_name, scopes, installed_at, uninstalled_at,
              subscription_id, subscription_status, trial_ends_at,
              current_period_end, price_amount, price_currency,
              is_test_subscription
       FROM shopify_stores
       ORDER BY installed_at DESC
       LIMIT 500`,
    ).all<ShopifyStoreRow>();

    const stores = (rows.results ?? []).map((r) => ({
      ...r,
      is_test: r.is_test_subscription === 1,
      // Derived: simple aggregate bucket for filter chips.
      bucket: deriveBucket(r),
    }));

    // Counts for the filter chips (`active`, `trial`, `cancelled`, `uninstalled`).
    const counts = {
      total: stores.length,
      active: stores.filter((s) => s.bucket === 'active').length,
      trial: stores.filter((s) => s.bucket === 'trial').length,
      pending: stores.filter((s) => s.bucket === 'pending').length,
      cancelled: stores.filter((s) => s.bucket === 'cancelled').length,
      uninstalled: stores.filter((s) => s.bucket === 'uninstalled').length,
    };

    return c.json({
      plan: PLAN_INFO,
      counts,
      stores,
    });
  });

  // ── GET /api/admin/shopify-stores/:domain ─────────────────────────────
  // One shop + last 50 billing events. Domain is URL-encoded in the path.
  app.get('/api/admin/shopify-stores/:domain', async (c) => {
    const adminCheck = await requireAdmin(c);
    if (adminCheck instanceof Response) return adminCheck;

    const rawDomain = decodeURIComponent(c.req.param('domain') ?? '');
    const domain = sanitizeShopDomain(rawDomain);
    if (!domain) return c.json({ error: 'Invalid shop domain' }, 400);

    // Audit log — non-fatal: never fail the request if the insert errors.
    try {
      await c.env.DB.prepare(
        `INSERT INTO shopify_admin_audit (admin_uid, admin_email, action, target_shop, created_at)
         VALUES (?, ?, 'view_store', ?, datetime('now'))`,
      ).bind(adminCheck.uid, adminCheck.email, domain).run();
    } catch (_err) {
      // Swallow — audit failure must not block admin observability.
    }

    // Explicit column list — never SELECT * here; the access_token column is
    // a Shopify OAuth offline token and must never reach the browser.
    const store = await c.env.DB.prepare(
      `SELECT shop_domain, shop_name, shop_email, country_code, currency,
              plan_name, scopes, installed_at, uninstalled_at,
              subscription_id, subscription_status, trial_ends_at,
              current_period_end, price_amount, price_currency,
              is_test_subscription
       FROM shopify_stores WHERE shop_domain = ?`,
    ).bind(domain).first<ShopifyStoreRow>();

    if (!store) return c.json({ error: 'Not found' }, 404);

    const events = await c.env.DB.prepare(
      `SELECT id, event_type, subscription_id, status_from, status_to, payload, created_at
       FROM shopify_billing_events
       WHERE shop_domain = ?
       ORDER BY created_at DESC
       LIMIT 50`,
    ).bind(domain).all();

    // Post count for this shop (Phase 2 will tie posts to shopify_stores;
    // for now the count is 0 unless the schema is extended).
    return c.json({
      store: { ...store, is_test: store.is_test_subscription === 1, bucket: deriveBucket(store) },
      events: events.results ?? [],
    });
  });
}

// Derive a simple filter bucket from the raw subscription_status + install
// timestamps. The frontend trusts this so it doesn't have to duplicate the
// logic.
export function deriveBucket(row: ShopifyStoreRow): 'active' | 'trial' | 'pending' | 'cancelled' | 'uninstalled' | 'none' {
  if (row.uninstalled_at) return 'uninstalled';
  if (!row.subscription_status) return 'none';
  const status = row.subscription_status.toUpperCase();
  if (status === 'ACTIVE') {
    // Active + within trial window → trial bucket. Otherwise paid-active.
    if (row.trial_ends_at && Date.parse(row.trial_ends_at) > Date.now()) return 'trial';
    return 'active';
  }
  if (status === 'PENDING') return 'pending';
  if (status === 'DECLINED' || status === 'CANCELLED' || status === 'EXPIRED' || status === 'FROZEN') return 'cancelled';
  return 'none';
}
