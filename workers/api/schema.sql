-- SocialAI Studio — Cloudflare D1 schema
-- Apply with: npx wrangler d1 execute socialai-db --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,
  email                   TEXT,
  plan                    TEXT,
  setup_status            TEXT,
  is_admin                INTEGER DEFAULT 0,
  onboarding_done         INTEGER DEFAULT 0,
  intake_form_done        INTEGER DEFAULT 0,
  agency_billing_url      TEXT,
  late_profile_id         TEXT,
  late_connected_platforms TEXT DEFAULT '[]',
  late_account_ids        TEXT DEFAULT '{}',
  fal_api_key             TEXT,
  paypal_subscription_id  TEXT,
  profile                 TEXT DEFAULT '{}',
  stats                   TEXT DEFAULT '{}',
  insight_report          TEXT,
  created_at              TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  client_id     TEXT,
  content       TEXT NOT NULL DEFAULT '',
  platform      TEXT,
  status        TEXT,
  scheduled_for TEXT,
  hashtags      TEXT DEFAULT '[]',
  image_url     TEXT,
  topic         TEXT,
  pillar        TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_posts_user     ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_client   ON posts(user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_posts_sched    ON posts(user_id, client_id, scheduled_for);

CREATE TABLE IF NOT EXISTS clients (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL,
  name                    TEXT NOT NULL,
  business_type           TEXT,
  created_at              TEXT,
  plan                    TEXT,
  profile                 TEXT DEFAULT '{}',
  stats                   TEXT DEFAULT '{}',
  insight_report          TEXT,
  late_profile_id         TEXT,
  late_connected_platforms TEXT DEFAULT '[]',
  late_account_ids        TEXT DEFAULT '{}',
  client_slug             TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);

CREATE TABLE IF NOT EXISTS portal (
  slug        TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  password    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pending_activations (
  id                     TEXT PRIMARY KEY,
  plan                   TEXT,
  paypal_subscription_id TEXT,
  consumed               INTEGER DEFAULT 0,
  created_at             TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pending_cancellations (
  id         TEXT PRIMARY KEY,
  consumed   INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
