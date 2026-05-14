-- ─────────────────────────────────────────────────────────────────────
--  schema_v12.sql — Agentic campaigns
--
--  Adds research-brief columns to the existing campaigns table so we can
--  store the AI's pre-research output once and reuse it across every
--  smart-schedule run that touches the campaign window. Today the brief is
--  re-generated on every schedule call (slow, non-deterministic, and
--  silently broken because /api/ai/web-fetch was never deployed) — these
--  columns let us run research ONCE on create/update and reuse it.
--
--  Why ALTER TABLE individually (vs CREATE TABLE … with backfill):
--    The campaigns table already has live rows on prod. Sqlite ALTER
--    supports ADD COLUMN and that's all we need — no pivot.
--
--  Apply with:
--    cd workers/api
--    npx wrangler d1 execute socialai-db --file=schema_v12.sql --remote
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE campaigns ADD COLUMN brief             TEXT;
ALTER TABLE campaigns ADD COLUMN brief_summary     TEXT;
ALTER TABLE campaigns ADD COLUMN brief_status      TEXT DEFAULT 'idle';
ALTER TABLE campaigns ADD COLUMN brief_updated_at  TEXT;
ALTER TABLE campaigns ADD COLUMN brief_sources     TEXT DEFAULT '[]';

-- brief_status values:
--   'idle'        — never researched (fresh row, or rules empty)
--   'researching' — research is currently in flight (stops duplicate kicks)
--   'ready'       — brief is current; safe to consume in smart-schedule
--   'failed'      — last research attempt errored (UI can show retry)
--
-- brief is the full multi-section research output. brief_summary is a short
-- 1-2 sentence "I checked example.com and found 3 features" line for the
-- UI's confirmation reply. brief_sources is a JSON array of URLs actually
-- fetched during research (for transparency in the UI).
