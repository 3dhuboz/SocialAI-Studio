-- schema_v35_user_uniques_and_cascade_helpers.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Audit P0-5 (2026-05-22): UNIQUE constraints on users.email and
-- users.paypal_subscription_id.
--
-- D1 doesn't enable `PRAGMA foreign_keys` per-statement, so the
-- `FOREIGN KEY ... ON DELETE CASCADE` clauses declared in earlier
-- schemas never fire. The new explicit-per-table-DELETE pattern in
-- routes/user.ts:DELETE handles user-deletion cascade in code rather
-- than at the FK layer.
--
-- For the integrity audit's "no UNIQUE on users.email / paypal_subscription_id"
-- P0: partial UNIQUE indexes are the right shape. Both columns are
-- legitimately NULL for some rows (Shopify sentinel users have no
-- Clerk email; non-paying users have no PayPal sub) and SQLite treats
-- multiple NULLs as distinct, so a partial index keyed on `IS NOT NULL`
-- enforces uniqueness on the populated subset without blocking the
-- NULL sentinels.
--
-- IMPORTANT: if there are existing duplicate rows, these CREATE UNIQUE
-- INDEX statements will fail. Pre-flight with:
--   SELECT email, COUNT(*) c FROM users WHERE email IS NOT NULL GROUP BY email HAVING c > 1;
--   SELECT paypal_subscription_id, COUNT(*) c FROM users WHERE paypal_subscription_id IS NOT NULL GROUP BY paypal_subscription_id HAVING c > 1;
-- If either returns rows, dedup manually (keep the oldest row, transfer
-- any plan/credits onto it, delete the rest) before applying.
--
-- Apply with:
--   wrangler d1 execute socialai-db --remote --file=schema_v35_user_uniques_and_cascade_helpers.sql
--   wrangler d1 execute socialai-db-staging --remote --file=schema_v35_user_uniques_and_cascade_helpers.sql

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users(email) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_paypal_sub_unique
  ON users(paypal_subscription_id) WHERE paypal_subscription_id IS NOT NULL;
