function requireScope(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Learning deletion requires ${label}`);
  return normalized;
}

export async function deleteLearningWorkspaceData(
  db: D1Database,
  userId: string,
  workspaceKey: string,
): Promise<void> {
  const scopedUserId = requireScope(userId, 'userId');
  const scopedWorkspaceKey = requireScope(workspaceKey, 'workspaceKey');

  await db.prepare(`
    DELETE FROM learning_critic_verdicts
    WHERE decision_id IN (
      SELECT id FROM learning_decisions
      WHERE user_id = ? AND workspace_key = ?
    )
  `).bind(scopedUserId, scopedWorkspaceKey).run();
  await db.prepare(`
    DELETE FROM learning_decisions
    WHERE user_id = ? AND workspace_key = ?
  `).bind(scopedUserId, scopedWorkspaceKey).run();
  await db.prepare(`
    DELETE FROM workspace_learning_settings
    WHERE user_id = ? AND workspace_key = ?
  `).bind(scopedUserId, scopedWorkspaceKey).run();
}

export async function deleteLearningUserData(
  db: D1Database,
  userId: string,
): Promise<void> {
  const scopedUserId = requireScope(userId, 'userId');

  await db.prepare(`
    DELETE FROM learning_critic_verdicts
    WHERE decision_id IN (
      SELECT id FROM learning_decisions WHERE user_id = ?
    )
  `).bind(scopedUserId).run();
  await db.prepare(
    'DELETE FROM learning_decisions WHERE user_id = ?',
  ).bind(scopedUserId).run();
  await db.prepare(
    'DELETE FROM workspace_learning_settings WHERE user_id = ?',
  ).bind(scopedUserId).run();
}
