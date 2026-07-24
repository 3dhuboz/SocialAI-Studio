-- schema_v46_learning_pilot_samples.sql
-- Positive, immutable receipts proving that an exact post version belongs to
-- the temporary real-world approval pilot. Absence always means ineligible.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS learning_pilot_samples (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client')),
  owner_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (
    LENGTH(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  attestation_basis TEXT NOT NULL CHECK (attestation_basis IN ('owner_real_post','customer_real_post')),
  note TEXT NOT NULL CHECK (LENGTH(TRIM(note)) BETWEEN 10 AND 2000),
  attested_by TEXT NOT NULL,
  attested_at TEXT NOT NULL,
  CHECK (
    (
      owner_kind = 'user'
      AND client_id IS NULL
      AND workspace_key = '__owner__'
      AND owner_id = user_id
      AND attestation_basis = 'owner_real_post'
    )
    OR
    (
      owner_kind = 'client'
      AND client_id IS NOT NULL
      AND workspace_key = client_id
      AND owner_id = client_id
      AND attestation_basis = 'customer_real_post'
    )
  ),
  UNIQUE(user_id, workspace_key, post_id, content_hash),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_pilot_samples_workspace
  ON learning_pilot_samples(user_id, workspace_key, attested_at DESC);

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_sample_update
BEFORE UPDATE ON learning_pilot_samples
BEGIN
  SELECT RAISE(ABORT, 'learning pilot samples are immutable');
END;
