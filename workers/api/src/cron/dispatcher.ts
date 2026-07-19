// Cron dispatcher — the single scheduled() entry point and the trackCron
// wrapper that gives every cron crash-safety + duration tracking + a
// row in cron_runs for the /api/cron-health endpoint.
//
// Maps Cloudflare's cron-expression triggers to the right cron function:
//   */5 * * * *   → prewarm images + videos + publish missed posts + poll reels
//   */15 * * * *  → health sweep (threshold-based observability alerts)
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
import { cronEvaluateLearningShadow } from './evaluate-learning-shadow';
import { cronEvaluateLearningPilot } from './evaluate-learning-pilot';
import { cronCollectLearningOutcomes } from './collect-learning-outcomes';
import { cronLearnStrategies } from './learn-strategies';
import { cronEvaluateLearningReadiness } from './evaluate-learning-readiness';
import { cronEvaluateLearningCalibration } from './evaluate-learning-calibration';
import { runBacklogCritique, runBacklogRegen } from '../lib/backfill';
import { fireAlert } from '../lib/alerts';
import { cronHealthSweep } from './health-sweep';
import { reconcileSubscriptions } from './reconcile-subscriptions';

const LEARNING_PILOT_DETAIL_KEYS = [
  'posts_processed',
  'candidates_considered',
  'evaluated',
  'reused',
  'claimed_elsewhere',
  'budget_skipped',
  'context_not_ready',
  'invalid_skipped',
  'errors',
] as const;

const LEARNING_READINESS_DETAIL_KEYS = [
  'workspaces_disabled',
] as const;

const LEARNING_CALIBRATION_DETAIL_KEYS = [
  'posts_processed',
  'candidates_considered',
  'completed',
  'unavailable',
  'claimed_elsewhere',
  'budget_skipped',
  'severe_false_passes',
  'workspaces_disabled',
  'errors',
] as const;

type TrackedCronResult = {
  posts_processed?: number;
  workspaces_disabled?: number;
};

function safeCounter(value: unknown): number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : 0;
}

export function buildCronDetails(
  cronType: string,
  result: TrackedCronResult | void,
): string | null {
  if (!result) return null;
  const detailKeys: readonly string[] = cronType === 'learning_pilot'
    ? LEARNING_PILOT_DETAIL_KEYS
    : cronType === 'learning_readiness'
      ? LEARNING_READINESS_DETAIL_KEYS
      : cronType === 'learning_calibration'
        ? LEARNING_CALIBRATION_DETAIL_KEYS
        : [];
  if (detailKeys.length === 0) return null;
  const counters = result as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(
    detailKeys.map((key) => [key, safeCounter(counters[key])]),
  ));
}

// Wrap a cron function with try/catch + duration tracking + cron_runs logging.
// Returns void; never throws (so a failure in one cron doesn't kill the worker).
export async function trackCron(
  env: Env,
  cronType: string,
  fn: () => Promise<TrackedCronResult | void>,
): Promise<void> {
  const start = Date.now();
  let success = 1;
  let posts = 0;
  let error: string | null = null;
  let detailsJson: string | null = null;
  try {
    const result = await fn();
    posts = result?.posts_processed ?? 0;
    detailsJson = buildCronDetails(cronType, result);
  } catch (e: any) {
    success = 0;
    error = (e?.message || String(e)).slice(0, 1000);
    console.error(`[CRON ${cronType}] FAILED:`, error);
    // Fire a critical alert so Steve learns about cron crashes within an
    // hour. fireAlert never throws — it logs internally on failure — so
    // it can't cascade into a second exception here. Defaults to
    // dark-launch (record-only) until the cron_alerts row is flipped.
    await fireAlert(env, `cron_crashed:${cronType}`, 'critical', error || 'unknown');
  }
  const duration = Date.now() - start;
  try {
    await env.DB.prepare(
      `INSERT INTO cron_runs (
         cron_type, success, posts_processed, error, duration_ms, details_json
       ) VALUES (?,?,?,?,?,?)`
    ).bind(cronType, success, posts, error, duration, detailsJson).run();
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
    if (env.LEARNING_BRAIN_ENABLED === 'true') {
      await trackCron(env, 'learning_shadow', () => cronEvaluateLearningShadow(env));
    }
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
    if (env.LEARNING_BRAIN_ENABLED === 'true') {
      await trackCron(env, 'learning_outcomes', () => cronCollectLearningOutcomes(env));
    }
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
  if (cron === '*/15 * * * *') {
    // Threshold-based observability sweep — runs every 15 min, near-free
    // when nothing's wrong (one COUNT(*) per check). Fires alerts via
    // lib/alerts.ts when publish failures cluster or posts go zombie.
    // See cron/health-sweep.ts for the per-check rationale + thresholds.
    await trackCron(env, 'health_sweep', async () => {
      const r = await cronHealthSweep(env);
      return { posts_processed: r.posts_processed };
    });
    // Reconcile Shopify subscriptions — catches missed app_subscriptions/update
    // webhooks. Cheap when no Shopify shops are out of sync; runs on the same
    // 15-min cadence as health sweep since both are observability-tier work.
    await trackCron(env, 'shopify_reconcile', () => reconcileSubscriptions(env));
    if (
      env.LEARNING_BRAIN_ENABLED === 'true'
      && env.LEARNING_RELEASE_ENFORCEMENT !== 'true'
      && env.LEARNING_AUTOPILOT_ENABLED !== 'true'
    ) {
      // Record-only pilot work is isolated from the 5-minute publish lane.
      // It evaluates at most one Draft per explicitly consented workspace
      // and can never schedule, mutate, or publish the source post.
      await trackCron(env, 'learning_pilot', () => cronEvaluateLearningPilot(env));
    }
    if (env.LEARNING_BRAIN_ENABLED === 'true') {
      await trackCron(env, 'learning_readiness', () => cronEvaluateLearningReadiness(env));
    }
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
    if (env.LEARNING_BRAIN_ENABLED === 'true') {
      await trackCron(env, 'learning_calibration', () => cronEvaluateLearningCalibration(env));
      await trackCron(env, 'learn_strategies', () => cronLearnStrategies(env));
    }
    await trackCron(env, 'weekly_review', () => cronWeeklyReview(env));
    return;
  }
  // Unknown cron expression — DO NOT trigger any expensive jobs as a
  // catch-all. Previously this branch re-ran prewarm/publish which is
  // unnecessary (the */5 branch covers them) and risked running backlog
  // jobs through a typo. Log loudly and return.
  console.warn(`[CRON dispatcher] unmatched cron expression: ${cron} — no jobs dispatched`);
}
