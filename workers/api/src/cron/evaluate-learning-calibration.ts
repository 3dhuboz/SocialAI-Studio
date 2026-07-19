import type { Env } from '../env';
import { fireAlert, resolveAlert } from '../lib/alerts';
import {
  claimCalibrationAudit,
  completeCalibrationAudit,
  listCalibrationCandidates,
  markCalibrationUnavailable,
  WEEKLY_CALIBRATION_SAMPLE_LIMIT,
} from '../lib/learning/calibration-audit';
import {
  buildReleaseContentHash,
  evaluateReleaseCandidateFresh,
} from '../lib/learning/release-preflight';
import type { ReleasePipelineResult } from '../lib/learning/release-pipeline';
import {
  getWorkspaceMonthlyAiSpend,
  quarantineSevereFalsePassWorkspaces,
} from '../lib/learning/workspace-mode';

const CALIBRATION_LEASE_MS = 15 * 60 * 1000;
export const WEEKLY_CALIBRATION_BUDGET_RESERVE_CENTS = 50;
export const LEARNING_CALIBRATION_DEGRADED_ALERT_KEY = 'learning_calibration_run_degraded';

export interface EvaluateLearningCalibrationOptions {
  now?: Date;
  listCandidates?: typeof listCalibrationCandidates;
  claimAudit?: typeof claimCalibrationAudit;
  buildContentHash?: typeof buildReleaseContentHash;
  evaluateFresh?: typeof evaluateReleaseCandidateFresh;
  loadSpend?: typeof getWorkspaceMonthlyAiSpend;
  completeAudit?: typeof completeCalibrationAudit;
  markUnavailable?: typeof markCalibrationUnavailable;
  quarantine?: typeof quarantineSevereFalsePassWorkspaces;
  alert?: typeof fireAlert;
  resolve?: typeof resolveAlert;
}

export interface LearningCalibrationResult {
  posts_processed: number;
  candidates_considered: number;
  completed: number;
  unavailable: number;
  claimed_elsewhere: number;
  budget_skipped: number;
  severe_false_passes: number;
  workspaces_disabled: number;
  errors: number;
}

function hasUnavailableCritic(result: ReleasePipelineResult): boolean {
  return result.judgeStatus === 'unavailable'
    || result.attempts.flat().some((verdict) => verdict.verdict === 'unavailable');
}

function compactSummary(result: ReleasePipelineResult): Record<string, unknown> {
  const verdicts = result.attempts.flat();
  return {
    attemptCount: result.attempts.length,
    repairCount: result.repairHistory.length,
    verdictCount: verdicts.length,
    criticKinds: [...new Set(verdicts.map((verdict) => verdict.kind))].sort(),
    judgeStatus: result.judgeStatus,
    mediaKind: result.candidate.media.kind,
  };
}

function originalExpectedState(
  result: ReleasePipelineResult,
): ReleasePipelineResult['state'] {
  if (result.state === 'block_red') return 'block_red';
  return result.repairHistory.length > 0 ? 'hold_amber' : result.state;
}

export async function cronEvaluateLearningCalibration(
  env: Env,
  options: EvaluateLearningCalibrationOptions = {},
): Promise<LearningCalibrationResult> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Calibration timestamp is invalid');
  const nowIso = now.toISOString();
  const leaseIso = new Date(now.getTime() + CALIBRATION_LEASE_MS).toISOString();
  const findCandidates = options.listCandidates ?? listCalibrationCandidates;
  const claim = options.claimAudit ?? claimCalibrationAudit;
  const buildHash = options.buildContentHash ?? buildReleaseContentHash;
  const evaluate = options.evaluateFresh ?? evaluateReleaseCandidateFresh;
  const loadSpend = options.loadSpend ?? getWorkspaceMonthlyAiSpend;
  const complete = options.completeAudit ?? completeCalibrationAudit;
  const unavailable = options.markUnavailable ?? markCalibrationUnavailable;
  const quarantine = options.quarantine ?? quarantineSevereFalsePassWorkspaces;
  const alert = options.alert ?? fireAlert;
  const resolve = options.resolve ?? resolveAlert;

  const candidates = await findCandidates(
    env.DB,
    nowIso,
    WEEKLY_CALIBRATION_SAMPLE_LIMIT,
  );
  const counters: LearningCalibrationResult = {
    posts_processed: 0,
    candidates_considered: candidates.length,
    completed: 0,
    unavailable: 0,
    claimed_elsewhere: 0,
    budget_skipped: 0,
    severe_false_passes: 0,
    workspaces_disabled: 0,
    errors: 0,
  };

  for (const candidate of candidates) {
    let claimedAuditId: string | null = null;
    try {
      const budget = candidate.monthlyAiBudgetUsdCents;
      const spend = await loadSpend(env.DB, candidate, now);
      const spendCents = spend.monthlyAiSpendUsdCents;
      if (
        !Number.isSafeInteger(budget)
        || Number(budget) <= 0
        || !Number.isSafeInteger(spendCents)
        || Number(spendCents) < 0
        || !Number.isSafeInteger(spend.telemetryCount)
        || spend.telemetryCount <= 0
        || Number(budget) - Number(spendCents) < WEEKLY_CALIBRATION_BUDGET_RESERVE_CENTS
      ) {
        counters.budget_skipped += 1;
        continue;
      }

      const audit = await claim(env.DB, candidate, nowIso, leaseIso);
      if (!audit) {
        counters.claimed_elsewhere += 1;
        continue;
      }
      claimedAuditId = audit.id;

      if (!candidate.post.content.trim()) {
        await unavailable(
          env.DB,
          candidate,
          audit.id,
          'missing',
          'Calibration source post is missing',
          nowIso,
        );
        claimedAuditId = null;
        counters.unavailable += 1;
        continue;
      }

      let currentHash: string;
      try {
        currentHash = await buildHash(candidate.post);
      } catch (error) {
        await unavailable(
          env.DB,
          candidate,
          audit.id,
          'missing',
          error instanceof Error ? error.message : String(error),
          nowIso,
        );
        claimedAuditId = null;
        counters.unavailable += 1;
        continue;
      }
      if (currentHash !== candidate.contentHash) {
        await unavailable(
          env.DB,
          candidate,
          audit.id,
          'stale',
          'Calibration source content changed after the original green decision',
          nowIso,
        );
        claimedAuditId = null;
        counters.unavailable += 1;
        continue;
      }

      let result: ReleasePipelineResult;
      try {
        result = await evaluate(env, candidate.post, candidate.mode);
      } catch (error) {
        await unavailable(
          env.DB,
          candidate,
          audit.id,
          'pipeline_unavailable',
          error instanceof Error ? error.message : String(error),
          nowIso,
        );
        claimedAuditId = null;
        counters.unavailable += 1;
        counters.errors += 1;
        continue;
      }

      if (hasUnavailableCritic(result)) {
        await unavailable(
          env.DB,
          candidate,
          audit.id,
          'pipeline_unavailable',
          'Weekly independent critic or Release Judge was unavailable',
          nowIso,
        );
        claimedAuditId = null;
        counters.unavailable += 1;
        continue;
      }

      const expectedState = originalExpectedState(result);
      const severe = expectedState === 'block_red';
      await complete(env.DB, candidate, audit.id, {
        expectedState,
        severity: severe ? 'release_critical' : 'advisory',
        judgeStatus: result.judgeStatus,
        summary: compactSummary(result),
      }, nowIso);
      claimedAuditId = null;
      counters.completed += 1;
      counters.posts_processed += 1;
      if (severe) counters.severe_false_passes += 1;
    } catch (error) {
      counters.errors += 1;
      if (claimedAuditId) {
        try {
          await unavailable(
            env.DB,
            candidate,
            claimedAuditId,
            'pipeline_unavailable',
            error instanceof Error ? error.message : String(error),
            nowIso,
          );
          counters.unavailable += 1;
        } catch {
          counters.errors += 1;
        }
      }
    }
  }

  counters.workspaces_disabled = await quarantine(env.DB, nowIso);
  if (counters.workspaces_disabled > 0) {
    await alert(
      env,
      'learning_severe_false_pass_quarantine',
      'critical',
      `Protected Autopilot automatically disabled for ${counters.workspaces_disabled} workspace(s) `
        + 'after weekly independent calibration found a release-critical false pass; '
        + 'operator review required.',
    );
  }
  if (counters.unavailable > 0 || counters.errors > 0) {
    await alert(
      env,
      LEARNING_CALIBRATION_DEGRADED_ALERT_KEY,
      'warn',
      `Weekly independent calibration run degraded: ${counters.completed} completed, `
        + `${counters.unavailable} unavailable, ${counters.errors} errors across `
        + `${counters.candidates_considered} candidates; operator review required.`,
    );
  } else {
    await resolve(env, LEARNING_CALIBRATION_DEGRADED_ALERT_KEY);
  }
  return counters;
}
