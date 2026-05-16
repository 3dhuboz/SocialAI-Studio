-- schema_v17: ai_usage metering table.
--
-- Records every AI provider call (FLUX image gen, Anthropic critique,
-- OpenRouter caption, Gemini, etc) so we can:
--   1. Attribute spend to user/client/post for billing reconciliation
--      and to spot per-customer FLUX/Anthropic hotspots.
--   2. Forecast cost trajectories — pre-this-table the only spend signal
--      was the fal.ai dashboard, which is workspace-aggregated and lags
--      by 24h. With a row per call we can build per-customer / per-feature
--      charts in admin-stats from D1 directly.
--   3. Audit cost cuts — the parallel "raise critique acceptance to <5"
--      change is hard to measure without per-call attribution. After
--      this lands, runBacklogRegen invocations show up here so we can
--      diff regen volume before/after deploy.
--
-- Write path: lib/ai-usage.ts logAiUsage helper. Wrapped in try/catch by
-- every call site so a logging failure NEVER breaks the actual op
-- (image gen, critique, etc). Helper is a no-op outside production so
-- local `wrangler dev` doesn't pollute the table.
--
-- Read path: future admin-stats endpoint (not in this migration's PR).
-- The two composite indexes below cover the obvious access patterns:
-- "what did user X spend in the last 30d" and "what did client Y spend
-- on FLUX last week".
--
-- Apply via:
--   wrangler d1 execute socialai-studio-db --remote --file=schema_v18_ai_usage.sql

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT,
  client_id TEXT,
  provider TEXT NOT NULL,         -- 'fal', 'anthropic', 'gemini', 'openrouter'
  model TEXT NOT NULL,
  operation TEXT NOT NULL,        -- 'image-gen', 'critique', 'caption', etc
  tokens_in INTEGER,
  tokens_out INTEGER,
  images_generated INTEGER,
  est_cost_usd REAL,
  post_id TEXT,
  ok INTEGER NOT NULL DEFAULT 1
);

-- "Spend by user over time" — for per-user billing reconciliation +
-- top-N consumer detection in admin tooling.
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_ts ON ai_usage(user_id, ts);

-- "Spend by client over time" — for agency-managed accounts where the
-- meaningful workspace boundary is client_id, not user_id.
CREATE INDEX IF NOT EXISTS idx_ai_usage_client_ts ON ai_usage(client_id, ts);
