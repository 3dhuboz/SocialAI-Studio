-- schema_v47_learning_calibration_audits.sql
-- Tenant-scoped receipts for bounded weekly independent rechecks.
-- Automated calibration is deliberately separate from human adjudication.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS learning_calibration_audits (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  original_state TEXT NOT NULL CHECK (original_state = 'pass_green'),
  expected_state TEXT CHECK (
    expected_state IS NULL OR expected_state IN ('pass_green','hold_amber','block_red')
  ),
  severity TEXT CHECK (
    severity IS NULL OR severity IN ('advisory','release_critical')
  ),
  audit_status TEXT NOT NULL CHECK (
    audit_status IN ('claimed','completed','unavailable')
  ),
  source_status TEXT NOT NULL CHECK (
    source_status IN ('pending','verified','missing','stale','pipeline_unavailable')
  ),
  judge_status TEXT CHECK (
    judge_status IS NULL OR judge_status IN ('available','unavailable','not_run')
  ),
  content_hash TEXT NOT NULL CHECK (
    LENGTH(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  summary_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(summary_json) AND LENGTH(summary_json) <= 4000
  ),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (
    attempt_count >= 1 AND attempt_count <= 2
  ),
  lease_expires_at TEXT,
  error TEXT CHECK (error IS NULL OR LENGTH(error) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(decision_id, policy_version),
  FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE,
  CHECK (
    (
      audit_status = 'claimed'
      AND source_status = 'pending'
      AND expected_state IS NULL
      AND severity IS NULL
      AND judge_status IS NULL
      AND lease_expires_at IS NOT NULL
      AND error IS NULL
      AND completed_at IS NULL
    )
    OR (
      audit_status = 'completed'
      AND source_status = 'verified'
      AND expected_state IS NOT NULL
      AND judge_status IN ('available','not_run')
      AND lease_expires_at IS NULL
      AND error IS NULL
      AND completed_at IS NOT NULL
      AND (
        (expected_state = 'block_red' AND severity = 'release_critical')
        OR (expected_state IN ('pass_green','hold_amber') AND severity = 'advisory')
      )
    )
    OR (
      audit_status = 'unavailable'
      AND source_status IN ('missing','stale','pipeline_unavailable')
      AND expected_state IS NULL
      AND severity = 'release_critical'
      AND judge_status = 'unavailable'
      AND lease_expires_at IS NOT NULL
      AND error IS NOT NULL
      AND completed_at IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_learning_calibration_workspace
  ON learning_calibration_audits(
    user_id, workspace_key, client_id, owner_kind, owner_id, updated_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_learning_calibration_status
  ON learning_calibration_audits(policy_version, audit_status, lease_expires_at);
