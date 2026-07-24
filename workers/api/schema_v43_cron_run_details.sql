-- schema_v43_cron_run_details.sql
-- Add bounded structured telemetry for cron receipts. Application code writes
-- only allowlisted numeric counters; no post or customer content belongs here.

ALTER TABLE cron_runs ADD COLUMN details_json TEXT
  CHECK (
    details_json IS NULL
    OR (json_valid(details_json) AND LENGTH(details_json) <= 2000)
  );
