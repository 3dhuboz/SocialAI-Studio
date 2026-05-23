-- schema_v36_customer_feedback.sql
-- Small customer QA feedback loop for scheduled/generated posts.
--
-- Users can mark the whole post, the image, or the caption as off-brand/bad
-- from PostModal. Stored on posts so support/admin review can inspect the
-- exact asset that triggered feedback and future generation work can mine it.
--
-- Apply with:
--   wrangler d1 execute socialai-db --remote --file=schema_v36_customer_feedback.sql
--   wrangler d1 execute socialai-db-staging --remote --file=schema_v36_customer_feedback.sql

-- D1/Wrangler v3 rejects `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
-- This migration is one-time; if an environment partially applied it,
-- inspect `PRAGMA table_info(posts)` and apply only missing columns manually.
ALTER TABLE posts ADD COLUMN qa_feedback_target TEXT;
ALTER TABLE posts ADD COLUMN qa_feedback_reason TEXT;
ALTER TABLE posts ADD COLUMN qa_feedback_note TEXT;
ALTER TABLE posts ADD COLUMN qa_feedback_at TEXT;
