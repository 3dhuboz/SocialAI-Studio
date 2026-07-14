-- Private, tenant-scoped planning data for the Organic Reach Engine.
-- This migration is additive and does not alter posts or publishing behavior.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reach_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  confirmation_status TEXT NOT NULL CHECK (confirmation_status IN ('proposed','confirmed')),
  timezone TEXT NOT NULL,
  base_location_json TEXT NOT NULL,
  service_area_json TEXT NOT NULL,
  excluded_locations_json TEXT NOT NULL DEFAULT '[]',
  platforms_json TEXT NOT NULL DEFAULT '["facebook","instagram"]',
  cadence_json TEXT NOT NULL DEFAULT '{}',
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_key, version)
);

CREATE TABLE IF NOT EXISTS audience_segments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  reach_profile_id TEXT NOT NULL,
  label TEXT NOT NULL,
  needs_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('predicted','confirmed','disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reach_profile_id) REFERENCES reach_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approved_media_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('image','video','poster','carousel')),
  url TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  rights_status TEXT NOT NULL CHECK (rights_status IN ('confirmed','blocked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reach_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  client_id TEXT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','client','shop')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  reach_profile_id TEXT NOT NULL,
  reach_profile_version INTEGER NOT NULL,
  objective TEXT NOT NULL,
  audience_segment_id TEXT,
  geographic_focus_json TEXT NOT NULL,
  platform_plan_json TEXT NOT NULL,
  timing_json TEXT NOT NULL,
  language_json TEXT NOT NULL,
  hashtag_json TEXT NOT NULL,
  media_json TEXT NOT NULL,
  experiment_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('shadow','selected','invalidated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reach_profile_id) REFERENCES reach_profiles(id),
  FOREIGN KEY (audience_segment_id) REFERENCES audience_segments(id)
);

CREATE INDEX IF NOT EXISTS idx_reach_profiles_workspace
  ON reach_profiles(user_id, workspace_key, version DESC);
CREATE INDEX IF NOT EXISTS idx_audience_segments_workspace
  ON audience_segments(user_id, workspace_key, status);
CREATE INDEX IF NOT EXISTS idx_reach_plans_post
  ON reach_plans(user_id, workspace_key, post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_workspace
  ON approved_media_assets(user_id, workspace_key, rights_status);
