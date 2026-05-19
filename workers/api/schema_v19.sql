-- schema_v19: Admin Shopify performance indexes + admin action audit log.
--
-- Follows v16-v18 style: idempotent (IF NOT EXISTS / IF EXISTS guards
-- everywhere), safe to re-run, no destructive operations. D1's SQLite does
-- not support `ADD COLUMN IF NOT EXISTS`, so this migration only creates
-- new indexes and a new table — no ALTER TABLE statements.
--
-- Migrations:
--
--   1. idx_shopify_billing_events_shop_created
--      Composite index on (shop_domain, created_at DESC). Speeds up the
--      admin detail query in workers/api/src/routes/admin-shopify.ts which
--      lists billing events for a single merchant sorted by recency.
--
--   2. idx_shopify_stores_installed
--      Index on installed_at DESC. Speeds up the admin list query that
--      ORDERs stores by most-recently-installed.
--
--   3. shopify_admin_audit (+ indexes)
--      New table capturing every admin action taken against a Shopify
--      merchant (viewing a store, viewing events, etc.). To be read by
--      admin-shopify.ts in a follow-up task — schema designed here so the
--      route work is unblocked. Two indexes:
--        - idx_shopify_admin_audit_admin   — "what has this admin done?"
--        - idx_shopify_admin_audit_created — recent-actions timeline
--
-- Apply via:
--   cd workers/api
--   npx wrangler d1 execute socialai-db --remote --file=schema_v19.sql --config wrangler.toml

-- 1. Composite index for the admin detail query in admin-shopify.ts
CREATE INDEX IF NOT EXISTS idx_shopify_billing_events_shop_created
  ON shopify_billing_events(shop_domain, created_at DESC);

-- 2. Index for the admin list ORDER BY installed_at DESC
CREATE INDEX IF NOT EXISTS idx_shopify_stores_installed
  ON shopify_stores(installed_at DESC);

-- 3. Audit table for admin actions (read by admin-shopify.ts in a separate task)
CREATE TABLE IF NOT EXISTS shopify_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_uid TEXT NOT NULL,         -- Clerk uid of the admin who took action
  admin_email TEXT,
  action TEXT NOT NULL,            -- 'view_store', 'view_events', etc.
  target_shop TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_admin_audit_admin
  ON shopify_admin_audit(admin_uid);
CREATE INDEX IF NOT EXISTS idx_shopify_admin_audit_created
  ON shopify_admin_audit(created_at);
