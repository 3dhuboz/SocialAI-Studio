import {
  normalizeWorkspaceIdentity,
  type WorkspaceOwnerKind,
  type LearningMode,
  type ReleaseState,
} from './types';
import { BASE_REQUIRED_CRITICS, type CriticKind } from './critic-types';

export const AUTOPILOT_POLICY_VERSION = '2026-07-14-v1';
export const RELEASE_EVIDENCE_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ReleaseEvidenceKind =
  | 'replay_red_team'
  | 'staging_green'
  | 'staging_block'
  | 'kill_switch'
  | 'publish_regression';

export interface ReleaseEvidenceRow {
  evidence_kind: ReleaseEvidenceKind;
  owner_kind: WorkspaceOwnerKind | null;
  passed: number;
  recorded_at: string;
  expires_at: string | null;
}

export interface ReadinessMetrics {
  pilotDecisions: number;
  pilotWorkspaceCount: number;
  pilotUserDecisions: number;
  pilotClientDecisions: number;
  adjudicatedDecisions: number;
  severeFalsePasses: number;
  falseHoldRate: number;
  requiredAvailability: number;
  decisionReceiptCoverage: number;
  predictionLift: number;
  rankCorrelation: number;
  criticalBypasses: number;
  publishingRegressions: number;
  costWithinBudget: boolean;
  killSwitchTested: boolean;
}

export interface PilotDecisionRow {
  id: string;
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind;
  owner_id: string;
  mode: LearningMode;
  release_state: ReleaseState;
  summary_json: string;
  publication_event_id: string | null;
  normalized_score: number | string | null;
  expected_state: ReleaseState | null;
  adjudication_severity: 'advisory' | 'release_critical' | null;
}

export interface PilotVerdictRow {
  decision_id: string;
  critic_kind: CriticKind;
  verdict: string;
  attempt: number;
}

export interface WorkspaceCostTelemetry {
  userId: string;
  workspaceKey: string;
  budgetUsdCents: number | null;
  spendUsd: number;
  telemetryCount: number;
}

export interface PredictionSample {
  workspaceKey: string;
  predicted: number;
  actual: number;
}

export interface ReadinessChecks {
  pilot: boolean;
  pilotCohort: boolean;
  adjudications: boolean;
  severeFalsePasses: boolean;
  falseHolds: boolean;
  availability: boolean;
  receipts: boolean;
  predictionLift: boolean;
  rankCorrelation: boolean;
  criticalBypasses: boolean;
  publishingRegressions: boolean;
  cost: boolean;
  killSwitch: boolean;
}

export interface LearningReadinessChecks extends ReadinessChecks {
  replayRedTeam: boolean;
  publishRegression: boolean;
  tenancyProofs: Record<WorkspaceOwnerKind, boolean>;
}

export interface LearningReadinessSnapshot {
  ready: boolean;
  metrics: ReadinessMetrics;
  checks: LearningReadinessChecks;
}

export function evaluateReadiness(metrics: ReadinessMetrics): {
  ready: boolean;
  checks: ReadinessChecks;
} {
  const checks: ReadinessChecks = {
    pilot: metrics.pilotDecisions >= 30,
    pilotCohort: metrics.pilotWorkspaceCount === 2
      && metrics.pilotUserDecisions > 0
      && metrics.pilotClientDecisions > 0,
    adjudications: metrics.adjudicatedDecisions >= 30,
    severeFalsePasses: metrics.severeFalsePasses === 0,
    falseHolds: metrics.falseHoldRate < 0.05,
    availability: metrics.requiredAvailability >= 0.995,
    receipts: metrics.decisionReceiptCoverage === 1,
    predictionLift: metrics.predictionLift >= 0.15,
    rankCorrelation: metrics.rankCorrelation > 0,
    criticalBypasses: metrics.criticalBypasses === 0,
    publishingRegressions: metrics.publishingRegressions === 0,
    cost: metrics.costWithinBudget,
    killSwitch: metrics.killSwitchTested,
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ranked(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = new Array<number>(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[sorted[index].index] = rank;
    start = end;
  }
  return ranks;
}

function correlation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = average(left);
  const rightMean = average(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? 0 : covariance / denominator;
}

export function calculatePredictionQuality(samples: PredictionSample[]): {
  predictionLift: number;
  rankCorrelation: number;
} {
  const grouped = new Map<string, PredictionSample[]>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.predicted) || !Number.isFinite(sample.actual)) continue;
    const rows = grouped.get(sample.workspaceKey) ?? [];
    rows.push(sample);
    grouped.set(sample.workspaceKey, rows);
  }

  let weightedLift = 0;
  let weightedCorrelation = 0;
  let totalWeight = 0;
  for (const rows of grouped.values()) {
    if (rows.length < 4) continue;
    const ordered = [...rows].sort((a, b) => b.predicted - a.predicted);
    const topCount = Math.max(1, Math.ceil(ordered.length * 0.25));
    const topActual = average(ordered.slice(0, topCount).map((row) => row.actual));
    const restActual = average(ordered.slice(topCount).map((row) => row.actual));
    const lift = (topActual - restActual) / Math.max(Math.abs(restActual), 1);
    const spearman = correlation(
      ranked(rows.map((row) => row.predicted)),
      ranked(rows.map((row) => row.actual)),
    );
    weightedLift += lift * rows.length;
    weightedCorrelation += spearman * rows.length;
    totalWeight += rows.length;
  }
  if (totalWeight === 0) return { predictionLift: 0, rankCorrelation: 0 };
  return {
    predictionLift: weightedLift / totalWeight,
    rankCorrelation: weightedCorrelation / totalWeight,
  };
}

function parseSummary(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function workspaceTelemetryKey(userId: string, workspaceKey: string): string {
  return `${userId}\u0000${workspaceKey}`;
}

export function buildReadinessMetrics(
  decisions: PilotDecisionRow[],
  verdicts: PilotVerdictRow[],
  costs: WorkspaceCostTelemetry[],
): ReadinessMetrics {
  const pilotDecisions = decisions.filter((decision) =>
    decision.mode === 'approval'
    && (decision.owner_kind === 'user' || decision.owner_kind === 'client'));
  const latestVerdicts = new Map<string, PilotVerdictRow>();
  for (const verdict of verdicts) {
    if (!BASE_REQUIRED_CRITICS.includes(verdict.critic_kind)) continue;
    const key = `${verdict.decision_id}\u0000${verdict.critic_kind}`;
    const current = latestVerdicts.get(key);
    if (!current || verdict.attempt > current.attempt) latestVerdicts.set(key, verdict);
  }

  const expectedSlots = pilotDecisions.length * BASE_REQUIRED_CRITICS.length;
  let availableSlots = 0;
  let completeReceipts = 0;
  const predictionSamples: PredictionSample[] = [];
  for (const decision of pilotDecisions) {
    const summary = parseSummary(decision.summary_json);
    const hasEveryCritic = BASE_REQUIRED_CRITICS.every((kind) =>
      latestVerdicts.has(`${decision.id}\u0000${kind}`));
    if (summary.persistenceState === 'complete' && hasEveryCritic) completeReceipts += 1;
    for (const kind of BASE_REQUIRED_CRITICS) {
      const verdict = latestVerdicts.get(`${decision.id}\u0000${kind}`);
      if (verdict && verdict.verdict !== 'unavailable') availableSlots += 1;
    }
    const predicted = typeof summary.predictedOutcomeScore === 'number'
      ? summary.predictedOutcomeScore
      : Number.NaN;
    const actual = decision.normalized_score == null
      ? Number.NaN
      : Number(decision.normalized_score);
    if (Number.isFinite(predicted) && Number.isFinite(actual)) {
      predictionSamples.push({
        workspaceKey: workspaceTelemetryKey(decision.user_id, decision.workspace_key),
        predicted,
        actual,
      });
    }
  }

  const adjudicated = pilotDecisions.filter((decision) => decision.expected_state != null);
  const severeFalsePasses = adjudicated.filter((decision) =>
    decision.release_state === 'pass_green'
    && decision.expected_state === 'block_red'
    && decision.adjudication_severity === 'release_critical').length;
  const falseHolds = adjudicated.filter((decision) =>
    decision.expected_state === 'pass_green'
    && (decision.release_state === 'hold_amber' || decision.release_state === 'block_red')).length;
  const criticalBypasses = pilotDecisions.filter((decision) =>
    (decision.mode === 'approval' || decision.mode === 'protected_autopilot')
    && decision.release_state !== 'pass_green'
    && decision.publication_event_id != null).length;

  const workspaceKeys = new Set(pilotDecisions.map((decision) =>
    workspaceTelemetryKey(decision.user_id, decision.workspace_key)));
  const costsByWorkspace = new Map(costs.map((cost) => [
    workspaceTelemetryKey(cost.userId, cost.workspaceKey),
    cost,
  ]));
  const costWithinBudget = workspaceKeys.size > 0 && [...workspaceKeys].every((key) => {
    const cost = costsByWorkspace.get(key);
    return Boolean(
      cost
      && Number.isSafeInteger(cost.budgetUsdCents)
      && Number(cost.budgetUsdCents) > 0
      && Number.isFinite(cost.spendUsd)
      && Number.isSafeInteger(cost.telemetryCount)
      && cost.telemetryCount > 0
      && cost.spendUsd * 100 < Number(cost.budgetUsdCents),
    );
  });

  const quality = predictionSamples.length === pilotDecisions.length && pilotDecisions.length >= 30
    ? calculatePredictionQuality(predictionSamples)
    : { predictionLift: 0, rankCorrelation: 0 };
  return {
    pilotDecisions: pilotDecisions.length,
    pilotWorkspaceCount: workspaceKeys.size,
    pilotUserDecisions: pilotDecisions.filter((decision) => decision.owner_kind === 'user').length,
    pilotClientDecisions: pilotDecisions.filter((decision) => decision.owner_kind === 'client').length,
    adjudicatedDecisions: adjudicated.length,
    severeFalsePasses,
    falseHoldRate: adjudicated.length === 0 ? 1 : falseHolds / adjudicated.length,
    requiredAvailability: expectedSlots === 0 ? 0 : availableSlots / expectedSlots,
    decisionReceiptCoverage: pilotDecisions.length === 0
      ? 0
      : completeReceipts / pilotDecisions.length,
    predictionLift: quality.predictionLift,
    rankCorrelation: quality.rankCorrelation,
    criticalBypasses,
    publishingRegressions: 1,
    costWithinBudget,
    killSwitchTested: false,
  };
}

function evidenceKey(kind: ReleaseEvidenceKind, ownerKind: WorkspaceOwnerKind | null): string {
  return `${kind}:${ownerKind ?? '*'}`;
}

export function evaluateReleaseEvidence(
  rows: ReleaseEvidenceRow[],
  now: Date = new Date(),
): {
  replayRedTeam: boolean;
  killSwitch: boolean;
  publishRegression: boolean;
  tenancyProofs: Record<WorkspaceOwnerKind, boolean>;
} {
  const latest = new Map<string, ReleaseEvidenceRow>();
  for (const row of rows) {
    const key = evidenceKey(row.evidence_kind, row.owner_kind);
    const existing = latest.get(key);
    if (!existing || Date.parse(row.recorded_at) > Date.parse(existing.recorded_at)) {
      latest.set(key, row);
    }
  }

  const nowMs = now.getTime();
  const passes = (kind: ReleaseEvidenceKind, ownerKind: WorkspaceOwnerKind | null) => {
    const row = latest.get(evidenceKey(kind, ownerKind));
    if (!row || row.passed !== 1) return false;
    if (!row.expires_at) return false;
    const recordedAt = Date.parse(row.recorded_at);
    const expiresAt = Date.parse(row.expires_at);
    return Number.isFinite(recordedAt)
      && Number.isFinite(expiresAt)
      && recordedAt <= nowMs
      && expiresAt > nowMs
      && expiresAt > recordedAt
      && expiresAt - recordedAt <= RELEASE_EVIDENCE_MAX_TTL_MS;
  };

  const tenancyProofs = Object.fromEntries(
    (['user', 'client', 'shop'] as const).map((ownerKind) => [
      ownerKind,
      passes('staging_green', ownerKind) && passes('staging_block', ownerKind),
    ]),
  ) as Record<WorkspaceOwnerKind, boolean>;

  return {
    replayRedTeam: passes('replay_red_team', null),
    killSwitch: passes('kill_switch', null),
    publishRegression: passes('publish_regression', null),
    tenancyProofs,
  };
}

function utcMonthBounds(now: Date): [string, string] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return [start.toISOString(), end.toISOString()];
}

export async function collectLearningReadiness(
  db: D1Database,
  now: Date = new Date(),
): Promise<LearningReadinessSnapshot> {
  const pilot = await db.prepare(`
    SELECT
      d.id, d.user_id, d.workspace_key, d.client_id, d.owner_kind, d.owner_id,
      d.mode, d.release_state, d.summary_json,
      a.expected_state, a.severity AS adjudication_severity,
      pe.id AS publication_event_id,
      lo.normalized_score
    FROM learning_decisions d
    INNER JOIN learning_pilot_enrollments pen
      ON pen.user_id = d.user_id
     AND pen.workspace_key = d.workspace_key
     AND pen.client_id IS d.client_id
     AND pen.owner_kind = d.owner_kind
     AND pen.owner_id = d.owner_id
     AND pen.policy_version = ?
     AND pen.record_only = 1
     AND unixepoch(d.created_at) >= unixepoch(pen.enrolled_at)
     AND unixepoch(pen.consent_confirmed_at) <= unixepoch(d.created_at)
     AND (
       (d.owner_kind = 'user' AND pen.consent_basis = 'owner_self')
       OR (d.owner_kind = 'client' AND pen.consent_basis = 'customer_attested')
     )
    LEFT JOIN users u
      ON d.owner_kind = 'user' AND u.id = d.user_id
    LEFT JOIN clients c
      ON d.owner_kind = 'client'
     AND c.id = d.client_id
     AND c.user_id = d.user_id
    LEFT JOIN learning_adjudications a
      ON a.decision_id = d.id
     AND a.user_id = d.user_id
     AND a.workspace_key = d.workspace_key
     AND a.owner_kind = d.owner_kind
     AND a.owner_id = d.owner_id
    LEFT JOIN publication_events pe
      ON pe.decision_id = d.id
     AND pe.user_id = d.user_id
     AND pe.workspace_key = d.workspace_key
     AND pe.owner_kind = d.owner_kind
     AND pe.owner_id = d.owner_id
     AND pe.id = (
       SELECT pe2.id
       FROM publication_events pe2
       WHERE pe2.decision_id = d.id
         AND pe2.user_id = d.user_id
         AND pe2.workspace_key = d.workspace_key
         AND pe2.owner_kind = d.owner_kind
         AND pe2.owner_id = d.owner_id
       ORDER BY pe2.published_at DESC, pe2.id DESC
       LIMIT 1
     )
    LEFT JOIN learning_outcomes lo
      ON lo.publication_event_id = pe.id
     AND lo.window_hours = 168
    WHERE d.stage = 'release'
      AND d.mode = 'approval'
      AND d.owner_kind IN ('user','client')
      AND (
        (d.owner_kind = 'user' AND u.id IS NOT NULL)
        OR (
          d.owner_kind = 'client'
          AND c.id IS NOT NULL
          AND COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'
        )
      )
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 30
  `).bind(AUTOPILOT_POLICY_VERSION).all<PilotDecisionRow>();
  const decisions = pilot.results ?? [];

  let verdicts: PilotVerdictRow[] = [];
  if (decisions.length > 0) {
    const placeholders = decisions.map(() => '?').join(',');
    const rows = await db.prepare(`
      SELECT decision_id, critic_kind, verdict, attempt
      FROM learning_critic_verdicts
      WHERE decision_id IN (${placeholders})
      ORDER BY decision_id, critic_kind, attempt
    `).bind(...decisions.map((decision) => decision.id)).all<PilotVerdictRow>();
    verdicts = rows.results ?? [];
  }

  const evidenceRows = await db.prepare(`
    SELECT evidence_kind, owner_kind, passed, recorded_at, expires_at
    FROM learning_release_evidence
    WHERE policy_version = ?
    ORDER BY recorded_at DESC, id DESC
  `).bind(AUTOPILOT_POLICY_VERSION).all<ReleaseEvidenceRow>();
  const evidence = evaluateReleaseEvidence(evidenceRows.results ?? [], now);

  const identities = new Map<string, ReturnType<typeof normalizeWorkspaceIdentity>>();
  for (const decision of decisions) {
    const identity = normalizeWorkspaceIdentity(
      decision.user_id,
      decision.client_id,
      decision.owner_kind,
      decision.owner_id,
    );
    if (identity.workspaceKey !== decision.workspace_key) {
      throw new Error(`Decision ${decision.id} has a non-canonical workspace key`);
    }
    identities.set(workspaceTelemetryKey(identity.userId, identity.workspaceKey), identity);
  }

  const [monthStart, monthEnd] = utcMonthBounds(now);
  const costs: WorkspaceCostTelemetry[] = [];
  for (const identity of identities.values()) {
    const setting = await db.prepare(`
      SELECT monthly_ai_budget_usd_cents
      FROM workspace_learning_settings
      WHERE user_id = ? AND workspace_key = ?
        AND client_id IS ? AND owner_kind = ? AND owner_id = ?
      LIMIT 1
    `).bind(
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
    ).first<{ monthly_ai_budget_usd_cents: number | null }>();
    const costSql = identity.clientId === null
      ? `SELECT COALESCE(SUM(est_cost_usd), 0) AS spend_usd, COUNT(*) AS telemetry_count
           FROM ai_usage
          WHERE user_id = ? AND client_id IS NULL AND ts >= ? AND ts < ?`
      : `SELECT COALESCE(SUM(est_cost_usd), 0) AS spend_usd, COUNT(*) AS telemetry_count
           FROM ai_usage
          WHERE user_id = ? AND client_id = ? AND ts >= ? AND ts < ?`;
    const bindings = identity.clientId === null
      ? [identity.userId, monthStart, monthEnd]
      : [identity.userId, identity.clientId, monthStart, monthEnd];
    const usage = await db.prepare(costSql).bind(...bindings).first<{
      spend_usd: number | null;
      telemetry_count: number;
    }>();
    costs.push({
      userId: identity.userId,
      workspaceKey: identity.workspaceKey,
      budgetUsdCents: setting?.monthly_ai_budget_usd_cents ?? null,
      spendUsd: Number(usage?.spend_usd ?? Number.NaN),
      telemetryCount: Number(usage?.telemetry_count ?? 0),
    });
  }

  const metrics = buildReadinessMetrics(decisions, verdicts, costs);
  metrics.killSwitchTested = evidence.killSwitch;
  metrics.publishingRegressions = evidence.publishRegression ? 0 : 1;
  const evaluated = evaluateReadiness(metrics);
  const checks: LearningReadinessChecks = {
    ...evaluated.checks,
    replayRedTeam: evidence.replayRedTeam,
    publishRegression: evidence.publishRegression,
    tenancyProofs: evidence.tenancyProofs,
  };
  const ownerProofsReady = Object.values(evidence.tenancyProofs).every(Boolean);
  return {
    metrics,
    checks,
    ready: evaluated.ready
      && evidence.replayRedTeam
      && evidence.publishRegression
      && ownerProofsReady,
  };
}
