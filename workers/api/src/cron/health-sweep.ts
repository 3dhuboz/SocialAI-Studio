// Health-sweep cron — runs every 15 minutes (`*/15 * * * *`).
//
// Threshold-based observability layer on top of `lib/alerts.ts`. Where the
// dispatcher hook fires `cron_crashed:<type>` for uncaught exceptions, this
// cron catches the *statistical* failure modes — patterns that don't throw
// but indicate something is broken in aggregate:
//
//   - publish_failure_burst : N posts marked Missed in the last 30 min
//   - publish_zombie        : posts stuck in status='Publishing' for >30 min
//
// Two checks for v1 — deliberately small. Each is dark-launched by default
// per the cron_alerts schema, so the first week is calibration-only (rows
// get written, no emails go out). Steve flips the per-key dark_launch flag
// after the noise level is known.
//
// 15-min cadence matches the spec from the alerting plan: "within an hour"
// detection budget with 4 sweeps per hour and headroom for the deploy window.
// One cheap COUNT(*) query per check, so even when there's nothing to alert
// the sweep is near-free.
//
// If you add a check, also add it to `dispatchScheduled` via `trackCron`
// — the catch block fires `cron_crashed:health_sweep` if this cron itself
// blows up, so the alerting infrastructure can't go silently dark.
//
// Resolution: when a check finds the condition cleared, it calls
// `resolveAlert(env, key)`. The next fire is treated as a fresh incident
// and bypasses the throttle — useful for incident-cluster re-alerts.

import type { Env } from '../env';
import { fireAlert, resolveAlert } from '../lib/alerts';

/** Threshold knobs centralised here so calibration after the dark-launch
 *  week is a one-file change. Conservative defaults: prefer false-negatives
 *  during calibration so the first emails Steve sees are signal, not noise. */
const THRESHOLDS = {
  /** Min number of Missed posts in 30 min to fire publish_failure_burst. */
  publishFailuresIn30Min: 5,
  /** Stuck-Publishing threshold — minutes since claim. */
  publishZombieMinutes: 30,
};

interface CheckResult {
  key: string;
  fired: boolean;
  detail?: string;
}

/** Run all sweep checks. Each check is wrapped so one failing check
 *  doesn't take down the whole sweep — the dispatcher's `trackCron`
 *  also catches, but we want partial results in the happy-ish case. */
export async function cronHealthSweep(env: Env): Promise<{ posts_processed: number; checks: CheckResult[] }> {
  const checks: CheckResult[] = [];
  for (const check of [checkPublishFailureBurst, checkPublishZombie]) {
    try {
      checks.push(await check(env));
    } catch (e: any) {
      // Per-check failure: log + record an alert for the check itself,
      // but continue to the others. The dispatcher's outer trackCron
      // would only see the final state.
      console.error(`[health-sweep] check ${check.name} threw:`, e?.message);
      await fireAlert(env, `health_sweep_check_failed:${check.name}`, 'warn', e?.message || String(e));
      checks.push({ key: check.name, fired: false, detail: `check threw: ${e?.message}` });
    }
  }
  const fired = checks.filter((c) => c.fired).length;
  return { posts_processed: fired, checks };
}

// ── Check: publish_failure_burst ────────────────────────────────────────
// If 5+ posts get marked Missed within a 30-min window, something is
// broken upstream — FB outage, Postproxy degradation, expired tokens
// for a high-volume workspace, etc. A handful of Misseds per day is
// normal (low-volume customers with stale tokens); a burst is not.

async function checkPublishFailureBurst(env: Env): Promise<CheckResult> {
  const key = 'publish_failure_burst';
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM posts
     WHERE status = 'Missed'
       AND reasoning IS NOT NULL
       AND (
         -- Prefer last_status_at if the column exists in this schema; fall back
         -- to scheduled_for (close enough — Missed transition fires near the
         -- scheduled time on the publish cron's next tick).
         scheduled_for >= datetime('now', '-30 minutes')
       )`
  ).first<{ n: number }>();
  const n = Number(row?.n ?? 0);
  if (n >= THRESHOLDS.publishFailuresIn30Min) {
    const detail = `${n} posts marked Missed in the last 30 minutes (threshold: ${THRESHOLDS.publishFailuresIn30Min}). Inspect via SELECT id, user_id, reasoning FROM posts WHERE status='Missed' AND scheduled_for >= datetime('now', '-30 minutes') ORDER BY scheduled_for DESC.`;
    await fireAlert(env, key, 'critical', detail);
    return { key, fired: true, detail };
  }
  await resolveAlert(env, key);
  return { key, fired: false, detail: `${n}/${THRESHOLDS.publishFailuresIn30Min}` };
}

// ── Check: publish_zombie ────────────────────────────────────────────────
// A post stuck in status='Publishing' for >30 min is almost certainly a
// zombie — either the Postproxy webhook never arrived, or the legacy
// reel-poll cron failed to flip it. Either way, the customer's content
// is in a black hole. The publish-missed cron's zombie-reset sweep
// catches these and flips them back to claim-able, but if MULTIPLE posts
// stay stuck across multiple zombie-resets, the dispatch is broken.

async function checkPublishZombie(env: Env): Promise<CheckResult> {
  const key = 'publish_zombie';
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM posts
     WHERE status = 'Publishing'
       AND claim_at IS NOT NULL
       AND claim_at < datetime('now', ?)`
  ).bind(`-${THRESHOLDS.publishZombieMinutes} minutes`).first<{ n: number }>();
  const n = Number(row?.n ?? 0);
  if (n > 0) {
    const detail = `${n} posts stuck in 'Publishing' for >${THRESHOLDS.publishZombieMinutes} min. Inspect via SELECT id, user_id, claim_at, fb_publish_state FROM posts WHERE status='Publishing' AND claim_at < datetime('now', '-${THRESHOLDS.publishZombieMinutes} minutes').`;
    await fireAlert(env, key, 'warn', detail);
    return { key, fired: true, detail };
  }
  await resolveAlert(env, key);
  return { key, fired: false, detail: '0 stuck' };
}

// Exported for unit tests to reach into without re-running the whole sweep.
export const __test = {
  THRESHOLDS,
  checkPublishFailureBurst,
  checkPublishZombie,
};
