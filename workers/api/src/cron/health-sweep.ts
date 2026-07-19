// Health-sweep cron — runs every 15 minutes (`*/15 * * * *`).
//
// Threshold-based observability layer on top of `lib/alerts.ts`. Where the
// dispatcher hook fires `cron_crashed:<type>` for uncaught exceptions, this
// cron catches the *statistical* failure modes — patterns that don't throw
// but indicate something is broken in aggregate:
//
//   - publish_failure_burst : N posts marked Missed in the last 30 min
//   - publish_zombie        : posts stuck in status='Publishing' for >30 min
//   - learning_calibration_receipt_stale : established weekly receipt stopped arriving
//   - alert_persistence_schema : the incident ledger and both indexes exist
//   - learning_readiness_receipt_schema : latest readiness receipt uses the full schema
//
// Five checks for v1 - deliberately small. Each incident is dark-launched by default
// per the cron_alerts schema, so the first week is calibration-only (rows
// get written, no emails go out). Steve flips the per-key dark_launch flag
// after the noise level is known.
//
// 15-min cadence matches the spec from the alerting plan: "within an hour"
// detection budget with 4 sweeps per hour and headroom for the deploy window.
// One cheap aggregate query per check, so even when there's nothing to alert
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
import { AUTOPILOT_POLICY_VERSION } from '../lib/learning/readiness';
import { hasCompleteGreenLearningReadinessChecks } from '../../../../shared/learning-readiness-checks';

/** Threshold knobs centralised here so calibration after the dark-launch
 *  week is a one-file change. Conservative defaults: prefer false-negatives
 *  during calibration so the first emails Steve sees are signal, not noise. */
const THRESHOLDS = {
  /** Min number of Missed posts in 30 min to fire publish_failure_burst. */
  publishFailuresIn30Min: 5,
  /** Stuck-Publishing threshold — minutes since claim. */
  publishZombieMinutes: 30,
  learningCalibrationMaxAgeMinutes: (7 * 24 * 60) + 60,
};

interface CheckResult {
  key: string;
  fired: boolean;
  detail?: string;
}

/** Run every sweep check even when one fails, then throw one aggregate error
 *  so the dispatcher's `trackCron` records a failed natural receipt. */
export async function cronHealthSweep(env: Env): Promise<{ posts_processed: number; checks: CheckResult[] }> {
  const checks: CheckResult[] = [];
  const failedChecks: string[] = [];
  for (const check of [
    checkAlertPersistenceSchema,
    checkLearningReadinessReceiptSchema,
    checkPublishFailureBurst,
    checkPublishZombie,
    checkLearningCalibrationFreshness,
  ]) {
    try {
      checks.push(await check(env));
    } catch (e: any) {
      // Per-check failure: log + record an alert for the check itself,
      // but continue to the others. The dispatcher's outer trackCron
      // would only see the final state.
      console.error(`[health-sweep] check ${check.name} threw:`, e?.message);
      await fireAlert(env, `health_sweep_check_failed:${check.name}`, 'warn', e?.message || String(e));
      checks.push({ key: check.name, fired: false, detail: `check threw: ${e?.message}` });
      failedChecks.push(check.name);
    }
  }
  if (failedChecks.length > 0) {
    const label = failedChecks.length === 1 ? 'check' : 'checks';
    throw new Error(
      `Health sweep completed with ${failedChecks.length} failed ${label}: ${failedChecks.join(', ')}`,
    );
  }
  const fired = checks.filter((c) => c.fired).length;
  return { posts_processed: fired, checks };
}

// Alert delivery stays best-effort so an alert-ledger or Resend outage cannot
// interrupt customer publishing. This health-lane sentinel independently
// makes missing persistence infrastructure visible in the cron receipt.
async function checkAlertPersistenceSchema(env: Env): Promise<CheckResult> {
  const key = 'alert_persistence_schema';
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE
              WHEN type = 'table' AND name = 'cron_alerts' THEN 1 ELSE 0
            END), 0) AS alert_tables,
            COALESCE(SUM(CASE
              WHEN type = 'index'
               AND name IN ('idx_cron_alerts_last_fired', 'idx_cron_alerts_unresolved')
              THEN 1 ELSE 0
            END), 0) AS alert_indexes
       FROM sqlite_master
      WHERE (type = 'table' AND name = 'cron_alerts')
         OR (type = 'index'
             AND name IN ('idx_cron_alerts_last_fired', 'idx_cron_alerts_unresolved'))`,
  ).first<{ alert_tables: number; alert_indexes: number }>();
  const tables = Number(row?.alert_tables ?? 0);
  const indexes = Number(row?.alert_indexes ?? 0);
  const detail = `table=${tables} indexes=${indexes}`;
  if (tables !== 1 || indexes !== 2) {
    throw new Error(`Alert persistence schema is incomplete (${detail})`);
  }
  return { key, fired: false, detail };
}

// Before the first readiness receipt, the rollout gate remains the authority.
// Once receipts exist, malformed or truncated checks must surface as a failed
// natural health receipt rather than silently reducing operator visibility.
async function checkLearningReadinessReceiptSchema(env: Env): Promise<CheckResult> {
  const key = 'learning_readiness_receipt_schema';
  const row = await env.DB.prepare(
    `SELECT checks_json
       FROM learning_release_readiness
      WHERE policy_version = ?
      ORDER BY evaluated_at DESC, id DESC
      LIMIT 1`,
  ).bind(AUTOPILOT_POLICY_VERSION).first<{ checks_json: string | null }>();

  if (!row) {
    return { key, fired: false, detail: 'monitor not established' };
  }

  let checks: unknown = null;
  try {
    checks = JSON.parse(row.checks_json ?? '');
  } catch {
    // The shared schema validator below owns the fail-closed result.
  }

  if (!hasCompleteGreenLearningReadinessChecks(checks)) {
    throw new Error('Latest learning readiness receipt has an incomplete checks schema');
  }

  return { key, fired: false, detail: 'complete current schema' };
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

// Once the first successful weekly receipt exists, it must keep arriving.
// Before that point, the promotion verifier remains the activation authority.
async function checkLearningCalibrationFreshness(
  env: Env,
  now = new Date(),
): Promise<CheckResult> {
  const key = 'learning_calibration_receipt_stale';
  const row = await env.DB.prepare(
    `SELECT MAX(run_at) AS last_success_at
       FROM cron_runs
      WHERE cron_type = 'learning_calibration'
        AND success = 1`,
  ).first<{ last_success_at: string | null }>();
  const lastSuccessAt = typeof row?.last_success_at === 'string'
    ? row.last_success_at.trim()
    : '';
  if (!lastSuccessAt) {
    return { key, fired: false, detail: 'monitor not established' };
  }

  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(lastSuccessAt)
    ? lastSuccessAt
    : `${lastSuccessAt.replace(' ', 'T')}Z`;
  const observedAt = Date.parse(normalized);
  const ageMinutes = (now.getTime() - observedAt) / 60_000;
  if (!Number.isFinite(observedAt) || !Number.isFinite(ageMinutes) || ageMinutes < 0) {
    const detail = 'The last successful weekly independent calibration receipt has an invalid '
      + 'or future timestamp; operator review required.';
    await fireAlert(env, key, 'critical', detail);
    return { key, fired: true, detail };
  }

  if (ageMinutes > THRESHOLDS.learningCalibrationMaxAgeMinutes) {
    const roundedAge = Math.floor(ageMinutes);
    const detail = `The last successful weekly independent calibration receipt is ${roundedAge} `
      + `minutes old, older than the ${THRESHOLDS.learningCalibrationMaxAgeMinutes}-minute `
      + 'limit; operator review required.';
    await fireAlert(env, key, 'critical', detail);
    return { key, fired: true, detail };
  }

  await resolveAlert(env, key);
  return {
    key,
    fired: false,
    detail: `${Math.floor(ageMinutes)}/${THRESHOLDS.learningCalibrationMaxAgeMinutes} minutes`,
  };
}

// Exported for unit tests to reach into without re-running the whole sweep.
export const __test = {
  THRESHOLDS,
  checkAlertPersistenceSchema,
  checkLearningReadinessReceiptSchema,
  checkPublishFailureBurst,
  checkPublishZombie,
  checkLearningCalibrationFreshness,
};
