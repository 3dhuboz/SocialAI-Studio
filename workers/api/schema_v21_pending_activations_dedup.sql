-- schema_v21 — dedup pending_activations + pending_cancellations
--
-- Pre-fix (security audit 2026-05-19): INSERT OR IGNORE in routes/paypal.ts:74
-- (verify-side) and lib/paypal.ts:285 (webhook side) falls back to the `id` PK
-- which is a freshly-minted UUID per call, so the dedup NEVER fires. Result:
-- typical signup creates 2 pending_activations rows for the same subscription
-- (one from /api/paypal-verify, one from the webhook). Only one is consumed;
-- the other sits at consumed=0 forever and can resurrect a stale plan on
-- next sign-in if the subscription was later cancelled and reactivated.
--
-- Fix: partial unique index on the natural key (paypal_subscription_id) WHERE
-- consumed=0. After this:
--   - The INSERT OR IGNORE actually deduplicates by subscription_id.
--   - Once a row is consumed (consumed=1) it falls out of the index, so a
--     legitimately-NEW activation for the same sub (cancel→reactivate cycle)
--     can still INSERT a fresh consumed=0 row.
--
-- pending_cancellations gets the same treatment for consistency — same race
-- (webhook retry of a CANCELLED event would insert duplicate prompts).
--
-- Run: wrangler d1 execute socialai-db --remote --file=schema_v21_pending_activations_dedup.sql

-- Drop any stale unconsumed duplicates BEFORE creating the unique index
-- (otherwise the CREATE fails with "UNIQUE constraint failed"). Keep the
-- newest row per subscription_id — the oldest were almost certainly stale
-- from before the welcome-email idempotency landed.
DELETE FROM pending_activations
WHERE consumed = 0
  AND paypal_subscription_id IS NOT NULL
  AND id NOT IN (
    SELECT id FROM pending_activations p1
    WHERE p1.consumed = 0
      AND p1.paypal_subscription_id IS NOT NULL
      AND p1.activated_at = (
        SELECT MAX(p2.activated_at) FROM pending_activations p2
        WHERE p2.paypal_subscription_id = p1.paypal_subscription_id
          AND p2.consumed = 0
      )
  );

DELETE FROM pending_cancellations
WHERE consumed = 0
  AND paypal_subscription_id IS NOT NULL
  AND id NOT IN (
    SELECT id FROM pending_cancellations p1
    WHERE p1.consumed = 0
      AND p1.paypal_subscription_id IS NOT NULL
      AND p1.cancelled_at = (
        SELECT MAX(p2.cancelled_at) FROM pending_cancellations p2
        WHERE p2.paypal_subscription_id = p1.paypal_subscription_id
          AND p2.consumed = 0
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_activations_sub_unconsumed
  ON pending_activations(paypal_subscription_id)
  WHERE consumed = 0 AND paypal_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_cancellations_sub_unconsumed
  ON pending_cancellations(paypal_subscription_id)
  WHERE consumed = 0 AND paypal_subscription_id IS NOT NULL;
