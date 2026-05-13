// Cross-cron shared constants.
//
// ACTIVE_CLIENT_FILTER — posts for on-hold clients must NEVER be claimed by
// any cron (publish, prewarm-images, prewarm-videos all use this). Append to
// a WHERE clause: ` AND ${ACTIVE_CLIENT_FILTER}` (no leading AND).
//
// This has been reverted twice in the past when the SQL was inline. Keep it
// named and centralised so any future cron query can include it explicitly.

export const ACTIVE_CLIENT_FILTER =
  `(client_id IS NULL OR client_id NOT IN (SELECT id FROM clients WHERE status = 'on_hold'))`;
