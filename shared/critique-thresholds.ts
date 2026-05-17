// Single source of truth for the image-quality critique gate.
//
// Imported by:
//   - workers/api/src/cron/prewarm-images.ts  (gen-time critique)
//   - workers/api/src/lib/backfill.ts          (manual + backlog critique)
//   - workers/api/src/cron/publish-missed.ts   (publish-time quality guard)
//
// Previously the magic number `5` was hardcoded in all three places. A tweak
// to one without the others would silently desync the regen loop from the
// publish-time block — same drift bug class as FLUX_NEGATIVE_PROMPT (PR #86).

/**
 * Critique score (1-10) at or above which a generated image is considered
 * shippable. Below this, the image is regenerated up to MAX_REGEN_ATTEMPTS
 * times before the publish-time guard kicks in.
 *
 * Tuned 2026-05: 5 was the sweet spot — 4 let visibly off-archetype images
 * through (food on a SaaS post passed the gate); 6 made the regen queue
 * thrash on legitimate prompts that just didn't render hero-quality.
 */
export const CRITIQUE_ACCEPT_THRESHOLD = 5;

/**
 * Max FLUX regen attempts per post. After this many tries, the post is
 * excluded from the regen queue and (if its scheduled_for arrives without
 * the score recovering) gets marked Missed by the publish-time quality
 * guard in cron/publish-missed.ts. Without a cap, a post whose caption is
 * hard for FLUX to render concretely (abstract wellness/coaching prompts
 * where FLUX defaults to generic stock-photo aesthetics) would loop
 * forever at ~$0.04/regen × 12 ticks/hour = ~$1/hour until publish.
 */
export const MAX_REGEN_ATTEMPTS = 3;
