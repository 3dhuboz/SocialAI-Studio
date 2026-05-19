-- schema_v22: Postproxy integration.
--
-- We're migrating off direct Facebook Graph publishing onto Postproxy
-- (https://postproxy.dev) — a hosted publishing layer that owns the OAuth
-- token lifecycle, reel upload pipeline, and per-platform status webhook
-- fan-out. Today the worker juggles all three: refresh-tokens cron rotates
-- 60-day FB user tokens, poll-pending-reels cron polls Graph for reel
-- container status, and the publish path has to deal with Graph's
-- multipart container/finalize dance. Each of those is a failure surface
-- we don't want to operate.
--
-- The schema lays down three things:
--
--   1. A per-user / per-client `use_postproxy` boolean. The cutover is
--      planned as a brief dual-path window — for ~2 weeks both the
--      legacy Graph path and the new Postproxy path will live in
--      publish-missed cron, gated by this flag. New connections set it
--      to 1; existing customers get migrated by the MigrationBanner flow.
--      Default 0 keeps live data on the legacy path until they reconnect.
--
--   2. A new `postproxy_profiles` table — single row per
--      (user_id, client_id) workspace tuple — holding the Postproxy
--      profile_group, profile, and placement (FB Page) IDs. SQLite treats
--      NULL as distinct in regular UNIQUE constraints, so we use two
--      partial unique indexes to enforce "one own-workspace row per user"
--      AND "one row per (user, client) tuple" without colliding.
--
--   3. Per-post Postproxy tracking columns (`postproxy_post_id`,
--      `postproxy_status`, `postproxy_permalink`, `postproxy_sent_at`,
--      `postproxy_finished_at`) plus a tiny `postproxy_webhook_events`
--      table for idempotent webhook delivery. Postproxy retries failed
--      deliveries — we INSERT OR IGNORE on event_id and short-circuit
--      duplicates with a 200 no-op.
--
-- Existing fb_* columns on posts and the Graph-side fields in
-- social_tokens are intentionally NOT dropped here — they need to stay
-- readable during the dual-path window. A future schema_v23 deletes them
-- once every workspace has `use_postproxy = 1`.
--
-- Apply via:
--   cd workers/api
--   npx wrangler d1 execute socialai-db --remote --file=schema_v22_postproxy.sql

-- ──────────────────────────────────────────────────────────────────────
-- 1. Per-workspace feature flag for cutover window.
-- ──────────────────────────────────────────────────────────────────────
-- Default 0 = legacy Graph path. The frontend's "Connect via Postproxy"
-- flow flips this to 1 on first save-placement. Cron branches on this.
ALTER TABLE users   ADD COLUMN use_postproxy INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN use_postproxy INTEGER DEFAULT 0;

-- ──────────────────────────────────────────────────────────────────────
-- 2. Per-workspace Postproxy mapping.
-- ──────────────────────────────────────────────────────────────────────
-- Single row per (user_id, client_id) tuple. client_id IS NULL for the
-- user's own workspace (no agency client). Profile/placement IDs are
-- populated as the OAuth + placement-picker flow progresses:
--   - INSERT happens at init-connection time (group_id only, status=pending)
--   - oauth_state is the redirect nonce, cleared once OAuth completes
--   - postproxy_profile_id arrives via the oauth-callback
--   - postproxy_placement_id is set when the user picks a FB Page
CREATE TABLE IF NOT EXISTS postproxy_profiles (
  id                     TEXT PRIMARY KEY,                 -- ULID minted by worker
  user_id                TEXT NOT NULL,
  client_id              TEXT,                              -- NULL = own workspace
  postproxy_group_id     TEXT NOT NULL,                     -- profile_groups.id from Postproxy
  postproxy_profile_id   TEXT,                              -- profiles.id once OAuth completes; NULL pre-OAuth
  postproxy_placement_id TEXT,                              -- chosen FB page numeric ID (= placement.id)
  fb_page_name           TEXT,                              -- display label only
  profile_status         TEXT DEFAULT 'pending',            -- pending | active | expired | revoked
  oauth_state            TEXT,                              -- short-lived nonce for redirect_url
  expires_at             TEXT,                              -- Postproxy's expires_at (informational)
  connected_at           TEXT,                              -- ISO when profile became active
  created_at             TEXT DEFAULT (datetime('now')),
  updated_at             TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- SQLite treats NULLs as distinct in plain UNIQUE constraints, so we
-- split the "one row per workspace" rule into two partial indexes:
--   - own-workspace rows (client_id IS NULL): unique on user_id alone
--   - client-workspace rows: unique on (user_id, client_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_postproxy_workspace_own
  ON postproxy_profiles(user_id) WHERE client_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_postproxy_workspace_client
  ON postproxy_profiles(user_id, client_id) WHERE client_id IS NOT NULL;

-- Lookup by placement (page) ID — webhook handler doesn't always know
-- which workspace a placement belongs to until it resolves it here.
CREATE INDEX IF NOT EXISTS idx_postproxy_placement
  ON postproxy_profiles(postproxy_placement_id);

-- Lookup by OAuth state nonce — partial because most rows have NULL
-- oauth_state (it's cleared after callback consumes it).
CREATE INDEX IF NOT EXISTS idx_postproxy_oauth_state
  ON postproxy_profiles(oauth_state) WHERE oauth_state IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- 3. Per-post Postproxy tracking.
-- ──────────────────────────────────────────────────────────────────────
-- Replaces fb_video_id / fb_publish_state for the Postproxy path. The
-- legacy fb_* columns stay on the posts table during the dual-path
-- window and get dropped in schema_v23.
ALTER TABLE posts ADD COLUMN postproxy_post_id     TEXT;
ALTER TABLE posts ADD COLUMN postproxy_status      TEXT;
ALTER TABLE posts ADD COLUMN postproxy_permalink   TEXT;
ALTER TABLE posts ADD COLUMN postproxy_sent_at     TEXT;
ALTER TABLE posts ADD COLUMN postproxy_finished_at TEXT;

-- "Which posts are currently in-flight at Postproxy" — used by the
-- publish cron and the webhook handler to short-circuit duplicate work.
-- Partial keeps the index tiny (most posts are 'published' or 'failed').
CREATE INDEX IF NOT EXISTS idx_posts_postproxy_status
  ON posts(postproxy_status) WHERE postproxy_status IN ('pending');

-- Resolve a webhook payload's post_id back to our row in O(log n).
CREATE INDEX IF NOT EXISTS idx_posts_postproxy_id
  ON posts(postproxy_post_id) WHERE postproxy_post_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- 4. Webhook idempotency.
-- ──────────────────────────────────────────────────────────────────────
-- Postproxy retries failed deliveries — we INSERT OR IGNORE on event_id
-- and treat a duplicate as a 200 no-op. payload is stored as JSON text
-- for forensics if something downstream goes sideways.
CREATE TABLE IF NOT EXISTS postproxy_webhook_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  post_id     TEXT,
  received_at TEXT DEFAULT (datetime('now')),
  payload     TEXT
);
