import { normalizeWorkspaceIdentity } from './types';
import type { CriticResult } from './critic-types';
import type {
  DecisionReceiptInput,
  LearningMode,
  ReleaseState,
  WorkspaceOwnerKind,
} from './types';

export interface FreshReleaseReceipt {
  id: string;
  state: Extract<ReleaseState, 'pass_green' | 'hold_amber' | 'block_red'>;
}

export async function createDecisionReceipt(
  db: D1Database,
  input: DecisionReceiptInput,
): Promise<string> {
  const ownerKind = input.ownerKind ?? (input.clientId === null ? 'user' : 'client');
  const ownerId = input.ownerId ?? input.clientId ?? input.userId;
  const identity = normalizeWorkspaceIdentity(
    input.userId,
    input.clientId,
    ownerKind,
    ownerId,
  );
  const id = crypto.randomUUID();
  const row = await db.prepare(`
    INSERT INTO learning_decisions (
      id, user_id, workspace_key, client_id, owner_kind, owner_id, post_id,
      mode, stage, release_state, content_hash, strategy_version,
      reach_plan_id, summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id,workspace_key,post_id,stage,content_hash) DO UPDATE SET
      mode = excluded.mode,
      release_state = excluded.release_state,
      strategy_version = excluded.strategy_version,
      reach_plan_id = excluded.reach_plan_id,
      summary_json = excluded.summary_json,
      updated_at = datetime('now')
    RETURNING id
  `).bind(
    id,
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    input.postId,
    input.mode,
    input.stage,
    input.releaseState,
    input.contentHash,
    input.strategyVersion ?? null,
    input.reachPlanId ?? null,
    JSON.stringify(input.summary),
  ).first<{ id: string }>();

  if (!row?.id) {
    throw new Error('Learning decision receipt was not persisted');
  }
  return row.id;
}

export async function listDecisionReceipts(
  db: D1Database,
  userId: string,
  clientId: string | null,
  postId: string,
  limit: number,
  ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client',
  ownerId: string = clientId ?? userId,
): Promise<unknown[]> {
  const identity = normalizeWorkspaceIdentity(
    userId,
    clientId,
    ownerKind,
    ownerId,
  );
  const result = await db.prepare(`
    SELECT * FROM learning_decisions
    WHERE user_id = ?
      AND workspace_key = ?
      AND client_id IS ?
      AND owner_kind = ?
      AND owner_id = ?
      AND post_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    postId,
    limit,
  ).all();

  return result.results ?? [];
}

export async function findFreshReleaseReceipt(
  db: D1Database,
  userId: string,
  clientId: string | null,
  ownerKind: WorkspaceOwnerKind,
  ownerId: string,
  postId: string,
  contentHash: string,
  mode: LearningMode,
): Promise<FreshReleaseReceipt | null> {
  const identity = normalizeWorkspaceIdentity(
    userId,
    clientId,
    ownerKind,
    ownerId,
  );
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
       AND d.mode = ?
       AND d.stage = 'release'
       AND d.release_state IN ('pass_green','hold_amber','block_red')
       AND d.updated_at >= datetime('now', '-24 hours')
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
    mode,
  ).first<{ id: string; release_state: ReleaseState }>();

  if (!row || !['pass_green', 'hold_amber', 'block_red'].includes(row.release_state)) {
    return null;
  }
  return {
    id: row.id,
    state: row.release_state as FreshReleaseReceipt['state'],
  };
}

export async function replaceCriticVerdicts(
  db: D1Database,
  decisionId: string,
  attempts: CriticResult[][],
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM learning_critic_verdicts WHERE decision_id = ?')
      .bind(decisionId),
  ];

  attempts.forEach((results, attempt) => {
    results.forEach((result) => {
      statements.push(db.prepare(`
        INSERT INTO learning_critic_verdicts (
          id, decision_id, critic_kind, verdict, severity, confidence,
          evidence_json, repair_json, provider, model, attempt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        decisionId,
        result.kind,
        result.verdict,
        result.severity,
        result.confidence,
        JSON.stringify(result.evidence),
        JSON.stringify(result.repairs),
        result.provider,
        result.model,
        attempt,
      ));
    });
  });

  await db.batch(statements);
}
