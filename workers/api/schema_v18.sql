-- schema_v18: Shopify Billing API integration + admin visibility.
--
-- Adds columns to shopify_stores to track each merchant's subscription
-- (Shopify-hosted recurring application charge), plus a new audit table
-- for billing events. Powers:
--
--   workers/api/src/lib/shopify-billing.ts   — Billing API helper
--   workers/api/src/routes/admin-shopify.ts  — Admin dashboard endpoints
--   src/components/AdminShopifyStores.tsx    — Admin Shopify Stores panel
--
-- Pricing (set in lib/shopify-billing.ts, NOT here):
--   $29 USD / month, 14-day trial.
--
-- subscription_status values (matches Shopify GraphQL AppSubscriptionStatus):
--   PENDING     — created, awaiting merchant approval (sub-second state)
--   ACTIVE      — approved + charging
--   DECLINED    — merchant rejected the charge
--   EXPIRED     — trial ended without payment method
--   FROZEN      — payment failed, awaiting retry
--   CANCELLED   — merchant cancelled, or uninstall flow cancelled the sub
--   ACCEPTED    — legacy (older Billing API)
--
-- Apply via:
--   cd workers/api
--   npx wrangler d1 execute socialai-db --remote --file=schema_v18.sql --config wrangler.toml

ALTER TABLE shopify_stores ADD COLUMN subscription_id TEXT;
ALTER TABLE shopify_stores ADD COLUMN subscription_status TEXT;
ALTER TABLE shopify_stores ADD COLUMN trial_ends_at TEXT;
ALTER TABLE shopify_stores ADD COLUMN current_period_end TEXT;
ALTER TABLE shopify_stores ADD COLUMN price_amount TEXT;     -- e.g. "29.00"
ALTER TABLE shopify_stores ADD COLUMN price_currency TEXT;   -- e.g. "USD"
ALTER TABLE shopify_stores ADD COLUMN is_test_subscription INTEGER DEFAULT 0;
                                          -- 1 for dev stores (test: true in
                                          -- the Billing API call, never
                                          -- charges); 0 for real merchants.

CREATE INDEX IF NOT EXISTS idx_shopify_stores_sub_status
  ON shopify_stores(subscription_status);

-- Audit log of every billing-related event we observe. Lets the admin tab
-- show a per-merchant timeline and gives Shopify reviewers proof we honor
-- billing webhooks correctly. payload is the raw inbound JSON (truncated
-- to 64KB).
CREATE TABLE IF NOT EXISTS shopify_billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_domain TEXT NOT NULL,
  event_type TEXT NOT NULL,                -- 'subscription_created', 'subscription_activated', 'subscription_cancelled', 'webhook_received', etc.
  subscription_id TEXT,
  status_from TEXT,                        -- previous subscription_status (nullable)
  status_to TEXT,                          -- new subscription_status (nullable)
  payload TEXT,                            -- raw inbound JSON (truncated to 64KB)
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_billing_events_shop
  ON shopify_billing_events(shop_domain);
CREATE INDEX IF NOT EXISTS idx_shopify_billing_events_created
  ON shopify_billing_events(created_at);
CREATE INDEX IF NOT EXISTS idx_shopify_billing_events_type
  ON shopify_billing_events(event_type);
