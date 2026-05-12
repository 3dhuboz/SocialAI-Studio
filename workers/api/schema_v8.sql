-- SocialAI Studio — D1 schema migration v8
-- Persists the result of Haiku 4.5 vision critique on each post's image.
--
-- The critique runs at prewarm time (T-30min before scheduled publish) AND
-- when the user manually calls /api/critique-image-caption. Storing the
-- result gives us:
--   1. An audit trail — Steve can scan for low-score posts in the admin
--      dashboard before they publish, instead of trusting the cron silently.
--   2. UI surfacing — PostModal renders a small "AI quality ✓ 8/10" badge so
--      the user sees that the system actually checked the image.
--   3. Re-critique skip — if a post already has a fresh critique, the cron
--      doesn't redundantly re-score it on every prewarm tick (the cron only
--      queries posts without image_url today, but this leaves room for a
--      future critique-only pass over already-generated images).
--
-- Idempotent — uses ALTER TABLE ADD COLUMN which D1 supports natively. Run via:
--   npx wrangler d1 execute socialai-db --file=workers/api/schema_v8.sql --remote

ALTER TABLE posts ADD COLUMN image_critique_score INTEGER;
ALTER TABLE posts ADD COLUMN image_critique_reasoning TEXT;
ALTER TABLE posts ADD COLUMN image_critique_at TEXT;
