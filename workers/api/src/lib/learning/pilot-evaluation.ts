import type { Env } from '../../env';
import {
  assertLearningDecisionUsageScopeComplete,
  withLearningDecisionUsageScope,
} from '../ai-usage';
import {
  buildReleaseContentHash,
  runAndPersistReleasePipeline,
  type PublishablePost,
} from './release-preflight';
import {
  findFreshReleaseReceipt,
  type FreshReleaseReceipt,
} from './decision-repository';
import {
  normalizeWorkspaceIdentity,
  type WorkspaceIdentity,
} from './types';

const PILOT_EVALUATION_LEASE_MS = 20 * 60 * 1000;

export const PILOT_EVALUATION_BUDGET_RESERVE_CENTS = 50;

export interface PilotBudgetStatus {
  allowed: boolean;
  monthlyAiSpendUsdCents: number | null;
  monthlyAiBudgetUsdCents: number;
  telemetryCount: number;
  remainingUsdCents: number | null;
  reason: 'invalid_budget' | 'telemetry_unavailable' | 'insufficient_reserve' | null;
}

export interface ClaimedPilotEvaluationResult {
  status: 'evaluated' | 'existing' | 'busy';
  decisionId: string | null;
  releaseState: FreshReleaseReceipt['state'] | null;
}

export interface PilotEnrollmentAuthorization {
  enrollmentId: string;
  policyVersion: string;
}

export interface PilotWithdrawalResult {
  withdrawn: boolean;
  alreadyWithdrawn: boolean;
  enrollmentId: string | null;
  policyVersion: string;
  decisionsRemoved: number;
  samplesRemoved: number;
  generatedPilotDraftsDeleted: number;
  generatedPilotMediaDeleted: number;
  sourcePostsDeleted: 0;
  publishingRecordsDeleted: 0;
}

interface PilotEvaluationDeps {
  findFreshReceipt: typeof findFreshReleaseReceipt;
  runPipeline(
    env: Env,
    post: PublishablePost,
    mode: 'approval',
    claimedDecisionId: string,
  ): ReturnType<typeof runAndPersistReleasePipeline>;
}

const defaultDeps: PilotEvaluationDeps = {
  findFreshReceipt: findFreshReleaseReceipt,
  runPipeline: (env, post, mode, claimedDecisionId) =>
    runAndPersistReleasePipeline(env, post, mode, undefined, claimedDecisionId),
};

function validatedAuthorization(
  authorization: PilotEnrollmentAuthorization,
): PilotEnrollmentAuthorization {
  const enrollmentId = authorization.enrollmentId.trim();
  const policyVersion = authorization.policyVersion.trim();
  if (!enrollmentId || !policyVersion) {
    throw new Error('Pilot enrollment authorization is incomplete');
  }
  return { enrollmentId, policyVersion };
}

function countValue(value: number | string | null | undefined): number {
  const count = Number(value ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function exactPilotDecisionIdsSql(): string {
  return `
    SELECT d.id
      FROM learning_decisions d
      INNER JOIN learning_pilot_enrollments pen
        ON pen.id = ?
       AND pen.policy_version = ?
       AND pen.record_only = 1
       AND pen.user_id = d.user_id
       AND pen.workspace_key = d.workspace_key
       AND pen.client_id IS d.client_id
       AND pen.owner_kind = d.owner_kind
       AND pen.owner_id = d.owner_id
      INNER JOIN learning_pilot_samples sample
        ON sample.user_id = d.user_id
       AND sample.workspace_key = d.workspace_key
       AND sample.client_id IS d.client_id
       AND sample.owner_kind = d.owner_kind
       AND sample.owner_id = d.owner_id
       AND sample.post_id = d.post_id
       AND sample.content_hash = d.content_hash
       AND unixepoch(sample.attested_at) >= unixepoch(pen.consent_confirmed_at)
     WHERE d.mode = 'approval'
       AND d.stage = 'release'
  `;
}

async function pilotAuthorizationIsCurrent(
  db: D1Database,
  identity: WorkspaceIdentity,
  postId: string,
  contentHash: string,
  authorization: PilotEnrollmentAuthorization,
  now: Date,
): Promise<boolean> {
  const scoped = validatedAuthorization(authorization);
  const row = await db.prepare(`
    SELECT 1 AS authorized
      FROM learning_pilot_enrollments pen
      INNER JOIN workspace_learning_settings w
        ON w.user_id = pen.user_id
       AND w.workspace_key = pen.workspace_key
       AND w.client_id IS pen.client_id
       AND w.owner_kind = pen.owner_kind
       AND w.owner_id = pen.owner_id
      INNER JOIN learning_pilot_samples sample
        ON sample.user_id = pen.user_id
       AND sample.workspace_key = pen.workspace_key
       AND sample.client_id IS pen.client_id
       AND sample.owner_kind = pen.owner_kind
       AND sample.owner_id = pen.owner_id
       AND sample.post_id = ?
       AND sample.content_hash = ?
       AND unixepoch(sample.attested_at) >= unixepoch(pen.consent_confirmed_at)
       AND unixepoch(sample.attested_at) <= unixepoch(?)
       AND sample.attestation_basis = CASE pen.owner_kind
         WHEN 'user' THEN 'owner_real_post'
         ELSE 'customer_real_post'
       END
      LEFT JOIN clients c
        ON c.id = pen.client_id
       AND c.user_id = pen.user_id
     WHERE pen.id = ?
       AND pen.user_id = ?
       AND pen.workspace_key = ?
       AND pen.client_id IS ?
       AND pen.owner_kind = ?
       AND pen.owner_id = ?
       AND pen.policy_version = ?
       AND pen.record_only = 1
       AND unixepoch(pen.consent_confirmed_at) <= unixepoch(?)
       AND w.mode = 'approval'
       AND w.monthly_ai_budget_usd_cents > 0
       AND NULLIF(TRIM(COALESCE(w.disabled_reason, '')), '') IS NULL
       AND (
         (
           pen.owner_kind = 'user'
           AND pen.consent_basis = 'owner_self'
           AND pen.client_id IS NULL
         )
         OR (
           pen.owner_kind = 'client'
           AND pen.consent_basis = 'customer_attested'
           AND NULLIF(TRIM(COALESCE(pen.consent_note, '')), '') IS NOT NULL
           AND c.id IS NOT NULL
           AND LOWER(TRIM(COALESCE(c.status, 'active'))) != 'on_hold'
         )
       )
     LIMIT 1
  `).bind(
    postId,
    contentHash,
    now.toISOString(),
    scoped.enrollmentId,
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    scoped.policyVersion,
    now.toISOString(),
  ).first<{ authorized: number }>();
  return row != null;
}

async function purgeClaimedPilotDecisionEvidence(
  db: D1Database,
  identity: WorkspaceIdentity,
  decisionId: string,
  postId: string,
  contentHash: string,
): Promise<void> {
  const claimedDecisionId = decisionId.trim();
  if (!claimedDecisionId) {
    throw new Error('Pilot decision cleanup requires an exact decision id');
  }
  const publication = await db.prepare(`
    SELECT COUNT(*) AS publication_count
      FROM publication_events
     WHERE decision_id = ?
  `).bind(claimedDecisionId).first<{ publication_count: number | string | null }>();
  if (countValue(publication?.publication_count) > 0) {
    throw new Error('Record-only pilot evidence unexpectedly has a publication record');
  }

  await db.batch([
    db.prepare(`
      DELETE FROM learning_calibration_audits
       WHERE decision_id = ?
    `).bind(claimedDecisionId),
    db.prepare(`
      DELETE FROM learning_adjudications
       WHERE decision_id = ?
    `).bind(claimedDecisionId),
    db.prepare(`
      DELETE FROM learning_decision_disqualifications
       WHERE decision_id = ?
    `).bind(claimedDecisionId),
    db.prepare(`
      DELETE FROM learning_critic_verdicts
       WHERE decision_id = ?
    `).bind(claimedDecisionId),
    db.prepare(`
      DELETE FROM ai_usage
       WHERE learning_decision_id = ?
    `).bind(claimedDecisionId),
    db.prepare(`
      DELETE FROM learning_decisions
       WHERE id = ?
         AND user_id = ?
         AND workspace_key = ?
         AND client_id IS ?
         AND owner_kind = ?
         AND owner_id = ?
         AND post_id = ?
         AND content_hash = ?
         AND mode = 'approval'
         AND stage = 'release'
    `).bind(
      claimedDecisionId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      postId,
      contentHash,
    ),
  ]);
}

export async function withdrawRecordOnlyPilot(
  db: D1Database,
  identity: WorkspaceIdentity,
  policyVersion: string,
  now: Date = new Date(),
): Promise<PilotWithdrawalResult> {
  const scopedPolicyVersion = policyVersion.trim();
  if (!scopedPolicyVersion) throw new Error('Pilot policy version is required');

  const enrollment = await db.prepare(`
    SELECT id
      FROM learning_pilot_enrollments
     WHERE user_id = ?
       AND workspace_key = ?
       AND client_id IS ?
       AND owner_kind = ?
       AND owner_id = ?
       AND policy_version = ?
       AND record_only = 1
     LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    scopedPolicyVersion,
  ).first<{ id: string }>();
  if (!enrollment?.id) {
    return {
      withdrawn: false,
      alreadyWithdrawn: true,
      enrollmentId: null,
      policyVersion: scopedPolicyVersion,
      decisionsRemoved: 0,
      samplesRemoved: 0,
      generatedPilotDraftsDeleted: 0,
      generatedPilotMediaDeleted: 0,
      sourcePostsDeleted: 0,
      publishingRecordsDeleted: 0,
    };
  }

  const authorization = validatedAuthorization({
    enrollmentId: enrollment.id,
    policyVersion: scopedPolicyVersion,
  });
  const decisionIds = exactPilotDecisionIdsSql();
  const decisionCount = await db.prepare(`
    SELECT COUNT(*) AS decision_count
      FROM (${decisionIds})
  `).bind(
    authorization.enrollmentId,
    authorization.policyVersion,
  ).first<{ decision_count: number | string | null }>();
  const sampleCount = await db.prepare(`
    SELECT COUNT(*) AS sample_count
      FROM learning_pilot_samples sample
      INNER JOIN learning_pilot_enrollments pen
        ON pen.id = ?
       AND pen.policy_version = ?
       AND pen.record_only = 1
       AND pen.user_id = sample.user_id
       AND pen.workspace_key = sample.workspace_key
       AND pen.client_id IS sample.client_id
       AND pen.owner_kind = sample.owner_kind
       AND pen.owner_id = sample.owner_id
       AND unixepoch(sample.attested_at) >= unixepoch(pen.consent_confirmed_at)
  `).bind(
    authorization.enrollmentId,
    authorization.policyVersion,
  ).first<{ sample_count: number | string | null }>();
  const generatedDrafts = await db.prepare(`
    SELECT
      COUNT(*) AS generated_draft_count,
      COALESCE(SUM(CASE
        WHEN generated.user_id IS NOT ?
          OR generated.workspace_key IS NOT ?
          OR generated.client_id IS NOT ?
          OR generated.owner_kind IS NOT ?
          OR generated.owner_id IS NOT ?
          OR generated.policy_version IS NOT ?
          OR generated.record_only <> 1
          OR p.id IS NULL
          OR p.user_id IS NOT generated.user_id
          OR p.client_id IS NOT generated.client_id
          OR p.owner_kind IS NOT generated.owner_kind
          OR p.owner_id IS NOT generated.owner_id
          OR LOWER(TRIM(COALESCE(p.status, ''))) <> 'draft'
          OR NULLIF(TRIM(COALESCE(p.scheduled_for, '')), '') IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM publication_events pe WHERE pe.post_id = generated.post_id
          )
          OR EXISTS (
            SELECT 1
              FROM publish_delivery_receipts delivery
             WHERE delivery.post_id = generated.post_id
          )
        THEN 1 ELSE 0 END), 0) AS unsafe_generated_draft_count
    FROM learning_pilot_generated_drafts generated
    LEFT JOIN posts p ON p.id = generated.post_id
    WHERE generated.enrollment_id = ?
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    authorization.policyVersion,
    authorization.enrollmentId,
  ).first<{
    generated_draft_count: number | string | null;
    unsafe_generated_draft_count: number | string | null;
  }>();
  if (countValue(generatedDrafts?.unsafe_generated_draft_count) > 0) {
    throw new Error('Record-only pilot withdrawal found an unsafe generated draft state and stopped');
  }
  const mediaJobs = await db.prepare(`
    SELECT
      COUNT(*) AS media_job_count,
      COALESCE(SUM(CASE
        WHEN job.user_id IS NOT ?
          OR job.workspace_key IS NOT ?
          OR job.client_id IS NOT ?
          OR job.owner_kind IS NOT ?
          OR job.owner_id IS NOT ?
          OR job.policy_version IS NOT ?
          OR job.record_only <> 1
          OR (job.state = 'ready' AND (
            p.id IS NULL
            OR p.user_id IS NOT job.user_id
            OR p.client_id IS NOT job.client_id
            OR p.owner_kind IS NOT job.owner_kind
            OR p.owner_id IS NOT job.owner_id
            OR LOWER(TRIM(COALESCE(p.status, ''))) <> 'draft'
            OR NULLIF(TRIM(COALESCE(p.scheduled_for, '')), '') IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM publication_events pe WHERE pe.post_id = job.post_id
            )
            OR EXISTS (
              SELECT 1
              FROM publish_delivery_receipts delivery
              WHERE delivery.post_id = job.post_id
            )
          ))
          OR (job.state <> 'ready' AND job.post_id IS NOT NULL)
        THEN 1 ELSE 0 END), 0) AS unsafe_media_job_count
    FROM learning_pilot_media_jobs job
    LEFT JOIN posts p ON p.id = job.post_id
    WHERE job.enrollment_id = ?
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    authorization.policyVersion,
    authorization.enrollmentId,
  ).first<{
    media_job_count: number | string | null;
    unsafe_media_job_count: number | string | null;
  }>();
  if (countValue(mediaJobs?.unsafe_media_job_count) > 0) {
    throw new Error('Record-only pilot withdrawal found an unsafe media job state and stopped');
  }
  const published = await db.prepare(`
    SELECT COUNT(*) AS publication_count
      FROM publication_events pe
     WHERE pe.decision_id IN (${decisionIds})
  `).bind(
    authorization.enrollmentId,
    authorization.policyVersion,
  ).first<{ publication_count: number | string | null }>();
  if (countValue(published?.publication_count) > 0) {
    throw new Error('Record-only pilot withdrawal found a publication record and stopped');
  }

  const decisionBindings = [
    authorization.enrollmentId,
    authorization.policyVersion,
  ];
  await db.batch([
    db.prepare(`
      UPDATE workspace_learning_settings
         SET mode = 'shadow',
             autopublish_consent_at = NULL,
             autopublish_policy_version = NULL,
             experiment_rate = 0,
             monthly_ai_budget_usd_cents = 0,
             updated_at = ?
       WHERE user_id = ?
         AND workspace_key = ?
         AND client_id IS ?
         AND owner_kind = ?
         AND owner_id = ?
         AND EXISTS (
           SELECT 1
             FROM learning_pilot_enrollments pen
            WHERE pen.id = ?
              AND pen.policy_version = ?
              AND pen.user_id = workspace_learning_settings.user_id
              AND pen.workspace_key = workspace_learning_settings.workspace_key
              AND pen.client_id IS workspace_learning_settings.client_id
              AND pen.owner_kind = workspace_learning_settings.owner_kind
              AND pen.owner_id = workspace_learning_settings.owner_id
         )
    `).bind(
      now.toISOString(),
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      authorization.enrollmentId,
      authorization.policyVersion,
    ),
    db.prepare(`
      DELETE FROM learning_calibration_audits
       WHERE decision_id IN (${decisionIds})
    `).bind(...decisionBindings),
    db.prepare(`
      DELETE FROM learning_adjudications
       WHERE decision_id IN (${decisionIds})
    `).bind(...decisionBindings),
    db.prepare(`
      DELETE FROM learning_decision_disqualifications
       WHERE decision_id IN (${decisionIds})
    `).bind(...decisionBindings),
    db.prepare(`
      DELETE FROM learning_critic_verdicts
       WHERE decision_id IN (${decisionIds})
    `).bind(...decisionBindings),
    db.prepare(`
      DELETE FROM ai_usage
       WHERE learning_decision_id IN (${decisionIds})
    `).bind(...decisionBindings),
    db.prepare(`
      DELETE FROM learning_decisions
       WHERE id IN (${decisionIds})
    `).bind(...decisionBindings),
    db.prepare(`
      DELETE FROM learning_pilot_samples
       WHERE EXISTS (
         SELECT 1
           FROM learning_pilot_enrollments pen
          WHERE pen.id = ?
            AND pen.policy_version = ?
            AND pen.record_only = 1
            AND pen.user_id = learning_pilot_samples.user_id
            AND pen.workspace_key = learning_pilot_samples.workspace_key
            AND pen.client_id IS learning_pilot_samples.client_id
            AND pen.owner_kind = learning_pilot_samples.owner_kind
            AND pen.owner_id = learning_pilot_samples.owner_id
            AND unixepoch(learning_pilot_samples.attested_at)
                >= unixepoch(pen.consent_confirmed_at)
       )
    `).bind(
      authorization.enrollmentId,
      authorization.policyVersion,
    ),
    db.prepare(`
      DELETE FROM ai_usage
       WHERE operation = 'learning_pilot_draft_generation'
         AND post_id IN (
           SELECT generated.post_id
             FROM learning_pilot_generated_drafts generated
            WHERE generated.enrollment_id = ?
              AND generated.user_id = ?
              AND generated.workspace_key = ?
              AND generated.client_id IS ?
              AND generated.owner_kind = ?
              AND generated.owner_id = ?
              AND generated.policy_version = ?
              AND generated.record_only = 1
         )
    `).bind(
      authorization.enrollmentId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      authorization.policyVersion,
    ),
    db.prepare(`
      DELETE FROM ai_usage
       WHERE operation LIKE 'learning_pilot_media_%'
         AND post_id IN (
           SELECT 'pilot-media-' || job.id
             FROM learning_pilot_media_jobs job
            WHERE job.enrollment_id = ?
              AND job.user_id = ?
              AND job.workspace_key = ?
              AND job.client_id IS ?
              AND job.owner_kind = ?
              AND job.owner_id = ?
              AND job.policy_version = ?
              AND job.record_only = 1
         )
    `).bind(
      authorization.enrollmentId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      authorization.policyVersion,
    ),
    db.prepare(`
      DELETE FROM posts
       WHERE id IN (
         SELECT job.post_id
           FROM learning_pilot_media_jobs job
          WHERE job.enrollment_id = ?
            AND job.user_id = ?
            AND job.workspace_key = ?
            AND job.client_id IS ?
            AND job.owner_kind = ?
            AND job.owner_id = ?
            AND job.policy_version = ?
            AND job.record_only = 1
            AND job.state = 'ready'
       )
         AND user_id = ?
         AND client_id IS ?
         AND owner_kind = ?
         AND owner_id = ?
         AND LOWER(TRIM(COALESCE(status, ''))) = 'draft'
         AND NULLIF(TRIM(COALESCE(scheduled_for, '')), '') IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM publication_events pe WHERE pe.post_id = posts.id
         )
         AND NOT EXISTS (
           SELECT 1
             FROM publish_delivery_receipts delivery
            WHERE delivery.post_id = posts.id
         )
    `).bind(
      authorization.enrollmentId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      authorization.policyVersion,
      identity.userId,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
    ),
    db.prepare(`
      DELETE FROM learning_pilot_media_jobs
       WHERE enrollment_id = ?
         AND user_id = ?
         AND workspace_key = ?
         AND client_id IS ?
         AND owner_kind = ?
         AND owner_id = ?
         AND policy_version = ?
         AND record_only = 1
    `).bind(
      authorization.enrollmentId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      authorization.policyVersion,
    ),
    db.prepare(`
      DELETE FROM posts
       WHERE id IN (
         SELECT generated.post_id
           FROM learning_pilot_generated_drafts generated
          WHERE generated.enrollment_id = ?
            AND generated.user_id = ?
            AND generated.workspace_key = ?
            AND generated.client_id IS ?
            AND generated.owner_kind = ?
            AND generated.owner_id = ?
            AND generated.policy_version = ?
            AND generated.record_only = 1
       )
         AND user_id = ?
         AND client_id IS ?
         AND owner_kind = ?
         AND owner_id = ?
         AND LOWER(TRIM(COALESCE(status, ''))) = 'draft'
         AND NULLIF(TRIM(COALESCE(scheduled_for, '')), '') IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM publication_events pe WHERE pe.post_id = posts.id
         )
         AND NOT EXISTS (
           SELECT 1
             FROM publish_delivery_receipts delivery
            WHERE delivery.post_id = posts.id
         )
    `).bind(
      authorization.enrollmentId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      authorization.policyVersion,
      identity.userId,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
    ),
    db.prepare(`
      DELETE FROM learning_pilot_generated_drafts
       WHERE enrollment_id = ?
         AND user_id = ?
         AND workspace_key = ?
         AND client_id IS ?
         AND owner_kind = ?
         AND owner_id = ?
         AND policy_version = ?
         AND record_only = 1
    `).bind(
      authorization.enrollmentId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      authorization.policyVersion,
    ),
    db.prepare(`
      DELETE FROM learning_pilot_enrollments
       WHERE id = ?
         AND user_id = ?
         AND workspace_key = ?
         AND client_id IS ?
         AND owner_kind = ?
         AND owner_id = ?
         AND policy_version = ?
         AND record_only = 1
    `).bind(
      authorization.enrollmentId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      authorization.policyVersion,
    ),
  ]);

  const remaining = await db.prepare(`
    SELECT COUNT(*) AS enrollment_count
      FROM learning_pilot_enrollments
     WHERE id = ?
       AND user_id = ?
       AND workspace_key = ?
       AND policy_version = ?
  `).bind(
    authorization.enrollmentId,
    identity.userId,
    identity.workspaceKey,
    authorization.policyVersion,
  ).first<{ enrollment_count: number | string | null }>();
  if (countValue(remaining?.enrollment_count) !== 0) {
    throw new Error('Pilot enrollment withdrawal did not complete');
  }

  return {
    withdrawn: true,
    alreadyWithdrawn: false,
    enrollmentId: authorization.enrollmentId,
    policyVersion: authorization.policyVersion,
    decisionsRemoved: countValue(decisionCount?.decision_count),
    samplesRemoved: countValue(sampleCount?.sample_count),
    generatedPilotDraftsDeleted: countValue(generatedDrafts?.generated_draft_count),
    generatedPilotMediaDeleted: countValue(mediaJobs?.media_job_count),
    sourcePostsDeleted: 0,
    publishingRecordsDeleted: 0,
  };
}

export async function isSyntheticQaPilotPost(
  db: D1Database,
  identity: WorkspaceIdentity,
  postId: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 AS quarantined
      FROM learning_decisions d
      INNER JOIN learning_decision_disqualifications synthetic_disq
        ON synthetic_disq.decision_id = d.id
       AND synthetic_disq.user_id = d.user_id
       AND synthetic_disq.workspace_key = d.workspace_key
       AND synthetic_disq.client_id IS d.client_id
       AND synthetic_disq.owner_kind = d.owner_kind
       AND synthetic_disq.owner_id = d.owner_id
     WHERE d.user_id = ?
       AND d.workspace_key = ?
       AND d.client_id IS ?
       AND d.owner_kind = ?
       AND d.owner_id = ?
       AND d.post_id = ?
       AND synthetic_disq.reason = 'synthetic_qa'
     LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    postId,
  ).first<{ quarantined: number }>();
  return row != null;
}

function currentMonthBounds(now: Date): [string, string] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return [start.toISOString(), end.toISOString()];
}

export async function getRecordOnlyPilotBudgetStatus(
  db: D1Database,
  identity: WorkspaceIdentity,
  budgetUsdCents: number,
  now: Date = new Date(),
): Promise<PilotBudgetStatus> {
  if (!Number.isSafeInteger(budgetUsdCents) || budgetUsdCents <= 0) {
    return {
      allowed: false,
      monthlyAiSpendUsdCents: null,
      monthlyAiBudgetUsdCents: budgetUsdCents,
      telemetryCount: 0,
      remainingUsdCents: null,
      reason: 'invalid_budget',
    };
  }

  const [monthStart, monthEnd] = currentMonthBounds(now);
  const sql = identity.clientId === null
    ? `SELECT COALESCE(SUM(est_cost_usd), 0) AS spend_usd, COUNT(*) AS telemetry_count
         FROM ai_usage
        WHERE user_id = ? AND client_id IS NULL
          AND unixepoch(ts) >= unixepoch(?) AND unixepoch(ts) < unixepoch(?)`
    : `SELECT COALESCE(SUM(est_cost_usd), 0) AS spend_usd, COUNT(*) AS telemetry_count
         FROM ai_usage
        WHERE user_id = ? AND client_id = ?
          AND unixepoch(ts) >= unixepoch(?) AND unixepoch(ts) < unixepoch(?)`;
  const bindings = identity.clientId === null
    ? [identity.userId, monthStart, monthEnd]
    : [identity.userId, identity.clientId, monthStart, monthEnd];
  const row = await db.prepare(sql).bind(...bindings).first<{
    spend_usd: number | string | null;
    telemetry_count: number | string | null;
  }>();
  const spendUsd = Number(row?.spend_usd);
  const telemetryCount = Number(row?.telemetry_count);
  const validEmptyLedger = telemetryCount === 0 && spendUsd === 0;
  if (
    !row
    || !Number.isSafeInteger(telemetryCount)
    || telemetryCount < 0
    || !Number.isFinite(spendUsd)
    || spendUsd < 0
    || (telemetryCount === 0 && !validEmptyLedger)
  ) {
    return {
      allowed: false,
      monthlyAiSpendUsdCents: null,
      monthlyAiBudgetUsdCents: budgetUsdCents,
      telemetryCount: Number.isSafeInteger(telemetryCount) && telemetryCount > 0
        ? telemetryCount
        : 0,
      remainingUsdCents: null,
      reason: 'telemetry_unavailable',
    };
  }

  // Round upward so fractional-cent provider costs can never be understated.
  const spendUsdCents = Math.max(0, Math.ceil((spendUsd * 100) - 1e-7));
  const remainingUsdCents = Math.max(0, budgetUsdCents - spendUsdCents);
  const allowed = remainingUsdCents >= PILOT_EVALUATION_BUDGET_RESERVE_CENTS;
  return {
    allowed,
    monthlyAiSpendUsdCents: spendUsdCents,
    monthlyAiBudgetUsdCents: budgetUsdCents,
    telemetryCount,
    remainingUsdCents,
    reason: allowed ? null : 'insufficient_reserve',
  };
}

async function acquirePilotEvaluationLease(
  db: D1Database,
  identity: WorkspaceIdentity,
  postId: string,
  contentHash: string,
  now: Date,
  authorization?: PilotEnrollmentAuthorization,
): Promise<string | null> {
  const decisionId = crypto.randomUUID();
  const claimToken = crypto.randomUUID();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - PILOT_EVALUATION_LEASE_MS).toISOString();
  const summary = JSON.stringify({
    persistenceState: 'claim',
    verdictCount: -1,
    recordOnlyPilot: true,
    claimToken,
    leaseExpiresAt: new Date(now.getTime() + PILOT_EVALUATION_LEASE_MS).toISOString(),
  });
  const row = authorization
    ? await db.prepare(`
    INSERT INTO learning_decisions (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,post_id,
      mode,stage,release_state,content_hash,summary_json,updated_at
    )
    SELECT
      ?,pen.user_id,pen.workspace_key,pen.client_id,pen.owner_kind,pen.owner_id,?,
      ?,?,?,?,?,?
      FROM learning_pilot_enrollments pen
      INNER JOIN workspace_learning_settings w
        ON w.user_id = pen.user_id
       AND w.workspace_key = pen.workspace_key
       AND w.client_id IS pen.client_id
       AND w.owner_kind = pen.owner_kind
       AND w.owner_id = pen.owner_id
      INNER JOIN learning_pilot_samples sample
        ON sample.user_id = pen.user_id
       AND sample.workspace_key = pen.workspace_key
       AND sample.client_id IS pen.client_id
       AND sample.owner_kind = pen.owner_kind
       AND sample.owner_id = pen.owner_id
       AND sample.post_id = ?
       AND sample.content_hash = ?
       AND unixepoch(sample.attested_at) >= unixepoch(pen.consent_confirmed_at)
       AND unixepoch(sample.attested_at) <= unixepoch(?)
       AND sample.attestation_basis = CASE pen.owner_kind
         WHEN 'user' THEN 'owner_real_post'
         ELSE 'customer_real_post'
       END
      LEFT JOIN clients c
        ON c.id = pen.client_id
       AND c.user_id = pen.user_id
     WHERE pen.id = ?
       AND pen.user_id = ?
       AND pen.workspace_key = ?
       AND pen.client_id IS ?
       AND pen.owner_kind = ?
       AND pen.owner_id = ?
       AND pen.policy_version = ?
       AND pen.record_only = 1
       AND unixepoch(pen.consent_confirmed_at) <= unixepoch(?)
       AND w.mode = 'approval'
       AND w.monthly_ai_budget_usd_cents > 0
       AND NULLIF(TRIM(COALESCE(w.disabled_reason, '')), '') IS NULL
       AND (
         (
           pen.owner_kind = 'user'
           AND pen.consent_basis = 'owner_self'
           AND pen.client_id IS NULL
         )
         OR (
           pen.owner_kind = 'client'
           AND pen.consent_basis = 'customer_attested'
           AND NULLIF(TRIM(COALESCE(pen.consent_note, '')), '') IS NOT NULL
           AND c.id IS NOT NULL
           AND LOWER(TRIM(COALESCE(c.status, 'active'))) != 'on_hold'
         )
       )
    ON CONFLICT(user_id,workspace_key,post_id,stage,content_hash) DO UPDATE SET
      mode = excluded.mode,
      release_state = excluded.release_state,
      summary_json = excluded.summary_json,
      updated_at = excluded.updated_at
    WHERE julianday(learning_decisions.updated_at) < julianday(?)
      AND (
        learning_decisions.release_state = 'pending'
        OR COALESCE(
          json_extract(learning_decisions.summary_json, '$.persistenceState'),
          ''
        ) IN ('claim','writing')
      )
    RETURNING id
  `).bind(
      decisionId,
      postId,
      'approval',
      'release',
      'pending',
      contentHash,
      summary,
      nowIso,
      postId,
      contentHash,
      nowIso,
      authorization.enrollmentId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      authorization.policyVersion,
      nowIso,
      staleBefore,
    ).first<{ id: string }>()
    : await db.prepare(`
    INSERT INTO learning_decisions (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,post_id,
      mode,stage,release_state,content_hash,summary_json,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,workspace_key,post_id,stage,content_hash) DO UPDATE SET
      mode = excluded.mode,
      release_state = excluded.release_state,
      summary_json = excluded.summary_json,
      updated_at = excluded.updated_at
    WHERE julianday(learning_decisions.updated_at) < julianday(?)
      AND (
        learning_decisions.release_state = 'pending'
        OR COALESCE(
          json_extract(learning_decisions.summary_json, '$.persistenceState'),
          ''
        ) IN ('claim','writing')
      )
    RETURNING id
  `).bind(
    decisionId,
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    postId,
    'approval',
    'release',
    'pending',
    contentHash,
    summary,
    nowIso,
    staleBefore,
  ).first<{ id: string }>();
  return row?.id ?? null;
}

async function findCompletePilotReceipt(
  db: D1Database,
  identity: WorkspaceIdentity,
  postId: string,
  contentHash: string,
): Promise<FreshReleaseReceipt | null> {
  const row = await db.prepare(`
    SELECT d.id, d.release_state
      FROM learning_decisions d
     WHERE d.user_id = ?
       AND d.workspace_key = ?
       AND d.client_id IS ?
       AND d.owner_kind = ?
       AND d.owner_id = ?
       AND d.post_id = ?
       AND d.content_hash = ?
       AND d.mode = 'approval'
       AND d.stage = 'release'
       AND d.release_state IN ('pass_green','hold_amber','block_red')
       AND CAST(COALESCE(json_extract(d.summary_json, '$.verdictCount'), -1) AS INTEGER) =
           (SELECT COUNT(*) FROM learning_critic_verdicts v WHERE v.decision_id = d.id)
       AND CAST(COALESCE(json_extract(d.summary_json, '$.verdictCount'), 0) AS INTEGER) > 0
     ORDER BY d.updated_at DESC
     LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    postId,
    contentHash,
  ).first<{ id: string; release_state: FreshReleaseReceipt['state'] }>();
  return row
    ? { id: row.id, state: row.release_state }
    : null;
}

export async function runClaimedPilotEvaluation(
  env: Env,
  post: PublishablePost,
  deps: PilotEvaluationDeps = defaultDeps,
  now: Date = new Date(),
  expectedContentHash?: string,
  enrollmentAuthorization?: PilotEnrollmentAuthorization,
): Promise<ClaimedPilotEvaluationResult> {
  const identity = normalizeWorkspaceIdentity(
    post.user_id,
    post.client_id,
    post.owner_kind,
    post.owner_id,
  );
  const contentHash = await buildReleaseContentHash(post);
  if (expectedContentHash !== undefined && contentHash !== expectedContentHash) {
    throw new Error('Pilot sample content changed after attestation');
  }
  if (
    expectedContentHash !== undefined
    && await isSyntheticQaPilotPost(env.DB, identity, post.id)
  ) {
    throw new Error('Known synthetic-QA posts cannot enter real pilot evidence');
  }
  if (expectedContentHash !== undefined && enrollmentAuthorization === undefined) {
    throw new Error('Exact pilot evaluation requires its enrollment authorization');
  }
  const authorization = enrollmentAuthorization
    ? validatedAuthorization(enrollmentAuthorization)
    : undefined;
  if (
    authorization
    && !(await pilotAuthorizationIsCurrent(
      env.DB,
      identity,
      post.id,
      contentHash,
      authorization,
      now,
    ))
  ) {
    throw new Error('Pilot enrollment authorization is no longer current');
  }
  const fresh = await deps.findFreshReceipt(
    env.DB,
    identity.userId,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    post.id,
    contentHash,
    'approval',
  );
  if (fresh) {
    if (
      authorization
      && !(await pilotAuthorizationIsCurrent(
        env.DB,
        identity,
        post.id,
        contentHash,
        authorization,
        now,
      ))
    ) {
      await purgeClaimedPilotDecisionEvidence(
        env.DB,
        identity,
        fresh.id,
        post.id,
        contentHash,
      );
      throw new Error('Pilot enrollment authorization was withdrawn');
    }
    return {
      status: 'existing',
      decisionId: fresh.id,
      releaseState: fresh.state,
    };
  }

  const claimId = await acquirePilotEvaluationLease(
    env.DB,
    identity,
    post.id,
    contentHash,
    now,
    authorization,
  );
  if (!claimId) {
    const complete = await findCompletePilotReceipt(
      env.DB,
      identity,
      post.id,
      contentHash,
    );
    if (
      complete
      && authorization
      && !(await pilotAuthorizationIsCurrent(
        env.DB,
        identity,
        post.id,
        contentHash,
        authorization,
        now,
      ))
    ) {
      await purgeClaimedPilotDecisionEvidence(
        env.DB,
        identity,
        complete.id,
        post.id,
        contentHash,
      );
      throw new Error('Pilot enrollment authorization was withdrawn');
    }
    return complete
      ? {
          status: 'existing',
          decisionId: complete.id,
          releaseState: complete.state,
        }
      : {
          status: 'busy',
          decisionId: null,
          releaseState: null,
        };
  }

  const meteredEnv = withLearningDecisionUsageScope(env, claimId);
  let withdrawalCleanupAttempted = false;
  try {
    const result = await deps.runPipeline(meteredEnv, post, 'approval', claimId);
    if (
      authorization
      && !(await pilotAuthorizationIsCurrent(
        env.DB,
        identity,
        post.id,
        contentHash,
        authorization,
        new Date(),
      ))
    ) {
      withdrawalCleanupAttempted = true;
      await purgeClaimedPilotDecisionEvidence(
        env.DB,
        identity,
        claimId,
        post.id,
        contentHash,
      );
      throw new Error('Pilot enrollment authorization was withdrawn during evaluation');
    }
    if (result.id !== claimId) {
      throw new Error('Pilot pipeline completed under a different decision id');
    }
    assertLearningDecisionUsageScopeComplete(meteredEnv, claimId);
    return {
      status: 'evaluated',
      decisionId: result.id,
      releaseState: result.state,
    };
  } catch (error) {
    if (
      !withdrawalCleanupAttempted
      && authorization
      && !(await pilotAuthorizationIsCurrent(
        env.DB,
        identity,
        post.id,
        contentHash,
        authorization,
        new Date(),
      ))
    ) {
      withdrawalCleanupAttempted = true;
      await purgeClaimedPilotDecisionEvidence(
        env.DB,
        identity,
        claimId,
        post.id,
        contentHash,
      );
    }
    throw error;
  }
}
