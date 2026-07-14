-- schema_v39_learning_outcomes.sql
-- Immutable publication outcomes, private strategy learning, privacy-gated
-- fleet aggregates, and fail-closed Protected Autopilot readiness receipts.
-- This migration is additive and does not alter posts or publishing behavior.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS publication_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  remote_post_id TEXT,
  permalink TEXT,
  decision_id TEXT,
  reach_plan_id TEXT,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key, post_id, platform)
);

CREATE TABLE IF NOT EXISTS learning_outcomes (
  id TEXT PRIMARY KEY,
  publication_event_id TEXT NOT NULL,
  window_hours INTEGER NOT NULL CHECK (window_hours IN (24,72,168)),
  raw_signals_json TEXT NOT NULL,
  normalized_score REAL,
  completeness TEXT NOT NULL CHECK (completeness IN ('none','engagement','action','conversion')),
  source_status TEXT NOT NULL CHECK (source_status IN ('complete','partial','unavailable')),
  measured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publication_event_id, window_hours),
  FOREIGN KEY (publication_event_id) REFERENCES publication_events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  variable_key TEXT NOT NULL,
  variable_value TEXT NOT NULL,
  objective TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  effect REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  freshness_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('tentative','usable','proven','rejected','operator_locked')),
  supporting_outcomes_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key, variable_key, variable_value, objective)
);

CREATE TABLE IF NOT EXISTS learning_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  profile_json TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key, version)
);

CREATE TABLE IF NOT EXISTS learning_experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  variable_key TEXT NOT NULL,
  control_value TEXT NOT NULL,
  test_value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','running','won','lost','inconclusive')),
  outcome_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS archetype_aggregates (
  id TEXT PRIMARY KEY,
  archetype_slug TEXT NOT NULL,
  variable_key TEXT NOT NULL,
  variable_value TEXT NOT NULL,
  workspace_count INTEGER NOT NULL CHECK (workspace_count >= 10),
  post_count INTEGER NOT NULL CHECK (post_count >= 100),
  effect_range_json TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  rebuilt_at TEXT NOT NULL,
  UNIQUE(archetype_slug, variable_key, variable_value)
);

CREATE TABLE IF NOT EXISTS tracking_links (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  click_count INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS conversion_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  calls INTEGER CHECK (calls IS NULL OR calls >= 0),
  messages INTEGER CHECK (messages IS NULL OR messages >= 0),
  leads INTEGER CHECK (leads IS NULL OR leads >= 0),
  bookings INTEGER CHECK (bookings IS NULL OR bookings >= 0),
  sales INTEGER CHECK (sales IS NULL OR sales >= 0),
  order_value_cents INTEGER CHECK (order_value_cents IS NULL OR order_value_cents >= 0),
  source TEXT NOT NULL CHECK (source IN ('owner','tracked','integration')),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_adjudications (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  expected_state TEXT NOT NULL CHECK (expected_state IN ('pass_green','hold_amber','block_red')),
  severity TEXT NOT NULL CHECK (severity IN ('advisory','release_critical')),
  note TEXT NOT NULL,
  adjudicated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_release_evidence (
  id TEXT PRIMARY KEY,
  policy_version TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('replay_red_team','staging_green','staging_block','kill_switch','publish_regression')),
  owner_kind TEXT CHECK (owner_kind IS NULL OR owner_kind IN ('user','client','shop')),
  passed INTEGER NOT NULL CHECK (passed IN (0,1)),
  artifact_hash TEXT NOT NULL,
  note TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS learning_release_readiness (
  id TEXT PRIMARY KEY,
  policy_version TEXT NOT NULL,
  ready INTEGER NOT NULL CHECK (ready IN (0,1)),
  metrics_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  evaluated_by TEXT NOT NULL,
  evaluated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_publication_events_due
  ON publication_events(published_at, post_id);
CREATE INDEX IF NOT EXISTS idx_learning_outcomes_window
  ON learning_outcomes(window_hours, measured_at);
CREATE INDEX IF NOT EXISTS idx_learning_signals_workspace
  ON learning_signals(user_id, workspace_key, status);
CREATE INDEX IF NOT EXISTS idx_learning_experiments_workspace
  ON learning_experiments(user_id, workspace_key, status);
CREATE INDEX IF NOT EXISTS idx_conversion_feedback_post
  ON conversion_feedback(user_id, workspace_key, post_id);
CREATE INDEX IF NOT EXISTS idx_tracking_links_workspace_post
  ON tracking_links(user_id, workspace_key, post_id);
CREATE INDEX IF NOT EXISTS idx_learning_adjudications_workspace
  ON learning_adjudications(user_id, workspace_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_release_evidence_policy
  ON learning_release_evidence(policy_version, evidence_kind, owner_kind, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_release_readiness_latest
  ON learning_release_readiness(policy_version, evaluated_at DESC);
