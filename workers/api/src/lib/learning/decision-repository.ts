import { normalizeWorkspaceIdentity } from './types';
import type { DecisionReceiptInput, WorkspaceOwnerKind } from './types';

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
    WHERE user_id = ? AND workspace_key = ? AND post_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(
    identity.userId,
    identity.workspaceKey,
    postId,
    limit,
  ).all();

  return result.results ?? [];
}
