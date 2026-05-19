-- schema_v23: cron_alerts table — operational alerting for Steve.
--
-- Single-row-per-alert dedup. The PK on alert_key enforces upsert via
-- INSERT … ON CONFLICT … DO UPDATE so concurrent fires from multiple cron
-- instances never insert duplicates.
--
-- Apply with:
--   cd workers/api
--   wrangler d1 execute socialai-db --remote --file=schema_v23_alerts.sql
--
-- Designed alongside lib/alerts.ts. fireAlert() upserts here, increments
-- fire_count, and decides whether to email based on severity-specific
-- throttle windows + the dark_launch flag.
--
-- Why a dedicated table (not piggyback on cron_runs):
--   - cron_runs is per-tick (one row per cron execution); we'd have to
--     re-SELECT and aggregate to derive "this alert has fired N times"
--   - cron_runs is also re-used by cron-notify.ts for throttle rows
--     (cron_type='alert:...'), which is already overloaded. Mixing
--     systems-health alerts in would make /api/cron-health unreadable.
--   - cron_alerts maps cleanly to a future /api/admin/alerts endpoint.

CREATE TABLE IF NOT EXISTS cron_alerts (
  alert_key        TEXT PRIMARY KEY,                       -- e.g. 'cron_crashed:publish'
  severity         TEXT NOT NULL,                          -- 'info' | 'warn' | 'critical'
  first_fired_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_fired_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_email_at    TEXT,                                   -- NULL = never emailed (dark-launch or pre-first-email)
  fire_count       INTEGER NOT NULL DEFAULT 1,
  last_resolved_at TEXT,                                   -- set when resolve cleared the condition
  last_body        TEXT,                                   -- forensics — last error/threshold message, truncated
  dark_launch      INTEGER NOT NULL DEFAULT 1              -- 1 = record-only (calibration mode), 0 = email-on-fire
);

CREATE INDEX IF NOT EXISTS idx_cron_alerts_last_fired
  ON cron_alerts(last_fired_at DESC);

CREATE INDEX IF NOT EXISTS idx_cron_alerts_unresolved
  ON cron_alerts(severity, last_fired_at DESC)
  WHERE last_resolved_at IS NULL;
