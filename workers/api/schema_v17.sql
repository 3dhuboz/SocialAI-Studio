-- schema_v17: split publish-missed serial 180s FB Reel poll into kick + poll-later.
--
-- Audit P0 (Hono/Workers lane). The publish cron's postReelToFacebookPage
-- polled FB up to 180s per post, serially, inside the per-tick loop. With
-- 20 posts per claim × 180s, the cron blew its 30s budget on the first slow
-- IG response and got killed mid-batch — posts silently failed.
--
-- Refactored to mirror cron/prewarm-videos.ts's persist-and-poll-later
-- pattern. The publish cron now does Phase 1+2 only (start + transfer URL,
-- fast), persists the FB video_id, and returns. A new poll cron, also on
-- the */5 dispatcher tick, picks up posts in 'kicked'/'polling' state,
-- polls FB once per tick (no inner wait loop), and on completion runs the
-- finish phase to publish the reel.
--
-- Per-tick CPU budget: drops from "minutes" to "single seconds per post"
-- because the FB poll is moved out of the publish cron's hot loop.
--
-- New columns on posts:
--   fb_video_id      — the FB-issued video container id from upload_phase=start.
--                       Persisted between the kick (publish cron) and the
--                       finish (poll cron). NULL for non-reel posts.
--   fb_publish_state — 'kicked' (upload+transfer complete, awaiting FB
--                       processing) | 'polling' (poll cron has seen it at
--                       least once) | 'done' (finish phase succeeded, post
--                       marked Posted) | 'failed' (FB reported error or we
--                       timed out — post marked Missed and surfaced to owner).
--                       NULL for non-reel posts and pre-v17 reels.
--   fb_kicked_at     — AEST timestamp of when phase 1+2 succeeded. Used by
--                       the poll cron's stale-kick timeout (8 min) and by
--                       the publish cron's zombie-reset guard so a reel
--                       being polled doesn't get bounced back to Missed.
--   fb_finished_at   — AEST timestamp of when finish phase succeeded (or
--                       failed terminally). Lets the dashboard show the
--                       FB processing wall time for diagnostic purposes.
--
-- Apply via:
--   npx wrangler d1 execute socialai-studio-db --remote --file=schema_v17.sql
--   npx wrangler d1 execute socialai-studio-db --local --file=schema_v17.sql

ALTER TABLE posts ADD COLUMN fb_video_id TEXT;
ALTER TABLE posts ADD COLUMN fb_publish_state TEXT;
ALTER TABLE posts ADD COLUMN fb_kicked_at TEXT;
ALTER TABLE posts ADD COLUMN fb_finished_at TEXT;

-- Index for the poll cron's claim sweep: pick up rows with an in-flight FB
-- upload. Partial index keeps it tiny (most posts have NULL fb_publish_state).
CREATE INDEX IF NOT EXISTS idx_posts_fb_publish_state
  ON posts(fb_publish_state, fb_kicked_at)
  WHERE fb_publish_state IN ('kicked', 'polling');
