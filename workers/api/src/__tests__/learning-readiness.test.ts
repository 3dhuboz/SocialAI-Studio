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
import { loadWorkspaceLearningMode } from '../lib/learning/workspace-mode';
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
    disabled_reason: null,
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
  adjudicatedDecisions: 30,
  severeFalsePasses: 0,
  falseHoldRate: 0.033,
  requiredAvailability: 0.995,
  decisionReceiptCoverage: 1,
  predictionLift: 0.15,
  rankCorrelation: 0.1,
  criticalBypasses: 0,
  publishingRegressions: 0,
  costWithinBudget: true,
  killSwitchTested: true,
};

describe('learning release readiness', () => {
  it('requires enough adjudicated pilot evidence and every safety threshold', () => {
    expect(evaluateReadiness(readyMetrics).ready).toBe(true);
    for (const patch of [
      { pilotDecisions: 29 },
      { adjudicatedDecisions: 29 },
      { severeFalsePasses: 1 },
      { falseHoldRate: 0.05 },
      { requiredAvailability: 0.994 },
      { decisionReceiptCoverage: 0.999 },
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
    const decisions: PilotDecisionRow[] = Array.from({ length: 30 }, (_, index) => ({
      id: `decision-${index}`,
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'shadow',
      release_state: 'pass_green',
      summary_json: JSON.stringify({
        persistenceState: 'complete',
        predictedOutcomeScore: index + 1,
      }),
      publication_event_id: `publication-${index}`,
      normalized_score: index + 1,
      expected_state: 'pass_green',
      adjudication_severity: 'advisory',
    }));
    const requiredKinds = ['brand', 'fact', 'repetition', 'platform', 'business_harm'] as const;
    const verdicts: PilotVerdictRow[] = decisions.flatMap((decision) =>
      requiredKinds.map((criticKind) => ({
        decision_id: decision.id,
        critic_kind: criticKind,
        verdict: 'pass',
        attempt: 0,
      })));
    const costs: WorkspaceCostTelemetry[] = [{
      userId: 'owner-1',
      workspaceKey: '__owner__',
      budgetUsdCents: 1000,
      spendUsd: 1,
      telemetryCount: 30,
    }];

    const metrics = buildReadinessMetrics(decisions, verdicts, costs);
    expect(metrics).toMatchObject({
      pilotDecisions: 30,
      adjudicatedDecisions: 30,
      severeFalsePasses: 0,
      falseHoldRate: 0,
      requiredAvailability: 1,
      decisionReceiptCoverage: 1,
      rankCorrelation: 1,
      criticalBypasses: 0,
      costWithinBudget: true,
    });
    expect(metrics.predictionLift).toBeGreaterThan(0.15);
    expect(evaluateReadiness({ ...metrics, publishingRegressions: 0, killSwitchTested: true }).ready)
      .toBe(true);
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
      { decision_id: 'decision-1', critic_kind: 'brand', verdict: 'pass', attempt: 0 },
      { decision_id: 'decision-1', critic_kind: 'brand', verdict: 'unavailable', attempt: 1 },
    ];
    const metrics = buildReadinessMetrics(decisions, verdicts, []);
    expect(metrics.requiredAvailability).toBe(0);
    expect(metrics.decisionReceiptCoverage).toBe(0);
    expect(metrics.falseHoldRate).toBe(1);
    expect(metrics.criticalBypasses).toBe(1);
    expect(metrics.costWithinBudget).toBe(false);
  });

  it('collects a strict consecutive pilot window and current evidence from D1', async () => {
    const decisions: PilotDecisionRow[] = Array.from({ length: 30 }, (_, index) => ({
      id: `decision-${index}`,
      user_id: 'owner-1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner-1',
      mode: 'shadow',
      release_state: 'pass_green',
      summary_json: JSON.stringify({
        persistenceState: 'complete', predictedOutcomeScore: index + 1,
      }),
      publication_event_id: `publication-${index}`,
      normalized_score: index + 1,
      expected_state: 'pass_green',
      adjudication_severity: 'advisory',
    }));
    const verdicts: PilotVerdictRow[] = decisions.flatMap((decision) =>
      (['brand', 'fact', 'repetition', 'platform', 'business_harm'] as const).map((criticKind) => ({
        decision_id: decision.id, critic_kind: criticKind, verdict: 'pass', attempt: 0,
      })));
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
      'FROM ai_usage': [{ spend_usd: 1, telemetry_count: 30 }],
    });

    const snapshot = await collectLearningReadiness(
      db,
      new Date('2026-07-14T01:00:00.000Z'),
    );
    expect(snapshot.ready).toBe(true);
    expect(snapshot.checks.tenancyProofs).toEqual({ user: true, client: true, shop: true });
    const pilotCall = calls.find((call) => call.sql.includes('FROM learning_decisions d'))!;
    expect(pilotCall.sql).toContain('LIMIT 30');
    expect(pilotCall.sql).toContain('a.user_id = d.user_id');
    expect(pilotCall.sql).toContain('pe.owner_id = d.owner_id');
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
    const alert = vi.fn(async () => undefined);
    const result = await cronEvaluateLearningReadiness({ DB: {} as D1Database } as Env, {
      now: new Date('2026-07-14T01:00:00.000Z'),
      collect: async () => redSnapshot,
      loadPrevious: async () => ({ ready: 1 }),
      persist,
      alert,
      randomId: () => 'readiness-1',
    });

    expect(result).toMatchObject({ posts_processed: 30, ready: false, id: 'readiness-1' });
    expect(persist).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledOnce();
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
});
