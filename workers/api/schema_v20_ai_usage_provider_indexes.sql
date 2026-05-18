-- schema_v20: extra ai_usage indexes for cross-workspace admin queries.
--
-- v18 shipped ai_usage with (user_id, ts) and (client_id, ts) indexes — both
-- workspace-scoped. Admin tooling needs the orthogonal slice: "what did
-- SocialAI spend on FLUX this week across ALL customers", "which operation
-- is the most expensive on average". Without these the admin-stats query
-- has to full-scan ai_usage every time the dashboard loads.
--
-- These indexes are cheap (ai_usage rows are short, and the table is
-- write-heavy but read-light) but pay back on every cost dashboard hit.
--
-- Apply via:
--   wrangler d1 execute socialai-db --remote --file=schema_v20_ai_usage_provider_indexes.sql

-- "What did we spend on provider X over time" — for cross-customer cost
-- attribution and FLUX vs Anthropic vs OpenRouter cost-trend charts.
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_ts ON ai_usage(provider, ts);

-- "What did we spend on operation X over time" — for spotting whether
-- critique, image-gen, or caption is dominating cost, and whether a
-- prompt change moved the needle on a specific operation.
CREATE INDEX IF NOT EXISTS idx_ai_usage_operation_ts ON ai_usage(operation, ts);
