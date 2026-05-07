-- SocialAI Studio — D1 schema migration v4
-- Adds the `payments` table used by the admin Customers dashboard and the
-- per-customer Billing screen. Mirrors PayPal webhook events into our own
-- DB so we get an audit trail (the existing pending_activations /
-- pending_cancellations rows are short-lived — they get marked consumed
-- and effectively disappear from view).
--
-- Append-only by design: every webhook event we care about gets one row.
-- Activation, recurring payment, refund, cancellation, failed payment.
-- Money rows have amount_cents (negative for refunds). Non-money rows
-- (activate / cancel / failed) leave amount_cents NULL.
--
-- Apply with: npx wrangler d1 execute socialai-db --file=schema_v4.sql --remote

CREATE TABLE IF NOT EXISTS payments (
  id                       TEXT PRIMARY KEY,             -- our uuid
  paypal_event_id          TEXT,                         -- PayPal webhook event id (used for dedup)
  paypal_subscription_id   TEXT,                         -- I-xxx; the subscription this event relates to
  paypal_capture_id        TEXT,                         -- the actual sale/refund transaction id (PAYMENT.SALE.* events)
  email                    TEXT,                         -- subscriber email, denormalised for fast filter
  user_id                  TEXT,                         -- our internal users.id; nullable until we resolve
  plan                     TEXT,                         -- 'starter' | 'growth' | 'pro' | 'agency'
  event_type               TEXT,                         -- e.g. 'PAYMENT.SALE.COMPLETED'
  amount_cents             INTEGER,                      -- minor units; negative for refunds; NULL for non-money events
  currency                 TEXT DEFAULT 'AUD',
  status                   TEXT,                         -- 'completed' | 'cancelled' | 'refunded' | 'failed'
  raw_event                TEXT,                         -- JSON of the webhook payload for audit (capped to 8KB at write time)
  created_at               TEXT DEFAULT (datetime('now'))
);

-- Dedup webhook deliveries: PayPal can deliver the same event multiple times
-- under retry conditions. INSERT OR IGNORE on this index makes the writer idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_event      ON payments(paypal_event_id);
CREATE INDEX        IF NOT EXISTS idx_payments_email      ON payments(email);
CREATE INDEX        IF NOT EXISTS idx_payments_user       ON payments(user_id);
CREATE INDEX        IF NOT EXISTS idx_payments_sub        ON payments(paypal_subscription_id);
CREATE INDEX        IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
