-- ─────────────────────────────────────────────────────────────────────────
-- schema_v24 — Shopify embedded-app campaigns + per-shop FB facts cache.
--
-- Two tables:
--
--   shopify_campaigns
--     A date-ranged marketing campaign (Black Friday, Summer Sale, Christmas)
--     that the AI Autopilot weaves into every post generated within its
--     window. Mirrors the main-app campaigns table but is shop-scoped via
--     shop_domain rather than (user_id, client_id).
--
--   shopify_facts
--     Per-shop scrape of the connected Facebook Page's about/posts/comments/
--     photos. Powers the "N facts from Facebook ready" indicator on the
--     Autopilot page and feeds verified copy into caption generation. Same
--     conceptual shape as client_facts but keyed on shop_domain (no
--     user_id/client_id FK chain to chase).
--
-- Idempotent — re-running is safe.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shopify_campaigns (
  id           TEXT PRIMARY KEY,
  shop_domain  TEXT NOT NULL,
  name         TEXT NOT NULL,
  goal         TEXT,            -- 'Drive Black Friday sales'
  theme        TEXT,            -- 'Bold neon urgency, dark backgrounds'
  start_at     TEXT NOT NULL,   -- ISO datetime, inclusive
  end_at       TEXT,            -- ISO datetime, exclusive (NULL = open-ended)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_domain) REFERENCES shopify_stores(shop_domain) ON DELETE CASCADE
);

-- Active-campaign lookup hot path: WHERE shop_domain = ? AND start_at <= ? AND (end_at IS NULL OR end_at >= ?).
CREATE INDEX IF NOT EXISTS idx_shopify_campaigns_active
  ON shopify_campaigns(shop_domain, start_at, end_at);

CREATE TABLE IF NOT EXISTS shopify_facts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_domain      TEXT NOT NULL,
  fact_type        TEXT NOT NULL,    -- 'about' | 'own_post' | 'comment' | 'photo' | 'event'
  content          TEXT NOT NULL,
  metadata         TEXT,             -- JSON: e.g. {fan_count, likes, comments, ...}
  fb_id            TEXT,             -- Source FB graph id (post id, comment id, …)
  engagement_score INTEGER DEFAULT 0,
  verified_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shop_domain, fb_id),       -- dedupe across cron re-runs
  FOREIGN KEY (shop_domain) REFERENCES shopify_stores(shop_domain) ON DELETE CASCADE
);

-- Hot path: "give me this shop's top-engaged posts for the autopilot prompt"
CREATE INDEX IF NOT EXISTS idx_shopify_facts_lookup
  ON shopify_facts(shop_domain, fact_type, engagement_score DESC);
