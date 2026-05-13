-- SocialAI Studio — D1 schema migration v11
-- Poster Maker: per-workspace gallery + brand-kit overrides.
--
-- Apply with: npx wrangler d1 execute socialai-db --file=schema_v11.sql --remote
--
-- ── posters ─────────────────────────────────────────────────────────────────
-- Persistent gallery for the Poster Maker feature. PNG bytes live in R2 (binding
-- POSTER_ASSETS, key `posters/<id>.png`); this row holds the input snapshot, the
-- R2 key, and the optional post-to-socials schedule.
--
-- Workspace scoping mirrors the `posts` table:
--   client_id IS NULL  → the agency owner's own workspace
--   client_id = <id>   → a specific client workspace (Agency-plan multi-client)
--
-- Every list/read/write route filters by both user_id (from Clerk JWT) AND
-- client_id (from ?clientId= query string), so a user only ever sees their own
-- posters and only inside the workspace they've switched into.
CREATE TABLE IF NOT EXISTS posters (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  client_id      TEXT,
  content_inputs TEXT NOT NULL,   -- JSON snapshot of the form inputs
  image_r2_key   TEXT,            -- e.g. posters/<id>.png
  brand_name     TEXT,            -- captured at generation time
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  scheduled_at   TEXT,            -- ISO timestamp; NULL = unscheduled
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Gallery list hot path: "show me my posters in this workspace, newest first".
CREATE INDEX IF NOT EXISTS idx_posters_owner ON posters(user_id, client_id, created_at DESC);

-- "Upcoming" filter on the gallery.
CREATE INDEX IF NOT EXISTS idx_posters_scheduled ON posters(scheduled_at);

-- ── poster_brand_kit ────────────────────────────────────────────────────────
-- Per-workspace BrandKitOverrides blob — the same shape that the white-label
-- `posterBrandKit.ts` BrandKitOverrides type produces from the editor. The
-- editor is total-replace (not deep-merge) so the admin can DELETE an override
-- (e.g. drop a banned phrase) — exactly the rationale documented in the
-- hughesysque-origin module.
--
-- Note on client_id: this table uses '' (empty string) for the own-workspace
-- case, NOT NULL — so the composite PRIMARY KEY (user_id, client_id) gives us
-- single-row-per-workspace semantics. (SQLite treats NULLs as distinct in
-- unique constraints, so NULL would let duplicate rows accumulate.) Routes
-- normalize NULL ↔ '' at the boundary.
CREATE TABLE IF NOT EXISTS poster_brand_kit (
  user_id     TEXT NOT NULL,
  client_id   TEXT NOT NULL DEFAULT '',
  overrides   TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
