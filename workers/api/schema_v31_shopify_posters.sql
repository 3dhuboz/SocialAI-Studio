-- ─────────────────────────────────────────────────────────────────────────
-- schema_v23 — Shopify embedded-app poster gallery.
--
-- Adds `shopify_posters` so Shopify shop tenants can generate + save
-- AI-generated posters/graphics independently of the main-app `posters`
-- table (which has a Clerk-user FK and per-plan quota/brand-kit machinery
-- that doesn't apply to shop tenants).
--
-- Same R2 bucket (POSTER_ASSETS) but a separate key namespace:
--   main app    →  posters/<uuid>.png
--   Shopify app →  shopify-posters/<uuid>.png
-- so a cleanup pass can tell them apart.
--
-- Idempotent — re-running is safe; the IF NOT EXISTS guard skips recreation.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shopify_posters (
  id             TEXT PRIMARY KEY,
  shop_domain    TEXT NOT NULL,
  prompt         TEXT NOT NULL,
  aspect_ratio   TEXT NOT NULL DEFAULT '1:1',
  image_r2_key   TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_domain) REFERENCES shopify_stores(shop_domain) ON DELETE CASCADE
);

-- Gallery list hot path: "show me this shop's posters, newest first".
CREATE INDEX IF NOT EXISTS idx_shopify_posters_shop
  ON shopify_posters(shop_domain, created_at DESC);
