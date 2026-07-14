const REACH_TABLES_IN_DELETE_ORDER = [
  'reach_plans',
  'approved_media_assets',
  'audience_segments',
  'reach_profiles',
] as const;

export async function deleteReachWorkspaceData(
  db: D1Database,
  userId: string,
  workspaceKey: string,
): Promise<void> {
  for (const table of REACH_TABLES_IN_DELETE_ORDER) {
    await db.prepare(
      `DELETE FROM ${table} WHERE user_id = ? AND workspace_key = ?`,
    ).bind(userId, workspaceKey).run();
  }
}

export async function deleteReachUserData(
  db: D1Database,
  userId: string,
): Promise<void> {
  for (const table of REACH_TABLES_IN_DELETE_ORDER) {
    await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`)
      .bind(userId).run();
  }
}
