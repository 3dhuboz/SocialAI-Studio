import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_RELEASE_PROOF_CHECKS,
  hashReleaseProofPayload,
  type ReleaseProofArtifact,
} from '../shared/learningReleaseProof';
import { hasCompleteGreenLearningReadinessChecks } from '../shared/learning-readiness-checks';

const POLICY_VERSION = '2026-07-14-v1';
const PILOT_OWNER_USER_ID = 'user_3B9YKodZsIQjLdGW8wtwd7mmBMQ';
const STAGING_DATABASE_ID = '0ce38359-c7d6-4d6e-b278-7ca1a719dbb4';
const PRODUCTION_DATABASE_ID = '6295841e-e5f7-4355-b0e0-c5f22e58d99d';
const DEFAULT_MAX_AGE_MINUTES = 20;
const WEEKLY_CALIBRATION_MAX_AGE_MINUTES = 8 * 24 * 60;

const CALIBRATION_DETAIL_KEYS = [
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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workerRoot = resolve(repoRoot, 'workers', 'api');

const PRODUCTION_SCHEMA_MIGRATIONS = [
  {
    id: 'positive_sample',
    file: 'workers/api/schema_v46_learning_pilot_samples.sql',
    table: 'learning_pilot_samples',
    dependency: 'posts',
    expectedSha256: 'bfe1ff0113a076f44afecf300a7b32d28d469dece12dbd045489244ea49fc6df',
    requiredFragments: [
      'CREATE TABLE IF NOT EXISTS learning_pilot_samples',
      'FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE',
      'CREATE TRIGGER IF NOT EXISTS prevent_learning_pilot_sample_update',
    ],
  },
  {
    id: 'calibration',
    file: 'workers/api/schema_v47_learning_calibration_audits.sql',
    table: 'learning_calibration_audits',
    dependency: 'learning_decisions',
    expectedSha256: '5c6a513a1205c678ba7ed1dfb6738e13b0a3576c3694d008c78729ef8f2bc343',
    requiredFragments: [
      'CREATE TABLE IF NOT EXISTS learning_calibration_audits',
      'FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE',
      'CREATE INDEX IF NOT EXISTS idx_learning_calibration_status',
    ],
  },
] as const;

const REQUIRED_DEPLOYED_FLAGS = {
  LEARNING_BRAIN_ENABLED: 'true',
  LEARNING_RELEASE_ENFORCEMENT: 'false',
  LEARNING_AUTOPILOT_ENABLED: 'false',
  ORGANIC_REACH_ENABLED: 'true',
  ORGANIC_REACH_APPLY_ENABLED: 'false',
} as const;

type DeployedFlagName = keyof typeof REQUIRED_DEPLOYED_FLAGS;
type RolloutResult = 'promotion_ready' | 'safe_hold' | 'unsafe_or_unverified';

export type RolloutActionPhase =
  | 'safety_recovery'
  | 'version_attestation'
  | 'pilot_evidence'
  | 'staging_calibration'
  | 'staging_readiness'
  | 'production_schema'
  | 'production_readiness'
  | 'operator_change_window';

export interface RolloutNextSafeAction {
  id: string;
  target: 'rollout' | 'owner_pilot' | 'customer_pilot' | 'staging' | 'production';
  executionMode: 'read_only' | 'record_only' | 'operator_change_window';
  productionMutation: boolean;
  productionBehaviorChange: false;
}

export interface RolloutActionPlan {
  phase: RolloutActionPhase;
  phaseBlockers: string[];
  nextSafeActions: RolloutNextSafeAction[];
  automaticActivationAllowed: false;
  automaticProductionMutationAllowed: false;
  prohibitedAutomaticActions: string[];
}

const PROHIBITED_AUTOMATIC_ROLLOUT_ACTIONS = [
  'deploy_behavior_changing_worker',
  'enable_learning_release_enforcement',
  'enable_protected_autopilot',
  'enable_organic_reach_apply',
  'schedule_or_publish_pilot_content',
  'apply_production_schema_before_prerequisites',
] as const;

export const STAGING_ROLLOUT_SQL = `
SELECT COUNT(*) AS pilot_samples,
       COALESCE(SUM(CASE WHEN sample.owner_kind = 'user' THEN 1 ELSE 0 END), 0)
         AS owner_samples,
       COALESCE(SUM(CASE WHEN sample.owner_kind = 'client' THEN 1 ELSE 0 END), 0)
         AS client_samples
  FROM learning_pilot_samples sample
  INNER JOIN learning_pilot_enrollments pen
    ON pen.user_id = sample.user_id
   AND pen.workspace_key = sample.workspace_key
   AND pen.client_id IS sample.client_id
   AND pen.owner_kind = sample.owner_kind
   AND pen.owner_id = sample.owner_id
   AND pen.policy_version = '${POLICY_VERSION}'
   AND pen.record_only = 1
  INNER JOIN workspace_learning_settings w
    ON w.user_id = pen.user_id
   AND w.workspace_key = pen.workspace_key
   AND w.client_id IS pen.client_id
   AND w.owner_kind = pen.owner_kind
   AND w.owner_id = pen.owner_id
   AND w.mode = 'approval'
   AND w.monthly_ai_budget_usd_cents > 0
   AND NULLIF(TRIM(COALESCE(w.disabled_reason, '')), '') IS NULL
  INNER JOIN users u
    ON u.id = pen.user_id
  LEFT JOIN clients c
    ON c.id = pen.client_id
   AND c.user_id = pen.user_id
 WHERE unixepoch(pen.enrolled_at) <= unixepoch(sample.attested_at)
   AND unixepoch(pen.consent_confirmed_at) <= unixepoch(sample.attested_at)
   AND unixepoch(sample.attested_at) <= unixepoch('now')
   AND (
     (
       sample.owner_kind = 'user'
       AND sample.client_id IS NULL
       AND sample.workspace_key = '__owner__'
       AND sample.owner_id = sample.user_id
       AND pen.consent_basis = 'owner_self'
       AND sample.attestation_basis = 'owner_real_post'
     )
     OR (
       sample.owner_kind = 'client'
       AND sample.client_id IS NOT NULL
       AND sample.workspace_key = sample.client_id
       AND sample.owner_id = sample.client_id
       AND pen.consent_basis = 'customer_attested'
       AND NULLIF(TRIM(COALESCE(pen.consent_note, '')), '') IS NOT NULL
       AND sample.attestation_basis = 'customer_real_post'
       AND c.id IS NOT NULL
       AND COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'
     )
   )
   AND EXISTS (
     SELECT 1
       FROM learning_decisions d
      WHERE d.user_id = sample.user_id
        AND d.workspace_key = sample.workspace_key
        AND d.client_id IS sample.client_id
        AND d.owner_kind = sample.owner_kind
        AND d.owner_id = sample.owner_id
        AND d.post_id = sample.post_id
        AND d.content_hash = sample.content_hash
        AND d.stage = 'release'
        AND d.mode = 'approval'
        AND unixepoch(d.created_at) >= unixepoch(sample.attested_at)
        AND NOT EXISTS (
          SELECT 1
            FROM learning_decision_disqualifications disq
           WHERE disq.decision_id = d.id
             AND disq.user_id = d.user_id
             AND disq.workspace_key = d.workspace_key
             AND disq.client_id IS d.client_id
             AND disq.owner_kind = d.owner_kind
             AND disq.owner_id = d.owner_id
        )
   );
SELECT COUNT(*) AS protected_workspaces
  FROM workspace_learning_settings
 WHERE mode = 'protected_autopilot';
SELECT cron_type, success, error, run_at, details_json
  FROM cron_runs
 WHERE id IN (
   SELECT MAX(id)
     FROM cron_runs
    WHERE cron_type IN (
      'health_sweep',
      'learning_pilot',
      'learning_readiness',
      'learning_calibration'
    )
    GROUP BY cron_type
 )
 ORDER BY id DESC;
SELECT policy_version, ready, checks_json, evaluated_at
  FROM learning_release_readiness
 WHERE policy_version = '${POLICY_VERSION}'
 ORDER BY evaluated_at DESC
 LIMIT 1;
WITH eligible_enrollments AS (
  SELECT pen.*
    FROM learning_pilot_enrollments pen
    INNER JOIN workspace_learning_settings w
      ON w.user_id = pen.user_id
     AND w.workspace_key = pen.workspace_key
     AND w.client_id IS pen.client_id
     AND w.owner_kind = pen.owner_kind
     AND w.owner_id = pen.owner_id
    LEFT JOIN clients c
      ON c.id = pen.client_id
     AND c.user_id = pen.user_id
   WHERE pen.policy_version = '${POLICY_VERSION}'
     AND pen.record_only = 1
     AND unixepoch(pen.enrolled_at) <= unixepoch('now')
     AND unixepoch(pen.consent_confirmed_at) <= unixepoch('now')
     AND w.mode = 'approval'
     AND w.monthly_ai_budget_usd_cents > 0
     AND NULLIF(TRIM(COALESCE(w.disabled_reason, '')), '') IS NULL
     AND (
       (
         pen.owner_kind = 'user'
         AND pen.client_id IS NULL
         AND pen.workspace_key = '__owner__'
         AND pen.owner_id = pen.user_id
         AND pen.consent_basis = 'owner_self'
       )
       OR (
         pen.owner_kind = 'client'
         AND pen.client_id IS NOT NULL
         AND pen.workspace_key = pen.client_id
         AND pen.owner_id = pen.client_id
         AND pen.consent_basis = 'customer_attested'
         AND NULLIF(TRIM(COALESCE(pen.consent_note, '')), '') IS NOT NULL
         AND c.id IS NOT NULL
         AND COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'
       )
     )
), bounded_drafts AS (
  SELECT p.id,
         p.user_id,
         p.client_id,
         CASE WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END AS owner_kind,
         CASE WHEN p.client_id IS NULL THEN '__owner__' ELSE p.client_id END
           AS workspace_key,
         CASE WHEN EXISTS (
           SELECT 1
             FROM learning_decisions d
             INNER JOIN learning_decision_disqualifications disq
               ON disq.decision_id = d.id
              AND disq.user_id = d.user_id
              AND disq.workspace_key = d.workspace_key
              AND disq.client_id IS d.client_id
              AND disq.owner_kind = d.owner_kind
              AND disq.owner_id = d.owner_id
            WHERE d.user_id = p.user_id
              AND d.workspace_key = CASE
                WHEN p.client_id IS NULL THEN '__owner__' ELSE p.client_id END
              AND d.client_id IS p.client_id
              AND d.owner_kind = CASE
                WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
              AND d.owner_id = CASE
                WHEN p.client_id IS NULL THEN p.user_id ELSE p.client_id END
              AND d.post_id = p.id
              AND disq.reason = 'synthetic_qa'
         ) THEN 1 ELSE 0 END AS synthetic_qa,
         CASE WHEN EXISTS (
           SELECT 1
             FROM learning_decisions d
            WHERE d.user_id = p.user_id
              AND d.workspace_key = CASE
                WHEN p.client_id IS NULL THEN '__owner__' ELSE p.client_id END
              AND d.client_id IS p.client_id
              AND d.owner_kind = CASE
                WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
              AND d.owner_id = CASE
                WHEN p.client_id IS NULL THEN p.user_id ELSE p.client_id END
              AND d.post_id = p.id
              AND d.stage = 'release'
              AND d.release_state IN ('pass_green','hold_amber','block_red')
              AND CAST(COALESCE(json_extract(d.summary_json, '$.verdictCount'), -1)
                AS INTEGER) = (
                SELECT COUNT(*)
                  FROM learning_critic_verdicts v
                 WHERE v.decision_id = d.id
              )
              AND CAST(COALESCE(json_extract(d.summary_json, '$.verdictCount'), 0)
                AS INTEGER) > 0
         ) THEN 1 ELSE 0 END AS release_evaluated,
         CASE WHEN EXISTS (
           SELECT 1
             FROM eligible_enrollments enrolled
            WHERE enrolled.user_id = p.user_id
              AND enrolled.workspace_key = CASE
                WHEN p.client_id IS NULL THEN '__owner__' ELSE p.client_id END
              AND enrolled.client_id IS p.client_id
              AND enrolled.owner_kind = CASE
                WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
              AND enrolled.owner_id = CASE
                WHEN p.client_id IS NULL THEN p.user_id ELSE p.client_id END
         ) THEN 1 ELSE 0 END AS enrolled_workspace
    FROM posts p
    LEFT JOIN clients c
      ON c.id = p.client_id
     AND c.user_id = p.user_id
   WHERE LOWER(TRIM(COALESCE(p.status, ''))) = 'draft'
     AND LENGTH(TRIM(COALESCE(p.content, ''))) BETWEEN 1 AND 5000
     AND (
       (p.client_id IS NULL AND (p.owner_kind IS NULL OR p.owner_kind = 'user'))
       OR (
         p.client_id IS NOT NULL
         AND c.id IS NOT NULL
         AND (p.owner_kind IS NULL OR p.owner_kind = 'client')
         AND COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'
       )
     )
), attested_samples AS (
  SELECT sample.owner_kind, COUNT(*) AS sample_count
    FROM learning_pilot_samples sample
    INNER JOIN eligible_enrollments pen
      ON pen.user_id = sample.user_id
     AND pen.workspace_key = sample.workspace_key
     AND pen.client_id IS sample.client_id
     AND pen.owner_kind = sample.owner_kind
     AND pen.owner_id = sample.owner_id
   WHERE unixepoch(pen.enrolled_at) <= unixepoch(sample.attested_at)
     AND unixepoch(pen.consent_confirmed_at) <= unixepoch(sample.attested_at)
     AND unixepoch(sample.attested_at) <= unixepoch('now')
     AND (
       (sample.owner_kind = 'user' AND sample.attestation_basis = 'owner_real_post')
       OR (sample.owner_kind = 'client'
           AND sample.attestation_basis = 'customer_real_post')
     )
   GROUP BY sample.owner_kind
)
SELECT
  (SELECT COUNT(*) FROM eligible_enrollments WHERE owner_kind = 'user')
    AS owner_enrollments,
  (SELECT COUNT(*) FROM eligible_enrollments WHERE owner_kind = 'client')
    AS customer_enrollments,
  (SELECT COUNT(*) FROM clients c
    WHERE COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold')
    AS active_customer_workspaces,
  COALESCE((SELECT sample_count FROM attested_samples WHERE owner_kind = 'user'), 0)
    AS owner_attested_samples,
  COALESCE((SELECT sample_count FROM attested_samples WHERE owner_kind = 'client'), 0)
    AS client_attested_samples,
  COALESCE(SUM(CASE WHEN owner_kind = 'user'
    AND enrolled_workspace = 1
    AND synthetic_qa = 0 AND release_evaluated = 0 THEN 1 ELSE 0 END), 0)
    AS owner_candidate_drafts,
  COALESCE(SUM(CASE WHEN owner_kind = 'client'
    AND enrolled_workspace = 1
    AND synthetic_qa = 0 AND release_evaluated = 0 THEN 1 ELSE 0 END), 0)
    AS client_candidate_drafts,
  COALESCE(SUM(CASE WHEN owner_kind = 'user'
    AND enrolled_workspace = 1 AND synthetic_qa = 1 THEN 1 ELSE 0 END), 0)
    AS owner_synthetic_excluded_drafts,
  COALESCE(SUM(CASE WHEN owner_kind = 'client'
    AND enrolled_workspace = 1 AND synthetic_qa = 1 THEN 1 ELSE 0 END), 0)
    AS client_synthetic_excluded_drafts
FROM bounded_drafts;
SELECT COALESCE(SUM(CASE
         WHEN type = 'table' AND name = 'learning_calibration_audits' THEN 1 ELSE 0
       END), 0) AS calibration_tables,
       COALESCE(SUM(CASE
         WHEN type = 'table' AND name = 'cron_alerts' THEN 1 ELSE 0
       END), 0) AS alert_tables,
       COALESCE(SUM(CASE
         WHEN type = 'index'
          AND name IN ('idx_cron_alerts_last_fired', 'idx_cron_alerts_unresolved')
         THEN 1 ELSE 0
       END), 0) AS alert_indexes
  FROM sqlite_master
 WHERE (type = 'table' AND name IN ('learning_calibration_audits', 'cron_alerts'))
    OR (type = 'index'
        AND name IN ('idx_cron_alerts_last_fired', 'idx_cron_alerts_unresolved'));
`;

export const STAGING_CALIBRATION_ROLLOUT_SQL = `
SELECT COUNT(*) AS calibration_rows,
       COALESCE(SUM(CASE
         WHEN audit_status = 'completed' AND source_status = 'verified' THEN 1 ELSE 0
       END), 0) AS verified_calibrations,
       COALESCE(SUM(CASE
         WHEN audit_status = 'unavailable' THEN 1 ELSE 0
       END), 0) AS unavailable_calibrations,
       COALESCE(SUM(CASE
         WHEN audit_status = 'completed'
          AND source_status = 'verified'
          AND original_state = 'pass_green'
          AND expected_state = 'block_red'
          AND severity = 'release_critical'
         THEN 1 ELSE 0
       END), 0) AS severe_false_passes
  FROM learning_calibration_audits
 WHERE policy_version = '${POLICY_VERSION}';
`;

export const PRODUCTION_ROLLOUT_SQL = `
SELECT id, status
  FROM clients
 WHERE id = 'hughesq-001';
SELECT COUNT(*) AS protected_workspaces
  FROM workspace_learning_settings
 WHERE mode = 'protected_autopilot';
SELECT COALESCE(SUM(CASE WHEN name = 'learning_pilot_samples' THEN 1 ELSE 0 END), 0)
         AS pilot_sample_tables,
       COALESCE(SUM(CASE WHEN name = 'learning_calibration_audits' THEN 1 ELSE 0 END), 0)
         AS calibration_tables,
       COALESCE(SUM(CASE WHEN type = 'table' AND name = 'posts' THEN 1 ELSE 0 END), 0)
         AS posts_tables,
       COALESCE(SUM(CASE WHEN type = 'table' AND name = 'learning_decisions' THEN 1 ELSE 0 END), 0)
         AS decision_tables,
       COALESCE(SUM(CASE
         WHEN type = 'table' AND name = 'cron_alerts' THEN 1 ELSE 0
       END), 0) AS alert_tables,
       COALESCE(SUM(CASE
         WHEN type = 'index'
          AND name IN ('idx_cron_alerts_last_fired', 'idx_cron_alerts_unresolved')
         THEN 1 ELSE 0
       END), 0) AS alert_indexes
 FROM sqlite_master
 WHERE (type = 'table'
        AND name IN (
          'learning_pilot_samples', 'learning_calibration_audits',
          'posts', 'learning_decisions', 'cron_alerts'
        ))
    OR (type = 'index'
        AND name IN ('idx_cron_alerts_last_fired', 'idx_cron_alerts_unresolved'));
SELECT policy_version, ready, checks_json, evaluated_at
  FROM learning_release_readiness
 WHERE policy_version = '${POLICY_VERSION}'
 ORDER BY evaluated_at DESC
 LIMIT 1;
SELECT COUNT(*) AS owner_draft_source_candidates
  FROM posts p
 WHERE p.user_id = '${PILOT_OWNER_USER_ID}'
   AND p.client_id IS NULL
   AND LOWER(TRIM(COALESCE(p.status, ''))) = 'draft'
   AND LENGTH(TRIM(COALESCE(p.content, ''))) BETWEEN 1 AND 5000
   AND (p.owner_kind IS NULL OR p.owner_kind = 'user')
   AND COALESCE(p.publish_attempts, 0) = 0
   AND p.late_post_id IS NULL
   AND p.claim_id IS NULL
   AND p.fb_video_id IS NULL
   AND p.postproxy_post_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM publication_events event
      WHERE event.user_id = p.user_id AND event.post_id = p.id
   )
   AND NOT EXISTS (
     SELECT 1 FROM publish_delivery_receipts receipt
      WHERE receipt.user_id = p.user_id AND receipt.post_id = p.id
   );
`;

export interface CronObservation {
  success: boolean;
  error: string | null;
  runAt: string;
  details: Record<string, unknown> | null;
}

export interface ReadinessObservation {
  policyVersion: string;
  ready: boolean;
  evaluatedAt: string;
  checks: Record<string, unknown>;
}

export interface ProductionSchemaMigrationPreflight {
  id: 'positive_sample' | 'calibration';
  file: string;
  filePresent: boolean;
  table: string;
  currentTablePresent: boolean;
  dependency: string;
  dependencyPresent: boolean;
  sha256: string;
  expectedSha256: string;
  hashMatches: boolean;
  additiveContractValid: boolean;
}

export interface ProductionSchemaPreflight {
  mode: 'read_only_deferred';
  readyToApplyWhenPhaseReached: boolean;
  applicationPerformed: false;
  migrations: ProductionSchemaMigrationPreflight[];
}

interface EnvironmentObservation {
  healthOk: boolean;
  versionId: string | null;
  expectedVersionId: string | null;
  environmentBinding: string | null;
  databaseBindingId: string | null;
  expectedDatabaseBindingId: string;
  flags: Partial<Record<DeployedFlagName, string | null>>;
  d1ReadOnly: boolean;
  protectedWorkspaces: number;
}

export interface RolloutObservation {
  generatedAt: string;
  maxAgeMinutes: number;
  offlineProof: {
    valid: boolean;
    currentCommit: string;
    proofCommit: string | null;
    gitClean: boolean;
  };
  staging: EnvironmentObservation & {
    pilotSamples: number;
    ownerSamples: number;
    clientSamples: number;
    ownerEnrollments: number;
    customerEnrollments: number;
    activeCustomerWorkspaces: number;
    ownerAttestedSamples: number;
    clientAttestedSamples: number;
    ownerCandidateDrafts: number;
    clientCandidateDrafts: number;
    ownerSyntheticExcludedDrafts: number;
    clientSyntheticExcludedDrafts: number;
    latestHealthSweepCron: CronObservation | null;
    latestPilotCron: CronObservation | null;
    latestReadinessCron: CronObservation | null;
    calibrationTablePresent: boolean;
    alertSchemaReady: boolean;
    latestCalibrationCron: CronObservation | null;
    calibrationRows: number;
    verifiedCalibrations: number;
    unavailableCalibrations: number;
    severeCalibrationFalsePasses: number;
    readiness: ReadinessObservation | null;
  };
  production: EnvironmentObservation & {
    hugheseysQueStatus: string | null;
    ownerDraftSourceCandidates: number;
    pilotSampleTablePresent: boolean;
    calibrationTablePresent: boolean;
    schemaPreflight: ProductionSchemaPreflight;
    alertSchemaReady: boolean;
    readiness: ReadinessObservation | null;
  };
}

const PILOT_INTAKE_COUNTERS = [
  'pilotSamples',
  'ownerSamples',
  'clientSamples',
  'ownerEnrollments',
  'customerEnrollments',
  'activeCustomerWorkspaces',
  'ownerAttestedSamples',
  'clientAttestedSamples',
  'ownerCandidateDrafts',
  'clientCandidateDrafts',
  'ownerSyntheticExcludedDrafts',
  'clientSyntheticExcludedDrafts',
] as const;

type PilotIntakeNextRequired =
  | 'unverified'
  | 'cohort_minimum_met'
  | 'owner_consent_and_enrollment'
  | 'create_genuine_owner_draft'
  | 'authorize_bounded_owner_draft_copy'
  | 'review_exact_owner_draft'
  | 'validate_attested_owner_sample'
  | 'obtain_separately_consenting_active_customer'
  | 'record_customer_consent_and_enroll'
  | 'create_genuine_customer_draft'
  | 'review_exact_customer_draft'
  | 'validate_attested_customer_sample';

function pilotIntakeCountersAreValid(staging: RolloutObservation['staging']): boolean {
  return PILOT_INTAKE_COUNTERS.every((key) => (
    Number.isSafeInteger(staging[key]) && staging[key] >= 0
  ))
    && staging.pilotSamples === staging.ownerSamples + staging.clientSamples
    && staging.ownerAttestedSamples >= staging.ownerSamples
    && staging.clientAttestedSamples >= staging.clientSamples
    && staging.ownerEnrollments <= 1
    && staging.customerEnrollments <= 1;
}

export function summarizePilotIntake(
  staging: RolloutObservation['staging'],
  ownerDraftSourceCandidates = 0,
) {
  const sourceInventoryValid = Number.isSafeInteger(ownerDraftSourceCandidates)
    && ownerDraftSourceCandidates >= 0;
  const valid = pilotIntakeCountersAreValid(staging) && sourceInventoryValid;
  const ownerStagingNext: PilotIntakeNextRequired = !valid
    ? 'unverified'
    : staging.ownerSamples >= 8
      ? 'cohort_minimum_met'
      : staging.ownerEnrollments < 1
        ? 'owner_consent_and_enrollment'
        : staging.ownerAttestedSamples > staging.ownerSamples
          ? 'validate_attested_owner_sample'
          : staging.ownerCandidateDrafts > 0
            ? 'review_exact_owner_draft'
            : 'create_genuine_owner_draft';
  const ownerNext: PilotIntakeNextRequired = ownerStagingNext === 'create_genuine_owner_draft'
    && ownerDraftSourceCandidates > 0
    ? 'authorize_bounded_owner_draft_copy'
    : ownerStagingNext;
  const customerNext: PilotIntakeNextRequired = !valid
    ? 'unverified'
    : staging.clientSamples >= 8
      ? 'cohort_minimum_met'
      : staging.activeCustomerWorkspaces < 1
        ? 'obtain_separately_consenting_active_customer'
        : staging.customerEnrollments < 1
          ? 'record_customer_consent_and_enroll'
          : staging.clientAttestedSamples > staging.clientSamples
            ? 'validate_attested_customer_sample'
            : staging.clientCandidateDrafts > 0
              ? 'review_exact_customer_draft'
              : 'create_genuine_customer_draft';

  return {
    countsOnly: true,
    owner: {
      enrollmentReceipts: staging.ownerEnrollments,
      candidateDrafts: staging.ownerCandidateDrafts,
      sourceDraftCandidates: ownerDraftSourceCandidates,
      syntheticExcludedDrafts: staging.ownerSyntheticExcludedDrafts,
      attestedSamples: staging.ownerAttestedSamples,
      validatedSamples: staging.ownerSamples,
      readyForOperatorAttestation: valid
        && staging.ownerEnrollments > 0
        && staging.ownerCandidateDrafts > 0,
      nextRequired: ownerNext,
    },
    customer: {
      activeWorkspaces: staging.activeCustomerWorkspaces,
      enrollmentReceipts: staging.customerEnrollments,
      candidateDrafts: staging.clientCandidateDrafts,
      syntheticExcludedDrafts: staging.clientSyntheticExcludedDrafts,
      attestedSamples: staging.clientAttestedSamples,
      validatedSamples: staging.clientSamples,
      readyForOperatorAttestation: valid
        && staging.customerEnrollments > 0
        && staging.clientCandidateDrafts > 0,
      nextRequired: customerNext,
    },
  };
}

export interface RolloutCheck {
  id: string;
  passed: boolean;
  category: 'safety' | 'promotion';
}

export interface RolloutEvaluation {
  result: RolloutResult;
  safeHold: boolean;
  promotionReady: boolean;
  checks: RolloutCheck[];
  failedSafetyChecks: string[];
  blockers: string[];
}

interface D1StatementResult {
  results?: Array<Record<string, unknown>>;
  success?: boolean;
  meta?: {
    changes?: number;
    changed_db?: boolean;
    rows_written?: number;
  };
}

interface VersionSummary {
  versionId: string | null;
  createdOn: string | null;
  environmentBinding: string | null;
  databaseBindingId: string | null;
  flags: Partial<Record<DeployedFlagName, string | null>>;
}

interface OfflineProofSummary {
  path: string;
  valid: boolean;
  payloadSha256: string | null;
  fileSha256: string | null;
  rawReportSha256: string | null;
  proofCommit: string | null;
  requiredChecks: number;
  missingChecks: number;
  failedChecks: number;
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function hasOption(name: string): boolean {
  return process.argv.includes(name);
}

function runGit(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = [result.error?.message, result.stderr?.trim()]
      .filter(Boolean)
      .join('; ') || `exit status ${String(result.status)}`;
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

export function buildWranglerInvocation(args: string[]): { command: string; args: string[] } {
  const cliPath = resolve(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return {
    command: process.execPath,
    args: [cliPath, ...args, '--json'],
  };
}

function runWranglerJson(args: string[]): unknown {
  const invocation = buildWranglerInvocation(args);
  if (!existsSync(invocation.args[0])) {
    throw new Error(`Local Wrangler CLI not found at ${invocation.args[0]}`);
  }
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = [result.error?.message, result.stderr?.trim()]
      .filter(Boolean)
      .join('; ') || `exit status ${String(result.status)}`;
    throw new Error(`wrangler ${args.join(' ')} failed: ${detail}`);
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error(`wrangler ${args.join(' ')} returned invalid JSON`);
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function buildProductionSchemaPreflight(input: {
  postsTablePresent: boolean;
  decisionTablePresent: boolean;
  pilotSampleTablePresent: boolean;
  calibrationTablePresent: boolean;
  root?: string;
}): ProductionSchemaPreflight {
  const root = input.root ?? repoRoot;
  const tablePresence: Record<string, boolean> = {
    learning_pilot_samples: input.pilotSampleTablePresent,
    learning_calibration_audits: input.calibrationTablePresent,
  };
  const dependencyPresence: Record<string, boolean> = {
    posts: input.postsTablePresent,
    learning_decisions: input.decisionTablePresent,
  };
  const forbiddenStatement = /^\s*(?:ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/im;
  const migrations = PRODUCTION_SCHEMA_MIGRATIONS.map((migration) => {
    const path = resolve(root, migration.file);
    const filePresent = existsSync(path);
    const sql = filePresent ? readFileSync(path, 'utf8') : '';
    const sha256 = filePresent ? sha256File(path) : '';
    return {
      id: migration.id,
      file: migration.file,
      filePresent,
      table: migration.table,
      currentTablePresent: tablePresence[migration.table] === true,
      dependency: migration.dependency,
      dependencyPresent: dependencyPresence[migration.dependency] === true,
      sha256,
      expectedSha256: migration.expectedSha256,
      hashMatches: filePresent && sha256 === migration.expectedSha256,
      additiveContractValid: filePresent && !forbiddenStatement.test(sql)
        && migration.requiredFragments.every((fragment) => sql.includes(fragment)),
    } satisfies ProductionSchemaMigrationPreflight;
  });

  return {
    mode: 'read_only_deferred',
    readyToApplyWhenPhaseReached: migrations.every((migration) =>
      migration.dependencyPresent
      && migration.hashMatches
      && migration.additiveContractValid),
    applicationPerformed: false,
    migrations,
  };
}

export function productionSchemaPreflightIsSafe(
  preflight: ProductionSchemaPreflight,
): boolean {
  const ids = new Set(preflight.migrations.map((migration) => migration.id));
  return preflight.mode === 'read_only_deferred'
    && preflight.applicationPerformed === false
    && preflight.readyToApplyWhenPhaseReached
    && preflight.migrations.length === PRODUCTION_SCHEMA_MIGRATIONS.length
    && ids.size === PRODUCTION_SCHEMA_MIGRATIONS.length
    && PRODUCTION_SCHEMA_MIGRATIONS.every((migration) => ids.has(migration.id))
    && preflight.migrations.every((migration) =>
      migration.filePresent
      && migration.dependencyPresent
      && migration.hashMatches
      && migration.additiveContractValid);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function sha256Payload(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

export function assertReadOnlySql(sql: string): void {
  const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
  const mutation = /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|VACUUM|PRAGMA|ATTACH|DETACH)\b/i;
  if (statements.length === 0 || statements.some(
    (statement) => !/^(?:SELECT|WITH)\b/i.test(statement) || mutation.test(statement),
  )) {
    throw new Error('Rollout verification permits read-only SELECT statements only');
  }
}

export function validateReadOnlyD1Results(
  value: unknown,
  expectedStatements: number,
): value is D1StatementResult[] {
  if (!Array.isArray(value) || value.length !== expectedStatements) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const result = item as D1StatementResult;
    return result.success === true
      && Array.isArray(result.results)
      && result.meta?.changes === 0
      && result.meta.changed_db === false
      && result.meta.rows_written === 0;
  });
}

function allDeployedFlagsDormant(
  flags: Partial<Record<DeployedFlagName, string | null>>,
): boolean {
  return Object.entries(REQUIRED_DEPLOYED_FLAGS).every(
    ([name, expected]) => flags[name as DeployedFlagName] === expected,
  );
}

function isFresh(timestamp: string | null | undefined, now: Date, maxAgeMinutes: number): boolean {
  if (!timestamp) return false;
  const observed = Date.parse(timestamp);
  const ageMs = now.getTime() - observed;
  return Number.isFinite(observed)
    && ageMs >= 0
    && ageMs <= maxAgeMinutes * 60_000;
}

function readinessIsGreen(
  readiness: ReadinessObservation | null,
  now: Date,
  maxAgeMinutes: number,
): boolean {
  return readiness?.policyVersion === POLICY_VERSION
    && readiness.ready
    && isFresh(readiness.evaluatedAt, now, maxAgeMinutes)
    && hasCompleteGreenLearningReadinessChecks(readiness.checks);
}

function cronIsHealthy(
  cron: CronObservation | null,
  now: Date,
  maxAgeMinutes: number,
): boolean {
  return cron?.success === true
    && cron.error === null
    && isFresh(cron.runAt, now, maxAgeMinutes);
}

function calibrationCronIsHealthy(
  cron: CronObservation | null,
  now: Date,
): boolean {
  const details = cron?.details;
  if (!cronIsHealthy(cron, now, WEEKLY_CALIBRATION_MAX_AGE_MINUTES) || !details) {
    return false;
  }
  if (!CALIBRATION_DETAIL_KEYS.every((key) => {
    const value = details[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  })) {
    return false;
  }
  return details.errors === 0
    && details.unavailable === 0
    && details.severe_false_passes === 0
    && details.workspaces_disabled === 0;
}

export function evaluateRolloutState(input: RolloutObservation): RolloutEvaluation {
  const now = new Date(input.generatedAt);
  if (!Number.isFinite(now.getTime()) || input.maxAgeMinutes <= 0) {
    throw new Error('Invalid rollout observation time');
  }

  const checks: RolloutCheck[] = [];
  const add = (id: string, passed: boolean, category: RolloutCheck['category']): void => {
    checks.push({ id, passed, category });
  };

  add(
    'offline_proof_current',
    input.offlineProof.valid
      && input.offlineProof.gitClean
      && input.offlineProof.proofCommit === input.offlineProof.currentCommit,
    'safety',
  );
  add('staging_health', input.staging.healthOk, 'safety');
  add('production_health', input.production.healthOk, 'safety');
  add('staging_d1_read_only', input.staging.d1ReadOnly, 'safety');
  add('production_d1_read_only', input.production.d1ReadOnly, 'safety');
  add(
    'production_owner_draft_inventory_observed',
    Number.isSafeInteger(input.production.ownerDraftSourceCandidates)
      && input.production.ownerDraftSourceCandidates >= 0,
    'safety',
  );
  add(
    'staging_pilot_intake_observed',
    pilotIntakeCountersAreValid(input.staging),
    'safety',
  );
  add(
    'staging_bindings',
    input.staging.environmentBinding === 'staging'
      && input.staging.databaseBindingId === input.staging.expectedDatabaseBindingId,
    'safety',
  );
  add(
    'production_bindings',
    input.production.environmentBinding === 'production'
      && input.production.databaseBindingId === input.production.expectedDatabaseBindingId,
    'safety',
  );
  add('staging_flags_dormant', allDeployedFlagsDormant(input.staging.flags), 'safety');
  add('production_flags_dormant', allDeployedFlagsDormant(input.production.flags), 'safety');
  add(
    'staging_health_sweep_fresh',
    cronIsHealthy(input.staging.latestHealthSweepCron, now, input.maxAgeMinutes),
    'safety',
  );
  add(
    'staging_scheduler_fresh',
    cronIsHealthy(input.staging.latestPilotCron, now, input.maxAgeMinutes)
      && cronIsHealthy(input.staging.latestReadinessCron, now, input.maxAgeMinutes),
    'safety',
  );
  add('staging_calibration_schema', input.staging.calibrationTablePresent, 'safety');
  add('staging_alert_schema', input.staging.alertSchemaReady, 'safety');
  add('production_alert_schema', input.production.alertSchemaReady, 'safety');
  add(
    'production_schema_preflight',
    productionSchemaPreflightIsSafe(input.production.schemaPreflight),
    'safety',
  );
  add(
    'zero_protected_workspaces',
    input.staging.protectedWorkspaces === 0 && input.production.protectedWorkspaces === 0,
    'safety',
  );
  add('hugheseys_que_on_hold', input.production.hugheseysQueStatus === 'on_hold', 'safety');

  add(
    'staging_version_attested',
    Boolean(input.staging.expectedVersionId)
      && input.staging.versionId === input.staging.expectedVersionId,
    'promotion',
  );
  add(
    'production_version_attested',
    Boolean(input.production.expectedVersionId)
      && input.production.versionId === input.production.expectedVersionId,
    'promotion',
  );
  add(
    'staging_readiness_green',
    readinessIsGreen(input.staging.readiness, now, input.maxAgeMinutes),
    'promotion',
  );
  add(
    'production_readiness_green',
    readinessIsGreen(input.production.readiness, now, input.maxAgeMinutes),
    'promotion',
  );
  add(
    'positive_pilot_samples',
    input.staging.pilotSamples >= 30
      && input.staging.ownerSamples >= 8
      && input.staging.clientSamples >= 8,
    'promotion',
  );
  add('customer_pilot_consent', input.staging.customerEnrollments >= 1, 'promotion');
  add(
    'staging_calibration_cron_fresh',
    calibrationCronIsHealthy(input.staging.latestCalibrationCron, now),
    'promotion',
  );
  add(
    'staging_calibration_evidence',
    input.staging.calibrationRows >= 1
      && input.staging.verifiedCalibrations >= 1
      && input.staging.calibrationRows === input.staging.verifiedCalibrations
      && input.staging.unavailableCalibrations === 0
      && input.staging.severeCalibrationFalsePasses === 0,
    'promotion',
  );
  add(
    'production_positive_sample_schema',
    input.production.pilotSampleTablePresent,
    'promotion',
  );
  add(
    'production_calibration_schema',
    input.production.calibrationTablePresent,
    'promotion',
  );

  const failedSafetyChecks = checks
    .filter((check) => check.category === 'safety' && !check.passed)
    .map((check) => check.id);
  const failedPromotionChecks = checks
    .filter((check) => check.category === 'promotion' && !check.passed)
    .map((check) => check.id);
  const safeHold = failedSafetyChecks.length === 0;
  const promotionReady = safeHold && failedPromotionChecks.length === 0;

  return {
    result: !safeHold
      ? 'unsafe_or_unverified'
      : promotionReady
        ? 'promotion_ready'
        : 'safe_hold',
    safeHold,
    promotionReady,
    checks,
    failedSafetyChecks,
    blockers: [...failedSafetyChecks, ...failedPromotionChecks],
  };
}

function rolloutAction(
  id: string,
  target: RolloutNextSafeAction['target'],
  executionMode: RolloutNextSafeAction['executionMode'],
  productionMutation = false,
): RolloutNextSafeAction {
  return {
    id,
    target,
    executionMode,
    productionMutation,
    productionBehaviorChange: false,
  };
}

function rolloutActionPlan(
  phase: RolloutActionPhase,
  phaseBlockers: string[],
  nextSafeActions: RolloutNextSafeAction[],
): RolloutActionPlan {
  return {
    phase,
    phaseBlockers,
    nextSafeActions,
    automaticActivationAllowed: false,
    automaticProductionMutationAllowed: false,
    prohibitedAutomaticActions: [...PROHIBITED_AUTOMATIC_ROLLOUT_ACTIONS],
  };
}

export function buildRolloutActionPlan(
  input: RolloutObservation,
  evaluation: RolloutEvaluation = evaluateRolloutState(input),
): RolloutActionPlan {
  const checkPassed = (id: string): boolean => (
    evaluation.checks.find((check) => check.id === id)?.passed === true
  );
  const failed = (ids: string[]): string[] => ids.filter((id) => !checkPassed(id));

  if (!evaluation.safeHold) {
    return rolloutActionPlan(
      'safety_recovery',
      evaluation.failedSafetyChecks.length > 0
        ? evaluation.failedSafetyChecks
        : ['rollout_evaluation_unverified'],
      [rolloutAction('investigate_failed_safety_checks', 'rollout', 'read_only')],
    );
  }

  const versionBlockers = failed([
    'staging_version_attested',
    'production_version_attested',
  ]);
  if (versionBlockers.length > 0) {
    const nextSafeActions = versionBlockers.map((id) => rolloutAction(
      id === 'staging_version_attested'
        ? 'attest_staging_worker_version'
        : 'attest_production_worker_version',
      id === 'staging_version_attested' ? 'staging' : 'production',
      'read_only',
    ));
    return rolloutActionPlan('version_attestation', versionBlockers, nextSafeActions);
  }

  const pilotBlockers = failed(['positive_pilot_samples', 'customer_pilot_consent']);
  if (pilotBlockers.length > 0) {
    const pilotIntake = summarizePilotIntake(
      input.staging,
      input.production.ownerDraftSourceCandidates,
    );
    const nextSafeActions: RolloutNextSafeAction[] = [];
    if (pilotIntake.owner.nextRequired !== 'cohort_minimum_met') {
      nextSafeActions.push(rolloutAction(
        `owner_${pilotIntake.owner.nextRequired}`,
        'owner_pilot',
        'record_only',
      ));
    }
    if (pilotIntake.customer.nextRequired !== 'cohort_minimum_met') {
      nextSafeActions.push(rolloutAction(
        `customer_${pilotIntake.customer.nextRequired}`,
        'customer_pilot',
        'record_only',
      ));
    }
    if (nextSafeActions.length === 0 && input.staging.pilotSamples < 30) {
      nextSafeActions.push(rolloutAction(
        'collect_additional_balanced_pilot_samples',
        'rollout',
        'record_only',
      ));
    }
    if (!checkPassed('customer_pilot_consent')
      && !nextSafeActions.some((action) => action.target === 'customer_pilot')) {
      nextSafeActions.push(rolloutAction(
        'reverify_customer_consent_and_enrollment',
        'customer_pilot',
        'record_only',
      ));
    }
    return rolloutActionPlan('pilot_evidence', pilotBlockers, nextSafeActions);
  }

  const calibrationBlockers = failed([
    'staging_calibration_cron_fresh',
    'staging_calibration_evidence',
  ]);
  if (calibrationBlockers.length > 0) {
    return rolloutActionPlan(
      'staging_calibration',
      calibrationBlockers,
      [rolloutAction('run_independent_staging_calibration', 'staging', 'record_only')],
    );
  }

  const stagingReadinessBlockers = failed(['staging_readiness_green']);
  if (stagingReadinessBlockers.length > 0) {
    return rolloutActionPlan(
      'staging_readiness',
      stagingReadinessBlockers,
      [rolloutAction('resolve_staging_readiness_checks', 'staging', 'record_only')],
    );
  }

  const productionSchemaBlockers = failed([
    'production_positive_sample_schema',
    'production_calibration_schema',
  ]);
  if (productionSchemaBlockers.length > 0) {
    return rolloutActionPlan(
      'production_schema',
      productionSchemaBlockers,
      [rolloutAction(
        'apply_additive_production_learning_schemas_in_change_window',
        'production',
        'operator_change_window',
        true,
      )],
    );
  }

  const productionReadinessBlockers = failed(['production_readiness_green']);
  if (productionReadinessBlockers.length > 0) {
    return rolloutActionPlan(
      'production_readiness',
      productionReadinessBlockers,
      [rolloutAction('run_production_shadow_readiness', 'production', 'record_only')],
    );
  }

  return rolloutActionPlan(
    'operator_change_window',
    [],
    [rolloutAction(
      'prepare_operator_reviewed_activation_change_window',
      'production',
      'operator_change_window',
    )],
  );
}

export function shouldFailRolloutCommand(
  evaluation: Pick<RolloutEvaluation, 'result' | 'promotionReady'>,
  requireReady: boolean,
): boolean {
  return evaluation.result === 'unsafe_or_unverified'
    || (requireReady && !evaluation.promotionReady);
}

function executeReadOnlyD1(
  database: string,
  sql: string,
  environment?: string,
): { rows: D1StatementResult[]; readOnly: boolean } {
  assertReadOnlySql(sql);
  const args = [
    'd1',
    'execute',
    database,
    '--remote',
    '--config',
    'wrangler.toml',
    ...(environment ? ['--env', environment] : []),
    '--command',
    sql,
  ];
  const raw = runWranglerJson(args);
  const statementCount = sql.split(';').map((statement) => statement.trim()).filter(Boolean).length;
  return {
    rows: Array.isArray(raw) ? raw as D1StatementResult[] : [],
    readOnly: validateReadOnlyD1Results(raw, statementCount),
  };
}

function firstRow(result: D1StatementResult | undefined): Record<string, unknown> | null {
  return result?.results?.[0] ?? null;
}

function numberField(row: Record<string, unknown> | null, name: string): number {
  const value = Number(row?.[name]);
  return Number.isFinite(value) ? value : -1;
}

function stringField(row: Record<string, unknown> | null, name: string): string | null {
  const value = row?.[name];
  return typeof value === 'string' && value.trim() ? value : null;
}

function parseReadiness(row: Record<string, unknown> | null): ReadinessObservation | null {
  if (!row) return null;
  const checksJson = stringField(row, 'checks_json');
  try {
    return {
      policyVersion: stringField(row, 'policy_version') ?? '',
      ready: Number(row.ready) === 1,
      evaluatedAt: stringField(row, 'evaluated_at') ?? '',
      checks: checksJson ? JSON.parse(checksJson) as Record<string, unknown> : {},
    };
  } catch {
    return null;
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseCron(
  rows: Array<Record<string, unknown>>,
  type: string,
): CronObservation | null {
  const row = rows.find((item) => item.cron_type === type);
  if (!row) return null;
  const runAt = stringField(row, 'run_at');
  if (!runAt) return null;
  return {
    success: Number(row.success) === 1,
    error: typeof row.error === 'string' ? row.error : null,
    runAt: /(?:Z|[+-]\d{2}:\d{2})$/.test(runAt) ? runAt : `${runAt.replace(' ', 'T')}Z`,
    details: parseJsonObject(row.details_json),
  };
}

function latestDeployment(environment?: string): VersionSummary {
  const deploymentArgs = [
    'deployments',
    'list',
    '--config',
    'wrangler.toml',
    ...(environment ? ['--env', environment] : []),
  ];
  const rawDeployments = runWranglerJson(deploymentArgs);
  if (!Array.isArray(rawDeployments) || rawDeployments.length === 0) {
    throw new Error(`No ${environment ?? 'production'} deployments found`);
  }
  const sortedDeployments = [...rawDeployments]
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .sort((left, right) => String(left.created_on).localeCompare(String(right.created_on)));
  const latest = sortedDeployments[sortedDeployments.length - 1];
  const versions = Array.isArray(latest?.versions) ? latest.versions : [];
  const active = versions.find((item: unknown) => (
    item && typeof item === 'object' && Number((item as Record<string, unknown>).percentage) === 100
  )) as Record<string, unknown> | undefined;
  const versionId = typeof active?.version_id === 'string' ? active.version_id : null;
  if (!versionId) throw new Error(`No active ${environment ?? 'production'} version found`);

  const details = runWranglerJson([
    'versions',
    'view',
    versionId,
    '--config',
    'wrangler.toml',
    ...(environment ? ['--env', environment] : []),
  ]) as Record<string, unknown>;
  const resources = details.resources as Record<string, unknown> | undefined;
  const bindings = Array.isArray(resources?.bindings) ? resources.bindings : [];
  const flags: Partial<Record<DeployedFlagName, string | null>> = {};
  let environmentBinding: string | null = null;
  let databaseBindingId: string | null = null;

  for (const item of bindings) {
    if (!item || typeof item !== 'object') continue;
    const binding = item as Record<string, unknown>;
    const name = typeof binding.name === 'string' ? binding.name : '';
    if (binding.type === 'plain_text' && name === 'ENVIRONMENT') {
      environmentBinding = typeof binding.text === 'string' ? binding.text : null;
    }
    if (binding.type === 'plain_text' && name in REQUIRED_DEPLOYED_FLAGS) {
      flags[name as DeployedFlagName] = typeof binding.text === 'string' ? binding.text : null;
    }
    if (binding.type === 'd1' && name === 'DB') {
      databaseBindingId = typeof binding.database_id === 'string'
        ? binding.database_id
        : typeof binding.id === 'string'
          ? binding.id
          : null;
    }
  }

  return {
    versionId,
    createdOn: typeof latest?.created_on === 'string' ? latest.created_on : null,
    environmentBinding,
    databaseBindingId,
    flags,
  };
}

async function healthOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: boolean; service?: string };
    return body.ok === true && body.service === 'socialai-api';
  } catch {
    return false;
  }
}

function latestOfflineProof(outputDir: string): string {
  const candidates = readdirSync(outputDir)
    .filter((name) => /^learning-release-proof-.+\.json$/.test(name))
    .filter((name) => !name.endsWith('-vitest.json'))
    .sort();
  const latest = candidates[candidates.length - 1];
  if (!latest) throw new Error('No offline learning release proof found');
  return resolve(outputDir, latest);
}

async function loadOfflineProof(path: string, currentCommit: string): Promise<OfflineProofSummary> {
  const artifact = JSON.parse(readFileSync(path, 'utf8')) as ReleaseProofArtifact;
  const payloadSha256 = await hashReleaseProofPayload(artifact.payload);
  const fileSha256 = sha256File(path);
  const sidecarPath = path.replace(/\.json$/i, '.sha256');
  const rawReportPath = path.replace(/\.json$/i, '-vitest.json');
  const expectedFileSha = existsSync(sidecarPath)
    ? readFileSync(sidecarPath, 'utf8').trim().match(/^([a-f0-9]{64})\b/i)?.[1]?.toLowerCase() ?? null
    : null;
  const rawReportSha256 = existsSync(rawReportPath) ? sha256File(rawReportPath) : null;
  const checks = artifact.payload.checks ?? [];
  const valid = artifact.payload.result === 'offline_pass'
    && artifact.payload.git.commit === currentCommit
    && artifact.payload.git.clean === true
    && artifact.payload.productionMutationPerformed === false
    && artifact.payload.releaseFlagsChanged === false
    && artifact.artifactSha256 === payloadSha256
    && expectedFileSha === fileSha256
    && artifact.payload.command.reportSha256 === rawReportSha256
    && checks.length === REQUIRED_RELEASE_PROOF_CHECKS.length
    && checks.every((check) => check.passed)
    && artifact.payload.missingCheckIds.length === 0
    && artifact.payload.failedCheckIds.length === 0;

  return {
    path,
    valid,
    payloadSha256,
    fileSha256,
    rawReportSha256,
    proofCommit: artifact.payload.git.commit ?? null,
    requiredChecks: checks.length,
    missingChecks: artifact.payload.missingCheckIds.length,
    failedChecks: artifact.payload.failedCheckIds.length,
  };
}

function outputDirectory(): string {
  const configured = option('--output-dir')
    ?? process.env.SOCIALAI_RELEASE_EVIDENCE_DIR?.trim()
    ?? (process.platform === 'win32' ? 'D:\\GitHubBackup\\SocialAi\\release-evidence' : null);
  if (!configured) {
    throw new Error('Set --output-dir or SOCIALAI_RELEASE_EVIDENCE_DIR; no C-drive fallback is allowed.');
  }
  return resolve(configured);
}

async function main(): Promise<void> {
  const outputDir = outputDirectory();
  mkdirSync(outputDir, { recursive: true });
  const currentCommit = runGit(['rev-parse', 'HEAD']).toLowerCase();
  const branch = runGit(['branch', '--show-current']);
  const gitClean = runGit(['status', '--porcelain']).length === 0;
  const proofPath = resolve(option('--offline-proof') ?? latestOfflineProof(outputDir));
  const offlineProof = await loadOfflineProof(proofPath, currentCommit);
  const generatedAt = new Date().toISOString();
  const maxAgeMinutes = Number(option('--max-age-minutes') ?? DEFAULT_MAX_AGE_MINUTES);
  if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) {
    throw new Error('--max-age-minutes must be a positive number');
  }

  const [
    stagingD1,
    productionD1,
    stagingVersion,
    productionVersion,
    stagingHealth,
    productionHealth,
  ] = await Promise.all([
    Promise.resolve(executeReadOnlyD1('socialai-db-staging', STAGING_ROLLOUT_SQL, 'staging')),
    Promise.resolve(executeReadOnlyD1('socialai-db', PRODUCTION_ROLLOUT_SQL)),
    Promise.resolve(latestDeployment('staging')),
    Promise.resolve(latestDeployment()),
    healthOk('https://socialai-api-staging.steve-700.workers.dev/api/health'),
    healthOk('https://socialai-api.steve-700.workers.dev/api/health'),
  ]);

  const stagingSamples = firstRow(stagingD1.rows[0]);
  const stagingProtected = firstRow(stagingD1.rows[1]);
  const stagingCrons = stagingD1.rows[2]?.results ?? [];
  const stagingReadiness = firstRow(stagingD1.rows[3]);
  const stagingEnrollments = firstRow(stagingD1.rows[4]);
  const stagingSchema = firstRow(stagingD1.rows[5]);
  const stagingCalibrationTablePresent = numberField(stagingSchema, 'calibration_tables') === 1;
  const stagingAlertSchemaReady = numberField(stagingSchema, 'alert_tables') === 1
    && numberField(stagingSchema, 'alert_indexes') === 2;
  const stagingCalibrationD1 = stagingCalibrationTablePresent
    ? executeReadOnlyD1(
      'socialai-db-staging',
      STAGING_CALIBRATION_ROLLOUT_SQL,
      'staging',
    )
    : { rows: [] as D1StatementResult[], readOnly: true };
  const stagingCalibration = firstRow(stagingCalibrationD1.rows[0]);
  const productionHughes = firstRow(productionD1.rows[0]);
  const productionProtected = firstRow(productionD1.rows[1]);
  const productionSchema = firstRow(productionD1.rows[2]);
  const productionReadiness = firstRow(productionD1.rows[3]);
  const productionOwnerDraftInventory = firstRow(productionD1.rows[4]);
  const productionPilotSampleTablePresent = numberField(
    productionSchema,
    'pilot_sample_tables',
  ) === 1;
  const productionCalibrationTablePresent = numberField(
    productionSchema,
    'calibration_tables',
  ) === 1;
  const productionSchemaPreflight = buildProductionSchemaPreflight({
    postsTablePresent: numberField(productionSchema, 'posts_tables') === 1,
    decisionTablePresent: numberField(productionSchema, 'decision_tables') === 1,
    pilotSampleTablePresent: productionPilotSampleTablePresent,
    calibrationTablePresent: productionCalibrationTablePresent,
  });

  const observation: RolloutObservation = {
    generatedAt,
    maxAgeMinutes,
    offlineProof: {
      valid: offlineProof.valid,
      currentCommit,
      proofCommit: offlineProof.proofCommit,
      gitClean,
    },
    staging: {
      healthOk: stagingHealth,
      versionId: stagingVersion.versionId,
      expectedVersionId: option('--expected-staging-version'),
      environmentBinding: stagingVersion.environmentBinding,
      databaseBindingId: stagingVersion.databaseBindingId,
      expectedDatabaseBindingId: STAGING_DATABASE_ID,
      flags: stagingVersion.flags,
      d1ReadOnly: stagingD1.readOnly && stagingCalibrationD1.readOnly,
      protectedWorkspaces: numberField(stagingProtected, 'protected_workspaces'),
      pilotSamples: numberField(stagingSamples, 'pilot_samples'),
      ownerSamples: numberField(stagingSamples, 'owner_samples'),
      clientSamples: numberField(stagingSamples, 'client_samples'),
      ownerEnrollments: numberField(stagingEnrollments, 'owner_enrollments'),
      customerEnrollments: numberField(stagingEnrollments, 'customer_enrollments'),
      activeCustomerWorkspaces: numberField(
        stagingEnrollments,
        'active_customer_workspaces',
      ),
      ownerAttestedSamples: numberField(stagingEnrollments, 'owner_attested_samples'),
      clientAttestedSamples: numberField(stagingEnrollments, 'client_attested_samples'),
      ownerCandidateDrafts: numberField(stagingEnrollments, 'owner_candidate_drafts'),
      clientCandidateDrafts: numberField(stagingEnrollments, 'client_candidate_drafts'),
      ownerSyntheticExcludedDrafts: numberField(
        stagingEnrollments,
        'owner_synthetic_excluded_drafts',
      ),
      clientSyntheticExcludedDrafts: numberField(
        stagingEnrollments,
        'client_synthetic_excluded_drafts',
      ),
      latestHealthSweepCron: parseCron(stagingCrons, 'health_sweep'),
      latestPilotCron: parseCron(stagingCrons, 'learning_pilot'),
      latestReadinessCron: parseCron(stagingCrons, 'learning_readiness'),
      calibrationTablePresent: stagingCalibrationTablePresent,
      alertSchemaReady: stagingAlertSchemaReady,
      latestCalibrationCron: parseCron(stagingCrons, 'learning_calibration'),
      calibrationRows: numberField(stagingCalibration, 'calibration_rows'),
      verifiedCalibrations: numberField(stagingCalibration, 'verified_calibrations'),
      unavailableCalibrations: numberField(stagingCalibration, 'unavailable_calibrations'),
      severeCalibrationFalsePasses: numberField(stagingCalibration, 'severe_false_passes'),
      readiness: parseReadiness(stagingReadiness),
    },
    production: {
      healthOk: productionHealth,
      versionId: productionVersion.versionId,
      expectedVersionId: option('--expected-production-version'),
      environmentBinding: productionVersion.environmentBinding,
      databaseBindingId: productionVersion.databaseBindingId,
      expectedDatabaseBindingId: PRODUCTION_DATABASE_ID,
      flags: productionVersion.flags,
      d1ReadOnly: productionD1.readOnly,
      protectedWorkspaces: numberField(productionProtected, 'protected_workspaces'),
      hugheseysQueStatus: stringField(productionHughes, 'status'),
      ownerDraftSourceCandidates: numberField(
        productionOwnerDraftInventory,
        'owner_draft_source_candidates',
      ),
      pilotSampleTablePresent: productionPilotSampleTablePresent,
      calibrationTablePresent: productionCalibrationTablePresent,
      schemaPreflight: productionSchemaPreflight,
      alertSchemaReady: numberField(productionSchema, 'alert_tables') === 1
        && numberField(productionSchema, 'alert_indexes') === 2,
      readiness: parseReadiness(productionReadiness),
    },
  };
  const evaluation = evaluateRolloutState(observation);
  const pilotIntake = summarizePilotIntake(
    observation.staging,
    observation.production.ownerDraftSourceCandidates,
  );
  const actionPlan = buildRolloutActionPlan(observation, evaluation);
  const payload = {
    schemaVersion: 8,
    generatedAt,
    scope: 'live_read_only_rollout_state',
    result: evaluation.result,
    safeHold: evaluation.safeHold,
    promotionReady: evaluation.promotionReady,
    productionMutationPerformed: false,
    releaseFlagsChanged: false,
    git: { commit: currentCommit, branch, clean: gitClean },
    offlineProof,
    staging: observation.staging,
    production: observation.production,
    pilotIntake,
    actionPlan,
    checks: evaluation.checks,
    failedSafetyChecks: evaluation.failedSafetyChecks,
    blockers: evaluation.blockers,
    limitations: [
      'This command performs read-only Cloudflare D1, deployment, version, and health checks.',
      'Pilot intake diagnostics contain aggregate counts only and do not grant consent.',
      'The production owner Draft count does not expose content or authorize a staging copy.',
      'Production schema preflight verifies deferred migration integrity and dependencies only; it never applies a migration.',
      'safe_hold proves dormant boundaries, not consent or permission to activate production.',
      'promotion_ready still requires an operator-reviewed change window and rollback plan.',
    ],
  };
  const artifact = {
    artifactSha256: sha256Payload(payload),
    payload,
  };
  const stem = `learning-rollout-state-${generatedAt.replace(/[:.]/g, '-')}`;
  const artifactPath = resolve(outputDir, `${stem}.json`);
  const hashPath = resolve(outputDir, `${stem}.sha256`);
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  const fileSha256 = sha256File(artifactPath);
  writeFileSync(hashPath, `${fileSha256}  ${artifactPath}\n`, 'utf8');

  process.stdout.write([
    `Rollout state: ${evaluation.result}`,
    `Promotion ready: ${evaluation.promotionReady}`,
    `Artifact: ${artifactPath}`,
    `Payload SHA-256: ${artifact.artifactSha256}`,
    `Artifact file SHA-256: ${fileSha256}`,
    `Staging version: ${stagingVersion.versionId}`,
    `Production version: ${productionVersion.versionId}`,
    `Pilot intake: owner=${payload.pilotIntake.owner.nextRequired}, customer=${payload.pilotIntake.customer.nextRequired}`,
    `Next safe phase: ${actionPlan.phase}`,
    `Next safe actions: ${actionPlan.nextSafeActions.map((action) => action.id).join(', ') || 'none'}`,
    `Automatic activation allowed: ${actionPlan.automaticActivationAllowed}`,
    `Blockers: ${evaluation.blockers.join(', ') || 'none'}`,
  ].join('\n') + '\n');

  if (shouldFailRolloutCommand(evaluation, hasOption('--require-ready'))) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
