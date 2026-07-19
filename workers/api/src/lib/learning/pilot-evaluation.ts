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

interface PilotEvaluationDeps {
  findFreshReceipt: typeof findFreshReleaseReceipt;
  runPipeline: typeof runAndPersistReleasePipeline;
}

const defaultDeps: PilotEvaluationDeps = {
  findFreshReceipt: findFreshReleaseReceipt,
  runPipeline: runAndPersistReleasePipeline,
};

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
  const row = await db.prepare(`
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
  );
  if (!claimId) {
    const complete = await findCompletePilotReceipt(
      env.DB,
      identity,
      post.id,
      contentHash,
    );
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
  const result = await deps.runPipeline(meteredEnv, post, 'approval');
  if (result.id !== claimId) {
    throw new Error('Pilot pipeline completed under a different decision id');
  }
  assertLearningDecisionUsageScopeComplete(meteredEnv, claimId);
  return {
    status: 'evaluated',
    decisionId: result.id,
    releaseState: result.state,
  };
}
