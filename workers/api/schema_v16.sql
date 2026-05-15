-- schema_v16: subscription_status column for payment-failure gating.
--
-- (Was originally drafted as schema_v14 but that version is taken by PR A's
-- portal token expiry migration. Renamed to v16 to avoid a merge conflict.
-- PR A = v14 portal expiry, PR C = v15 client_facts index, v16 = this file.)
--
-- Set to 'past_due' by the PayPal BILLING.SUBSCRIPTION.PAYMENT.FAILED
-- webhook handler in lib/paypal.ts. Cleared back to NULL when a
-- PAYMENT.SALE.COMPLETED event fires (successful retry / card update).
--
-- Routes that consume AI provider budget gate on this column so a user
-- whose card has failed can't keep burning OpenRouter / Anthropic credits:
--   POST /api/ai/generate → 402 when subscription_status = 'past_due'
--
-- Apply via:
--   wrangler d1 execute socialai-studio-db --remote --file=schema_v16.sql

ALTER TABLE users ADD COLUMN subscription_status TEXT;
