import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
  claimCalibrationAudit,
  completeCalibrationAudit,
  listCalibrationCandidates,
  markCalibrationUnavailable,
  type CalibrationCandidate,
} from '../lib/learning/calibration-audit';
import { cronEvaluateLearningCalibration } from '../cron/evaluate-learning-calibration';
import type { ReleasePipelineResult } from '../lib/learning/release-pipeline';
import { getWorkspaceMonthlyAiSpend } from '../lib/learning/workspace-mode';
import {
  deleteLearningUserData,
  deleteLearningWorkspaceData,
} from '../lib/learning/deletion';
import { makeRecordingD1 } from './helpers/recording-d1';

const NOW = new Date('2026-07-19T13:00:00.000Z');

function candidate(id: string): CalibrationCandidate {
  return {
    decisionId: `decision-${id}`,
    userId: 'owner-1',
    workspaceKey: `client-${id}`,
    clientId: `client-${id}`,
    ownerKind: 'client',
    ownerId: `client-${id}`,
    mode: 'approval',
    contentHash: id.repeat(64).slice(0, 64),
    monthlyAiBudgetUsdCents: 2500,
    post: {
      id: `post-${id}`,
      user_id: 'owner-1',
      client_id: `client-${id}`,
      owner_kind: 'client',
      owner_id: `client-${id}`,
      content: `Verified post ${id}`,
      platform: 'facebook',
      hashtags: '[]',
      image_url: `https://cdn.example/${id}.jpg`,
      post_type: 'image',
      video_url: null,
      video_status: null,
      video_script: null,
      video_shots: null,
      archetype_slug: 'tech-saas-agency',
    },
  };
}

function pipelineResult(state: ReleasePipelineResult['state']): ReleasePipelineResult {
  return {
    state,
    candidate: {
      userId: 'owner-1', clientId: 'client-a', ownerKind: 'client', ownerId: 'client-a',
      postId: 'post-a', mode: 'approval', content: 'Verified post', platform: 'facebook',
      hashtags: [], media: { kind: 'image', url: 'https://cdn.example/a.jpg', thumbnailUrl: null },
    },
    attempts: [[{
      kind: state === 'block_red' ? 'fact' : 'image',
      verdict: state === 'block_red' ? 'block' : 'pass',
      severity: state === 'block_red' ? 'release_critical' : 'advisory',
      confidence: 1,
      evidence: [],
      repairs: [],
      provider: 'independent',
      model: 'critic',
    }]],
    repairHistory: [],
    judgeStatus: state === 'pass_green' ? 'available' : 'not_run',
  };
}

describe('weekly learning calibration audit', () => {
  it('ships a bounded tenant-scoped calibration ledger separate from human adjudication', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'schema_v47_learning_calibration_audits.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_calibration_audits');
    expect(sql).toContain("audit_status IN ('claimed','completed','unavailable')");
    expect(sql).toContain("source_status IN ('pending','verified','missing','stale','pipeline_unavailable')");
    expect(sql).toContain('UNIQUE(decision_id, policy_version)');
    expect(sql).toContain('FOREIGN KEY (decision_id) REFERENCES learning_decisions(id) ON DELETE CASCADE');
    expect(sql).toContain('user_id TEXT NOT NULL');
    expect(sql).toContain('workspace_key TEXT NOT NULL');
    expect(sql).toContain('owner_kind TEXT NOT NULL');
    expect(sql).toContain('owner_id TEXT NOT NULL');
    expect(sql).toContain("audit_status = 'completed'");
    expect(sql).toContain("source_status = 'verified'");
    expect(sql).toContain("audit_status = 'unavailable'");
    expect(sql).toContain("expected_state = 'block_red' AND severity = 'release_critical'");
  });

  it('selects unchanged green release decisions fairly and excludes unsafe workspaces', async () => {
    const row = candidate('a');
    const { db, calls } = makeRecordingD1({
      'FROM ranked_candidates': [{
        decision_id: row.decisionId,
        user_id: row.userId,
        workspace_key: row.workspaceKey,
        client_id: row.clientId,
        owner_kind: row.ownerKind,
        owner_id: row.ownerId,
        mode: row.mode,
        content_hash: row.contentHash,
        monthly_ai_budget_usd_cents: row.monthlyAiBudgetUsdCents,
        post_id: row.post.id,
        content: row.post.content,
        platform: row.post.platform,
        hashtags: row.post.hashtags,
        image_url: row.post.image_url,
        post_type: row.post.post_type,
        video_url: null,
        video_status: null,
        video_script: null,
        video_shots: null,
        archetype_slug: row.post.archetype_slug,
      }],
    });

    await expect(listCalibrationCandidates(db, NOW.toISOString(), 10)).resolves.toHaveLength(1);

    const read = calls[0];
    expect(read.sql).toContain("d.stage = 'release'");
    expect(read.sql).toContain("d.release_state = 'pass_green'");
    expect(read.sql).toContain('LENGTH(d.content_hash) = 64');
    expect(read.sql).toContain("d.content_hash NOT GLOB '*[^0-9a-f]*'");
    expect(read.sql).toContain("unixepoch(d.created_at) >= unixepoch(?, '-8 days')");
    expect(read.sql).toContain('OR audit.id IS NOT NULL');
    expect(read.sql).toContain(
      "LOWER(TRIM(COALESCE(client.status, 'active'))) = 'active'",
    );
    expect(read.sql).not.toContain('client.on_hold');
    expect(read.sql).toContain('LEFT JOIN users owner');
    expect(read.sql).toContain('ON owner.id = d.user_id');
    expect(read.sql).not.toContain("ON d.owner_kind = 'user'");
    expect(read.sql).toContain('INNER JOIN workspace_learning_settings settings');
    expect(read.sql).toContain("settings.mode IN ('approval','protected_autopilot')");
    expect(read.sql).toContain('settings.monthly_ai_budget_usd_cents');
    expect(read.sql).toContain('s.uninstalled_at IS NULL');
    expect(read.sql).toContain('FROM learning_decision_disqualifications q');
    expect(read.sql).not.toContain('learning_pilot_disqualifications');
    expect(read.sql).toContain("q.reason = 'synthetic_qa'");
    expect(read.sql).toContain('ROW_NUMBER() OVER');
    expect(read.sql).toContain('workspace_rank = 1');
    expect(read.sql).toContain("audit.audit_status IN ('claimed','unavailable')");
    expect(read.sql).toContain('audit.lease_expires_at <= ?');
    expect(read.sql).toContain('p.client_id IS d.client_id');
    expect(read.sql).toContain('p.owner_kind');
    expect(read.binds.at(-1)).toBe(10);
  });

  it('claims and completes only the exact tenant decision', async () => {
    const item = candidate('a');
    const { db, calls } = makeRecordingD1({
      'RETURNING id, attempt_count': [{ id: 'audit-1', attempt_count: 1 }],
    });

    const claim = await claimCalibrationAudit(
      db,
      item,
      NOW.toISOString(),
      '2026-07-19T13:15:00.000Z',
    );
    expect(claim).toEqual({ id: 'audit-1', attempt: 1 });

    await completeCalibrationAudit(db, item, 'audit-1', {
      expectedState: 'pass_green',
      severity: 'advisory',
      judgeStatus: 'available',
      summary: { verdictCount: 1 },
    }, NOW.toISOString());

    const claimCall = calls[0];
    expect(claimCall.sql).toContain('ON CONFLICT(decision_id,policy_version) DO UPDATE SET');
    expect(claimCall.sql).toContain('attempt_count < 2');
    expect(claimCall.sql).toContain('lease_expires_at <= excluded.created_at');
    const complete = calls[1];
    expect(complete.sql).toContain("audit_status = 'completed'");
    expect(complete.sql).toContain('user_id = ?');
    expect(complete.sql).toContain('workspace_key = ?');
    expect(complete.sql).toContain('client_id IS ?');
    expect(complete.sql).toContain('owner_kind = ?');
    expect(complete.sql).toContain('owner_id = ?');
  });

  it('records stale source evidence without calling the independent evaluator', async () => {
    const item = candidate('a');
    const evaluateFresh = vi.fn(async () => pipelineResult('pass_green'));
    const unavailable = vi.fn(async () => undefined);

    const result = await cronEvaluateLearningCalibration({ DB: {} as D1Database } as Env, {
      now: NOW,
      listCandidates: async () => [item],
      claimAudit: async () => ({ id: 'audit-a', attempt: 1 }),
      buildContentHash: async () => 'f'.repeat(64),
      loadSpend: async () => ({ monthlyAiSpendUsdCents: 100, telemetryCount: 1 }),
      evaluateFresh,
      completeAudit: async () => undefined,
      markUnavailable: unavailable,
      quarantine: async () => 0,
      alert: async () => undefined,
    });

    expect(evaluateFresh).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledWith(
      expect.anything(), item, 'audit-a', 'stale', expect.stringContaining('changed'),
      NOW.toISOString(),
    );
    expect(result).toMatchObject({ posts_processed: 0, unavailable: 1, severe_false_passes: 0 });
  });

  it('performs zero claim or critic work without healthy tenant cost telemetry', async () => {
    const item = candidate('a');
    const claimAudit = vi.fn(async () => ({ id: 'never', attempt: 1 }));
    const evaluateFresh = vi.fn(async () => pipelineResult('pass_green'));

    const result = await cronEvaluateLearningCalibration({ DB: {} as D1Database } as Env, {
      now: NOW,
      listCandidates: async () => [item],
      loadSpend: async () => ({ monthlyAiSpendUsdCents: 2451, telemetryCount: 1 }),
      claimAudit,
      buildContentHash: async () => item.contentHash,
      evaluateFresh,
      completeAudit: async () => undefined,
      markUnavailable: async () => undefined,
      quarantine: async () => 0,
      alert: async () => undefined,
    });

    expect(claimAudit).not.toHaveBeenCalled();
    expect(evaluateFresh).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      posts_processed: 0,
      budget_skipped: 1,
      unavailable: 0,
    });
  });

  it('rejects invalid spend telemetry and rounds provider cost upward', async () => {
    const item = candidate('a');
    const invalid = makeRecordingD1({
      'FROM ai_usage': [{ spend_usd: 0.5, telemetry_count: 2, invalid_telemetry_count: 1 }],
    });
    const fractional = makeRecordingD1({
      'FROM ai_usage': [{ spend_usd: 0.000001, telemetry_count: 1, invalid_telemetry_count: 0 }],
    });

    await expect(getWorkspaceMonthlyAiSpend(invalid.db, item, NOW)).resolves.toEqual({
      monthlyAiSpendUsdCents: null,
      telemetryCount: 2,
    });
    await expect(getWorkspaceMonthlyAiSpend(fractional.db, item, NOW)).resolves.toEqual({
      monthlyAiSpendUsdCents: 1,
      telemetryCount: 1,
    });
    expect(invalid.calls[0].sql).toContain('invalid_telemetry_count');
    expect(invalid.calls[0].sql).toContain('unixepoch(ts)');
  });

  it('records independent results and immediately quarantines a severe false pass', async () => {
    const items = [candidate('a'), candidate('b')];
    const complete = vi.fn(async () => undefined);
    const alert = vi.fn(async () => undefined);

    const result = await cronEvaluateLearningCalibration({ DB: {} as D1Database } as Env, {
      now: NOW,
      listCandidates: async () => items,
      claimAudit: async (_db, item) => ({ id: `audit-${item.decisionId}`, attempt: 1 }),
      buildContentHash: async (post) => items.find((item) => item.post.id === post.id)!.contentHash,
      loadSpend: async () => ({ monthlyAiSpendUsdCents: 100, telemetryCount: 1 }),
      evaluateFresh: async (_env, post) => pipelineResult(
        post.id === 'post-b' ? 'block_red' : 'pass_green',
      ),
      completeAudit: complete,
      markUnavailable: async () => undefined,
      quarantine: async () => 1,
      alert,
    });

    expect(result).toMatchObject({
      posts_processed: 2,
      completed: 2,
      severe_false_passes: 1,
      workspaces_disabled: 1,
      errors: 0,
    });
    expect(complete).toHaveBeenCalledWith(
      expect.anything(), items[1], expect.any(String),
      expect.objectContaining({ expectedState: 'block_red', severity: 'release_critical' }),
      NOW.toISOString(),
    );
    expect(alert).toHaveBeenCalledWith(
      expect.anything(),
      'learning_severe_false_pass_quarantine',
      'critical',
      expect.stringContaining('weekly independent calibration'),
    );
  });

  it('treats a repaired recheck as an advisory false pass of the original green decision', async () => {
    const item = candidate('a');
    const repaired = pipelineResult('pass_green');
    repaired.repairHistory = [['Remove the unsupported claim']];
    const complete = vi.fn(async () => undefined);

    const result = await cronEvaluateLearningCalibration({ DB: {} as D1Database } as Env, {
      now: NOW,
      listCandidates: async () => [item],
      claimAudit: async () => ({ id: 'audit-a', attempt: 1 }),
      buildContentHash: async () => item.contentHash,
      loadSpend: async () => ({ monthlyAiSpendUsdCents: 100, telemetryCount: 1 }),
      evaluateFresh: async () => repaired,
      completeAudit: complete,
      markUnavailable: async () => undefined,
      quarantine: async () => 0,
      alert: async () => undefined,
    });

    expect(complete).toHaveBeenCalledWith(
      expect.anything(), item, 'audit-a',
      expect.objectContaining({ expectedState: 'hold_amber', severity: 'advisory' }),
      NOW.toISOString(),
    );
    expect(result).toMatchObject({ completed: 1, severe_false_passes: 0, errors: 0 });
  });

  it('isolates tenant telemetry failures and still quarantines completed false passes', async () => {
    const items = [candidate('a'), candidate('b')];
    const quarantine = vi.fn(async () => 1);

    const result = await cronEvaluateLearningCalibration({ DB: {} as D1Database } as Env, {
      now: NOW,
      listCandidates: async () => items,
      loadSpend: async (_db, item) => {
        if (item.workspaceKey === 'client-a') throw new Error('tenant telemetry unavailable');
        return { monthlyAiSpendUsdCents: 100, telemetryCount: 1 };
      },
      claimAudit: async (_db, item) => ({ id: `audit-${item.decisionId}`, attempt: 1 }),
      buildContentHash: async (post) => items.find((item) => item.post.id === post.id)!.contentHash,
      evaluateFresh: async () => pipelineResult('block_red'),
      completeAudit: async () => undefined,
      markUnavailable: async () => undefined,
      quarantine,
      alert: async () => undefined,
    });

    expect(result).toMatchObject({
      posts_processed: 1,
      completed: 1,
      severe_false_passes: 1,
      workspaces_disabled: 1,
      errors: 1,
    });
    expect(quarantine).toHaveBeenCalledOnce();
  });

  it('records unavailable critic telemetry without treating it as an adjudication', async () => {
    const item = candidate('a');
    const unavailable = vi.fn(async () => undefined);
    const resultWithOutage = pipelineResult('hold_amber');
    resultWithOutage.judgeStatus = 'unavailable';

    const result = await cronEvaluateLearningCalibration({ DB: {} as D1Database } as Env, {
      now: NOW,
      listCandidates: async () => [item],
      claimAudit: async () => ({ id: 'audit-a', attempt: 1 }),
      buildContentHash: async () => item.contentHash,
      loadSpend: async () => ({ monthlyAiSpendUsdCents: 100, telemetryCount: 1 }),
      evaluateFresh: async () => resultWithOutage,
      completeAudit: async () => undefined,
      markUnavailable: unavailable,
      quarantine: async () => 0,
      alert: async () => undefined,
    });

    expect(unavailable).toHaveBeenCalledWith(
      expect.anything(), item, 'audit-a', 'pipeline_unavailable',
      expect.stringContaining('independent critic'), NOW.toISOString(),
    );
    expect(result).toMatchObject({ posts_processed: 0, unavailable: 1, errors: 0 });
  });

  it('does no critic work for an overlapping claim and preserves a genuine advisory hold', async () => {
    const items = [candidate('a'), candidate('b')];
    const evaluateFresh = vi.fn(async (_env: Env, post: { id: string }) =>
      pipelineResult(post.id === 'post-b' ? 'hold_amber' : 'pass_green'));
    const complete = vi.fn(async () => undefined);

    const result = await cronEvaluateLearningCalibration({ DB: {} as D1Database } as Env, {
      now: NOW,
      listCandidates: async () => items,
      claimAudit: async (_db, item) => item.decisionId === 'decision-a'
        ? null
        : { id: 'audit-b', attempt: 1 },
      buildContentHash: async () => items[1].contentHash,
      loadSpend: async () => ({ monthlyAiSpendUsdCents: 100, telemetryCount: 1 }),
      evaluateFresh,
      completeAudit: complete,
      markUnavailable: async () => undefined,
      quarantine: async () => 0,
      alert: async () => undefined,
    });

    expect(evaluateFresh).toHaveBeenCalledOnce();
    expect(evaluateFresh.mock.calls[0][1].id).toBe('post-b');
    expect(complete).toHaveBeenCalledWith(
      expect.anything(), items[1], 'audit-b',
      expect.objectContaining({ expectedState: 'hold_amber', severity: 'advisory' }),
      NOW.toISOString(),
    );
    expect(result).toMatchObject({
      posts_processed: 1,
      completed: 1,
      claimed_elsewhere: 1,
      unavailable: 0,
    });
  });

  it('wires calibration before learning and weekly customer review', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/cron/dispatcher.ts'), 'utf8');
    expect(source).toContain(
      "import { cronEvaluateLearningCalibration } from './evaluate-learning-calibration'",
    );
    const calibration = source.indexOf("trackCron(env, 'learning_calibration'");
    const learning = source.indexOf("trackCron(env, 'learn_strategies'");
    const review = source.indexOf("trackCron(env, 'weekly_review'");
    expect(calibration).toBeGreaterThan(0);
    expect(calibration).toBeLessThan(learning);
    expect(learning).toBeLessThan(review);
  });

  it('reruns fresh preflight without mutating posts, decisions, or human adjudications', () => {
    const preflight = readFileSync(
      resolve(process.cwd(), 'src/lib/learning/release-preflight.ts'),
      'utf8',
    );
    const start = preflight.indexOf('export async function evaluateReleaseCandidateFresh');
    const end = preflight.indexOf('const defaultRunnerDeps', start);
    const freshEvaluation = preflight.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(freshEvaluation).toContain('loadReleaseContext(env, post)');
    expect(freshEvaluation).toContain('executeReleasePipeline(env, buildCandidate(post, mode), context)');
    expect(freshEvaluation).not.toContain('findFreshReleaseReceipt');
    expect(freshEvaluation).not.toContain('createDecisionReceipt');
    expect(freshEvaluation).not.toContain('replaceCriticVerdicts');

    const cron = readFileSync(
      resolve(process.cwd(), 'src/cron/evaluate-learning-calibration.ts'),
      'utf8',
    );
    expect(cron).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM)\s+posts/i);
    expect(cron).not.toContain('learning_adjudications');
    expect(cron).not.toContain('publishPersistedPost');
  });

  it('deletes calibration receipts before parent decisions for every tenant erasure', async () => {
    for (const erase of [
      async (db: D1Database) => deleteLearningWorkspaceData(db, 'owner-1', 'client-a'),
      async (db: D1Database) => deleteLearningUserData(db, 'owner-1'),
    ]) {
      const { db, calls } = makeRecordingD1();
      await erase(db);
      const calibration = calls.findIndex((call) =>
        call.sql.includes('DELETE FROM learning_calibration_audits'));
      const decisions = calls.findIndex((call) =>
        call.sql.includes('DELETE FROM learning_decisions'));
      expect(calibration).toBeGreaterThan(-1);
      expect(calibration).toBeLessThan(decisions);
    }
  });

  it('marks unavailable audit rows through complete tenant identity without persisting raw errors', async () => {
    const item = candidate('a');
    const { db, calls } = makeRecordingD1();

    await markCalibrationUnavailable(
      db,
      item,
      'audit-a',
      'pipeline_unavailable',
      'critic timeout for private.customer@example.com at https://private.example/post-a',
      NOW.toISOString(),
    );

    const write = calls[0];
    expect(write.sql).toContain("audit_status = 'unavailable'");
    expect(write.sql).toContain('user_id = ?');
    expect(write.sql).toContain('workspace_key = ?');
    expect(write.sql).toContain('client_id IS ?');
    expect(write.sql).toContain('owner_kind = ?');
    expect(write.sql).toContain('owner_id = ?');
    expect(write.binds).toContain('2026-07-25T13:00:00.000Z');
    expect(write.binds).toContain('Independent calibration pipeline unavailable');
    expect(write.binds.join(' ')).not.toContain('private.customer@example.com');
    expect(write.binds.join(' ')).not.toContain('private.example');
  });
});
