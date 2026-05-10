-- ─────────────────────────────────────────────────────────────────────────────
-- One-off cleanup for the Penny Wise pricing-table image regression.
--
-- Background: prior to PR #52, 5 image-gen entry points had drifted apart
-- and the worst-guarded one (App.tsx weak preamble) ran in production. This
-- caused promo/SaaS posts to render as blurry pricing-table mockups when
-- the AI's imagePrompt described a UI element.
--
-- PR #52 fixes it going forward — but Scheduled posts whose image_prompt
-- already mentions UI/pricing/dashboard/etc. will still publish with the
-- bad image_url that's already cached in D1, unless we clear it.
--
-- Strategy: NULL out image_url on those posts. cronPrewarmImages picks up
-- posts where image_url IS NULL within the next 30-min window, regenerates
-- via the new buildSafeImagePrompt helper, which detects the UI prompt and
-- swaps to a neutral safe scene before sending to FLUX. image_prompt is
-- left alone — the helper handles it at gen time.
--
-- Safety clauses:
--   - Only Scheduled posts (Posted/Cancelled/Missed are not touched)
--   - Only fal-cached image_url values (fal.media / fal.ai / fal.run)
--     — user-uploaded base64 (data:) images and unknown sources are skipped
--   - Conservative LIKE patterns (avoid false-positive matches like "tier"
--     in "frontier" or "ui" in "build/guide")
--
-- USAGE:
--   1. Run the DIAGNOSTIC SELECT first:
--        wrangler d1 execute socialai-db --remote --file=workers/api/cleanup_2026_05_ui_image_prompts.sql
--      Wrangler runs all statements in the file. The SELECT prints the
--      candidate rows; the UPDATE then clears their image_url.
--   2. To run JUST the SELECT (dry run), comment out the UPDATE block
--      below and re-run.
--   3. After the UPDATE: wait ~5-10 min for the next cronPrewarmImages tick.
--      Verify in CF Worker logs you see "[CRON prewarm] generated for post X"
--      lines and no "skipped post X: prompt too short" warnings.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── DIAGNOSTIC: which Scheduled posts will be affected? ──────────────────────
SELECT
  id,
  status,
  scheduled_for,
  CASE
    WHEN image_url IS NULL OR image_url = '' THEN 'no-image (cron will gen on new path)'
    WHEN image_url LIKE 'data:%' THEN 'user-upload (will SKIP)'
    WHEN image_url LIKE '%fal.media%' OR image_url LIKE '%fal.ai%' OR image_url LIKE '%fal.run%' THEN 'AI-cached (WILL CLEAR)'
    ELSE 'unknown source (will SKIP)'
  END AS source,
  substr(image_prompt, 1, 140) AS prompt_preview
FROM posts
WHERE status = 'Scheduled'
  AND image_prompt IS NOT NULL
  AND image_prompt != ''
  AND image_prompt != 'N/A'
  AND (
    LOWER(image_prompt) LIKE '%pricing%' OR
    LOWER(image_prompt) LIKE '%dashboard%' OR
    LOWER(image_prompt) LIKE '%infographic%' OR
    LOWER(image_prompt) LIKE '%comparison%' OR
    LOWER(image_prompt) LIKE '%mockup%' OR
    LOWER(image_prompt) LIKE '%wireframe%' OR
    LOWER(image_prompt) LIKE '%screenshot%' OR
    LOWER(image_prompt) LIKE '%landing page%' OR
    LOWER(image_prompt) LIKE '%marketing graphic%' OR
    LOWER(image_prompt) LIKE '%subscription plan%' OR
    LOWER(image_prompt) LIKE '%pricing table%' OR
    LOWER(image_prompt) LIKE '%pricing tier%' OR
    LOWER(image_prompt) LIKE '%comparison grid%' OR
    LOWER(image_prompt) LIKE '%pricing comparison%'
  )
ORDER BY scheduled_for ASC;

-- ── UPDATE: clear image_url on AI-cached posts that match the UI pattern ────
-- Comment out this block for a dry-run.
UPDATE posts
SET image_url = NULL
WHERE status = 'Scheduled'
  AND image_prompt IS NOT NULL
  AND image_prompt != ''
  AND image_prompt != 'N/A'
  AND image_url IS NOT NULL
  AND image_url != ''
  AND image_url NOT LIKE 'data:%'
  AND (
    image_url LIKE '%fal.media%'
    OR image_url LIKE '%fal.ai%'
    OR image_url LIKE '%fal.run%'
  )
  AND (
    LOWER(image_prompt) LIKE '%pricing%' OR
    LOWER(image_prompt) LIKE '%dashboard%' OR
    LOWER(image_prompt) LIKE '%infographic%' OR
    LOWER(image_prompt) LIKE '%comparison%' OR
    LOWER(image_prompt) LIKE '%mockup%' OR
    LOWER(image_prompt) LIKE '%wireframe%' OR
    LOWER(image_prompt) LIKE '%screenshot%' OR
    LOWER(image_prompt) LIKE '%landing page%' OR
    LOWER(image_prompt) LIKE '%marketing graphic%' OR
    LOWER(image_prompt) LIKE '%subscription plan%' OR
    LOWER(image_prompt) LIKE '%pricing table%' OR
    LOWER(image_prompt) LIKE '%pricing tier%' OR
    LOWER(image_prompt) LIKE '%comparison grid%' OR
    LOWER(image_prompt) LIKE '%pricing comparison%'
  );

-- ── VERIFY: same SELECT, should now show only 'no-image' rows for the
-- posts that were just cleared. Useful sanity check after the UPDATE.
SELECT
  COUNT(*) AS posts_cleared_now_pending_regen
FROM posts
WHERE status = 'Scheduled'
  AND (image_url IS NULL OR image_url = '')
  AND image_prompt IS NOT NULL
  AND (
    LOWER(image_prompt) LIKE '%pricing%' OR
    LOWER(image_prompt) LIKE '%dashboard%' OR
    LOWER(image_prompt) LIKE '%infographic%' OR
    LOWER(image_prompt) LIKE '%comparison%' OR
    LOWER(image_prompt) LIKE '%mockup%' OR
    LOWER(image_prompt) LIKE '%landing page%' OR
    LOWER(image_prompt) LIKE '%marketing graphic%'
  );
