// Cron dispatcher — the single scheduled() entry point and the trackCron
// wrapper that gives every cron crash-safety + duration tracking + a
// row in cron_runs for the /api/cron-health endpoint.
//
// Maps Cloudflare's cron-expression triggers to the right cron function:
//   */5 * * * *  → prewarm images + videos + publish missed posts
//   0 3 * * *    → token refresh
//   0 4 * * *    → daily fact refresh
//   0 21 * * 0   → weekly review (Monday 7am AEST)
//   (anything else) → fallback chain
//
// Every cron is wrapped in trackCron so:
//   - a thrown exception in one cron doesn't kill the whole worker dispatch
//   - duration_ms is captured for the cron-health dashboard
//   - cron_runs has a row per fire with success=0/1 + error text
//
// Extracted from src/index.ts as Phase B step 25 of the route-module split.

import type { Env } from '../env';
import { cronRefreshTokens } from './refresh-tokens';
import { cronCheckFalCredits } from './check-fal-credits';
import { cronWeeklyReview } from './weekly-review';
import { cronRefreshFacts } from './refresh-facts';
import { cronPublishMissedPosts } from './publish-missed';
import { cronPrewarmImages } from './prewarm-images';
import { cronPrewarmVideos } from './prewarm-videos';
import { runBacklogCritique, runBacklogRegen } from '../lib/backfill';

// Wrap a cron function with try/catch + duration tracking + cron_runs logging.
// Returns void; never throws (so a failure in one cron doesn't kill the worker).
async function trackCron(
  env: Env,
  cronType: string,
  fn: () => Promise<{ posts_processed?: number } | void>,
): Promise<void> {
  const start = Date.now();
  let success = 1;
  let posts = 0;
  let error: string | null = null;
  try {
    const result = await fn();
    posts = result?.posts_processed ?? 0;
  } catch (e: any) {
    success = 0;
    error = (e?.message || String(e)).slice(0, 1000);
    console.error(`[CRON ${cronType}] FAILED:`, error);
  }
  const duration = Date.now() - start;
  try {
    await env.DB.prepare(
      `INSERT INTO cron_runs (cron_type, success, posts_processed, error, duration_ms)
       VALUES (?,?,?,?,?)`
    ).bind(cronType, success, posts, error, duration).run();
  } catch (logErr: any) {
    console.error(`[CRON ${cronType}] Failed to log run:`, logErr?.message);
  }
}

export async function dispatchScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  const cron = event.cron;
  if (cron === '*/5 * * * *') {
    await trackCron(env, 'prewarm_images', () => cronPrewarmImages(env));
    await trackCron(env, 'prewarm_videos', () => cronPrewarmVideos(env));
    await trackCron(env, 'publish', () => cronPublishMissedPosts(env));
    // Backlog: score every post with image_url but no critique data yet,
    // then regen low-scoring posts. Both helpers open with a cheap COUNT(*)
    // — once the backlog is exhausted they become free no-ops on subsequent
    // ticks. Self-limiting because:
    //   - critique only touches posts where image_critique_score IS NULL
    //   - regen only touches posts where image_critique_score <= 5
    // Once a post is scored OR regenerated to score > 5, it's done.
    await trackCron(env, 'backlog_critique', async () => {
      const r = await runBacklogCritique(env);
      return { posts_processed: r.scored };
    });
    await trackCron(env, 'backlog_regen', async () => {
      const r = await runBacklogRegen(env);
      return { posts_processed: r.regenerated };
    });
    return;
  }
  if (cron === '0 3 * * *') {
    await trackCron(env, 'token_refresh', () => cronRefreshTokens(env));
    return;
  }
  if (cron === '0 4 * * *') {
    await trackCron(env, 'facts_refresh', () => cronRefreshFacts(env));
    return;
  }
  // Monday 7am AEST (Sunday 21:00 UTC) — Autonomous Weekly Review.
  // For each workspace with FB connected, analyse last 7 days' performance
  // and send a Monday recap email with a CTA to approve next week's posts.
  if (cron === '0 21 * * 0') {
    await trackCron(env, 'weekly_review', () => cronWeeklyReview(env));
    return;
  }
  // Fallback for 6-hourly credit check and any unmatched triggers
  await trackCron(env, 'prewarm_fallback', () => cronPrewarmImages(env));
  await trackCron(env, 'prewarm_videos_fallback', () => cronPrewarmVideos(env));
  await trackCron(env, 'publish_fallback', () => cronPublishMissedPosts(env));
  await trackCron(env, 'fal_credits', () => cronCheckFalCredits(env));
}
