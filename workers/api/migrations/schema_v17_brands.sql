-- schema_v17: per-reseller branding foundation.
--
-- Today every server-emitted artifact (welcome/cancellation/admin emails,
-- OAuth callbacks, payment receipts) hardcodes "SocialAI Studio", #f59e0b,
-- socialaistudio.au, and steve@pennywiseit.com.au. The whitelabel deploys
-- swap the *frontend* config but the worker still sends emails branded as
-- the parent platform — which leaks the relationship to a reseller's
-- end-customer.
--
-- This migration lays the schema foundation for true per-reseller branding:
--
--   1. A `brands` table holds the user-visible identity (app name, colors,
--      support/from emails) plus optional per-reseller credentials for
--      PayPal plan IDs and the Facebook app. NULL credentials fall back to
--      the worker env (the default SocialAI Studio brand).
--   2. `users.brand_id` (nullable) points each user at their owning brand.
--      NULL = default brand (the SocialAI Studio platform itself). Clients
--      inherit their brand transitively via their owning user — no
--      `brand_id` is added to clients in this migration.
--   3. The default brand is seeded inline so live data keeps working
--      without a separate provisioning step.
--
-- The brand_id FK column on users is intentionally non-FK-enforced today —
-- SQLite enforces FKs only when `PRAGMA foreign_keys = ON;` is set per
-- connection, and the rest of the schema relies on application-level
-- integrity checks rather than runtime enforcement. We get the column
-- shape right here; future migrations can flip the pragma cohort-wide.
--
-- Apply via:
--   wrangler d1 execute socialai-studio-db --remote --file=workers/api/migrations/schema_v17_brands.sql

CREATE TABLE IF NOT EXISTS brands (
  id                  TEXT PRIMARY KEY,                       -- slug, e.g. 'socialai-studio'
  app_name            TEXT NOT NULL,                          -- 'SocialAI Studio'
  domain              TEXT NOT NULL,                          -- 'socialaistudio.au'
  accent_color        TEXT NOT NULL,                          -- '#f59e0b'
  bg_color            TEXT NOT NULL DEFAULT '#0a0a0f',
  support_email       TEXT NOT NULL,                          -- 'support@socialaistudio.au'
  admin_notify_email  TEXT NOT NULL,                          -- 'steve@pennywiseit.com.au'
  from_email          TEXT NOT NULL,                          -- 'hello@socialaistudio.au'
  facebook_app_id     TEXT,                                   -- NULL → falls back to env.FACEBOOK_APP_ID
  facebook_app_secret TEXT,                                   -- NULL → falls back to env.FACEBOOK_APP_SECRET
  paypal_plan_starter TEXT,                                   -- NULL → falls back to hardcoded PAYPAL_PLAN_TIER
  paypal_plan_pro     TEXT,
  paypal_plan_agency  TEXT,
  is_default          INTEGER NOT NULL DEFAULT 0,             -- exactly one row should be 1
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_domain ON brands(domain);

-- Seed the default brand from the current hardcodes. INSERT OR IGNORE makes
-- this safe to re-run during dev resets.
INSERT OR IGNORE INTO brands (
  id, app_name, domain, accent_color, support_email,
  admin_notify_email, from_email, is_default
) VALUES (
  'socialai-studio',
  'SocialAI Studio',
  'socialaistudio.au',
  '#f59e0b',
  'support@socialaistudio.au',
  'steve@pennywiseit.com.au',
  'hello@socialaistudio.au',
  1
);

-- brand_id on users. NULL = the default brand (transparently resolved by
-- loadBrandForUser in lib/brand.ts). DO NOT add to `clients` — clients
-- inherit their brand from their owning user.
ALTER TABLE users ADD COLUMN brand_id TEXT REFERENCES brands(id);
