import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { logAiUsage } from '../lib/ai-usage';
import { cronEvaluateLearningPilot } from '../cron/evaluate-learning-pilot';
import type { CriticContext } from '../lib/learning/critic-context';
import {
  PILOT_EVALUATION_BUDGET_RESERVE_CENTS,
  getRecordOnlyPilotBudgetStatus,
  runClaimedPilotEvaluation,
} from '../lib/learning/pilot-evaluation';
import type { PublishablePost } from '../lib/learning/release-preflight';
import type { WorkspaceIdentity } from '../lib/learning/types';
import { makeRecordingD1 } from './helpers/recording-d1';

const ownerPost: PublishablePost = {
  id: 'draft-owner-1',
  user_id: 'owner-1',
  client_id: null,
  owner_kind: 'user',
  owner_id: 'owner-1',
  content: 'A verified local technology tip.',
  platform: 'facebook',
  hashtags: '["#GladstoneBusiness"]',
  image_url: null,
  post_type: 'text',
  video_url: null,
  video_status: null,
  video_script: null,
  video_shots: null,
  archetype_slug: 'tech-saas-agency',
};

const ownerIdentity: WorkspaceIdentity = {
  userId: 'owner-1',
  clientId: null,
  workspaceKey: '__owner__',
  ownerKind: 'user',
  ownerId: 'owner-1',
};

const readyContext: CriticContext = {
  profile: { productsServices: 'Custom software and workflow automation' },
  verifiedFacts: [],
  recentPosts: [],
  forbiddenSubjects: [],
};

const emptyContext: CriticContext = {
  profile: { name: 'Metadata only', tone: 'Professional' },
  verifiedFacts: [],
  recentPosts: [],
  forbiddenSubjects: [],
};

function ownerCandidate() {
  return {
    ...ownerPost,
    workspace_key: '__owner__',
    consent_basis: 'owner_self',
    consent_confirmed_at: '2026-07-17T00:00:00.000Z',
    consent_note: 'Owner approved the record-only pilot.',
    monthly_ai_budget_usd_cents: 500,
    client_status: null,
  };
}

function clientCandidate() {
  return {
    id: 'draft-client-1',
    user_id: 'owner-1',
    client_id: 'client-1',
    owner_kind: 'client',
    owner_id: 'client-1',
    workspace_key: 'client-1',
    content: 'A verified customer offer.',
    platform: 'instagram',
    hashtags: '["#GladstoneEats"]',
    image_url: 'https://images.example.test/customer.jpg',
    post_type: 'image',
    video_url: null,
    video_status: null,
    video_script: null,
    video_shots: null,
    archetype_slug: 'restaurant',
    consent_basis: 'customer_attested',
    consent_confirmed_at: '2026-07-17T00:00:00.000Z',
    consent_note: 'Customer explicitly approved record-only quality review.',
    monthly_ai_budget_usd_cents: 500,
    client_status: 'active',
  };
}

describe('record-only pilot evaluation lease', () => {
  it('reuses a fresh completed receipt without spending or writing', async () => {
    const { db, calls } = makeRecordingD1();
    const runPipeline = vi.fn();

    const result = await runClaimedPilotEvaluation(
      { DB: db } as Env,
      ownerPost,
      {
        findFreshReceipt: vi.fn(async () => ({
          id: 'decision-existing',
          state: 'pass_green',
        })),
        runPipeline,
      },
    );

    expect(result).toEqual({
      status: 'existing',
      decisionId: 'decision-existing',
      releaseState: 'pass_green',
    });
    expect(runPipeline).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('atomically claims and completes one immutable decision without touching posts', async () => {
    const { db, calls } = makeRecordingD1({
      'INSERT INTO learning_decisions': [{ id: 'decision-claim-1' }],
    });
    const runPipeline = vi.fn(async (scopedEnv: Env) => {
      await logAiUsage(scopedEnv, {
        userId: 'owner-1',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        operation: 'learning_release_judge',
        postId: ownerPost.id,
        estCostUsd: 0.003,
      });
      return {
        id: 'decision-claim-1',
        state: 'hold_amber' as const,
      };
    });

    const result = await runClaimedPilotEvaluation(
      { DB: db, ENVIRONMENT: 'staging' } as Env,
      ownerPost,
      {
        findFreshReceipt: vi.fn(async () => null),
        runPipeline,
      },
      new Date('2026-07-17T01:00:00.000Z'),
    );

    expect(result).toEqual({
      status: 'evaluated',
      decisionId: 'decision-claim-1',
      releaseState: 'hold_amber',
    });
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ DB: db }),
      ownerPost,
      'approval',
    );
    const claim = calls.find((call) => call.sql.includes('INSERT INTO learning_decisions'))!;
    expect(claim.sql).toContain('ON CONFLICT(user_id,workspace_key,post_id,stage,content_hash)');
    expect(claim.sql).toContain("learning_decisions.release_state = 'pending'");
    expect(claim.sql).toContain("$.persistenceState");
    expect(claim.sql).toContain(
      'julianday(learning_decisions.updated_at) < julianday(?)',
    );
    expect(claim.sql).toContain('RETURNING id');
    expect(claim.binds).toEqual(expect.arrayContaining([
      'owner-1',
      '__owner__',
      'draft-owner-1',
      'approval',
      'release',
      'pending',
      '2026-07-17T00:40:00.000Z',
    ]));
    expect(calls.some((call) => /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+posts\b/i.test(call.sql)))
      .toBe(false);
    const usage = calls.find((call) => call.sql.includes('INSERT INTO ai_usage'))!;
    expect(usage.binds.at(-2)).toBe('decision-claim-1');
  });

  it('fails closed if the completed receipt differs from the claimed metering scope', async () => {
    const { db } = makeRecordingD1({
      'INSERT INTO learning_decisions': [{ id: 'decision-claim-1' }],
    });

    await expect(runClaimedPilotEvaluation(
      { DB: db, ENVIRONMENT: 'staging' } as Env,
      ownerPost,
      {
        findFreshReceipt: vi.fn(async () => null),
        runPipeline: vi.fn(async () => ({
          id: 'decision-other',
          state: 'pass_green' as const,
        })),
      },
    )).rejects.toThrow('different decision id');
  });

  it('does not run critics when another worker owns a non-stale claim', async () => {
    const { db, calls } = makeRecordingD1();
    const runPipeline = vi.fn();

    const result = await runClaimedPilotEvaluation(
      { DB: db } as Env,
      ownerPost,
      {
        findFreshReceipt: vi.fn(async () => null),
        runPipeline,
      },
    );

    expect(result).toEqual({
      status: 'busy',
      decisionId: null,
      releaseState: null,
    });
    expect(runPipeline).not.toHaveBeenCalled();
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_decisions'))).toBe(true);
    expect(calls.some((call) => /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+posts\b/i.test(call.sql)))
      .toBe(false);
  });
});

describe('record-only pilot budget', () => {
  it('treats an empty but valid monthly ledger as zero spend', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM ai_usage': [{ spend_usd: 0, telemetry_count: 0 }],
    });

    const result = await getRecordOnlyPilotBudgetStatus(
      db,
      ownerIdentity,
      500,
      new Date('2026-07-17T01:00:00.000Z'),
    );

    expect(result).toEqual({
      allowed: true,
      monthlyAiSpendUsdCents: 0,
      monthlyAiBudgetUsdCents: 500,
      telemetryCount: 0,
      remainingUsdCents: 500,
      reason: null,
    });
    const usage = calls.find((call) => call.sql.includes('FROM ai_usage'))!;
    expect(usage.sql).toContain('unixepoch(ts) >= unixepoch(?)');
    expect(usage.sql).toContain('unixepoch(ts) < unixepoch(?)');
  });

  it('fails closed when the conservative evaluation reserve is unavailable', async () => {
    const { db } = makeRecordingD1({
      'FROM ai_usage': [{ spend_usd: 4.51, telemetry_count: 30 }],
    });

    const result = await getRecordOnlyPilotBudgetStatus(
      db,
      ownerIdentity,
      500,
      new Date('2026-07-17T01:00:00.000Z'),
    );

    expect(PILOT_EVALUATION_BUDGET_RESERVE_CENTS).toBe(50);
    expect(result).toMatchObject({
      allowed: false,
      monthlyAiSpendUsdCents: 451,
      remainingUsdCents: 49,
      reason: 'insufficient_reserve',
    });
  });
});

describe('record-only pilot collector', () => {
  it('does not query D1 unless every dormant-pilot switch is safe', async () => {
    const { db, calls } = makeRecordingD1();

    await expect(cronEvaluateLearningPilot({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'true',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env)).resolves.toMatchObject({ posts_processed: 0 });

    expect(calls).toEqual([]);
  });

  it('evaluates at most one draft from each of two consented workspaces', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM learning_pilot_enrollments pen': [ownerCandidate(), clientCandidate()],
      'FROM ai_usage': [{ spend_usd: 0, telemetry_count: 0 }],
    });
    const runEvaluation = vi.fn(async () => ({
      status: 'evaluated' as const,
      decisionId: crypto.randomUUID(),
      releaseState: 'pass_green' as const,
    }));
    const loadContext = vi.fn(async () => readyContext);

    const result = await cronEvaluateLearningPilot({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env, { loadContext, runEvaluation });

    expect(result).toEqual({
      posts_processed: 2,
      candidates_considered: 2,
      evaluated: 2,
      reused: 0,
      claimed_elsewhere: 0,
      budget_skipped: 0,
      context_not_ready: 0,
      invalid_skipped: 0,
      errors: 0,
    });
    expect(loadContext).toHaveBeenCalledTimes(2);
    expect(runEvaluation).toHaveBeenCalledTimes(2);
    const candidateQuery = calls.find((call) =>
      call.sql.includes('FROM learning_pilot_enrollments pen'))!;
    expect(candidateQuery.sql).toContain('ROW_NUMBER() OVER');
    expect(candidateQuery.sql).toContain('pen.record_only = 1');
    expect(candidateQuery.sql).toContain("pen.consent_basis = 'owner_self'");
    expect(candidateQuery.sql).toContain("pen.consent_basis = 'customer_attested'");
    expect(candidateQuery.sql).toContain("w.mode = 'approval'");
    expect(candidateQuery.sql).toContain("LOWER(TRIM(COALESCE(c.status, 'active'))) != 'on_hold'");
    expect(candidateQuery.sql).toContain('PARTITION BY owner_kind');
    expect(candidateQuery.sql).toMatch(/owner_kind_rank\s+<=\s+5/i);
    expect(candidateQuery.sql).toMatch(/LIMIT\s+10/i);
    expect(calls.some((call) => /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+posts\b/i.test(call.sql)))
      .toBe(false);
  });

  it('skips empty context before budget checks without starving later ready workspaces', async () => {
    const secondOwner = {
      ...ownerCandidate(),
      id: 'draft-owner-2',
      user_id: 'owner-2',
      owner_id: 'owner-2',
      content: 'A second owner draft with real business context.',
    };
    const { db, calls } = makeRecordingD1();
    const loadContext = vi.fn(async (_env: Env, identity: WorkspaceIdentity) =>
      identity.ownerKind === 'user' && identity.userId === 'owner-1'
        ? emptyContext
        : readyContext);
    const getBudgetStatus = vi.fn(async () => ({
      allowed: true as const,
      monthlyAiSpendUsdCents: 0,
      monthlyAiBudgetUsdCents: 500,
      telemetryCount: 0,
      remainingUsdCents: 500,
      reason: null,
    }));
    const runEvaluation = vi.fn(async () => ({
      status: 'evaluated' as const,
      decisionId: crypto.randomUUID(),
      releaseState: 'pass_green' as const,
    }));

    const result = await cronEvaluateLearningPilot({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env, {
      loadCandidates: vi.fn(async () => [
        ownerCandidate(),
        secondOwner,
        clientCandidate(),
      ]),
      loadContext,
      getBudgetStatus,
      runEvaluation,
    });

    expect(result).toEqual({
      posts_processed: 2,
      candidates_considered: 3,
      evaluated: 2,
      reused: 0,
      claimed_elsewhere: 0,
      budget_skipped: 0,
      context_not_ready: 1,
      invalid_skipped: 0,
      errors: 0,
    });
    expect(loadContext).toHaveBeenCalledTimes(3);
    expect(getBudgetStatus).toHaveBeenCalledTimes(2);
    expect(runEvaluation).toHaveBeenCalledTimes(2);
    expect(runEvaluation).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'draft-owner-1' }),
    );
    expect(calls).toEqual([]);
  });

  it('does not let an exhausted workspace budget starve a later ready workspace', async () => {
    const secondOwner = {
      ...ownerCandidate(),
      id: 'draft-owner-budget-ready',
      user_id: 'owner-budget-ready',
      owner_id: 'owner-budget-ready',
    };
    const { db, calls } = makeRecordingD1();
    const getBudgetStatus = vi.fn(
      async (_db: D1Database, identity: WorkspaceIdentity) =>
        identity.userId === 'owner-1'
          ? {
              allowed: false as const,
              monthlyAiSpendUsdCents: 451,
              monthlyAiBudgetUsdCents: 500,
              telemetryCount: 30,
              remainingUsdCents: 49,
              reason: 'insufficient_reserve' as const,
            }
          : {
              allowed: true as const,
              monthlyAiSpendUsdCents: 0,
              monthlyAiBudgetUsdCents: 500,
              telemetryCount: 0,
              remainingUsdCents: 500,
              reason: null,
            },
    );
    const runEvaluation = vi.fn(async () => ({
      status: 'evaluated' as const,
      decisionId: 'decision-budget-ready',
      releaseState: 'pass_green' as const,
    }));

    const result = await cronEvaluateLearningPilot({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env, {
      loadCandidates: vi.fn(async () => [ownerCandidate(), secondOwner]),
      loadContext: vi.fn(async () => readyContext),
      getBudgetStatus,
      runEvaluation,
    });

    expect(result).toMatchObject({
      posts_processed: 1,
      candidates_considered: 2,
      evaluated: 1,
      budget_skipped: 1,
      context_not_ready: 0,
      errors: 0,
    });
    expect(getBudgetStatus).toHaveBeenCalledTimes(2);
    expect(runEvaluation).toHaveBeenCalledTimes(1);
    expect(runEvaluation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'draft-owner-budget-ready' }),
    );
    expect(calls).toEqual([]);
  });

  it('skips a held client defensively even if a malformed query adapter returns it', async () => {
    const held = { ...clientCandidate(), client_status: 'on_hold' };
    const { db, calls } = makeRecordingD1({
      'FROM learning_pilot_enrollments pen': [held],
    });
    const runEvaluation = vi.fn();

    const result = await cronEvaluateLearningPilot({
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env, { runEvaluation });

    expect(result).toMatchObject({
      posts_processed: 0,
      invalid_skipped: 1,
      errors: 0,
    });
    expect(runEvaluation).not.toHaveBeenCalled();
    expect(calls.some((call) => call.sql.includes('FROM ai_usage'))).toBe(false);
  });
});
