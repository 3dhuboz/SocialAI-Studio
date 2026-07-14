import type { WorkspaceIdentity } from './types';

export type LearningEvidenceKind = 'association' | 'experiment';

export interface LearningProfileView {
  version: number;
  approved: boolean;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface LearningSignalView {
  variableKey: string;
  variableValue: string;
  objective: string;
  sampleCount: number;
  effect: number;
  confidence: number;
  freshnessAt: string;
  status: string;
  evidenceKind: LearningEvidenceKind;
}

export interface LearningOutcomeView {
  id: string;
  postId: string;
  platform: string;
  postType: string | null;
  content: string | null;
  windowHours: number;
  rawSignals: Record<string, unknown>;
  normalizedScore: number | null;
  completeness: string;
  sourceStatus: string;
  publishedAt: string;
  measuredAt: string;
}

export interface WorkspaceLearningSummary {
  profile: LearningProfileView | null;
  signals: LearningSignalView[];
  outcomes: LearningOutcomeView[];
}

type ProfileRow = {
  version: number | string;
  profile_json: string;
  approved: number;
  created_at: string;
};

type SignalRow = {
  variable_key: string;
  variable_value: string;
  objective: string;
  sample_count: number | string;
  effect: number | string;
  confidence: number | string;
  freshness_at: string;
  status: string;
  experiment_isolated: number;
};

type OutcomeRow = {
  id: string;
  post_id: string;
  platform: string;
  post_type: string | null;
  content: string | null;
  window_hours: number | string;
  raw_signals_json: string;
  normalized_score: number | string | null;
  completeness: string;
  source_status: string;
  published_at: string;
  measured_at: string;
};

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getWorkspaceLearningSummary(
  db: D1Database,
  identity: WorkspaceIdentity,
): Promise<WorkspaceLearningSummary> {
  const [profileRow, signalRows, outcomeRows] = await Promise.all([
    db.prepare(`
      SELECT version, profile_json, approved, created_at
        FROM learning_profiles
       WHERE user_id = ? AND workspace_key = ? AND client_id IS ?
         AND owner_kind = ? AND owner_id = ?
       ORDER BY version DESC, created_at DESC
       LIMIT 1
    `).bind(
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
    ).first<ProfileRow>(),
    db.prepare(`
      SELECT ls.variable_key, ls.variable_value, ls.objective,
             ls.sample_count, ls.effect, ls.confidence, ls.freshness_at,
             ls.status,
             CASE WHEN EXISTS (
               SELECT 1
                 FROM learning_experiments e
                WHERE e.user_id = ls.user_id
                  AND e.workspace_key = ls.workspace_key
                  AND e.owner_kind = ls.owner_kind
                  AND e.owner_id = ls.owner_id
                  AND e.variable_key = ls.variable_key
                  AND e.status IN ('won','lost')
                  AND (e.control_value = ls.variable_value OR e.test_value = ls.variable_value)
             ) THEN 1 ELSE 0 END AS experiment_isolated
        FROM learning_signals ls
       WHERE ls.user_id = ? AND ls.workspace_key = ? AND ls.client_id IS ?
         AND ls.owner_kind = ? AND ls.owner_id = ?
         AND ls.status != 'rejected'
       ORDER BY ls.confidence DESC, ABS(ls.effect) DESC,
                ls.variable_key ASC, ls.variable_value ASC
       LIMIT ?
    `).bind(
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      100,
    ).all<SignalRow>(),
    db.prepare(`
      SELECT lo.id, pe.post_id, pe.platform, p.post_type, p.content,
             lo.window_hours, lo.raw_signals_json, lo.normalized_score,
             lo.completeness, lo.source_status, pe.published_at, lo.measured_at
        FROM learning_outcomes lo
        JOIN publication_events pe ON pe.id = lo.publication_event_id
        LEFT JOIN posts p ON p.id = pe.post_id
         AND p.user_id = pe.user_id
         AND p.client_id IS pe.client_id
         AND p.owner_kind = pe.owner_kind
         AND p.owner_id = pe.owner_id
       WHERE pe.user_id = ? AND pe.workspace_key = ? AND pe.client_id IS ?
         AND pe.owner_kind = ? AND pe.owner_id = ?
       ORDER BY lo.measured_at DESC, lo.window_hours DESC, lo.id DESC
       LIMIT ?
    `).bind(
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      20,
    ).all<OutcomeRow>(),
  ]);

  const profile = profileRow ? {
    version: finiteNumber(profileRow.version),
    approved: profileRow.approved === 1,
    createdAt: profileRow.created_at,
    data: parseObject(profileRow.profile_json),
  } : null;
  const signals = (signalRows.results ?? []).map((row): LearningSignalView => ({
    variableKey: row.variable_key,
    variableValue: row.variable_value,
    objective: row.objective,
    sampleCount: finiteNumber(row.sample_count),
    effect: finiteNumber(row.effect),
    confidence: finiteNumber(row.confidence),
    freshnessAt: row.freshness_at,
    status: row.status,
    evidenceKind: row.experiment_isolated === 1 ? 'experiment' : 'association',
  }));
  const outcomes = (outcomeRows.results ?? []).map((row): LearningOutcomeView => ({
    id: row.id,
    postId: row.post_id,
    platform: row.platform,
    postType: row.post_type,
    content: row.content,
    windowHours: finiteNumber(row.window_hours),
    rawSignals: parseObject(row.raw_signals_json),
    normalizedScore: row.normalized_score == null
      ? null : finiteNumber(row.normalized_score),
    completeness: row.completeness,
    sourceStatus: row.source_status,
    publishedAt: row.published_at,
    measuredAt: row.measured_at,
  }));
  return { profile, signals, outcomes };
}
