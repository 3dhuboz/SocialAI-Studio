-- schema_v41_learning_pilot_enrollments.sql
-- Record the exact, consented, record-only pilot cohort and its evidence boundary.
-- Receipts are append-only during normal operation; scoped privacy erasure may delete them.
-- This migration is additive and does not alter posts or publishing behavior.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS learning_pilot_enrollments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client')),
  owner_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  enrolled_by TEXT NOT NULL,
  enrolled_at TEXT NOT NULL,
  record_only INTEGER NOT NULL DEFAULT 1 CHECK (record_only = 1),
  consent_basis TEXT NOT NULL CHECK (consent_basis IN ('owner_self','customer_attested')),
  consent_confirmed_at TEXT NOT NULL,
  consent_note TEXT NOT NULL CHECK (LENGTH(TRIM(consent_note)) BETWEEN 10 AND 500),
  UNIQUE(user_id, workspace_key, policy_version),
  CHECK (
    (
      owner_kind = 'user'
      AND client_id IS NULL
      AND workspace_key = '__owner__'
      AND owner_id = user_id
      AND consent_basis = 'owner_self'
    )
    OR
    (
      owner_kind = 'client'
      AND client_id IS NOT NULL
      AND workspace_key = client_id
      AND owner_id = client_id
      AND consent_basis = 'customer_attested'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_learning_pilot_enrollments_policy_cohort
  ON learning_pilot_enrollments(policy_version, user_id, owner_kind, enrolled_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_pilot_enrollments_policy_owner_kind
  ON learning_pilot_enrollments(policy_version, owner_kind);

CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_enrollment_update
BEFORE UPDATE ON learning_pilot_enrollments
BEGIN
  SELECT RAISE(ABORT, 'learning pilot enrollments are immutable');
END;
