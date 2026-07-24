-- schema_v44_learning_decision_disqualifications.sql
-- Append-only staging QA receipts that exclude synthetic pilot decisions from
-- readiness and adjudication without mutating the source post or decision.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS learning_decision_disqualifications (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client')),
  owner_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason = 'synthetic_qa'),
  note TEXT NOT NULL CHECK (LENGTH(TRIM(note)) BETWEEN 10 AND 2000),
  excluded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
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
  ),
  FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_decision_disqualifications_workspace
  ON learning_decision_disqualifications(user_id, workspace_key, created_at DESC);

CREATE TRIGGER IF NOT EXISTS prevent_learning_decision_disqualification_update
BEFORE UPDATE ON learning_decision_disqualifications
BEGIN
  SELECT RAISE(ABORT, 'learning decision disqualifications are immutable');
END;
