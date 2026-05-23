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

ALTER TABLE posts ADD COLUMN IF NOT EXISTS qa_feedback_target TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS qa_feedback_reason TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS qa_feedback_note TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS qa_feedback_at TEXT;
