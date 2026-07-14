-- schema_v37_learning_foundation.sql
-- Read-only foundation for the Customer Learning Brain. These tables store
-- workspace controls and immutable evaluation receipts without altering posts.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace_learning_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('off','shadow','approval','protected_autopilot')),
  autopublish_consent_at TEXT,
  autopublish_policy_version TEXT,
  experiment_rate REAL NOT NULL DEFAULT 0 CHECK (experiment_rate >= 0 AND experiment_rate <= 0.20),
  monthly_ai_budget_usd_cents INTEGER CHECK (monthly_ai_budget_usd_cents IS NULL OR monthly_ai_budget_usd_cents >= 0),
  disabled_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key)
);

CREATE TABLE IF NOT EXISTS learning_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('off','shadow','approval','protected_autopilot')),
  stage TEXT NOT NULL CHECK (stage IN ('snapshot','text_preflight','media_preflight','release')),
  release_state TEXT NOT NULL CHECK (release_state IN ('pending','pass_green','hold_amber','block_red','shadow_only')),
  content_hash TEXT NOT NULL,
  strategy_version INTEGER,
  reach_plan_id TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key, post_id, stage, content_hash)
);

CREATE TABLE IF NOT EXISTS learning_critic_verdicts (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  critic_kind TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass','warn_repairable','block','unavailable')),
  severity TEXT NOT NULL CHECK (severity IN ('advisory','release_critical')),
  confidence REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  repair_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  model TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_decisions_workspace_post
  ON learning_decisions(user_id, workspace_key, post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_decisions_state_created
  ON learning_decisions(release_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_verdicts_decision
  ON learning_critic_verdicts(decision_id, critic_kind, attempt);
