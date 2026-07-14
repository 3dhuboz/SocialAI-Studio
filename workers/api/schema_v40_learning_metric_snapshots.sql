-- schema_v40_learning_metric_snapshots.sql
-- Preserve Facebook fact refreshes as append-only measurement snapshots and
-- track bounded retries before an unavailable outcome window is finalized.
-- This migration is additive and does not alter posts or publishing behavior.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_metric_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook','instagram')),
  remote_post_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('client_facts','shopify_facts')),
  engagement_score REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key, platform, remote_post_id, captured_at)
);

CREATE TABLE IF NOT EXISTS learning_outcome_attempts (
  id TEXT PRIMARY KEY,
  publication_event_id TEXT NOT NULL,
  window_hours INTEGER NOT NULL CHECK (window_hours IN (24,72,168)),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1 AND attempt_count <= 4),
  next_retry_at TEXT,
  last_attempted_at TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publication_event_id, window_hours),
  FOREIGN KEY (publication_event_id) REFERENCES publication_events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_metric_snapshots_window
  ON platform_metric_snapshots(
    user_id, workspace_key, platform, remote_post_id, captured_at
  );
CREATE INDEX IF NOT EXISTS idx_learning_outcome_attempts_due
  ON learning_outcome_attempts(next_retry_at, resolved_at);

CREATE TRIGGER IF NOT EXISTS capture_client_fact_metric_snapshot
AFTER INSERT ON client_facts
WHEN NEW.fact_type = 'own_post'
  AND NEW.fb_id IS NOT NULL
  AND TRIM(NEW.fb_id) <> ''
BEGIN
  INSERT OR IGNORE INTO platform_metric_snapshots (
    id, user_id, workspace_key, client_id, owner_kind, owner_id,
    platform, remote_post_id, source, engagement_score, metadata_json,
    captured_at
  ) VALUES (
    LOWER(HEX(RANDOMBLOB(16))),
    TRIM(NEW.user_id),
    CASE
      WHEN NEW.client_id IS NULL OR TRIM(NEW.client_id) = '' THEN '__owner__'
      ELSE TRIM(NEW.client_id)
    END,
    CASE
      WHEN NEW.client_id IS NULL OR TRIM(NEW.client_id) = '' THEN NULL
      ELSE TRIM(NEW.client_id)
    END,
    CASE
      WHEN NEW.client_id IS NULL OR TRIM(NEW.client_id) = '' THEN 'user'
      ELSE 'client'
    END,
    CASE
      WHEN NEW.client_id IS NULL OR TRIM(NEW.client_id) = '' THEN TRIM(NEW.user_id)
      ELSE TRIM(NEW.client_id)
    END,
    'facebook',
    TRIM(NEW.fb_id),
    'client_facts',
    NEW.engagement_score,
    COALESCE(NEW.metadata, '{}'),
    COALESCE(NULLIF(TRIM(NEW.verified_at), ''), STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
END;

CREATE TRIGGER IF NOT EXISTS capture_shopify_fact_metric_snapshot
AFTER INSERT ON shopify_facts
WHEN NEW.fact_type = 'own_post'
  AND NEW.fb_id IS NOT NULL
  AND TRIM(NEW.fb_id) <> ''
BEGIN
  INSERT OR IGNORE INTO platform_metric_snapshots (
    id, user_id, workspace_key, client_id, owner_kind, owner_id,
    platform, remote_post_id, source, engagement_score, metadata_json,
    captured_at
  ) VALUES (
    LOWER(HEX(RANDOMBLOB(16))),
    LOWER(TRIM(NEW.shop_domain)),
    'shop:' || LOWER(TRIM(NEW.shop_domain)),
    NULL,
    'shop',
    LOWER(TRIM(NEW.shop_domain)),
    'facebook',
    TRIM(NEW.fb_id),
    'shopify_facts',
    NEW.engagement_score,
    COALESCE(NEW.metadata, '{}'),
    COALESCE(NULLIF(TRIM(NEW.verified_at), ''), STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
END;

-- Seed the current scrape once. Historical windows still require a snapshot
-- close to their boundary and therefore cannot be mistaken for fresh proof.
INSERT OR IGNORE INTO platform_metric_snapshots (
  id, user_id, workspace_key, client_id, owner_kind, owner_id,
  platform, remote_post_id, source, engagement_score, metadata_json,
  captured_at
)
SELECT
  LOWER(HEX(RANDOMBLOB(16))),
  TRIM(user_id),
  CASE
    WHEN client_id IS NULL OR TRIM(client_id) = '' THEN '__owner__'
    ELSE TRIM(client_id)
  END,
  CASE
    WHEN client_id IS NULL OR TRIM(client_id) = '' THEN NULL
    ELSE TRIM(client_id)
  END,
  CASE
    WHEN client_id IS NULL OR TRIM(client_id) = '' THEN 'user'
    ELSE 'client'
  END,
  CASE
    WHEN client_id IS NULL OR TRIM(client_id) = '' THEN TRIM(user_id)
    ELSE TRIM(client_id)
  END,
  'facebook',
  TRIM(fb_id),
  'client_facts',
  engagement_score,
  COALESCE(metadata, '{}'),
  COALESCE(NULLIF(TRIM(verified_at), ''), STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM client_facts
WHERE fact_type = 'own_post' AND fb_id IS NOT NULL AND TRIM(fb_id) <> '';

INSERT OR IGNORE INTO platform_metric_snapshots (
  id, user_id, workspace_key, client_id, owner_kind, owner_id,
  platform, remote_post_id, source, engagement_score, metadata_json,
  captured_at
)
SELECT
  LOWER(HEX(RANDOMBLOB(16))),
  LOWER(TRIM(shop_domain)),
  'shop:' || LOWER(TRIM(shop_domain)),
  NULL,
  'shop',
  LOWER(TRIM(shop_domain)),
  'facebook',
  TRIM(fb_id),
  'shopify_facts',
  engagement_score,
  COALESCE(metadata, '{}'),
  COALESCE(NULLIF(TRIM(verified_at), ''), STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM shopify_facts
WHERE fact_type = 'own_post' AND fb_id IS NOT NULL AND TRIM(fb_id) <> '';
