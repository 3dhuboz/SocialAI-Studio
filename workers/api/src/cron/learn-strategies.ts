import type { Env } from '../env';
import {
  nextSignal,
  type LearningSignal,
  type LearningSignalStatus,
} from '../lib/learning/strategy-learning';
import {
  normalizeWorkspaceIdentity,
  type WorkspaceIdentity,
  type WorkspaceOwnerKind,
} from '../lib/learning/types';
import { localWeekdayHour } from '../lib/reach/timing-model';

type CandidateOutcomeRow = {
  outcome_id: string;
  publication_event_id: string;
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: string;
  owner_id: string;
  post_id: string;
  platform: string;
  post_type: string | null;
  objective: string | null;
  timezone: string | null;
  normalized_score: number | string | null;
  completeness: string;
  source_status: string;
  published_at: string;
  measured_at: string;
};

type PersistedSignalRow = {
  id: string;
  variable_key: string;
  variable_value: string;
  objective: string;
  sample_count: number | string;
  effect: number | string;
  confidence: number | string;
  freshness_at: string;
  status: string;
  supporting_outcomes_json: string;
};

type ProfileSignalRow = Omit<PersistedSignalRow, 'id' | 'supporting_outcomes_json'>;

interface DerivedVariable {
  variableKey: string;
  variableValue: string;
}

export interface LearnStrategiesOptions {
  now?: string;
  limit?: number;
  randomId?: () => string;
}

export interface LearnStrategiesResult {
  posts_processed: number;
  outcomes_processed: number;
  signals_updated: number;
  profiles_created: number;
  skipped: number;
}

const VALID_SIGNAL_STATUSES = new Set<LearningSignalStatus>([
  'tentative',
  'usable',
  'proven',
  'rejected',
  'operator_locked',
]);

function boundedLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 200;
  return Math.max(1, Math.min(500, Math.floor(value)));
}

function ownerKind(value: string): WorkspaceOwnerKind {
  if (value === 'user' || value === 'client' || value === 'shop') return value;
  throw new Error(`Invalid learning owner kind: ${value}`);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function safeStatus(value: string): LearningSignalStatus | null {
  return VALID_SIGNAL_STATUSES.has(value as LearningSignalStatus)
    ? value as LearningSignalStatus
    : null;
}

function parseSupportingOutcomes(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string =>
      typeof item === 'string' && Boolean(item.trim())))]
      .slice(-499);
  } catch {
    return [];
  }
}

function canonicalCandidate(row: CandidateOutcomeRow): {
  identity: WorkspaceIdentity;
  score: number;
  objective: string;
} {
  const identity = normalizeWorkspaceIdentity(
    row.user_id,
    row.client_id,
    ownerKind(row.owner_kind),
    row.owner_id,
  );
  if (identity.workspaceKey !== row.workspace_key) {
    throw new Error(`Outcome ${row.outcome_id} has a non-canonical workspace key`);
  }
  const score = finiteNumber(row.normalized_score);
  if (score === null || score < 0 || score > 100) {
    throw new Error(`Outcome ${row.outcome_id} has an invalid normalized score`);
  }
  if (!Number.isFinite(Date.parse(row.published_at))
    || !Number.isFinite(Date.parse(row.measured_at))) {
    throw new Error(`Outcome ${row.outcome_id} has an invalid timestamp`);
  }
  const objective = row.objective?.trim()
    || (row.completeness === 'conversion' ? 'conversion'
      : row.completeness === 'action' ? 'tracked_action'
        : 'meaningful_engagement');
  return { identity, score, objective };
}

function deriveVariables(row: CandidateOutcomeRow): DerivedVariable[] {
  const format = String(row.post_type || 'text').trim().toLowerCase();
  const variables: DerivedVariable[] = [
    { variableKey: 'media_format', variableValue: format || 'text' },
  ];
  if (row.timezone?.trim()) {
    const local = localWeekdayHour(row.published_at, row.timezone);
    variables.unshift(
      { variableKey: 'posting_hour', variableValue: String(local.hour) },
      { variableKey: 'weekday', variableValue: String(local.weekday) },
    );
  }
  return variables;
}

function toLearningSignal(
  row: PersistedSignalRow,
): (LearningSignal & { id: string; supportingOutcomeIds: string[] }) | null {
  const status = safeStatus(row.status);
  const sampleCount = finiteNumber(row.sample_count);
  const effect = finiteNumber(row.effect);
  const confidence = finiteNumber(row.confidence);
  if (!status
    || sampleCount === null
    || !Number.isSafeInteger(sampleCount)
    || effect === null
    || confidence === null) {
    return null;
  }
  return {
    id: row.id,
    variableKey: row.variable_key,
    variableValue: row.variable_value,
    objective: row.objective,
    sampleCount,
    effect,
    confidence,
    freshnessAt: row.freshness_at,
    status,
    supportingOutcomeIds: parseSupportingOutcomes(row.supporting_outcomes_json),
  };
}

async function listCandidateOutcomes(
  db: D1Database,
  limit: number,
): Promise<CandidateOutcomeRow[]> {
  const rows = await db.prepare(`
    SELECT
      lo.id AS outcome_id, lo.publication_event_id, lo.normalized_score,
      lo.completeness, lo.source_status, lo.measured_at,
      pe.user_id, pe.workspace_key, pe.client_id, pe.owner_kind, pe.owner_id,
      pe.post_id, pe.platform, pe.published_at,
      p.post_type,
      COALESCE(NULLIF(rp.objective, ''), '') AS objective,
      rpf.timezone
    FROM learning_outcomes lo
    JOIN publication_events pe ON pe.id = lo.publication_event_id
    JOIN posts p ON p.id = pe.post_id
      AND p.user_id = pe.user_id
      AND COALESCE(p.client_id, '') = COALESCE(pe.client_id, '')
      AND p.owner_kind = pe.owner_kind
      AND p.owner_id = pe.owner_id
    LEFT JOIN reach_plans rp ON rp.id = pe.reach_plan_id
      AND rp.user_id = pe.user_id
      AND rp.workspace_key = pe.workspace_key
      AND rp.owner_kind = pe.owner_kind
      AND rp.owner_id = pe.owner_id
    LEFT JOIN reach_profiles rpf ON rpf.id = rp.reach_profile_id
      AND rpf.user_id = pe.user_id
      AND rpf.workspace_key = pe.workspace_key
      AND rpf.owner_kind = pe.owner_kind
      AND rpf.owner_id = pe.owner_id
      AND rpf.confirmation_status = 'confirmed'
    LEFT JOIN clients c ON pe.owner_kind = 'client'
      AND c.id = pe.client_id AND c.user_id = pe.user_id
    WHERE lo.window_hours = 168
      AND lo.source_status != 'unavailable'
      AND lo.normalized_score IS NOT NULL
      AND (
        pe.owner_kind != 'client'
        OR (c.id IS NOT NULL AND COALESCE(c.status, 'active') != 'on_hold')
      )
    ORDER BY lo.measured_at ASC, lo.id ASC
    LIMIT ?
  `).bind(limit).all<CandidateOutcomeRow>();
  return rows.results ?? [];
}

async function loadSignal(
  db: D1Database,
  identity: WorkspaceIdentity,
  variable: DerivedVariable,
  objective: string,
): Promise<PersistedSignalRow | null> {
  return db.prepare(`
    SELECT id, variable_key, variable_value, objective, sample_count, effect,
      confidence, freshness_at, status, supporting_outcomes_json
    FROM learning_signals
    WHERE user_id = ? AND workspace_key = ? AND owner_kind = ? AND owner_id = ?
      AND variable_key = ? AND variable_value = ? AND objective = ?
    LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.ownerKind,
    identity.ownerId,
    variable.variableKey,
    variable.variableValue,
    objective,
  ).first<PersistedSignalRow>();
}

async function saveSignal(
  db: D1Database,
  identity: WorkspaceIdentity,
  signal: LearningSignal,
  supportingOutcomeIds: string[],
  now: string,
  randomId: () => string,
): Promise<void> {
  await db.prepare(`
    INSERT INTO learning_signals (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,variable_key,
      variable_value,objective,sample_count,effect,confidence,freshness_at,
      status,supporting_outcomes_json,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,workspace_key,variable_key,variable_value,objective)
    DO UPDATE SET
      sample_count = excluded.sample_count,
      effect = excluded.effect,
      confidence = excluded.confidence,
      freshness_at = excluded.freshness_at,
      status = excluded.status,
      supporting_outcomes_json = excluded.supporting_outcomes_json,
      updated_at = excluded.updated_at
    WHERE learning_signals.owner_kind = excluded.owner_kind
      AND learning_signals.owner_id = excluded.owner_id
      AND learning_signals.status != 'operator_locked'
  `).bind(
    randomId(),
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    signal.variableKey,
    signal.variableValue,
    signal.objective,
    signal.sampleCount,
    signal.effect,
    signal.confidence,
    signal.freshnessAt,
    signal.status,
    JSON.stringify(supportingOutcomeIds),
    now,
  ).run();
}

async function listProfileSignals(
  db: D1Database,
  identity: WorkspaceIdentity,
): Promise<ProfileSignalRow[]> {
  const rows = await db.prepare(`
    SELECT variable_key, variable_value, objective, sample_count, effect,
      confidence, freshness_at, status
    FROM learning_signals
    WHERE user_id = ? AND workspace_key = ? AND owner_kind = ? AND owner_id = ?
      AND status IN ('usable','proven','operator_locked')
    ORDER BY confidence DESC, ABS(effect) DESC, variable_key ASC, variable_value ASC
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.ownerKind,
    identity.ownerId,
  ).all<ProfileSignalRow>();
  return rows.results ?? [];
}

async function createProfile(
  db: D1Database,
  identity: WorkspaceIdentity,
  signals: ProfileSignalRow[],
  now: string,
  randomId: () => string,
): Promise<boolean> {
  if (!signals.length) return false;
  const latest = await db.prepare(`
    SELECT COALESCE(MAX(version), 0) AS version
    FROM learning_profiles
    WHERE user_id = ? AND workspace_key = ? AND owner_kind = ? AND owner_id = ?
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.ownerKind,
    identity.ownerId,
  ).first<{ version: number | string }>();
  const currentVersion = finiteNumber(latest?.version ?? 0);
  if (currentVersion === null || !Number.isSafeInteger(currentVersion) || currentVersion < 0) {
    return false;
  }
  const version = currentVersion + 1;
  const profile = {
    version,
    approved: false,
    generatedAt: now,
    signals: signals.map((signal) => ({
      variableKey: signal.variable_key,
      variableValue: signal.variable_value,
      objective: signal.objective,
      sampleCount: Number(signal.sample_count),
      effect: Number(signal.effect),
      confidence: Number(signal.confidence),
      freshnessAt: signal.freshness_at,
      status: signal.status,
    })),
  };
  await db.prepare(`
    INSERT INTO learning_profiles (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,version,
      profile_json,approved,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(
    randomId(),
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    version,
    JSON.stringify(profile),
    0,
    now,
  ).run();
  return true;
}

export async function cronLearnStrategies(
  env: Env,
  options: LearnStrategiesOptions = {},
): Promise<LearnStrategiesResult> {
  const now = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('Learning run timestamp is invalid');
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const candidates = await listCandidateOutcomes(env.DB, boundedLimit(options.limit));
  const touched = new Map<string, WorkspaceIdentity>();
  const processedPosts = new Set<string>();
  let outcomesProcessed = 0;
  let signalsUpdated = 0;
  let skipped = 0;

  for (const row of candidates) {
    try {
      const { identity, score, objective } = canonicalCandidate(row);
      const variables = deriveVariables(row);
      let outcomeUpdated = false;
      for (const variable of variables) {
        const persisted = await loadSignal(env.DB, identity, variable, objective);
        const current = persisted ? toLearningSignal(persisted) : null;
        if (persisted && !current) continue;
        if (current?.status === 'operator_locked'
          || current?.supportingOutcomeIds.includes(row.outcome_id)) {
          continue;
        }
        const base: LearningSignal = current ?? {
          variableKey: variable.variableKey,
          variableValue: variable.variableValue,
          objective,
          sampleCount: 0,
          effect: 0,
          confidence: 0,
          freshnessAt: now,
          status: 'tentative',
        };
        const updated = nextSignal(base, {
          effect: Math.max(-1, Math.min(1, (score - 50) / 50)),
          sampleCount: 1,
        }, new Date(now));
        if (updated === base && current) continue;
        await saveSignal(
          env.DB,
          identity,
          updated,
          [...(current?.supportingOutcomeIds ?? []), row.outcome_id],
          now,
          randomId,
        );
        signalsUpdated += 1;
        outcomeUpdated = true;
      }
      if (outcomeUpdated) {
        outcomesProcessed += 1;
        processedPosts.add(row.post_id);
        touched.set(`${identity.userId}:${identity.workspaceKey}:${identity.ownerKind}:${identity.ownerId}`, identity);
      }
    } catch (error) {
      skipped += 1;
      console.warn(`[learning] skipped outcome ${row.outcome_id}: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  let profilesCreated = 0;
  for (const identity of touched.values()) {
    const signals = await listProfileSignals(env.DB, identity);
    if (await createProfile(env.DB, identity, signals, now, randomId)) {
      profilesCreated += 1;
    }
  }

  return {
    posts_processed: processedPosts.size,
    outcomes_processed: outcomesProcessed,
    signals_updated: signalsUpdated,
    profiles_created: profilesCreated,
    skipped,
  };
}
