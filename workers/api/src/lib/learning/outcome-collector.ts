import {
  normaliseSignal,
  scoreOutcome,
  type OutcomeCategory,
} from './outcome-score';
import {
  normalizePublicationPlatform,
  type PersistedPublicationEvent,
} from './publication-repository';
import {
  normalizeWorkspaceIdentity,
  type WorkspaceIdentity,
  type WorkspaceOwnerKind,
} from './types';

export type OutcomeWindow = 24 | 72 | 168;
export type OutcomeSourceStatus = 'complete' | 'partial' | 'unavailable';

export const OUTCOME_WINDOWS = Object.freeze([24, 72, 168] as const);

export interface FetchedOutcomeSignals {
  sourceStatus: OutcomeSourceStatus;
  values: Partial<Record<OutcomeCategory, number>>;
  rawSignals?: Record<string, unknown>;
}

export interface LearningOutcomeWrite {
  sourceStatus: OutcomeSourceStatus;
  score: number | null;
  completeness: 'none' | 'engagement' | 'action' | 'conversion';
  values: Partial<Record<OutcomeCategory, number>>;
  rawSignals: Record<string, unknown>;
}

export interface OutcomeCollectorDeps {
  hasOutcome(eventId: string, window: OutcomeWindow): Promise<boolean>;
  fetchSignals(
    event: PersistedPublicationEvent,
    window: OutcomeWindow,
  ): Promise<FetchedOutcomeSignals>;
  saveOutcome(
    event: PersistedPublicationEvent,
    window: OutcomeWindow,
    outcome: LearningOutcomeWrite,
  ): Promise<void>;
  recordUnavailableAttempt(
    event: PersistedPublicationEvent,
    window: OutcomeWindow,
  ): Promise<OutcomeRetryDecision>;
  markAttemptResolved(eventId: string, window: OutcomeWindow): Promise<void>;
}

export interface OutcomeRetryDecision {
  attempt: number;
  finalize: boolean;
  nextRetryAt: string | null;
}

export interface DuePublicationWindows {
  event: PersistedPublicationEvent;
  windows: OutcomeWindow[];
}

type DueOutcomeRow = {
  id: string;
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: string;
  owner_id: string;
  post_id: string;
  platform: string;
  remote_post_id: string | null;
  permalink: string | null;
  decision_id: string | null;
  reach_plan_id: string | null;
  published_at: string;
  window_hours: number;
};

type FactRow = {
  engagement_score: number | string | null;
  metadata: string | null;
  captured_at: string | null;
};

type OutcomeAttemptRow = {
  attempt_count: number | string | null;
  resolved_at: string | null;
};

type AggregateRow = {
  source_count: number | string | null;
  raw_value: number | string | null;
};

type AggregateHistoryRow = {
  post_id: string;
  raw_value: number | string | null;
};

type ConversionAggregateRow = {
  source_count: number | string | null;
  lead_available: number | string | null;
  lead_value: number | string | null;
  conversion_available: number | string | null;
  conversion_value: number | string | null;
};

type ConversionHistoryRow = ConversionAggregateRow & { post_id: string };

interface SignalContribution {
  values: Partial<Record<OutcomeCategory, number>>;
  raw: Record<string, unknown>;
  hasData: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
export const OUTCOME_RETRY_DELAYS_HOURS = Object.freeze([6, 12, 24] as const);
export const OUTCOME_MAX_ATTEMPTS = OUTCOME_RETRY_DELAYS_HOURS.length + 1;
const SNAPSHOT_TOLERANCE_HOURS = 18;

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function metadataMetric(
  metadata: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = numberOrNull(metadata[key]);
    if (value !== null) return value;
  }
  return null;
}

function ownerKind(value: string): WorkspaceOwnerKind {
  if (value === 'user' || value === 'client' || value === 'shop') return value;
  throw new Error(`Invalid publication owner kind: ${value}`);
}

function boundedLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(500, Math.floor(value)));
}

function windowEnd(event: PersistedPublicationEvent, window: OutcomeWindow): string {
  const published = Date.parse(event.publishedAt);
  if (!Number.isFinite(published)) throw new Error('Publication timestamp is invalid');
  return new Date(published + window * HOUR_MS).toISOString();
}

function canonicalWindows(windows: readonly OutcomeWindow[]): OutcomeWindow[] {
  const requested = new Set<number>(windows);
  return OUTCOME_WINDOWS.filter((window) => requested.has(window));
}

function addNormalisedSignal(
  contribution: SignalContribution,
  category: OutcomeCategory,
  raw: number,
  history: number[],
): void {
  const normalized = normaliseSignal(raw, history);
  contribution.values[category] = normalized.score;
  contribution.raw[category] = { raw, ...normalized };
  contribution.hasData = true;
}

function emptyContribution(): SignalContribution {
  return { values: {}, raw: {}, hasData: false };
}

function outcomeCompleteness(
  value: unknown,
): LearningOutcomeWrite['completeness'] {
  if (value === 'engagement' || value === 'action' || value === 'conversion') {
    return value;
  }
  return 'none';
}

function canonicalEvent(row: DueOutcomeRow): PersistedPublicationEvent {
  const identity = normalizeWorkspaceIdentity(
    row.user_id,
    row.client_id,
    ownerKind(row.owner_kind),
    row.owner_id,
  );
  if (identity.workspaceKey !== row.workspace_key) {
    throw new Error(`Publication ${row.id} has a non-canonical workspace key`);
  }
  return {
    id: row.id,
    userId: identity.userId,
    clientId: identity.clientId,
    ownerKind: identity.ownerKind,
    ownerId: identity.ownerId,
    workspaceKey: identity.workspaceKey,
    postId: row.post_id,
    platform: normalizePublicationPlatform(row.platform),
    remotePostId: row.remote_post_id,
    permalink: row.permalink,
    decisionId: row.decision_id,
    reachPlanId: row.reach_plan_id,
    publishedAt: row.published_at,
  };
}

function canonicalIdentity(event: PersistedPublicationEvent): WorkspaceIdentity {
  const identity = normalizeWorkspaceIdentity(
    event.userId,
    event.clientId,
    event.ownerKind,
    event.ownerId,
  );
  if (identity.workspaceKey !== event.workspaceKey) {
    throw new Error(`Publication ${event.id} has a non-canonical workspace key`);
  }
  return identity;
}

export function dueOutcomeWindows(
  publishedAt: string,
  now: string,
): OutcomeWindow[] {
  const published = Date.parse(publishedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(published) || !Number.isFinite(current)) return [];
  return OUTCOME_WINDOWS.filter((window) =>
    published + window * HOUR_MS <= current);
}

export async function collectOutcomeWindows(
  event: PersistedPublicationEvent,
  windows: readonly OutcomeWindow[],
  deps: OutcomeCollectorDeps,
): Promise<{ saved: number; skipped: number; deferred: number }> {
  let saved = 0;
  let skipped = 0;
  let deferred = 0;

  for (const window of canonicalWindows(windows)) {
    if (await deps.hasOutcome(event.id, window)) {
      skipped += 1;
      continue;
    }

    let fetched: FetchedOutcomeSignals;
    try {
      fetched = await deps.fetchSignals(event, window);
    } catch {
      fetched = {
        sourceStatus: 'unavailable',
        values: {},
        rawSignals: { sourceError: 'unavailable' },
      };
    }

    const values = fetched.sourceStatus === 'unavailable'
      ? {}
      : fetched.values;
    const scored = fetched.sourceStatus === 'unavailable'
      ? { score: null, completeness: 'none' as const }
      : scoreOutcome(values);

    let retry: OutcomeRetryDecision | null = null;
    if (fetched.sourceStatus === 'unavailable') {
      retry = await deps.recordUnavailableAttempt(event, window);
      if (!retry.finalize) {
        deferred += 1;
        continue;
      }
    }

    await deps.saveOutcome(event, window, {
      sourceStatus: fetched.sourceStatus,
      score: scored.score,
      completeness: outcomeCompleteness(scored.completeness),
      values,
      rawSignals: retry
        ? { ...(fetched.rawSignals ?? {}), retry }
        : fetched.rawSignals ?? {},
    });
    try {
      await deps.markAttemptResolved(event.id, window);
    } catch (error) {
      console.warn(
        `[CRON learning_outcomes] could not resolve retry state for ${event.id}/${window}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    saved += 1;
  }

  return { saved, skipped, deferred };
}

export async function listDueOutcomeWindows(
  db: D1Database,
  now: string,
  limit = 100,
): Promise<DuePublicationWindows[]> {
  const result = await db.prepare(`
    WITH outcome_windows(window_hours) AS (VALUES (24), (72), (168))
    SELECT
      pe.id, pe.user_id, pe.workspace_key, pe.client_id, pe.owner_kind,
      pe.owner_id, pe.post_id, pe.platform, pe.remote_post_id, pe.permalink,
      pe.decision_id, pe.reach_plan_id, pe.published_at, w.window_hours
    FROM publication_events pe
    CROSS JOIN outcome_windows w
    LEFT JOIN learning_outcome_attempts oa
      ON oa.publication_event_id = pe.id
     AND oa.window_hours = w.window_hours
    WHERE datetime(pe.published_at, '+' || w.window_hours || ' hours') <= datetime(?)
      AND (
        pe.owner_kind != 'client'
        OR EXISTS (
          SELECT 1 FROM clients c
          WHERE c.id = pe.client_id AND c.user_id = pe.user_id
            AND COALESCE(c.status, 'active') != 'on_hold'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM learning_outcomes lo
        WHERE lo.publication_event_id = pe.id
          AND lo.window_hours = w.window_hours
      )
      AND (
        oa.publication_event_id IS NULL
        OR (
          oa.resolved_at IS NULL
          AND (
            oa.next_retry_at IS NULL
            OR datetime(oa.next_retry_at) <= datetime(?)
          )
        )
      )
    ORDER BY pe.published_at ASC, pe.id ASC, w.window_hours ASC
    LIMIT ?
  `).bind(now, now, boundedLimit(limit)).all<DueOutcomeRow>();

  const grouped = new Map<string, DuePublicationWindows>();
  for (const row of result.results ?? []) {
    try {
      if (!OUTCOME_WINDOWS.includes(row.window_hours as OutcomeWindow)) continue;
      const event = canonicalEvent(row);
      const window = row.window_hours as OutcomeWindow;
      if (!dueOutcomeWindows(event.publishedAt, now).includes(window)) continue;
      const existing = grouped.get(event.id);
      if (existing) {
        if (!existing.windows.includes(window)) existing.windows.push(window);
      } else {
        grouped.set(event.id, { event, windows: [window] });
      }
    } catch (error) {
      console.warn(
        `[CRON learning_outcomes] invalid publication event ${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const due of grouped.values()) {
    due.windows = canonicalWindows(due.windows);
  }
  return [...grouped.values()];
}

async function loadFactSignals(
  db: D1Database,
  event: PersistedPublicationEvent,
  identity: WorkspaceIdentity,
  window: OutcomeWindow,
  end: string,
): Promise<SignalContribution> {
  const current = await db.prepare(`
    SELECT s.engagement_score, s.metadata_json AS metadata, s.captured_at
    FROM platform_metric_snapshots s
    WHERE s.user_id = ?
      AND s.workspace_key = ?
      AND s.client_id IS ?
      AND s.owner_kind = ?
      AND s.owner_id = ?
      AND s.platform = ?
      AND s.remote_post_id = ?
      AND datetime(s.captured_at) BETWEEN
        datetime(?, '-${SNAPSHOT_TOLERANCE_HOURS} hours')
        AND datetime(?, '+${SNAPSHOT_TOLERANCE_HOURS} hours')
    ORDER BY ABS(julianday(s.captured_at) - julianday(?)) ASC,
             datetime(s.captured_at) ASC
    LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    event.platform,
    event.remotePostId,
    end,
    end,
    end,
  ).first<FactRow>();

  const historyResult = await db.prepare(`
    WITH ranked_history AS (
      SELECT
        s.engagement_score,
        s.metadata_json AS metadata,
        s.captured_at,
        ROW_NUMBER() OVER (
          PARTITION BY pe.id
          ORDER BY ABS(
            julianday(s.captured_at)
            - julianday(datetime(pe.published_at, '+' || ? || ' hours'))
          ) ASC,
          datetime(s.captured_at) ASC
        ) AS snapshot_rank
      FROM publication_events pe
      JOIN platform_metric_snapshots s
        ON s.user_id = pe.user_id
       AND s.workspace_key = pe.workspace_key
       AND s.client_id IS pe.client_id
       AND s.owner_kind = pe.owner_kind
       AND s.owner_id = pe.owner_id
       AND s.platform = pe.platform
       AND s.remote_post_id = pe.remote_post_id
      WHERE pe.user_id = ?
        AND pe.workspace_key = ?
        AND pe.client_id IS ?
        AND pe.owner_kind = ?
        AND pe.owner_id = ?
        AND pe.platform = ?
        AND pe.id <> ?
        AND datetime(s.captured_at) BETWEEN
          datetime(pe.published_at, '+' || ? || ' hours', '-${SNAPSHOT_TOLERANCE_HOURS} hours')
          AND datetime(pe.published_at, '+' || ? || ' hours', '+${SNAPSHOT_TOLERANCE_HOURS} hours')
    )
    SELECT engagement_score, metadata, captured_at
    FROM ranked_history
    WHERE snapshot_rank = 1
    ORDER BY datetime(captured_at) DESC
    LIMIT 100
  `).bind(
    window,
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    event.platform,
    event.id,
    window,
    window,
  ).all<FactRow>();

  const contribution = emptyContribution();
  if (!current) return contribution;
  contribution.raw.snapshotCapturedAt = current.captured_at;
  const captured = Date.parse(current.captured_at ?? '');
  const boundary = Date.parse(end);
  if (Number.isFinite(captured) && Number.isFinite(boundary)) {
    contribution.raw.measurementLagHours = Math.round(
      (Math.abs(captured - boundary) / HOUR_MS) * 100,
    ) / 100;
  }
  const history = historyResult.results ?? [];
  const engagement = numberOrNull(current.engagement_score);
  if (engagement !== null) {
    addNormalisedSignal(
      contribution,
      'meaningful_engagement',
      engagement,
      history
        .map((row) => numberOrNull(row.engagement_score))
        .filter((value): value is number => value !== null),
    );
  }

  const reachKeys = ['reach', 'impressions', 'views', 'video_views'] as const;
  const reach = metadataMetric(parseMetadata(current.metadata), reachKeys);
  if (reach !== null) {
    addNormalisedSignal(
      contribution,
      'reach',
      reach,
      history
        .map((row) => metadataMetric(parseMetadata(row.metadata), reachKeys))
        .filter((value): value is number => value !== null),
    );
  }
  return contribution;
}

async function loadTrackingSignals(
  db: D1Database,
  identity: WorkspaceIdentity,
  postId: string,
  end: string,
): Promise<SignalContribution> {
  const current = await db.prepare(`
    SELECT COUNT(*) AS source_count, SUM(click_count) AS raw_value
    FROM tracking_links
    WHERE user_id = ?
      AND workspace_key = ?
      AND client_id IS ?
      AND owner_kind = ?
      AND owner_id = ?
      AND post_id = ?
      AND datetime(created_at) <= datetime(?)
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    postId,
    end,
  ).first<AggregateRow>();
  const history = await db.prepare(`
    SELECT post_id, SUM(click_count) AS raw_value
    FROM tracking_links
    WHERE user_id = ?
      AND workspace_key = ?
      AND client_id IS ?
      AND owner_kind = ?
      AND owner_id = ?
      AND datetime(created_at) <= datetime(?)
    GROUP BY post_id
    ORDER BY MAX(datetime(created_at)) DESC
    LIMIT 100
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    end,
  ).all<AggregateHistoryRow>();

  const contribution = emptyContribution();
  const count = numberOrNull(current?.source_count);
  const raw = numberOrNull(current?.raw_value);
  if (count !== null && count > 0 && raw !== null) {
    addNormalisedSignal(
      contribution,
      'tracked_action',
      raw,
      (history.results ?? [])
        .map((row) => numberOrNull(row.raw_value))
        .filter((value): value is number => value !== null),
    );
  }
  return contribution;
}

const CONVERSION_AGGREGATES = `
  COUNT(*) AS source_count,
  MAX(CASE WHEN calls IS NOT NULL OR messages IS NOT NULL OR leads IS NOT NULL
    THEN 1 ELSE 0 END) AS lead_available,
  SUM(CASE WHEN calls IS NOT NULL OR messages IS NOT NULL OR leads IS NOT NULL
    THEN COALESCE(calls, 0) + COALESCE(messages, 0) + COALESCE(leads, 0)
    ELSE NULL END) AS lead_value,
  MAX(CASE WHEN bookings IS NOT NULL OR sales IS NOT NULL OR order_value_cents IS NOT NULL
    THEN 1 ELSE 0 END) AS conversion_available,
  SUM(CASE WHEN bookings IS NOT NULL OR sales IS NOT NULL OR order_value_cents IS NOT NULL
    THEN COALESCE(bookings, 0) + COALESCE(sales, 0)
      + CASE WHEN bookings IS NULL AND sales IS NULL AND COALESCE(order_value_cents, 0) > 0
        THEN 1 ELSE 0 END
    ELSE NULL END) AS conversion_value
`;

async function loadConversionSignals(
  db: D1Database,
  identity: WorkspaceIdentity,
  postId: string,
  end: string,
): Promise<SignalContribution> {
  const current = await db.prepare(`
    SELECT ${CONVERSION_AGGREGATES}
    FROM conversion_feedback
    WHERE user_id = ?
      AND workspace_key = ?
      AND client_id IS ?
      AND owner_kind = ?
      AND owner_id = ?
      AND post_id = ?
      AND datetime(recorded_at) <= datetime(?)
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    postId,
    end,
  ).first<ConversionAggregateRow>();
  const history = await db.prepare(`
    SELECT post_id, ${CONVERSION_AGGREGATES}
    FROM conversion_feedback
    WHERE user_id = ?
      AND workspace_key = ?
      AND client_id IS ?
      AND owner_kind = ?
      AND owner_id = ?
      AND datetime(recorded_at) <= datetime(?)
    GROUP BY post_id
    ORDER BY MAX(datetime(recorded_at)) DESC
    LIMIT 100
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    end,
  ).all<ConversionHistoryRow>();

  const contribution = emptyContribution();
  const rows = history.results ?? [];
  const lead = numberOrNull(current?.lead_value);
  if ((numberOrNull(current?.lead_available) ?? 0) > 0 && lead !== null) {
    addNormalisedSignal(
      contribution,
      'lead',
      lead,
      rows
        .filter((row) => (numberOrNull(row.lead_available) ?? 0) > 0)
        .map((row) => numberOrNull(row.lead_value))
        .filter((value): value is number => value !== null),
    );
  }

  const conversion = numberOrNull(current?.conversion_value);
  if ((numberOrNull(current?.conversion_available) ?? 0) > 0
    && conversion !== null) {
    addNormalisedSignal(
      contribution,
      'conversion',
      conversion,
      rows
        .filter((row) => (numberOrNull(row.conversion_available) ?? 0) > 0)
        .map((row) => numberOrNull(row.conversion_value))
        .filter((value): value is number => value !== null),
    );
  }
  return contribution;
}

export async function fetchOutcomeSignals(
  db: D1Database,
  event: PersistedPublicationEvent,
  window: OutcomeWindow,
): Promise<FetchedOutcomeSignals> {
  const identity = canonicalIdentity(event);
  const end = windowEnd(event, window);
  const sources = await Promise.allSettled([
    loadFactSignals(db, event, identity, window, end),
    loadTrackingSignals(db, identity, event.postId, end),
    loadConversionSignals(db, identity, event.postId, end),
  ]);
  const names = ['facts', 'tracking', 'conversion'] as const;
  const values: Partial<Record<OutcomeCategory, number>> = {};
  const rawSources: Record<string, unknown> = {};

  sources.forEach((result, index) => {
    const name = names[index];
    if (result.status === 'rejected') {
      rawSources[name] = { status: 'unavailable' };
      return;
    }
    Object.assign(values, result.value.values);
    rawSources[name] = {
      status: result.value.hasData ? 'available' : 'unavailable',
      ...result.value.raw,
    };
  });

  const availableCount = Object.keys(values).length;
  const sourceStatus: OutcomeSourceStatus = availableCount === 0
    ? 'unavailable'
    : availableCount === 5
      ? 'complete'
      : 'partial';
  return {
    sourceStatus,
    values,
    rawSignals: { windowEnd: end, sources: rawSources },
  };
}

export async function hasLearningOutcome(
  db: D1Database,
  eventId: string,
  window: OutcomeWindow,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 AS present
    FROM learning_outcomes
    WHERE publication_event_id = ? AND window_hours = ?
    LIMIT 1
  `).bind(eventId, window).first<{ present: number }>();
  return row !== null;
}

export async function saveLearningOutcome(
  db: D1Database,
  event: PersistedPublicationEvent,
  window: OutcomeWindow,
  outcome: LearningOutcomeWrite,
  measuredAt: string,
): Promise<void> {
  await db.prepare(`
    INSERT INTO learning_outcomes (
      id, publication_event_id, window_hours, raw_signals_json,
      normalized_score, completeness, source_status, measured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(publication_event_id,window_hours) DO NOTHING
  `).bind(
    crypto.randomUUID(),
    event.id,
    window,
    JSON.stringify({
      normalizedValues: outcome.values,
      ...outcome.rawSignals,
    }),
    outcome.score,
    outcome.completeness,
    outcome.sourceStatus,
    measuredAt,
  ).run();
}

function retryAt(now: string, attempt: number): string | null {
  if (attempt >= OUTCOME_MAX_ATTEMPTS) return null;
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new Error('Outcome attempt timestamp is invalid');
  const delayHours = OUTCOME_RETRY_DELAYS_HOURS[attempt - 1];
  return new Date(timestamp + delayHours * HOUR_MS).toISOString();
}

export async function recordUnavailableOutcomeAttempt(
  db: D1Database,
  event: PersistedPublicationEvent,
  window: OutcomeWindow,
  now: string,
): Promise<OutcomeRetryDecision> {
  const existing = await db.prepare(`
    SELECT attempt_count, resolved_at
    FROM learning_outcome_attempts
    WHERE publication_event_id = ? AND window_hours = ?
    LIMIT 1
  `).bind(event.id, window).first<OutcomeAttemptRow>();
  const previous = Math.max(0, Number(existing?.attempt_count ?? 0));
  const attempt = Math.min(previous + 1, OUTCOME_MAX_ATTEMPTS);
  const nextRetryAt = retryAt(now, attempt);

  await db.prepare(`
    INSERT INTO learning_outcome_attempts (
      id, publication_event_id, window_hours, attempt_count,
      next_retry_at, last_attempted_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(publication_event_id,window_hours) DO UPDATE SET
      attempt_count = excluded.attempt_count,
      next_retry_at = excluded.next_retry_at,
      last_attempted_at = excluded.last_attempted_at,
      updated_at = datetime('now')
    WHERE learning_outcome_attempts.resolved_at IS NULL
  `).bind(
    crypto.randomUUID(),
    event.id,
    window,
    attempt,
    nextRetryAt,
    now,
  ).run();

  return {
    attempt,
    finalize: attempt >= OUTCOME_MAX_ATTEMPTS,
    nextRetryAt,
  };
}

export async function markOutcomeAttemptResolved(
  db: D1Database,
  eventId: string,
  window: OutcomeWindow,
  now: string,
): Promise<void> {
  await db.prepare(`
    UPDATE learning_outcome_attempts
    SET resolved_at = COALESCE(resolved_at, ?),
        next_retry_at = NULL,
        updated_at = datetime('now')
    WHERE publication_event_id = ? AND window_hours = ?
  `).bind(now, eventId, window).run();
}

export async function collectDueLearningOutcomes(
  db: D1Database,
  now: string,
  limit = 100,
): Promise<{ dueEvents: number; saved: number; skipped: number; deferred: number }> {
  const due = await listDueOutcomeWindows(db, now, limit);
  let saved = 0;
  let skipped = 0;
  let deferred = 0;

  for (const item of due) {
    const result = await collectOutcomeWindows(item.event, item.windows, {
      hasOutcome: (eventId, window) => hasLearningOutcome(db, eventId, window),
      fetchSignals: (event, window) => fetchOutcomeSignals(db, event, window),
      saveOutcome: (event, window, outcome) =>
        saveLearningOutcome(db, event, window, outcome, now),
      recordUnavailableAttempt: (event, window) =>
        recordUnavailableOutcomeAttempt(db, event, window, now),
      markAttemptResolved: (eventId, window) =>
        markOutcomeAttemptResolved(db, eventId, window, now),
    });
    saved += result.saved;
    skipped += result.skipped;
    deferred += result.deferred;
  }

  return { dueEvents: due.length, saved, skipped, deferred };
}
