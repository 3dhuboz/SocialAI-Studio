import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { makeRecordingD1 } from './helpers/recording-d1';
import {
  AUTOPILOT_POLICY_VERSION,
  buildReadinessMetrics,
  calculatePredictionQuality,
  collectLearningReadiness,
  evaluateReadiness,
  evaluateReleaseEvidence,
  type PilotDecisionRow,
  type PilotVerdictRow,
  type ReadinessMetrics,
  type ReleaseEvidenceRow,
  type WorkspaceCostTelemetry,
} from '../lib/learning/readiness';
import { cronEvaluateLearningReadiness } from '../cron/evaluate-learning-readiness';
import {
  hasWorkspaceSevereFalsePass,
  loadWorkspaceLearningMode,
  quarantineSevereFalsePassWorkspaces,
  saveWorkspaceLearningSettings,
  SEVERE_FALSE_PASS_DISABLED_REASON,
} from '../lib/learning/workspace-mode';
import type { LearningMode, WorkspaceOwnerKind } from '../lib/learning/types';

type ModeOptions = {
  requested?: LearningMode;
  readiness?: boolean;
  consent?: boolean;
  onHold?: boolean;
  shop?: string;
  budgetUsdCents?: number | null;
  spendUsdCents?: number;
  telemetryCount?: number;
  tenancyProofs?: Partial<Record<WorkspaceOwnerKind, boolean>>;
  disabledReason?: string | null;
  severeFalsePass?: boolean;
  brain?: string;
  enforcement?: string;
  autopilot?: string;
};

function modeEnv(options: ModeOptions = {}): Env {
  const tenancyProofs = {
    user: true,
    client: true,
    shop: true,
    ...options.tenancyProofs,
  };
  const settings = options.requested === undefined ? [] : [{
    mode: options.requested,
    autopublish_consent_at: options.consent ? '2026-07-14T00:00:00.000Z' : null,
    autopublish_policy_version: options.consent ? AUTOPILOT_POLICY_VERSION : null,
    experiment_rate: 0,
    monthly_ai_budget_usd_cents: options.budgetUsdCents === undefined
      ? 1000
      : options.budgetUsdCents,
    disabled_reason: options.disabledReason ?? null,
  }];
  const { db } = makeRecordingD1({
    'FROM clients': [{ status: options.onHold ? 'on_hold' : 'active' }],
    'FROM shopify_stores': options.shop ? [{ shop_domain: options.shop }] : [],
    'FROM workspace_learning_settings': settings,
    'FROM learning_release_readiness': [{
      ready: options.readiness === false ? 0 : 1,
      policy_version: AUTOPILOT_POLICY_VERSION,
      checks_json: JSON.stringify({ tenancyProofs }),
      evaluated_at: '2026-07-14T00:00:00.000Z',
    }],
    'FROM ai_usage': [{
      spend_usd: (options.spendUsdCents ?? 100) / 100,
      telemetry_count: options.telemetryCount ?? 1,
    }],
    'INNER JOIN learning_adjudications a': options.severeFalsePass
      ? [{ severe_false_pass: 1 }]
      : [],
  });
  return {
    DB: db,
    LEARNING_BRAIN_ENABLED: options.brain ?? 'true',
    LEARNING_RELEASE_ENFORCEMENT: options.enforcement ?? 'true',
    LEARNING_AUTOPILOT_ENABLED: options.autopilot ?? 'true',
  } as Env;
}

const readyMetrics: ReadinessMetrics = {
  pilotDecisions: 30,
  pilotWorkspaceCount: 2,
  pilotUserDecisions: 15,
  pilotClientDecisions: 15,
  adjudicatedDecisions: 30,
  severeFalsePasses: 0,
  falseHoldRate: 0.033,
  requiredAvailability: 0.995,
  releaseJudgeAvailability: 1,
  releaseJudgeTelemetryCoverage: 1,
  releaseJudgeInvocations: 30,
  decisionReceiptCoverage: 1,
  predictionSampleCount: 20,
  predictionWorkspaceCount: 2,
  predictionMinWorkspaceSamples: 10,
  predictionLift: 0.15,
  rankCorrelation: 0.1,
  criticalBypasses: 0,
  publishingRegressions: 0,
  costWithinBudget: true,
  killSwitchTested: true,
};

const deterministicKinds = ['brand', 'fact', 'repetition', 'platform'] as const;
const independentKinds = [
  'brand',
  'fact',
  'repetition',
  'platform',
  'business_harm',
] as const;

function completeTextVerdicts(decisionId: string): PilotVerdictRow[] {
  return [
    ...deterministicKinds.map((criticKind) => ({
      decision_id: decisionId,
      critic_kind: criticKind,
      verdict: 'pass',
      attempt: 0,
      provider: 'deterministic',
    } as const)),
    ...independentKinds.map((criticKind) => ({
      decision_id: decisionId,
      critic_kind: criticKind,
      verdict: 'pass',
      attempt: 0,
      provider: 'anthropic',
    } as const)),
  ];
}

describe('learning release readiness', () => {
  it('requires enough adjudicated pilot evidence and every safety threshold', () => {
    expect(evaluateReadiness(readyMetrics).ready).toBe(true);
    for (const patch of [
      { pilotDecisions: 29 },
      { pilotWorkspaceCount: 1 },
      { pilotWorkspaceCount: 3 },
      { pilotUserDecisions: 0 },
      { pilotClientDecisions: 0 },
      { adjudicatedDecisions: 29 },
      { severeFalsePasses: 1 },
      { falseHoldRate: 0.05 },
      { requiredAvailability: 0.994 },
      { releaseJudgeAvailability: 0.994 },
      { releaseJudgeTelemetryCoverage: 0.999 },
      { decisionReceiptCoverage: 0.999 },
      { predictionSampleCount: 19 },
      { predictionWorkspaceCount: 1 },
      { predictionMinWorkspaceSamples: 7 },
      { predictionLift: 0.149 },
      { rankCorrelation: 0 },
      { criticalBypasses: 1 },
      { publishingRegressions: 1 },
      { costWithinBudget: false },
      { killSwitchTested: false },
    ]) {
      expect(evaluateReadiness({ ...readyMetrics, ...patch }).ready).toBe(false);
    }
  });

  it('requires current passing global evidence and both staging proofs per owner kind', () => {
    const rows: ReleaseEvidenceRow[] = [
      ['replay_red_team', null],
      ['kill_switch', null],
      ['publish_regression', null],
      ...(['user', 'client', 'shop'] as const).flatMap((ownerKind) => [
        ['staging_green', ownerKind] as const,
        ['staging_block', ownerKind] as const,
      ]),
    ].map(([evidenceKind, ownerKind]) => ({
      evidence_kind: evidenceKind,
      owner_kind: ownerKind,
      passed: 1,
      recorded_at: '2026-07-14T00:00:00.000Z',
      expires_at: '2026-07-21T00:00:00.000Z',
    }));

    expect(evaluateReleaseEvidence(rows, new Date('2026-07-14T01:00:00.000Z'))).toEqual({
      replayRedTeam: true,
      killSwitch: true,
      publishRegression: true,
      tenancyProofs: { user: true, client: true, shop: true },
    });
  });

  it('lets the newest failure override a pass and rejects expired evidence', () => {
    const rows: ReleaseEvidenceRow[] = [
      {
        evidence_kind: 'kill_switch', owner_kind: null, passed: 1,
        recorded_at: '2026-07-14T00:00:00.000Z', expires_at: '2026-07-21T00:00:00.000Z',
      },
      {
        evidence_kind: 'kill_switch', owner_kind: null, passed: 0,
        recorded_at: '2026-07-14T00:05:00.000Z', expires_at: '2026-07-21T00:00:00.000Z',
      },
      {
        evidence_kind: 'replay_red_team', owner_kind: null, passed: 1,
        recorded_at: '2026-07-13T00:00:00.000Z', expires_at: '2026-07-14T00:30:00.000Z',
      },
    ];
    const result = evaluateReleaseEvidence(rows, new Date('2026-07-14T01:00:00.000Z'));
    expect(result.killSwitch).toBe(false);
    expect(result.replayRedTeam).toBe(false);
    expect(result.tenancyProofs).toEqual({ user: false, client: false, shop: false });
  });

  it('fails closed for missing, malformed, future-dated, or overlong release evidence', () => {
    const now = new Date('2026-07-14T01:00:00.000Z');
    const row: ReleaseEvidenceRow = {
      evidence_kind: 'kill_switch',
      owner_kind: null,
      passed: 1,
      recorded_at: '2026-07-14T00:00:00.000Z',
      expires_at: null,
    };

    expect(evaluateReleaseEvidence([row], now).killSwitch).toBe(false);
    expect(evaluateReleaseEvidence([{
      ...row,
      expires_at: '2026-07-22T00:00:00.001Z',
    }], now).killSwitch).toBe(false);
    expect(evaluateReleaseEvidence([{
      ...row,
      recorded_at: '2026-07-14T02:00:00.000Z',
      expires_at: '2026-07-21T02:00:00.000Z',
    }], now).killSwitch).toBe(false);
    expect(evaluateReleaseEvidence([{
      ...row,
      recorded_at: 'not-a-date',
      expires_at: '2026-07-21T00:00:00.000Z',
    }], now).killSwitch).toBe(false);
  });

  it('scores prediction quality inside each workspace rather than across tenants', () => {
    const samples = [
      ...[1, 2, 3, 4].map((value) => ({
        workspaceKey: 'a', predicted: value, actual: value * 10,
      })),
      ...[1, 2, 3, 4].map((value) => ({
        workspaceKey: 'b', predicted: value + 100, actual: value * 10,
      })),
    ];
    const quality = calculatePredictionQuality(samples);
    expect(quality.rankCorrelation).toBe(1);
    expect(quality.predictionLift).toBeGreaterThan(0.15);
  });

  it('builds green metrics only from complete, labelled, available and costed pilot receipts', () => {
    const decisions: PilotDecisionRow[] = Array.from({ length: 30 }, (_, index) => {
      const clientPilot = index >= 15;
      return {
        id: `decision-${index}`,
        user_id: 'owner-1',
        workspace_key: clientPilot ? 'client-1' : '__owner__',
        client_id: clientPilot ? 'client-1' : null,
        owner_kind: clientPilot ? 'client' : 'user',
        owner_id: clientPilot ? 'client-1' : 'owner-1',
        mode: 'approval',
        release_state: index % 15 < 10 ? 'pass_green' : 'block_red',
        summary_json: JSON.stringify({
          persistenceState: 'complete',
          pipelineState: index % 15 < 10 ? 'pass_green' : 'block_red',
          mediaKind: 'none',
          judgeStatus: index % 15 < 10 ? 'available' : 'not_run',
          predictedOutcomeScore: (index % 15) + 1,
        }),
        publication_event_id: index % 15 < 10 ? `publication-${index}` : null,
        normalized_score: index % 15 < 10 ? (index % 15) + 1 : null,
        outcome_source_status: index % 15 < 10 ? 'complete' : null,
        expected_state: index % 15 < 10 ? 'pass_green' : 'block_red',
        adjudication_severity: 'advisory',
      };
    });
    const verdicts: PilotVerdictRow[] = decisions.flatMap((decision, index) =>
      completeTextVerdicts(decision.id).map((verdict) => (
        index % 15 >= 10
        && verdict.provider === 'deterministic'
        && verdict.critic_kind === 'fact'
          ? { ...verdict, verdict: 'block' as const }
          : verdict
      )));
    const costs: WorkspaceCostTelemetry[] = [
      {
        userId: 'owner-1',
        workspaceKey: '__owner__',
        budgetUsdCents: 1000,
        spendUsd: 1,
        telemetryCount: 30,
        invalidTelemetryCount: 0,
        pilotSpendUsd: 0.5,
        pilotTelemetryCount: 30,
        pilotInvalidTelemetryCount: 0,
        meteredPilotDecisionCount: 15,
      },
      {
        userId: 'owner-1',
        workspaceKey: 'client-1',
        budgetUsdCents: 1000,
        spendUsd: 1,
        telemetryCount: 30,
        invalidTelemetryCount: 0,
        pilotSpendUsd: 0.5,
        pilotTelemetryCount: 30,
        pilotInvalidTelemetryCount: 0,
        meteredPilotDecisionCount: 15,
      },
    ];

    const metrics = buildReadinessMetrics(decisions, verdicts, costs);
    expect(metrics).toMatchObject({
      pilotDecisions: 30,
      pilotWorkspaceCount: 2,
      pilotUserDecisions: 15,
      pilotClientDecisions: 15,
      adjudicatedDecisions: 30,
      severeFalsePasses: 0,
      falseHoldRate: 0,
      requiredAvailability: 1,
      releaseJudgeAvailability: 1,
      releaseJudgeTelemetryCoverage: 1,
      releaseJudgeInvocations: 20,
      decisionReceiptCoverage: 1,
      predictionSampleCount: 20,
      predictionWorkspaceCount: 2,
      predictionMinWorkspaceSamples: 10,
      rankCorrelation: 1,
      criticalBypasses: 0,
      costWithinBudget: true,
    });
    expect(metrics.predictionLift).toBeGreaterThan(0.15);
    expect(evaluateReadiness({ ...metrics, publishingRegressions: 0, killSwitchTested: true }).ready)
      .toBe(true);
  });

  it('fails cost readiness when generic usage is not attributed to every pilot decision', () => {
    const decisions: PilotDecisionRow[] = Array.from({ length: 2 }, (_, index) => ({
      id: `decision-${index}`,
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'approval',
      release_state: 'pass_green',
      summary_json: JSON.stringify({ persistenceState: 'complete' }),
      publication_event_id: null,
      normalized_score: null,
      expected_state: null,
      adjudication_severity: null,
    }));
    const genericOnly: WorkspaceCostTelemetry[] = [{
      userId: 'owner-1',
      workspaceKey: '__owner__',
      budgetUsdCents: 1000,
      spendUsd: 2,
      telemetryCount: 100,
      invalidTelemetryCount: 0,
      pilotSpendUsd: 0.1,
      pilotTelemetryCount: 1,
      pilotInvalidTelemetryCount: 0,
      meteredPilotDecisionCount: 1,
    }];

    expect(buildReadinessMetrics(decisions, [], genericOnly).costWithinBudget).toBe(false);
  });

  it('fails cost readiness when any workspace or pilot estimate is missing or negative', () => {
    const decision: PilotDecisionRow = {
      id: 'decision-1',
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'approval',
      release_state: 'pass_green',
      summary_json: JSON.stringify({ persistenceState: 'complete' }),
      publication_event_id: null,
      normalized_score: null,
      expected_state: null,
      adjudication_severity: null,
    };
    const completeCost: WorkspaceCostTelemetry = {
      userId: 'owner-1',
      workspaceKey: '__owner__',
      budgetUsdCents: 1000,
      spendUsd: 1,
      telemetryCount: 3,
      invalidTelemetryCount: 0,
      pilotSpendUsd: 0.5,
      pilotTelemetryCount: 3,
      pilotInvalidTelemetryCount: 0,
      meteredPilotDecisionCount: 1,
    };

    expect(buildReadinessMetrics(
      [decision],
      [],
      [{ ...completeCost, invalidTelemetryCount: 1 }],
    ).costWithinBudget).toBe(false);
    expect(buildReadinessMetrics(
      [decision],
      [],
      [{ ...completeCost, pilotInvalidTelemetryCount: 1 }],
    ).costWithinBudget).toBe(false);
  });

  it('does not count shadow or protected decisions as approval pilot evidence', () => {
    const decisions: PilotDecisionRow[] = (['shadow', 'protected_autopilot'] as const).map(
      (mode, index) => ({
        id: `non-pilot-${index}`,
        user_id: 'owner-1',
        workspace_key: '__owner__',
        client_id: null,
        owner_kind: 'user',
        owner_id: 'owner-1',
        mode,
        release_state: 'pass_green',
        summary_json: JSON.stringify({ persistenceState: 'complete' }),
        publication_event_id: null,
        normalized_score: null,
        expected_state: 'pass_green',
        adjudication_severity: 'advisory',
      }),
    );

    expect(buildReadinessMetrics(decisions, [], [])).toMatchObject({
      pilotDecisions: 0,
      pilotWorkspaceCount: 0,
      pilotUserDecisions: 0,
      pilotClientDecisions: 0,
      adjudicatedDecisions: 0,
    });
  });

  it('counts a required critic slot when any fallback is available on the latest attempt', () => {
    const decisions: PilotDecisionRow[] = [{
      id: 'decision-fallback',
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'approval',
      release_state: 'pass_green',
      summary_json: JSON.stringify({
        persistenceState: 'complete',
        pipelineState: 'pass_green',
        mediaKind: 'none',
        judgeStatus: 'available',
      }),
      publication_event_id: null,
      normalized_score: null,
      expected_state: null,
      adjudication_severity: null,
    }];
    const verdicts: PilotVerdictRow[] = [
      ...completeTextVerdicts('decision-fallback'),
      {
        decision_id: 'decision-fallback', critic_kind: 'brand',
        verdict: 'unavailable', attempt: 0, provider: 'unavailable',
      },
    ];

    expect(buildReadinessMetrics(decisions, verdicts, []).requiredAvailability).toBe(1);
    expect(buildReadinessMetrics(decisions, [...verdicts].reverse(), []).requiredAvailability)
      .toBe(1);
  });

  it('does not let a deterministic pass mask an unavailable independent critic', () => {
    const decision: PilotDecisionRow = {
      id: 'decision-independent-outage',
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'approval',
      release_state: 'hold_amber',
      summary_json: JSON.stringify({
        persistenceState: 'complete',
        pipelineState: 'hold_amber',
        mediaKind: 'none',
        judgeStatus: 'not_run',
      }),
      publication_event_id: null,
      normalized_score: null,
      expected_state: null,
      adjudication_severity: null,
    };
    const verdicts = completeTextVerdicts(decision.id).map((row) =>
      row.critic_kind === 'brand' && row.provider !== 'deterministic'
        ? { ...row, verdict: 'unavailable', provider: 'unavailable' }
        : row);

    const metrics = buildReadinessMetrics([decision], verdicts, []);
    expect(metrics.requiredAvailability).toBeCloseTo(8 / 9);
    expect(metrics.releaseJudgeTelemetryCoverage).toBe(1);
    expect(metrics.decisionReceiptCoverage).toBe(1);
  });

  it('does not count critics intentionally skipped after a deterministic hard block', () => {
    const decision: PilotDecisionRow = {
      id: 'decision-deterministic-block',
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'approval',
      release_state: 'block_red',
      summary_json: JSON.stringify({
        persistenceState: 'complete',
        pipelineState: 'block_red',
        mediaKind: 'image',
        judgeStatus: 'not_run',
      }),
      publication_event_id: null,
      normalized_score: null,
      expected_state: null,
      adjudication_severity: null,
    };
    const verdicts: PilotVerdictRow[] = deterministicKinds.map((criticKind) => ({
      decision_id: decision.id,
      critic_kind: criticKind,
      verdict: criticKind === 'brand' ? 'block' : 'pass',
      attempt: 0,
      provider: 'deterministic',
    }));

    const metrics = buildReadinessMetrics([decision], verdicts, []);
    expect(metrics.requiredAvailability).toBe(1);
    expect(metrics.releaseJudgeTelemetryCoverage).toBe(1);
    expect(metrics.releaseJudgeInvocations).toBe(0);
    expect(metrics.decisionReceiptCoverage).toBe(1);
  });

  it('requires the selected media critic for availability and receipt coverage', () => {
    const decisions: PilotDecisionRow[] = [{
      id: 'decision-image',
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'approval',
      release_state: 'pass_green',
      summary_json: JSON.stringify({
        persistenceState: 'complete',
        pipelineState: 'pass_green',
        mediaKind: 'image',
        judgeStatus: 'available',
      }),
      publication_event_id: null,
      normalized_score: null,
      expected_state: null,
      adjudication_severity: null,
    }];
    const baseVerdicts = completeTextVerdicts('decision-image');

    const missingMedia = buildReadinessMetrics(decisions, baseVerdicts, []);
    expect(missingMedia.requiredAvailability).toBeCloseTo(9 / 10);
    expect(missingMedia.decisionReceiptCoverage).toBe(0);

    const complete = buildReadinessMetrics(decisions, [
      ...baseVerdicts,
      {
        decision_id: 'decision-image',
        critic_kind: 'image',
        verdict: 'pass',
        attempt: 0,
        provider: 'vision_critic',
      },
    ], []);
    expect(complete.requiredAvailability).toBe(1);
    expect(complete.decisionReceiptCoverage).toBe(1);
  });

  it('fails closed on unavailable or ambiguous Release Judge telemetry', () => {
    const decision = (judgeStatus?: string): PilotDecisionRow => ({
      id: `decision-${judgeStatus ?? 'legacy'}`,
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'approval',
      release_state: 'hold_amber',
      summary_json: JSON.stringify({
        persistenceState: 'complete',
        pipelineState: 'hold_amber',
        mediaKind: 'none',
        ...(judgeStatus ? { judgeStatus } : {}),
      }),
      publication_event_id: null,
      normalized_score: null,
      expected_state: null,
      adjudication_severity: null,
    });
    const verdicts = (id: string): PilotVerdictRow[] => completeTextVerdicts(id);

    const unavailable = decision('unavailable');
    const unavailableMetrics = buildReadinessMetrics(
      [unavailable],
      verdicts(unavailable.id),
      [],
    );
    expect(unavailableMetrics.releaseJudgeAvailability).toBe(0);
    expect(unavailableMetrics.releaseJudgeTelemetryCoverage).toBe(1);
    expect(unavailableMetrics.decisionReceiptCoverage).toBe(1);

    const ambiguous = decision();
    const ambiguousMetrics = buildReadinessMetrics(
      [ambiguous],
      verdicts(ambiguous.id),
      [],
    );
    expect(ambiguousMetrics.releaseJudgeAvailability).toBe(0);
    expect(ambiguousMetrics.releaseJudgeTelemetryCoverage).toBe(0);
    expect(ambiguousMetrics.decisionReceiptCoverage).toBe(0);
  });

  it('infers legacy judge not-run only when a stored critic verdict proves it', () => {
    const decision: PilotDecisionRow = {
      id: 'decision-legacy-block',
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'approval',
      release_state: 'block_red',
      summary_json: JSON.stringify({
        persistenceState: 'complete',
        pipelineState: 'block_red',
        mediaKind: 'image',
      }),
      publication_event_id: null,
      normalized_score: null,
      expected_state: null,
      adjudication_severity: null,
    };
    const verdicts: PilotVerdictRow[] = [
      ...completeTextVerdicts(decision.id),
      {
        decision_id: decision.id,
        critic_kind: 'image',
        verdict: 'block',
        attempt: 0,
        provider: 'vision_critic',
      },
    ];

    const metrics = buildReadinessMetrics([decision], verdicts, []);
    expect(metrics.releaseJudgeTelemetryCoverage).toBe(1);
    expect(metrics.releaseJudgeInvocations).toBe(0);
    expect(metrics.releaseJudgeAvailability).toBe(0);
    expect(metrics.decisionReceiptCoverage).toBe(1);
  });

  it('treats latest unavailable critics, incomplete receipts, bypasses and missing cost as unsafe', () => {
    const decisions: PilotDecisionRow[] = [{
      id: 'decision-1',
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'approval',
      release_state: 'block_red',
      summary_json: JSON.stringify({ persistenceState: 'writing', predictedOutcomeScore: 80 }),
      publication_event_id: 'publication-1',
      normalized_score: 20,
      expected_state: 'pass_green',
      adjudication_severity: 'release_critical',
    }];
    const verdicts: PilotVerdictRow[] = [
      ...completeTextVerdicts('decision-1'),
      {
        decision_id: 'decision-1',
        critic_kind: 'brand',
        verdict: 'unavailable',
        attempt: 1,
        provider: 'unavailable',
      },
    ];
    const metrics = buildReadinessMetrics(decisions, verdicts, []);
    expect(metrics.requiredAvailability).toBeCloseTo(8 / 9);
    expect(metrics.decisionReceiptCoverage).toBe(0);
    expect(metrics.falseHoldRate).toBe(1);
    expect(metrics.criticalBypasses).toBe(1);
    expect(metrics.costWithinBudget).toBe(false);
  });

  it('collects a strict consecutive pilot window and current evidence from D1', async () => {
    const decisions: PilotDecisionRow[] = Array.from({ length: 30 }, (_, index) => {
      const clientPilot = index >= 15;
      return {
        id: `decision-${index}`,
        user_id: 'owner-1',
        workspace_key: clientPilot ? 'client-1' : '__owner__',
        client_id: clientPilot ? 'client-1' : null,
        owner_kind: clientPilot ? 'client' : 'user',
        owner_id: clientPilot ? 'client-1' : 'owner-1',
        mode: 'approval',
        release_state: 'pass_green',
        summary_json: JSON.stringify({
          persistenceState: 'complete',
          pipelineState: 'pass_green',
          mediaKind: 'none',
          judgeStatus: 'available',
          predictedOutcomeScore: (index % 15) + 1,
        }),
        publication_event_id: `publication-${index}`,
        normalized_score: (index % 15) + 1,
        outcome_source_status: 'complete',
        expected_state: 'pass_green',
        adjudication_severity: 'advisory',
      };
    });
    const verdicts: PilotVerdictRow[] = decisions.flatMap((decision) =>
      completeTextVerdicts(decision.id));
    const evidence: ReleaseEvidenceRow[] = [
      ['replay_red_team', null], ['kill_switch', null], ['publish_regression', null],
      ...(['user', 'client', 'shop'] as const).flatMap((kind) => [
        ['staging_green', kind] as const, ['staging_block', kind] as const,
      ]),
    ].map(([evidenceKind, ownerKind]) => ({
      evidence_kind: evidenceKind,
      owner_kind: ownerKind,
      passed: 1,
      recorded_at: '2026-07-14T00:00:00.000Z',
      expires_at: '2026-07-21T00:00:00.000Z',
    }));
    const { db, calls } = makeRecordingD1({
      'FROM learning_decisions d': decisions,
      'FROM learning_critic_verdicts': verdicts,
      'FROM learning_release_evidence': evidence,
      'FROM workspace_learning_settings': [{ monthly_ai_budget_usd_cents: 1000 }],
      'INNER JOIN learning_decisions usage_decision': [{
        pilot_spend_usd: 0.5,
        pilot_telemetry_count: 30,
        pilot_invalid_telemetry_count: 0,
        metered_decision_count: 15,
      }],
      'FROM ai_usage': [{
        spend_usd: 1,
        telemetry_count: 30,
        invalid_telemetry_count: 0,
      }],
    });

    const snapshot = await collectLearningReadiness(
      db,
      new Date('2026-07-14T01:00:00.000Z'),
    );
    expect(snapshot.ready).toBe(true);
    expect(snapshot.checks.tenancyProofs).toEqual({ user: true, client: true, shop: true });
    const pilotCall = calls.find((call) => call.sql.includes('FROM learning_decisions d'))!;
    expect(pilotCall.sql).toContain('LIMIT 30');
    expect(pilotCall.sql).toContain("d.mode = 'approval'");
    expect(pilotCall.sql).toContain('INNER JOIN learning_pilot_enrollments pen');
    expect(pilotCall.sql).toContain(
      'unixepoch(d.created_at) >= unixepoch(pen.enrolled_at)',
    );
    expect(pilotCall.sql).toContain(
      'unixepoch(pen.consent_confirmed_at) <= unixepoch(d.created_at)',
    );
    expect(pilotCall.sql).not.toContain('AND d.created_at >= pen.enrolled_at');
    expect(pilotCall.sql).not.toContain('AND pen.consent_confirmed_at <= d.created_at');
    expect(pilotCall.sql).toContain("pen.consent_basis = 'customer_attested'");
    expect(pilotCall.sql).not.toContain("w.mode = 'approval'");
    expect(pilotCall.binds).toEqual([AUTOPILOT_POLICY_VERSION]);
    expect(pilotCall.sql).toContain("d.owner_kind IN ('user','client')");
    expect(pilotCall.sql).toContain("COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'");
    expect(pilotCall.sql).toContain(
      'LEFT JOIN learning_decision_disqualifications disq',
    );
    expect(pilotCall.sql).toContain('INNER JOIN learning_pilot_samples sample');
    expect(pilotCall.sql).toContain('sample.content_hash = d.content_hash');
    expect(pilotCall.sql).toContain(
      'unixepoch(sample.attested_at) <= unixepoch(d.created_at)',
    );
    expect(pilotCall.sql).toContain('disq.id IS NULL');
    expect(pilotCall.sql).toContain('a.user_id = d.user_id');
    expect(pilotCall.sql).toContain('pe.owner_id = d.owner_id');
    expect(pilotCall.sql).toContain('lo.source_status AS outcome_source_status');
    const attributedCalls = calls.filter((call) =>
      call.sql.includes('INNER JOIN learning_decisions usage_decision'));
    expect(attributedCalls).toHaveLength(2);
    for (const call of attributedCalls) {
      expect(call.sql).toContain('u.learning_decision_id IN (');
      expect(call.sql).toContain('usage_decision.user_id = u.user_id');
      expect(call.sql).toContain('usage_decision.client_id IS u.client_id');
      expect(call.sql).toContain('usage_decision.post_id = u.post_id');
    }
  });
});

describe('readiness cron receipts', () => {
  const redSnapshot = {
    ready: false,
    metrics: { ...readyMetrics, severeFalsePasses: 1 },
    checks: {
      ...evaluateReadiness({ ...readyMetrics, severeFalsePasses: 1 }).checks,
      replayRedTeam: true,
      publishRegression: true,
      tenancyProofs: { user: true, client: true, shop: true },
    },
  };

  it('persists every evaluation and alerts once when readiness turns green to red', async () => {
    const persist = vi.fn(async () => undefined);
    const quarantine = vi.fn(async () => 2);
    const alert = vi.fn(async () => undefined);
    const env = { DB: {} as D1Database } as Env;
    const result = await cronEvaluateLearningReadiness(env, {
      now: new Date('2026-07-14T01:00:00.000Z'),
      collect: async () => redSnapshot,
      loadPrevious: async () => ({ ready: 1 }),
      quarantine,
      persist,
      alert,
      randomId: () => 'readiness-1',
    });

    expect(result).toMatchObject({
      posts_processed: 30,
      ready: false,
      id: 'readiness-1',
      workspaces_disabled: 2,
    });
    expect(quarantine).toHaveBeenCalledWith(env.DB, '2026-07-14T01:00:00.000Z');
    expect(persist).toHaveBeenCalledOnce();
    expect(quarantine.mock.invocationCallOrder[0]).toBeLessThan(
      persist.mock.invocationCallOrder[0],
    );
    expect(alert).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(
      env,
      'learning_readiness_green_to_red',
      'critical',
      expect.stringMatching(/severeFalsePasses.*workspaces quarantined: 2/),
    );
  });

  it('does not alert without an actual green-to-red transition', async () => {
    const persist = vi.fn(async () => undefined);
    const alert = vi.fn(async () => undefined);
    const scenarios = [
      { previous: null, snapshot: redSnapshot },
      { previous: { ready: 0 }, snapshot: redSnapshot },
      { previous: { ready: 1 }, snapshot: { ...redSnapshot, ready: true } },
    ];
    let sequence = 0;

    for (const scenario of scenarios) {
      await cronEvaluateLearningReadiness({ DB: {} as D1Database } as Env, {
        now: new Date('2026-07-14T01:00:00.000Z'),
        collect: async () => scenario.snapshot,
        loadPrevious: async () => scenario.previous,
        quarantine: async () => 0,
        persist,
        alert,
        randomId: () => `readiness-${++sequence}`,
      });
    }

    expect(persist).toHaveBeenCalledTimes(3);
    expect(alert).not.toHaveBeenCalled();
  });

  it('alerts when a quarantine occurs while readiness is already red', async () => {
    const alert = vi.fn(async () => undefined);

    const result = await cronEvaluateLearningReadiness(
      { DB: {} as D1Database } as Env,
      {
        now: new Date('2026-07-14T01:00:00.000Z'),
        collect: async () => redSnapshot,
        loadPrevious: async () => ({ ready: 0 }),
        quarantine: async () => 1,
        persist: async () => undefined,
        alert,
        randomId: () => 'readiness-quarantine',
      },
    );

    expect(result.workspaces_disabled).toBe(1);
    expect(alert).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(
      expect.anything(),
      'learning_severe_false_pass_quarantine',
      'critical',
      expect.stringMatching(/disabled for 1 workspace.*operator review required/),
    );
  });

  it('writes no replacement receipt when evidence collection fails', async () => {
    const persist = vi.fn(async () => undefined);
    await expect(cronEvaluateLearningReadiness({ DB: {} as D1Database } as Env, {
      collect: async () => { throw new Error('D1 unavailable'); },
      loadPrevious: async () => ({ ready: 1 }),
      persist,
      alert: async () => undefined,
      randomId: () => 'never',
    })).rejects.toThrow('D1 unavailable');
    expect(persist).not.toHaveBeenCalled();
  });

  it('fails closed before persisting readiness when severe false-pass quarantine fails', async () => {
    const persist = vi.fn(async () => undefined);
    await expect(cronEvaluateLearningReadiness({ DB: {} as D1Database } as Env, {
      collect: async () => redSnapshot,
      loadPrevious: async () => ({ ready: 1 }),
      quarantine: async () => { throw new Error('quarantine unavailable'); },
      persist,
      alert: async () => undefined,
      randomId: () => 'never',
    })).rejects.toThrow('quarantine unavailable');
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('severe false-pass quarantine repository', () => {
  const identity = {
    userId: 'owner-1', workspaceKey: 'client-1', clientId: 'client-1',
    ownerKind: 'client' as const, ownerId: 'client-1',
  };

  it('binds a severe false-pass lookup to the complete canonical tenant identity', async () => {
    const { db, calls } = makeRecordingD1({
      'INNER JOIN learning_adjudications a': [{ severe_false_pass: 1 }],
    });

    await expect(hasWorkspaceSevereFalsePass(db, identity)).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('a.workspace_key = d.workspace_key');
    expect(calls[0].sql).toContain('a.client_id IS d.client_id');
    expect(calls[0].sql).toContain("d.stage = 'release'");
    expect(calls[0].binds).toEqual([
      'owner-1', 'client-1', 'client-1', 'client', 'client-1',
    ]);
  });

  it('downgrades only protected workspaces with a tenant-matched severe false pass', async () => {
    const { db, calls } = makeRecordingD1();
    const now = '2026-07-14T01:00:00.000Z';

    await expect(quarantineSevereFalsePassWorkspaces(db, now)).resolves.toBe(0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('run');
    expect(calls[0].sql).toContain("WHERE mode = 'protected_autopilot'");
    expect(calls[0].sql).toContain('d.user_id = workspace_learning_settings.user_id');
    expect(calls[0].sql).toContain('d.client_id IS workspace_learning_settings.client_id');
    expect(calls[0].sql).toContain("d.stage = 'release'");
    expect(calls[0].binds).toEqual([SEVERE_FALSE_PASS_DISABLED_REASON, now]);
  });

  it('returns a sanitized count of newly quarantined workspaces', async () => {
    const statement = {
      bind() { return statement; },
      async run() { return { meta: { changes: 2 } }; },
    };
    const db = {
      prepare() { return statement; },
    } as unknown as D1Database;

    await expect(quarantineSevereFalsePassWorkspaces(
      db,
      '2026-07-14T01:00:00.000Z',
    )).resolves.toBe(2);
  });
});

describe('protected autopilot mode gates', () => {
  const now = new Date('2026-07-14T00:10:00.000Z');

  it('allows protected autopilot only when every gate passes', async () => {
    await expect(loadWorkspaceLearningMode(
      modeEnv({ requested: 'protected_autopilot', consent: true }),
      'u1', 'c1', 'client', 'c1', now,
    )).resolves.toBe('protected_autopilot');
  });

  it('downgrades protected mode when any global switch is disabled', async () => {
    for (const switchPatch of [
      { brain: 'false' },
      { enforcement: 'false' },
      { autopilot: 'false' },
    ]) {
      await expect(loadWorkspaceLearningMode(
        modeEnv({ requested: 'protected_autopilot', consent: true, ...switchPatch }),
        'u1', 'c1', 'client', 'c1', now,
      )).resolves.toBe('approval');
    }
  });

  it('downgrades without current consent, fresh readiness, or an owner-kind proof', async () => {
    const scenarios: ModeOptions[] = [
      { requested: 'protected_autopilot', consent: false },
      { requested: 'protected_autopilot', consent: true, readiness: false },
      {
        requested: 'protected_autopilot', consent: true,
        disabledReason: 'severe_false_pass_pending_operator_review',
      },
      {
        requested: 'protected_autopilot', consent: true,
        severeFalsePass: true,
      },
      {
        requested: 'protected_autopilot', consent: true,
        tenancyProofs: { client: false },
      },
    ];
    for (const scenario of scenarios) {
      await expect(loadWorkspaceLearningMode(
        modeEnv(scenario), 'u1', 'c1', 'client', 'c1', now,
      )).resolves.toBe('approval');
    }
    await expect(loadWorkspaceLearningMode(
      modeEnv({ requested: 'protected_autopilot', consent: true }),
      'u1', 'c1', 'client', 'c1', new Date('2026-07-14T00:21:00.001Z'),
    )).resolves.toBe('approval');
  });

  it('downgrades without positive budget telemetry or when spend reaches the ceiling', async () => {
    const scenarios: ModeOptions[] = [
      { requested: 'protected_autopilot', consent: true, budgetUsdCents: null },
      { requested: 'protected_autopilot', consent: true, budgetUsdCents: 0 },
      { requested: 'protected_autopilot', consent: true, telemetryCount: 0 },
      {
        requested: 'protected_autopilot', consent: true,
        budgetUsdCents: 1000, spendUsdCents: 1000,
      },
    ];
    for (const scenario of scenarios) {
      await expect(loadWorkspaceLearningMode(
        modeEnv(scenario), 'u1', 'c1', 'client', 'c1', now,
      )).resolves.toBe('approval');
    }
  });

  it('promotes active missing, off, or shadow settings to approval after enforcement', async () => {
    for (const requested of [undefined, 'off', 'shadow'] as const) {
      await expect(loadWorkspaceLearningMode(
        modeEnv({ requested }), 'u1', 'c1', 'client', 'c1', now,
      )).resolves.toBe('approval');
    }
  });

  it('keeps invalid and on-hold clients inactive', async () => {
    await expect(loadWorkspaceLearningMode(
      modeEnv({ requested: 'protected_autopilot', consent: true, onHold: true }),
      'u1', 'c1', 'client', 'c1', now,
    )).resolves.toBe('off');
    await expect(loadWorkspaceLearningMode(
      modeEnv({ requested: 'protected_autopilot', consent: true }),
      'u1', 'c1', 'client', 'other-client', now,
    )).resolves.toBe('off');
  });

  it('uses an installed canonical Shopify identity and shop-scoped telemetry', async () => {
    const shop = 'store.myshopify.com';
    await expect(loadWorkspaceLearningMode(
      modeEnv({ requested: 'protected_autopilot', consent: true, shop }),
      shop, null, 'shop', shop, now,
    )).resolves.toBe('protected_autopilot');
  });

  it('does not let routine settings updates clear an operator-review quarantine', async () => {
    const { db, calls } = makeRecordingD1();
    await saveWorkspaceLearningSettings(
      db,
      {
        userId: 'u1', workspaceKey: 'c1', clientId: 'c1',
        ownerKind: 'client', ownerId: 'c1',
      },
      {
        mode: 'approval',
        autopublishConsentAt: null,
        autopublishPolicyVersion: null,
        experimentRate: 0,
        monthlyAiBudgetUsdCents: 1000,
      },
      '2026-07-14T00:10:00.000Z',
    );

    const write = calls.find((call) => call.method === 'run');
    expect(write?.sql).not.toContain('disabled_reason = NULL');
    expect(write?.sql).toContain("AND excluded.mode = 'protected_autopilot' THEN 'approval'");
    expect(write?.sql).toContain('IS NOT NULL THEN 0');
  });
});
