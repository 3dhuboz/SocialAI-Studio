function requireScope(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Learning deletion requires ${label}`);
  return normalized;
}

type ArchetypeRow = { archetype_slug: string | null };

function canonicalArchetypes(rows: ArchetypeRow[]): string[] {
  return [...new Set(rows.map((row) => row.archetype_slug?.trim() || '')
    .filter(Boolean))].sort();
}

async function invalidateArchetypes(
  db: D1Database,
  archetypes: string[],
): Promise<void> {
  for (const archetype of archetypes) {
    await db.prepare(`
      DELETE FROM archetype_aggregates
      WHERE archetype_slug = ?
    `).bind(archetype).run();
  }
}

async function workspaceArchetypes(
  db: D1Database,
  userId: string,
  workspaceKey: string,
): Promise<string[]> {
  if (workspaceKey === '__owner__' || workspaceKey.startsWith('shop:')) {
    const row = await db.prepare(`
      SELECT archetype_slug FROM users WHERE id = ?
    `).bind(userId).first<ArchetypeRow>();
    return canonicalArchetypes(row ? [row] : []);
  }
  const row = await db.prepare(`
    SELECT COALESCE(c.archetype_slug, u.archetype_slug) AS archetype_slug
    FROM clients c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.id = ? AND c.user_id = ?
    LIMIT 1
  `).bind(workspaceKey, userId).first<ArchetypeRow>();
  return canonicalArchetypes(row ? [row] : []);
}

async function userArchetypes(db: D1Database, userId: string): Promise<string[]> {
  const rows = await db.prepare(`
    SELECT DISTINCT archetype_slug
    FROM (
      SELECT archetype_slug FROM users WHERE id = ?
      UNION ALL
      SELECT COALESCE(c.archetype_slug, u.archetype_slug) AS archetype_slug
      FROM clients c
      JOIN users u ON u.id = c.user_id
      WHERE c.user_id = ?
    )
    WHERE archetype_slug IS NOT NULL AND TRIM(archetype_slug) != ''
  `).bind(userId, userId).all<ArchetypeRow>();
  return canonicalArchetypes(rows.results ?? []);
}

async function deleteOutcomeWorkspaceData(
  db: D1Database,
  userId: string,
  workspaceKey: string,
): Promise<void> {
  await db.prepare(`
    DELETE FROM learning_outcomes
    WHERE publication_event_id IN (
      SELECT id FROM publication_events
      WHERE user_id = ? AND workspace_key = ?
    )
  `).bind(userId, workspaceKey).run();
  await db.prepare(`
    DELETE FROM learning_outcome_attempts
    WHERE publication_event_id IN (
      SELECT id FROM publication_events
      WHERE user_id = ? AND workspace_key = ?
    )
  `).bind(userId, workspaceKey).run();
  for (const table of [
    'publication_events',
    'platform_metric_snapshots',
    'conversion_feedback',
    'tracking_links',
    'learning_experiments',
    'learning_profiles',
    'learning_signals',
    'learning_pilot_samples',
    'learning_decision_disqualifications',
    'learning_calibration_audits',
    'learning_adjudications',
    'learning_pilot_enrollments',
  ]) {
    await db.prepare(`
      DELETE FROM ${table}
      WHERE user_id = ? AND workspace_key = ?
    `).bind(userId, workspaceKey).run();
  }
}

async function deleteOutcomeUserData(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db.prepare(`
    DELETE FROM learning_outcomes
    WHERE publication_event_id IN (
      SELECT id FROM publication_events WHERE user_id = ?
    )
  `).bind(userId).run();
  await db.prepare(`
    DELETE FROM learning_outcome_attempts
    WHERE publication_event_id IN (
      SELECT id FROM publication_events WHERE user_id = ?
    )
  `).bind(userId).run();
  for (const table of [
    'publication_events',
    'platform_metric_snapshots',
    'conversion_feedback',
    'tracking_links',
    'learning_experiments',
    'learning_profiles',
    'learning_signals',
    'learning_pilot_samples',
    'learning_decision_disqualifications',
    'learning_calibration_audits',
    'learning_adjudications',
    'learning_pilot_enrollments',
  ]) {
    await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`)
      .bind(userId).run();
  }
}

export async function deleteLearningWorkspaceData(
  db: D1Database,
  userId: string,
  workspaceKey: string,
): Promise<void> {
  const scopedUserId = requireScope(userId, 'userId');
  const scopedWorkspaceKey = requireScope(workspaceKey, 'workspaceKey');

  await invalidateArchetypes(
    db,
    await workspaceArchetypes(db, scopedUserId, scopedWorkspaceKey),
  );
  await deleteOutcomeWorkspaceData(db, scopedUserId, scopedWorkspaceKey);
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

  await invalidateArchetypes(db, await userArchetypes(db, scopedUserId));
  await deleteOutcomeUserData(db, scopedUserId);
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
