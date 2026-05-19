-- schema_v24: Instagram support via Postproxy.
--
-- Adds `platform` column to postproxy_profiles so a single workspace can
-- own BOTH an FB profile AND an IG profile (Postproxy's
-- initialize_connection requires one platform per OAuth flow — see
-- postproxy-docs §profile-groups). Existing rows default to 'facebook'
-- which preserves all current behaviour.
--
-- Unique indexes must be rebuilt to include platform — otherwise a
-- workspace's second-platform connection violates the (user_id) /
-- (user_id, client_id) unique constraint.
--
-- Apply with:
--   cd workers/api
--   wrangler d1 execute socialai-db --remote --file=schema_v24_postproxy_ig.sql
--
-- Backend caller compatibility: every callsite that reads
-- postproxy_profiles without a platform filter will now match the
-- FIRST row found (typically the FB one). Callsites that need
-- platform-aware lookup (publish-missed cron, init-connection route)
-- will get their changes in the ig-wire-cron / ig-wire-routes follow-up
-- PRs. This migration is safe to ship alone.

-- 1. Add the platform column. DEFAULT 'facebook' backfills existing rows.
ALTER TABLE postproxy_profiles ADD COLUMN platform TEXT NOT NULL DEFAULT 'facebook';

-- 2. Drop the old single-platform partial unique indexes.
DROP INDEX IF EXISTS idx_postproxy_workspace_own;
DROP INDEX IF EXISTS idx_postproxy_workspace_client;

-- 3. Rebuild with platform as the 3rd dimension. Same partial-index split
--    (own vs client) — SQLite treats NULL as distinct in regular UNIQUE
--    constraints, so partial indexes remain the safest enforcement.
CREATE UNIQUE INDEX idx_postproxy_workspace_own
  ON postproxy_profiles(user_id, platform) WHERE client_id IS NULL;
CREATE UNIQUE INDEX idx_postproxy_workspace_client
  ON postproxy_profiles(user_id, client_id, platform) WHERE client_id IS NOT NULL;

-- 4. Lookup index for the cron path (mapping loader will gain platform
--    filtering in the follow-up PR).
CREATE INDEX IF NOT EXISTS idx_postproxy_workspace_platform
  ON postproxy_profiles(user_id, client_id, platform);
