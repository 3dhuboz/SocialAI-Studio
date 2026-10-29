export type ClientAutomationStatus = 'active' | 'on_hold';

export interface ClientAutomationState {
  status: ClientAutomationStatus;
  paused: boolean;
  draftCount: number;
  scheduledCount: number;
  postedCount: number;
  overdueScheduledCount: number;
  undatedScheduledCount: number;
  staleScheduledCount: number;
  canResume: boolean;
}

export class ClientAutomationNotFoundError extends Error {
  constructor() {
    super('Client workspace not found');
    this.name = 'ClientAutomationNotFoundError';
  }
}

export class StaleScheduledPostsError extends Error {
  readonly state: ClientAutomationState;

  constructor(state: ClientAutomationState) {
    super(`${state.staleScheduledCount} old queued post${state.staleScheduledCount === 1 ? '' : 's'} must be reviewed before automation can resume`);
    this.name = 'StaleScheduledPostsError';
    this.state = state;
  }
}

export class AutomationMustBePausedError extends Error {
  constructor() {
    super('Pause automation before returning queued posts to Draft');
    this.name = 'AutomationMustBePausedError';
  }
}

type CountRow = {
  draft_count: number | string | null;
  scheduled_count: number | string | null;
  posted_count: number | string | null;
  overdue_scheduled_count: number | string | null;
  undated_scheduled_count: number | string | null;
};

const count = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

/** Matches publish-missed.ts: UTC+10 wall-clock stored without a timezone. */
export const toCanonicalScheduleNow = (timestamp = Date.now()): string =>
  new Date(timestamp + 10 * 60 * 60 * 1000)
    .toISOString()
    .replace('Z', '');

export async function getClientAutomationState(
  db: D1Database,
  userId: string,
  clientId: string,
  nowIso = toCanonicalScheduleNow(),
): Promise<ClientAutomationState> {
  const client = await db.prepare(
    'SELECT status FROM clients WHERE id = ? AND user_id = ?',
  ).bind(clientId, userId).first<{ status: string | null }>();
  if (!client) throw new ClientAutomationNotFoundError();

  const row = await db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) AS draft_count,
       SUM(CASE WHEN status = 'Scheduled' THEN 1 ELSE 0 END) AS scheduled_count,
       SUM(CASE WHEN status = 'Posted' THEN 1 ELSE 0 END) AS posted_count,
       SUM(CASE WHEN status = 'Scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= ? THEN 1 ELSE 0 END) AS overdue_scheduled_count,
       SUM(CASE WHEN status = 'Scheduled' AND scheduled_for IS NULL THEN 1 ELSE 0 END) AS undated_scheduled_count
     FROM posts
     WHERE user_id = ? AND client_id = ?`,
  ).bind(nowIso, userId, clientId).first<CountRow>();

  const overdueScheduledCount = count(row?.overdue_scheduled_count);
  const undatedScheduledCount = count(row?.undated_scheduled_count);
  const staleScheduledCount = overdueScheduledCount + undatedScheduledCount;
  const status: ClientAutomationStatus = client.status?.trim().toLowerCase() === 'on_hold'
    ? 'on_hold'
    : 'active';

  return {
    status,
    paused: status === 'on_hold',
    draftCount: count(row?.draft_count),
    scheduledCount: count(row?.scheduled_count),
    postedCount: count(row?.posted_count),
    overdueScheduledCount,
    undatedScheduledCount,
    staleScheduledCount,
    canResume: staleScheduledCount === 0,
  };
}

export async function pauseClientAutomation(
  db: D1Database,
  userId: string,
  clientId: string,
  nowIso = toCanonicalScheduleNow(),
): Promise<ClientAutomationState> {
  const current = await getClientAutomationState(db, userId, clientId, nowIso);
  await db.prepare(
    `UPDATE clients SET status = 'on_hold' WHERE id = ? AND user_id = ?`,
  ).bind(clientId, userId).run();
  return { ...current, status: 'on_hold', paused: true };
}

export async function resumeClientAutomation(
  db: D1Database,
  userId: string,
  clientId: string,
  nowIso = toCanonicalScheduleNow(),
): Promise<ClientAutomationState> {
  const current = await getClientAutomationState(db, userId, clientId, nowIso);
  if (!current.canResume) throw new StaleScheduledPostsError(current);

  // The NOT EXISTS check closes the read/update race: a stale Scheduled row
  // inserted after the state read still prevents the workspace from resuming.
  const result = await db.prepare(
    `UPDATE clients
       SET status = 'active'
     WHERE id = ? AND user_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM posts p
          WHERE p.user_id = ?
            AND p.client_id = ?
            AND p.status = 'Scheduled'
            AND (p.scheduled_for IS NULL OR p.scheduled_for <= ?)
       )`,
  ).bind(clientId, userId, userId, clientId, nowIso).run();

  if ((result.meta?.changes ?? 0) === 0) {
    const refreshed = await getClientAutomationState(db, userId, clientId, nowIso);
    if (!refreshed.canResume) throw new StaleScheduledPostsError(refreshed);
    if (refreshed.paused) throw new Error('Automation could not be resumed');
    return refreshed;
  }
  return { ...current, status: 'active', paused: false };
}

export async function returnStaleScheduledPostsToDraft(
  db: D1Database,
  userId: string,
  clientId: string,
  nowIso = toCanonicalScheduleNow(),
): Promise<{ changed: number; state: ClientAutomationState }> {
  const current = await getClientAutomationState(db, userId, clientId, nowIso);
  if (!current.paused) throw new AutomationMustBePausedError();
  const result = await db.prepare(
    `UPDATE posts
        SET status = 'Draft',
            scheduled_for = NULL,
            claim_id = NULL,
            claim_at = NULL
      WHERE user_id = ?
        AND client_id = ?
        AND status = 'Scheduled'
        AND (scheduled_for IS NULL OR scheduled_for <= ?)`,
  ).bind(userId, clientId, nowIso).run();
  const state = await getClientAutomationState(db, userId, clientId, nowIso);
  return { changed: result.meta?.changes ?? 0, state };
}
