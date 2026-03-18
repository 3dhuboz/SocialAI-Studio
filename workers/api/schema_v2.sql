-- SocialAI Studio — D1 schema migration v2
-- Apply with: npx wrangler d1 execute socialai-db --file=schema_v2.sql --remote

-- Add missing post fields (Late.dev tracking, image metadata, video fields)
ALTER TABLE posts ADD COLUMN late_post_id  TEXT;
ALTER TABLE posts ADD COLUMN image_prompt  TEXT;
ALTER TABLE posts ADD COLUMN reasoning     TEXT;
ALTER TABLE posts ADD COLUMN post_type     TEXT;
ALTER TABLE posts ADD COLUMN video_script  TEXT;
ALTER TABLE posts ADD COLUMN video_shots   TEXT;
ALTER TABLE posts ADD COLUMN video_mood    TEXT;

-- Add missing fields to pending_activations (needed for PayPal webhook + verify)
ALTER TABLE pending_activations ADD COLUMN email                   TEXT;
ALTER TABLE pending_activations ADD COLUMN paypal_customer_id      TEXT;
ALTER TABLE pending_activations ADD COLUMN activated_at            TEXT;

-- Add missing fields to pending_cancellations (needed for PayPal webhook)
ALTER TABLE pending_cancellations ADD COLUMN email                 TEXT;
ALTER TABLE pending_cancellations ADD COLUMN paypal_subscription_id TEXT;
ALTER TABLE pending_cancellations ADD COLUMN cancelled_at          TEXT;
