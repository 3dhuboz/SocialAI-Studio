-- schema_v42_delivery_uncertainty_receipts.sql
-- Append-only shadow evidence for provider delivery attempts. This migration
-- is additive and does not change retry, post status, or publishing behavior.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS publish_delivery_receipts (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook','instagram')),
  backend TEXT NOT NULL CHECK (backend IN ('postproxy','graph','graph_reel','graph_instagram')),
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'attempt_started','provider_accepted','definite_failure','ambiguous_failure'
  )),
  content_hash TEXT CHECK (
    content_hash IS NULL OR (
      LENGTH(content_hash) = 64
      AND content_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  remote_post_id TEXT,
  http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  error_class TEXT CHECK (error_class IS NULL OR LENGTH(error_class) <= 80),
  error_message TEXT CHECK (error_message IS NULL OR LENGTH(error_message) <= 500),
  shadow_only INTEGER NOT NULL DEFAULT 1 CHECK (shadow_only = 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(attempt_id, event_kind),
  CHECK (
    (
      owner_kind = 'user'
      AND client_id IS NULL
      AND workspace_key = '__owner__'
      AND owner_id = user_id
    )
    OR
    (
      owner_kind = 'client'
      AND client_id IS NOT NULL
      AND workspace_key = client_id
      AND owner_id = client_id
    )
    OR
    (
      owner_kind = 'shop'
      AND client_id IS NULL
      AND workspace_key = 'shop:' || LOWER(TRIM(owner_id))
      AND LOWER(TRIM(owner_id)) = LOWER(TRIM(user_id))
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_publish_delivery_receipts_workspace
  ON publish_delivery_receipts(user_id, workspace_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_publish_delivery_receipts_post
  ON publish_delivery_receipts(user_id, workspace_key, post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_publish_delivery_receipts_ambiguity
  ON publish_delivery_receipts(event_kind, created_at DESC)
  WHERE event_kind = 'ambiguous_failure';

CREATE TRIGGER IF NOT EXISTS prevent_publish_delivery_receipt_update
BEFORE UPDATE ON publish_delivery_receipts
BEGIN
  SELECT RAISE(ABORT, 'publish delivery receipts are append-only');
END;
