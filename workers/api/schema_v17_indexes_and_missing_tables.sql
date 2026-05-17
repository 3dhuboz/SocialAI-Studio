-- ─────────────────────────────────────────────────────────────────────
--  schema_v17.sql — Missing indexes + CREATE TABLE catch-up
--
--  Two classes of fix in one file:
--
--    1. INDEXES — the cron tick (every 5 min) currently full-scans posts
--       on `status = 'Scheduled' AND scheduled_for <= ?`, and the portal
--       auth path does an unindexed SELECT-by-token on every request.
--       Adds the missing covering indexes so these hot paths don't degrade
--       with row count.
--
--    2. CREATE TABLE catch-up — `campaigns` and `cron_runs` are referenced
--       by committed source (routes/campaigns.ts, cron/dispatcher.ts) and
--       in `campaigns`' case ALTER'd in schema_v12, but no CREATE TABLE
--       was ever committed. They exist on prod because they were created
--       manually at the time of first use. This migration is the catch-up
--       so a fresh-DB deploy (CI / staging / future prod) reproduces.
--       All CREATE statements use IF NOT EXISTS so re-applying on a DB
--       where the tables already exist is a no-op.
--
--  The `rate_limit_log` CREATE is also included here. Today `auth.ts`
--  calls `db.exec('CREATE TABLE IF NOT EXISTS rate_limit_log ...')` on
--  every isRateLimited() call — that's a wasted round-trip on every
--  rate-limited route. Moving the DDL into this migration unblocks a
--  follow-up PR that strips the runtime exec from auth.ts (NOT in this
--  PR — keeps the diff focused on the migration).
--
--  Apply with:
--    cd workers/api
--    npx wrangler d1 execute socialai-db --file=schema_v17_indexes_and_missing_tables.sql --remote
--
--  All statements are IF NOT EXISTS — safe to re-run. See MIGRATION_NOTES.md
--  for prod/staging apply order.
-- ─────────────────────────────────────────────────────────────────────

-- ─── 1. Indexes ──────────────────────────────────────────────────────

-- Posts publish-cron hot path. The cron tick fires every 5 minutes and
-- currently does a full scan of `posts` on:
--   WHERE status = 'Scheduled' AND scheduled_for <= ? AND <ACTIVE_CLIENT_FILTER>
-- The existing idx_posts_sched is keyed on (user_id, client_id, scheduled_for)
-- — useless for the cron because the cron doesn't filter by user. With
-- thousands of historical posts this scan dominates the tick. (status,
-- scheduled_for) lets sqlite seek directly to scheduled-and-due rows.
CREATE INDEX IF NOT EXISTS idx_posts_status_sched
  ON posts(status, scheduled_for);

-- Portal token auth. Every portal-authenticated request does:
--   SELECT user_id, expires_at, revoked_at FROM portal WHERE portal_token = ?
-- (workers/api/src/auth.ts L33). Without an index that's a full scan of
-- `portal` on every API call from a portal client. UNIQUE because
-- portal_token is a uuid — a duplicate would mean two portals share
-- credentials, which is a bug. Partial WHERE portal_token IS NOT NULL
-- so rows with no token (legacy/draft portal rows) don't take index space.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_token
  ON portal(portal_token) WHERE portal_token IS NOT NULL;

-- ACTIVE_CLIENT_FILTER subquery. Every cron query that touches posts
-- appends ` AND (client_id IS NULL OR client_id NOT IN (SELECT id FROM
-- clients WHERE status = 'on_hold'))` — see workers/api/src/cron/_shared.ts.
-- Partial index on the small subset of rows that match. on_hold is a tiny
-- minority (1-2 rows typically) so the partial index stays cheap and the
-- planner can use it to satisfy the NOT IN subquery without scanning
-- the whole clients table. Note: the `status` column is added at runtime
-- by an admin tool (no committed migration); the index is safe even if
-- the column doesn't exist yet because CREATE INDEX … WHERE on a missing
-- column will fail. If that's an issue on a fresh DB, run schema.sql + this
-- migration; the column-add follow-up will land separately.
CREATE INDEX IF NOT EXISTS idx_clients_on_hold
  ON clients(status) WHERE status = 'on_hold';

-- ─── 2. rate_limit_log (currently runtime-created in auth.ts) ────────
--
-- isRateLimited() in workers/api/src/auth.ts calls db.exec(CREATE TABLE
-- IF NOT EXISTS rate_limit_log ...) on every invocation. That works but
-- wastes a round-trip per rate-limited route hit. This commits the DDL
-- so a follow-up PR can drop the runtime exec.
--
-- Columns mirror the runtime DDL exactly:
--   key TEXT NOT NULL — caller-provided bucket key (e.g. 'campaign-research:<uid>')
--   ts  INTEGER NOT NULL — ms-since-epoch timestamp of the request
CREATE TABLE IF NOT EXISTS rate_limit_log (
  key TEXT NOT NULL,
  ts  INTEGER NOT NULL
);

-- Hot path: COUNT(*) of recent requests per key in the last 60s window.
-- (key, ts) lets sqlite seek by key then range-scan ts.
CREATE INDEX IF NOT EXISTS idx_rate_limit_log_key_ts
  ON rate_limit_log(key, ts);

-- ─── 3. campaigns (referenced by routes/campaigns.ts, ALTER'd in v12) ─
--
-- Column set INFERRED from workers/api/src/routes/campaigns.ts:
--   - INSERT: (id, user_id, client_id, name, type, start_date, end_date,
--             rules, posts_per_day, enabled)                       — L73
--   - UPDATE fieldMap also references: image_notes                  — L84
--   - rowToApi reads: created_at                                     — L44
--   - SELECT * FROM campaigns ORDER BY start_date                    — L62
--
-- Schema_v12 then ADDs: brief, brief_summary, brief_status (default 'idle'),
--                       brief_updated_at, brief_sources (default '[]').
-- Those are NOT included here — schema_v12's ALTERs run after this CREATE.
-- If running migrations in a fresh order on a brand-new DB, the order is:
--   schema.sql → ... → schema_v12.sql (campaign ALTERs) → schema_v17.sql
-- and the IF NOT EXISTS makes this a no-op on the existing campaigns table.
--
-- WARNING: Diff against prod `.schema campaigns` output before applying.
-- See MIGRATION_NOTES.md for the diff command.
CREATE TABLE IF NOT EXISTS campaigns (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  client_id      TEXT,
  name           TEXT NOT NULL,
  type           TEXT DEFAULT 'custom',
  start_date     TEXT,
  end_date       TEXT,
  rules          TEXT DEFAULT '',
  image_notes    TEXT DEFAULT '',
  posts_per_day  INTEGER DEFAULT 1,
  enabled        INTEGER DEFAULT 1,
  created_at     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Workspace-scoped list hot path: "SELECT * FROM campaigns WHERE user_id = ?
-- AND client_id [=?|IS NULL] ORDER BY start_date ASC".
CREATE INDEX IF NOT EXISTS idx_campaigns_owner
  ON campaigns(user_id, client_id, start_date);

-- ─── 4. cron_runs (referenced by cron/dispatcher.ts + routes/health.ts) ─
--
-- Column set INFERRED from:
--   workers/api/src/cron/dispatcher.ts L51
--     INSERT INTO cron_runs (cron_type, success, posts_processed, error, duration_ms)
--   workers/api/src/cron/publish-missed.ts L70
--     SELECT 1 FROM cron_runs WHERE cron_type = ? AND run_at > datetime('now','-1 hour')
--   workers/api/src/routes/health.ts L28
--     SELECT run_at, cron_type, success, posts_processed, duration_ms, error
--     FROM cron_runs ORDER BY run_at DESC LIMIT 30
--
-- Inferences:
--   run_at        — TEXT, datetime('now') default; the inserts don't provide it
--                   so the column must default. SELECT orders by it DESC.
--   cron_type     — TEXT NOT NULL; every insert provides it.
--   success       — INTEGER (0/1); INSERT binds 0/1; health filters on it.
--   posts_processed — INTEGER; INSERT binds an integer (0 default in
--                     publish-missed throttle row).
--   error         — TEXT NULL; INSERT binds NULL on success.
--   duration_ms   — INTEGER; INSERT binds Date.now() - start.
--
-- WARNING: Diff against prod `.schema cron_runs` before applying.
CREATE TABLE IF NOT EXISTS cron_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at          TEXT NOT NULL DEFAULT (datetime('now')),
  cron_type       TEXT NOT NULL,
  success         INTEGER NOT NULL DEFAULT 1,
  posts_processed INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0
);

-- /api/cron-health does "ORDER BY run_at DESC LIMIT 30" on every poll
-- from the deploy-monitor widget. Index on run_at DESC keeps that O(log N).
CREATE INDEX IF NOT EXISTS idx_cron_runs_run_at
  ON cron_runs(run_at DESC);

-- publish-missed's throttle check filters "WHERE cron_type = ? AND run_at >
-- datetime('now','-1 hour')". (cron_type, run_at) serves that lookup directly.
CREATE INDEX IF NOT EXISTS idx_cron_runs_type_run_at
  ON cron_runs(cron_type, run_at);

-- ─── 5. Pending-activations / pending-cancellations email lookups ─────
--
-- workers/api/src/routes/activations.ts looks up both tables by email
-- (L39, L57) when a user signs up post-payment. Without an index that's
-- a full scan of each table on every signup. Both tables are append-only
-- so they grow indefinitely.
CREATE INDEX IF NOT EXISTS idx_pending_activations_email
  ON pending_activations(email);

CREATE INDEX IF NOT EXISTS idx_pending_cancellations_email
  ON pending_cancellations(email);
