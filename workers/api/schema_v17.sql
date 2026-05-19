-- schema_v17: Shopify embedded app foundation.
--
-- Phase 1 of the Shopify App Store path — establishes the storage layer for
-- the OAuth shell:
--
--   shopify_stores         one row per installed store; offline access token
--                          + scopes + install/uninstall timestamps
--   shopify_oauth_state    short-lived CSRF/nonce store for the OAuth handshake
--                          (rows expire after ~10 min; GC'd opportunistically)
--   shopify_webhooks_log   audit trail for inbound webhooks (mandatory GDPR
--                          topics + app/uninstalled). Compliance review may
--                          ask to demonstrate webhook receipt.
--   shopify_products       cached product catalog per shop (populated in
--                          Phase 2; pre-creating the table here keeps the
--                          migration small once Phase 2 lands).
--
-- shopify_stores.user_id is a soft link to the existing users table for
-- merchants who ALSO have a SocialAI Studio account. The Shopify install
-- flow does NOT require an existing Clerk user — installs come from the
-- Shopify App Store and the shop is the source of truth.
--
-- Apply via:
--   cd workers/api
--   npx wrangler d1 execute socialai-db --remote --file=schema_v17.sql

CREATE TABLE IF NOT EXISTS shopify_stores (
  shop_domain TEXT PRIMARY KEY,            -- e.g. "acme-co.myshopify.com"
  access_token TEXT NOT NULL,              -- offline token (long-lived per Shopify spec)
  scopes TEXT NOT NULL,                    -- comma-separated granted scopes
  installed_at TEXT NOT NULL,
  uninstalled_at TEXT,                     -- set when app/uninstalled webhook fires
  shop_name TEXT,
  shop_email TEXT,
  country_code TEXT,
  currency TEXT,
  plan_name TEXT,                          -- basic / shopify / advanced / plus / etc.
  user_id TEXT,                            -- optional link to users.id (Clerk uid)
  metadata TEXT                             -- JSON blob for extensibility
);

CREATE INDEX IF NOT EXISTS idx_shopify_stores_user_id ON shopify_stores(user_id);
CREATE INDEX IF NOT EXISTS idx_shopify_stores_uninstalled ON shopify_stores(uninstalled_at);

-- OAuth state — short-lived nonce store. The /auth handler writes a row with
-- a freshly-generated state; the /auth/callback handler reads + deletes it
-- to validate the redirect came from Shopify. Rows older than 10 min are
-- swept opportunistically (≈1% sample rate) and TTL'd on lookup miss.
CREATE TABLE IF NOT EXISTS shopify_oauth_state (
  state TEXT PRIMARY KEY,
  shop TEXT NOT NULL,                      -- expected shop domain
  created_at INTEGER NOT NULL              -- unix ms (for TTL/GC)
);

CREATE INDEX IF NOT EXISTS idx_shopify_oauth_state_created_at ON shopify_oauth_state(created_at);

-- Inbound webhook audit log. Mandatory for App Store review — reviewers
-- regularly ask for proof that GDPR webhooks are received + acted on.
-- Keep payload size bounded; truncate at 64KB if needed at write time.
CREATE TABLE IF NOT EXISTS shopify_webhooks_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_domain TEXT NOT NULL,
  topic TEXT NOT NULL,                     -- e.g. "app/uninstalled", "customers/redact"
  payload TEXT,                            -- raw JSON body (truncated to ~64KB)
  webhook_id TEXT,                         -- X-Shopify-Webhook-Id header (idempotency)
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_webhooks_log_shop ON shopify_webhooks_log(shop_domain);
CREATE INDEX IF NOT EXISTS idx_shopify_webhooks_log_topic ON shopify_webhooks_log(topic);
CREATE INDEX IF NOT EXISTS idx_shopify_webhooks_log_received ON shopify_webhooks_log(received_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_webhooks_log_webhook_id
  ON shopify_webhooks_log(webhook_id) WHERE webhook_id IS NOT NULL;

-- Product cache (Phase 2 populates this via /sync-products + product webhooks).
-- PRIMARY KEY is composite because the same shop publishes its own product
-- GIDs; we never collide cross-shop.
CREATE TABLE IF NOT EXISTS shopify_products (
  id TEXT NOT NULL,                        -- Shopify GID, e.g. "gid://shopify/Product/123"
  shop_domain TEXT NOT NULL,
  title TEXT NOT NULL,
  handle TEXT,
  description TEXT,
  product_type TEXT,
  vendor TEXT,
  tags TEXT,                               -- comma-separated
  price TEXT,                              -- string for precision (e.g. "29.99")
  currency TEXT,
  image_url TEXT,
  status TEXT,                             -- active / draft / archived
  synced_at TEXT NOT NULL,
  raw TEXT,                                -- full product JSON (capped)
  PRIMARY KEY (id, shop_domain)
);

CREATE INDEX IF NOT EXISTS idx_shopify_products_shop ON shopify_products(shop_domain);
CREATE INDEX IF NOT EXISTS idx_shopify_products_status ON shopify_products(status);
