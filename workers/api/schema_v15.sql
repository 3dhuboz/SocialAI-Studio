-- schema_v15: client_facts table definition + de-dup UNIQUE index.
--
-- The client_facts table was created manually on production D1 when the
-- Facebook Page Insights scraper shipped (commit 43e548d) but the schema was
-- never committed to a file. This migration catches up:
--
--   1. CREATE TABLE IF NOT EXISTS — safe no-op on prod (table already exists),
--      but required for fresh deployments and CI/test databases.
--   2. CREATE UNIQUE INDEX IF NOT EXISTS — the de-dup guard that INSERT OR IGNORE
--      depends on. Without it the IGNORE silently has nothing to match against,
--      so concurrent refresh calls can accumulate duplicate rows.
--
-- Constraint design: UNIQUE(user_id, COALESCE(client_id,''), fb_id)
--   - Expression index normalises NULL client_id (own-workspace facts) and ''
--     (rare legacy rows) so both map to the same de-dup bucket.
--   - fb_id is the Facebook object ID (page, post, comment, photo, event) —
--     globally unique within FB, so (user, workspace, fb_id) uniquely identifies
--     a fact row without needing fact_type in the key.
--
-- Apply via:
--   wrangler d1 execute socialai-studio-db --remote --file=schema_v15.sql

CREATE TABLE IF NOT EXISTS client_facts (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id          TEXT NOT NULL,
  client_id        TEXT,
  fact_type        TEXT NOT NULL,   -- 'about' | 'own_post' | 'comment' | 'photo' | 'event'
  content          TEXT NOT NULL,
  metadata         TEXT NOT NULL DEFAULT '{}',
  fb_id            TEXT,            -- Facebook object ID for de-dup
  engagement_score REAL DEFAULT 0,
  verified_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- De-dup index: INSERT OR IGNORE checks this to avoid accumulating duplicate
-- rows across concurrent refresh calls or retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_facts_dedup
  ON client_facts(user_id, COALESCE(client_id, ''), COALESCE(fb_id, ''));

-- Hot path: "give me all facts for this workspace, best signal first"
CREATE INDEX IF NOT EXISTS idx_client_facts_owner
  ON client_facts(user_id, client_id, engagement_score DESC);
