// Cron dispatcher — the single scheduled() entry point and the trackCron
// wrapper that gives every cron crash-safety + duration tracking + a
// row in cron_runs for the /api/cron-health endpoint.
//
// Maps Cloudflare's cron-expression triggers to the right cron function:
//   */5 * * * *   → prewarm images + videos + publish missed posts + poll reels
//   0 */6 * * *   → backlog critique + backlog regen + fal.ai credits check
//   0 3 * * *     → token refresh
//   0 4 * * *     → daily fact refresh
//   0 21 * * SUN  → weekly review (Monday 7am AEST)
//   (anything else) → no-op + warn log (no expensive fallback)
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
import { cronPollPendingReels } from './poll-pending-reels';
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
    // Latency-sensitive lane: posts need images prewarmed before the publish
    // cron fires, and the publish cron needs to fire close to scheduled time.
    // Backlog jobs are NOT included here — they run on the 6-hourly lane
    // below to cap their worst-case spend (FLUX Pro Kontext at $0.04/img on
    // up to 20 imgs/tick = $0.80/tick = $9.60/hr if it ran here).
    await trackCron(env, 'prewarm_images', () => cronPrewarmImages(env));
    await trackCron(env, 'prewarm_videos', () => cronPrewarmVideos(env));
    await trackCron(env, 'publish', () => cronPublishMissedPosts(env));
    // Poll FB Reel uploads kicked off by the publish cron. Audit P0 fix
    // (2026-05) — Phase 3 (status poll) + Phase 4 (finish) of the reel
    // pipeline live here so the publish cron's hot loop isn't blocked
    // for 180s per post on FB processing. Bounded by 10s tick budget.
    await trackCron(env, 'poll_pending_reels', () => cronPollPendingReels(env));
    return;
  }
  if (cron === '0 */6 * * *') {
    // 6-hourly lane: "catch up later" work by design. Backlog jobs are
    // self-limiting (critique only scores posts where image_critique_score
    // IS NULL; regen only touches posts where image_critique_score <= 5 AND
    // image_regen_count < MAX_REGEN_ATTEMPTS) so once the backlog is
    // drained these become cheap no-op COUNT(*) queries. fal.ai credits
    // check runs on the same tick — also low-frequency by design.
    await trackCron(env, 'backlog_critique', async () => {
      const r = await runBacklogCritique(env);
      return { posts_processed: r.scored };
    });
    await trackCron(env, 'backlog_regen', async () => {
      const r = await runBacklogRegen(env);
      return { posts_processed: r.regenerated };
    });
    await trackCron(env, 'fal_credits', () => cronCheckFalCredits(env));
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
  //
  // GOTCHA: Cloudflare passes the literal trigger string from wrangler.toml
  // to event.cron — no normalisation. The CF cron parser rejects "0" as the
  // day-of-week field and demands the symbolic "SUN", so wrangler.toml must
  // use "0 21 * * SUN" and this case must compare the exact same string.
  // The previous "0 21 * * 0" form was unreachable: cron would never match
  // and the fallback chain ran instead, double-firing prewarm + publish at
  // 21:00 UTC every Sunday without ever invoking cronWeeklyReview.
  if (cron === '0 21 * * SUN') {
    await trackCron(env, 'weekly_review', () => cronWeeklyReview(env));
    return;
  }
  // Unknown cron expression — DO NOT trigger any expensive jobs as a
  // catch-all. Previously this branch re-ran prewarm/publish which is
  // unnecessary (the */5 branch covers them) and risked running backlog
  // jobs through a typo. Log loudly and return.
  console.warn(`[CRON dispatcher] unmatched cron expression: ${cron} — no jobs dispatched`);
}
