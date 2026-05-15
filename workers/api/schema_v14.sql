-- ─────────────────────────────────────────────────────────────────────
--  schema_v14.sql — Portal token expiry + audit fields
--
--  Pre-2026-05 portal tokens were eternal: once issued they authenticated
--  forever, weren't workspace-scoped at the auth layer, and had no
--  revocation mechanism. A leaked token meant indefinite access until the
--  row was manually overwritten. This migration adds the minimum security
--  posture: explicit expiry, soft revocation, and last-used auditing.
--
--  Schema additions:
--    expires_at   — TEXT (ISO8601). NULL = no expiry (legacy rows,
--                   pre-migration tokens). Set to now+30d on every new
--                   issuance going forward. Re-issuing a slug refreshes
--                   the window.
--    revoked_at   — TEXT (ISO8601). NULL = active. Setting a value
--                   instantly invalidates the token without deleting the
--                   row (so admin can see who/when in audit trail).
--    last_used_at — TEXT (ISO8601). Updated opportunistically on each
--                   successful auth (~1 write per request, debounced
--                   client-side later if it shows up in hot path).
--
--  Auth-side gate (see workers/api/src/auth.ts):
--    portal_token matches
--      AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
--      AND revoked_at IS NULL
--
--  Apply with:
--    cd workers/api
--    npx wrangler d1 execute socialai-db --file=schema_v14.sql --remote
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE portal ADD COLUMN expires_at   TEXT;
ALTER TABLE portal ADD COLUMN revoked_at   TEXT;
ALTER TABLE portal ADD COLUMN last_used_at TEXT;

-- Index for the auth-time query so the WHERE clause stays cheap as the
-- portal table grows. portal_token already has implicit index via the
-- existing schema; the composite predicate (expires_at, revoked_at) is
-- best served by checking expiry post-lookup rather than indexing both
-- columns — most rows will have expires_at IS NULL OR in the future.
