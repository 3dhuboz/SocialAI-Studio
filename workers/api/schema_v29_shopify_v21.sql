-- schema_v21: OAuth-token envelope-encryption marker on shopify_stores.
--
-- Companion to workers/api/src/lib/crypto.ts. Adds a small marker column so
-- a future cleanup cron (and ad-hoc audits) can distinguish:
--   * 'plaintext' rows  — legacy access_token written before this rollout
--                          (or written after, but with MASTER_ENCRYPTION_KEY
--                          unset — graceful degradation in shopify-oauth.ts)
--   * 'v1'        rows  — AES-GCM-256 envelope, format "v1:<iv_b64>:<ct_b64>"
--
-- Migration plan (zero-downtime):
--   1. Apply this migration to add the column with DEFAULT 'plaintext'. All
--      existing rows are marked plaintext (which they are).
--   2. Deploy worker with MASTER_ENCRYPTION_KEY set as a secret. From this
--      point on, every write encrypts the token and sets
--      access_token_format='v1'. Reads transparently handle both formats.
--   3. (Future / out of scope here) A cleanup cron picks up
--      access_token_format='plaintext' rows in small batches, reads each
--      access_token, encrypts it, and rewrites the row with format='v1'.
--      The index below exists specifically so that cron's WHERE clause is
--      cheap once the plaintext set shrinks to a long tail.
--
-- D1 / SQLite caveat:
--   SQLite (and therefore D1) does NOT support `ADD COLUMN IF NOT EXISTS`.
--   If this migration was applied previously and is being re-run, the ALTER
--   below will fail with "duplicate column". That's the same risk profile
--   as schema_v17/v18 (also non-idempotent ALTERs). The CREATE INDEX is
--   guarded with IF NOT EXISTS so the index half is safe to re-run.
--
-- Apply via:
--   cd workers/api
--   npx wrangler d1 execute socialai-db --remote --file=schema_v21.sql --config wrangler.toml

ALTER TABLE shopify_stores ADD COLUMN access_token_format TEXT DEFAULT 'plaintext';

CREATE INDEX IF NOT EXISTS idx_shopify_stores_token_format
  ON shopify_stores(access_token_format);
