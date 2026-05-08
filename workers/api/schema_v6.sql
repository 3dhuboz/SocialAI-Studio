-- SocialAI Studio — D1 schema migration v6
-- Adds billing_cycle tracking so the PayPal webhook knows whether to grant
-- monthly (× 1) or annual (× 12) reel credits on PAYMENT.SALE.COMPLETED.
--
-- Apply with: npx wrangler d1 execute socialai-db --file=schema_v6.sql --remote
-- Local dev:  npx wrangler d1 execute socialai-db --file=schema_v6.sql --local
--
-- Backwards compatibility: NULL on existing rows is treated as 'monthly' by
-- the worker (the safer default — slight under-grant for any legacy yearly
-- users, never over-grant). New activations going forward always populate it.

-- One of 'monthly' | 'yearly'. Resolved from the PayPal plan_id at activation
-- time and propagated to the users row when the pending_activations is
-- consumed by the frontend.
ALTER TABLE pending_activations ADD COLUMN billing_cycle TEXT;
ALTER TABLE users               ADD COLUMN billing_cycle TEXT;
