-- SocialAI Studio — D1 schema migration v5
-- Adds scheduled AI Reels: video URL tracking + R2 cache state on posts,
-- plus reel_credits balance on users and clients.
--
-- Apply with: npx wrangler d1 execute socialai-db --file=schema_v5.sql --remote
-- Local dev:  npx wrangler d1 execute socialai-db --file=schema_v5.sql --local
--
-- SQLite/D1 limitation: ALTER TABLE only supports ADD COLUMN. All new columns
-- are nullable or have a sensible DEFAULT so existing rows keep working without
-- backfill. Existing video columns from v2 (post_type, video_script,
-- video_shots, video_mood) are reused — do NOT re-add them here.

-- ── posts ──────────────────────────────────────────────────────────────────
-- The R2-cached or fal.ai video URL. Populated by cronPrewarmVideos at
-- T-45min; consumed by cronPublishMissedPosts when scheduled_for arrives.
ALTER TABLE posts ADD COLUMN video_url        TEXT;

-- State machine for the prewarm pipeline:
--   NULL          — not a video post (or pre-prewarm legacy row)
--   'pending'     — accepted by user, waiting for prewarm cron to claim
--   'generating'  — fal.ai Kling job in flight; video_request_id is set
--   'ready'       — video_url populated, R2-cached, ready to publish
--   'failed'      — generation failed; publish cron falls back to thumbnail
ALTER TABLE posts ADD COLUMN video_status     TEXT;

-- fal.ai queue request id, persisted across cron ticks so polling resumes.
-- Kling generation takes 60-180s — far longer than a single 5-min cron tick's
-- comfortable budget. We kick off in tick N, poll in N+1, store URL in N+2.
ALTER TABLE posts ADD COLUMN video_request_id TEXT;

-- AEST timestamp marking when video_status flipped to 'generating'. Used by
-- the prewarm cron's watchdog to time out stuck jobs (>8 min) and fail them
-- so the publish cron can fall back to image-only without losing the slot.
ALTER TABLE posts ADD COLUMN video_started_at TEXT;

-- Last failure reason for video gen. Surfaced in PostModal so users see why
-- their reel didn't generate — same UX pattern as `reasoning` for publish failures.
ALTER TABLE posts ADD COLUMN video_error      TEXT;

-- R2 object key (e.g. 'reels/<post_id>.mp4'). Persisted so the cleanup cron
-- can delete the right object without recomputing the key from post_id.
ALTER TABLE posts ADD COLUMN r2_video_key     TEXT;

-- The mixed-audio version (PR #2). Browser-side mixer can't run in cron, so
-- this stays NULL for cron-published reels in PR #1. Future-proofed schema:
-- when ffmpeg-as-a-service ships, populate this and prefer it over video_url
-- in the publish branch.
ALTER TABLE posts ADD COLUMN audio_mixed_url  TEXT;

-- Speeds up the prewarm cron's hot-path query
-- (post_type='video' AND video_status IN ('pending','generating') AND ...).
-- Without this index the cron scans the full posts table every 5 minutes.
CREATE INDEX IF NOT EXISTS idx_posts_video_prewarm
  ON posts(post_type, video_status, scheduled_for);

-- ── users / clients — reel credits ─────────────────────────────────────────
-- Single balance per workspace. Both plan-included grants (Stripe webhook
-- on invoice.paid adds plan.reelsPerMonth) AND purchased credit packs
-- (Stripe one-off product webhook adds the pack size) increment this column.
-- Reel generation decrements by 1. Never expires — accumulates indefinitely.
--
-- Gating: any reel generation requires reel_credits > 0. Starter/Growth users
-- start at 0 and only get credits via purchase; Pro/Agency get monthly grants
-- on each successful billing.
ALTER TABLE users   ADD COLUMN reel_credits INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN reel_credits INTEGER DEFAULT 0;
