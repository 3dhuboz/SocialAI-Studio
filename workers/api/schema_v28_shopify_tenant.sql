-- ─────────────────────────────────────────────────────────────────────
--  schema_v20.sql — Tenant-abstraction groundwork (tri-tenant model)
--
--  Establishes the SCHEMA-LEVEL groundwork to abstract row ownership
--  across three tenant kinds without breaking any existing query.
--  No code changes happen in this migration; routes/cron continue to
--  use the legacy user_id / client_id columns. This file just adds the
--  new columns + indexes that subsequent code-migration PRs will adopt.
--
--  ── The tri-tenant model ─────────────────────────────────────────────
--  Three kinds of "owner" can hold rows in posts / social_tokens / campaigns:
--
--    owner_kind = 'user'    → owner_id is a Clerk uid → users.id
--                             (the agency owner's own workspace, OR a solo
--                              SaaS subscriber)
--    owner_kind = 'client'  → owner_id is a clients.id
--                             (an Agency-plan workspace managed on behalf
--                              of a third-party client)
--    owner_kind = 'shop'    → owner_id is a shopify_stores.shop_domain
--                             (a Shopify App Store merchant — installed
--                              the embedded app, no Clerk account needed)
--
--  The mapping is intentionally TEXT/TEXT so all three kinds fit a single
--  column pair without UNION views or table partitioning.
--
--  ── Why additive (vs. drop legacy columns now) ─────────────────────
--  Doing the column drop in the same migration would require a full code
--  rewrite to land atomically — every route, cron, and admin query reads
--  user_id / client_id today. Instead this migration is purely additive:
--
--    1. New owner_kind / owner_id columns are added with defaults so
--       existing INSERTs keep working unchanged.
--    2. A backfill UPDATE populates them from the legacy columns so
--       SELECT-by-owner queries can start being migrated incrementally.
--    3. Existing user_id / client_id columns STAY — no DROP COLUMN.
--    4. New code SHOULD write BOTH old AND new columns on insert until
--       a follow-up migration (schema_vN, TBD) drops user_id / client_id
--       once every read path has been migrated.
--
--  ── Apply with ──────────────────────────────────────────────────────
--    cd workers/api
--    npx wrangler d1 execute socialai-db --remote --file=schema_v20.sql --config wrangler.toml
--
--  Idempotent: D1's SQLite does not support ADD COLUMN IF NOT EXISTS,
--  so re-running this migration will error on the ALTERs ("duplicate
--  column name"). That's the expected, safe failure mode — once-only.
-- ─────────────────────────────────────────────────────────────────────

-- NOTE on social_tokens: in this codebase, social_tokens is a JSON column
-- on users + clients, not a standalone table. Confirmed against prod D1
-- (sqlite_master returned: users, posts, clients, campaigns — no
-- social_tokens table). The ALTER + index lines for that table have
-- therefore been removed. When/if social_tokens becomes a real table,
-- repeat this migration's pattern for it in a follow-up schema_vN.

-- ── 1. owner_kind columns ───────────────────────────────────────────
-- TEXT with DEFAULT 'user' so existing INSERTs (which don't set this
-- column) get the correct value for the vast majority of legacy rows.
ALTER TABLE posts     ADD COLUMN owner_kind TEXT DEFAULT 'user';
ALTER TABLE campaigns ADD COLUMN owner_kind TEXT DEFAULT 'user';

-- ── 2. owner_id columns ─────────────────────────────────────────────
-- Initially nullable. Backfilled below from the legacy user_id / client_id
-- columns. New code MUST set this explicitly on insert.
ALTER TABLE posts     ADD COLUMN owner_id TEXT;
ALTER TABLE campaigns ADD COLUMN owner_id TEXT;

-- ── 3. Backfill ─────────────────────────────────────────────────────
-- Order matters: backfill 'client' rows FIRST (rows with a non-null
-- client_id), then fall through to 'user' for the rest. Both updates
-- include `WHERE owner_id IS NULL` so this migration is safe to re-run
-- against rows that have already been migrated (the second run is a
-- no-op on already-populated owner_id values).

-- 3a. posts — has both user_id (NOT NULL) and client_id (nullable).
UPDATE posts
   SET owner_kind = 'client', owner_id = client_id
 WHERE owner_id IS NULL
   AND client_id IS NOT NULL;

UPDATE posts
   SET owner_kind = 'user', owner_id = user_id
 WHERE owner_id IS NULL;

-- 3b. campaigns — has both user_id and client_id (see routes/campaigns.ts).
UPDATE campaigns
   SET owner_kind = 'client', owner_id = client_id
 WHERE owner_id IS NULL
   AND client_id IS NOT NULL;

UPDATE campaigns
   SET owner_kind = 'user', owner_id = user_id
 WHERE owner_id IS NULL;

-- 3c. social_tokens — N/A in this codebase (JSON column, see note above).

-- ── 4. Composite indexes for tenant-scoped reads ───────────────────
-- The hot-path query shape after migration is:
--   WHERE owner_kind = ? AND owner_id = ?
-- A composite index on (owner_kind, owner_id) covers both equality
-- predicates cleanly. Putting owner_kind first is fine here — the
-- selectivity of owner_id is the dominant factor and (owner_kind=?,
-- owner_id=?) seeks directly to the matching range.
CREATE INDEX IF NOT EXISTS idx_posts_owner
  ON posts(owner_kind, owner_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_owner
  ON campaigns(owner_kind, owner_id);
