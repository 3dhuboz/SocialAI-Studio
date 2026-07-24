import type { Env } from '../env';
import { fireAlert } from '../lib/alerts';
import {
  AUTOPILOT_POLICY_VERSION,
  collectLearningReadiness,
  evaluateReadiness,
  type LearningReadinessSnapshot,
  type ReadinessMetrics,
} from '../lib/learning/readiness';
import { quarantineSevereFalsePassWorkspaces } from '../lib/learning/workspace-mode';

type PreviousReadiness = { ready: number } | null;

export interface LearningReadinessSchemaState {
  pilotSamplesReady: boolean;
  calibrationAuditsReady: boolean;
}

interface PersistedReadinessInput {
  id: string;
  snapshot: LearningReadinessSnapshot;
  evaluatedAt: string;
}

export interface EvaluateLearningReadinessOptions {
  now?: Date;
  collect?: typeof collectLearningReadiness;
  loadPrevious?: (db: D1Database) => Promise<PreviousReadiness>;
  loadSchemaState?: (db: D1Database) => Promise<LearningReadinessSchemaState>;
  quarantine?: typeof quarantineSevereFalsePassWorkspaces;
  persist?: (db: D1Database, input: PersistedReadinessInput) => Promise<void>;
  alert?: typeof fireAlert;
  randomId?: () => string;
}

async function loadPrevious(db: D1Database): Promise<PreviousReadiness> {
  return db.prepare(`
    SELECT ready
    FROM learning_release_readiness
    WHERE policy_version = ?
    ORDER BY evaluated_at DESC, id DESC
    LIMIT 1
  `).bind(AUTOPILOT_POLICY_VERSION).first<{ ready: number }>();
}

function parseSchemaCount(name: string, value: unknown): boolean {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || (value !== 0 && value !== 1)
  ) {
    throw new Error(`Learning readiness schema preflight returned invalid ${name} count`);
  }
  return value === 1;
}

export async function loadLearningReadinessSchemaState(
  db: D1Database,
): Promise<LearningReadinessSchemaState> {
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN type = 'table' AND name = 'learning_pilot_samples' THEN 1 ELSE 0
      END), 0) AS pilot_samples_count,
      COALESCE(SUM(CASE
        WHEN type = 'table' AND name = 'learning_calibration_audits' THEN 1 ELSE 0
      END), 0) AS calibration_audits_count
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('learning_pilot_samples', 'learning_calibration_audits')
  `).first<{
    pilot_samples_count: number;
    calibration_audits_count: number;
  }>();

  return {
    pilotSamplesReady: parseSchemaCount(
      'learning_pilot_samples',
      row?.pilot_samples_count,
    ),
    calibrationAuditsReady: parseSchemaCount(
      'learning_calibration_audits',
      row?.calibration_audits_count,
    ),
  };
}

function buildDeferredReadinessSnapshot(): LearningReadinessSnapshot {
  const metrics: ReadinessMetrics = {
    pilotDecisions: 0,
    pilotWorkspaceCount: 0,
    pilotUserDecisions: 0,
    pilotClientDecisions: 0,
    adjudicatedDecisions: 0,
    severeFalsePasses: 0,
    falseHoldRate: 1,
    requiredAvailability: 0,
    releaseJudgeAvailability: 0,
    releaseJudgeTelemetryCoverage: 0,
    releaseJudgeInvocations: 0,
    decisionReceiptCoverage: 0,
    predictionSampleCount: 0,
    predictionWorkspaceCount: 0,
    predictionMinWorkspaceSamples: 0,
    predictionLift: 0,
    rankCorrelation: 0,
    criticalBypasses: 0,
    publishingRegressions: 1,
    costWithinBudget: false,
    killSwitchTested: false,
  };
  const evaluated = evaluateReadiness(metrics);
  return {
    ready: false,
    metrics,
    checks: {
      ...evaluated.checks,
      replayRedTeam: false,
      publishRegression: false,
      tenancyProofs: { user: false, client: false, shop: false },
    },
  };
}

async function persistReadiness(
  db: D1Database,
  input: PersistedReadinessInput,
): Promise<void> {
  await db.prepare(`
    INSERT INTO learning_release_readiness (
      id, policy_version, ready, metrics_json, checks_json, evaluated_by, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, 'cron', ?)
  `).bind(
    input.id,
    AUTOPILOT_POLICY_VERSION,
    input.snapshot.ready ? 1 : 0,
    JSON.stringify(input.snapshot.metrics),
    JSON.stringify(input.snapshot.checks),
    input.evaluatedAt,
  ).run();
}

function failedChecks(snapshot: LearningReadinessSnapshot): string[] {
  const failed = Object.entries(snapshot.checks)
    .filter(([key, value]) => key !== 'tenancyProofs' && value === false)
    .map(([key]) => key);
  for (const [ownerKind, passed] of Object.entries(snapshot.checks.tenancyProofs)) {
    if (!passed) failed.push(`tenancyProofs.${ownerKind}`);
  }
  return failed;
}

export async function cronEvaluateLearningReadiness(
  env: Env,
  options: EvaluateLearningReadinessOptions = {},
): Promise<{
  posts_processed: number;
  ready: boolean;
  id: string;
  workspaces_disabled: number;
  pilot_samples_schema_ready: 0 | 1;
  calibration_audits_schema_ready: 0 | 1;
}> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Readiness timestamp is invalid');
  const collect = options.collect ?? collectLearningReadiness;
  const readPrevious = options.loadPrevious ?? loadPrevious;
  const loadSchemaState = options.loadSchemaState ?? loadLearningReadinessSchemaState;
  const quarantine = options.quarantine ?? quarantineSevereFalsePassWorkspaces;
  const persist = options.persist ?? persistReadiness;
  const alert = options.alert ?? fireAlert;
  const randomId = options.randomId ?? (() => crypto.randomUUID());

  const previous = await readPrevious(env.DB);
  const schemaState = await loadSchemaState(env.DB);
  const schemasReady = schemaState.pilotSamplesReady
    && schemaState.calibrationAuditsReady;
  const snapshot = schemasReady
    ? await collect(env.DB, now)
    : buildDeferredReadinessSnapshot();
  const workspacesDisabled = schemasReady
    ? await quarantine(env.DB, now.toISOString())
    : 0;
  const id = randomId();
  await persist(env.DB, { id, snapshot, evaluatedAt: now.toISOString() });

  const turnedRed = previous?.ready === 1 && !snapshot.ready;
  if (turnedRed) {
    await alert(
      env,
      'learning_readiness_green_to_red',
      'critical',
      `Protected Autopilot readiness turned red: ${failedChecks(snapshot).join(', ')}; `
        + `workspaces quarantined: ${workspacesDisabled}`,
    );
  } else if (workspacesDisabled > 0) {
    await alert(
      env,
      'learning_severe_false_pass_quarantine',
      'critical',
      `Protected Autopilot automatically disabled for ${workspacesDisabled} workspace(s) `
        + 'after a release-critical severe false pass; operator review required.',
    );
  }
  return {
    posts_processed: snapshot.metrics.pilotDecisions,
    ready: snapshot.ready,
    id,
    workspaces_disabled: workspacesDisabled,
    pilot_samples_schema_ready: schemaState.pilotSamplesReady ? 1 : 0,
    calibration_audits_schema_ready: schemaState.calibrationAuditsReady ? 1 : 0,
  };
}
