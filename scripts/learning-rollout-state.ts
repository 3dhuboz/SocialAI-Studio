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

const POLICY_VERSION = '2026-07-14-v1';
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

const REQUIRED_DEPLOYED_FLAGS = {
  LEARNING_BRAIN_ENABLED: 'true',
  LEARNING_RELEASE_ENFORCEMENT: 'false',
  LEARNING_AUTOPILOT_ENABLED: 'false',
  ORGANIC_REACH_ENABLED: 'true',
  ORGANIC_REACH_APPLY_ENABLED: 'false',
} as const;

type DeployedFlagName = keyof typeof REQUIRED_DEPLOYED_FLAGS;
type RolloutResult = 'promotion_ready' | 'safe_hold' | 'unsafe_or_unverified';

export const STAGING_ROLLOUT_SQL = `
SELECT COUNT(*) AS pilot_samples,
       COALESCE(SUM(CASE WHEN owner_kind = 'user' THEN 1 ELSE 0 END), 0) AS owner_samples,
       COALESCE(SUM(CASE WHEN owner_kind = 'client' THEN 1 ELSE 0 END), 0) AS client_samples
  FROM learning_pilot_samples;
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
SELECT COUNT(*) AS customer_enrollments
  FROM learning_pilot_enrollments
 WHERE policy_version = '${POLICY_VERSION}'
   AND owner_kind = 'client'
   AND consent_basis = 'customer_attested'
   AND record_only = 1;
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
        AND name IN ('learning_pilot_samples', 'learning_calibration_audits', 'cron_alerts'))
    OR (type = 'index'
        AND name IN ('idx_cron_alerts_last_fired', 'idx_cron_alerts_unresolved'));
SELECT policy_version, ready, checks_json, evaluated_at
  FROM learning_release_readiness
 WHERE policy_version = '${POLICY_VERSION}'
 ORDER BY evaluated_at DESC
 LIMIT 1;
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
    customerEnrollments: number;
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
    pilotSampleTablePresent: boolean;
    calibrationTablePresent: boolean;
    alertSchemaReady: boolean;
    readiness: ReadinessObservation | null;
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
    (statement) => !/^SELECT\b/i.test(statement) || mutation.test(statement),
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

function everyBooleanTrue(value: unknown): boolean {
  const booleans: boolean[] = [];
  const visit = (item: unknown): void => {
    if (typeof item === 'boolean') {
      booleans.push(item);
      return;
    }
    if (item && typeof item === 'object') {
      for (const child of Object.values(item as Record<string, unknown>)) visit(child);
    }
  };
  visit(value);
  return booleans.length > 0 && booleans.every(Boolean);
}

function readinessIsGreen(
  readiness: ReadinessObservation | null,
  now: Date,
  maxAgeMinutes: number,
): boolean {
  return readiness?.policyVersion === POLICY_VERSION
    && readiness.ready
    && isFresh(readiness.evaluatedAt, now, maxAgeMinutes)
    && everyBooleanTrue(readiness.checks);
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
      customerEnrollments: numberField(stagingEnrollments, 'customer_enrollments'),
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
      pilotSampleTablePresent: numberField(productionSchema, 'pilot_sample_tables') === 1,
      calibrationTablePresent: numberField(productionSchema, 'calibration_tables') === 1,
      alertSchemaReady: numberField(productionSchema, 'alert_tables') === 1
        && numberField(productionSchema, 'alert_indexes') === 2,
      readiness: parseReadiness(productionReadiness),
    },
  };
  const evaluation = evaluateRolloutState(observation);
  const payload = {
    schemaVersion: 4,
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
    checks: evaluation.checks,
    failedSafetyChecks: evaluation.failedSafetyChecks,
    blockers: evaluation.blockers,
    limitations: [
      'This command performs read-only Cloudflare D1, deployment, version, and health checks.',
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
    `Blockers: ${evaluation.blockers.join(', ') || 'none'}`,
  ].join('\n') + '\n');

  if (evaluation.result === 'unsafe_or_unverified'
    || (hasOption('--require-ready') && !evaluation.promotionReady)) {
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
