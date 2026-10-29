import { describe, expect, it } from 'vitest';
import {
  getClientAutomationState,
  pauseClientAutomation,
  resumeClientAutomation,
  returnStaleScheduledPostsToDraft,
  AutomationMustBePausedError,
  StaleScheduledPostsError,
  toCanonicalScheduleNow,
} from '../lib/client-automation';

type Row = Record<string, unknown>;

function automationDb(options: {
  client?: Row;
  counts?: Row;
  updateChanges?: number;
} = {}) {
  const calls: Array<{ sql: string; binds: unknown[]; method: string }> = [];
  const db = {
    prepare(sql: string) {
      const state = { binds: [] as unknown[] };
      return {
        bind(...binds: unknown[]) {
          state.binds = binds;
          return this;
        },
        async first<T>() {
          calls.push({ sql, binds: state.binds, method: 'first' });
          if (sql.includes('FROM clients')) return (options.client ?? null) as T | null;
          if (sql.includes('FROM posts')) return (options.counts ?? {}) as T;
          return null;
        },
        async run() {
          calls.push({ sql, binds: state.binds, method: 'run' });
          return { success: true, meta: { changes: options.updateChanges ?? 1 } };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

const NOW = '2026-10-29T14:00:00.000';

describe('client automation safety', () => {
  it('uses the same naive AEST clock format as the publisher', () => {
    expect(toCanonicalScheduleNow(Date.parse('2026-10-29T04:00:00.000Z'))).toBe('2026-10-29T14:00:00.000');
  });

  it('reports the real pause state and separates overdue from undated scheduled posts', async () => {
    const { db } = automationDb({
      client: { status: 'on_hold' },
      counts: {
        draft_count: 16,
        scheduled_count: 2,
        posted_count: 7,
        overdue_scheduled_count: 1,
        undated_scheduled_count: 1,
      },
    });

    const state = await getClientAutomationState(db, 'owner-1', 'hughesq-001', NOW);

    expect(state).toEqual({
      status: 'on_hold',
      paused: true,
      draftCount: 16,
      scheduledCount: 2,
      postedCount: 7,
      overdueScheduledCount: 1,
      undatedScheduledCount: 1,
      staleScheduledCount: 2,
      canResume: false,
    });
  });

  it('blocks resume before mutation when stale scheduled posts exist', async () => {
    const { db, calls } = automationDb({
      client: { status: 'on_hold' },
      counts: {
        draft_count: 16,
        scheduled_count: 2,
        posted_count: 7,
        overdue_scheduled_count: 1,
        undated_scheduled_count: 1,
      },
    });

    await expect(resumeClientAutomation(db, 'owner-1', 'hughesq-001', NOW))
      .rejects.toBeInstanceOf(StaleScheduledPostsError);
    expect(calls.filter((call) => call.method === 'run')).toHaveLength(0);
  });

  it('resumes through an atomic update only when no stale scheduled row exists', async () => {
    const { db, calls } = automationDb({
      client: { status: 'on_hold' },
      counts: {
        draft_count: 4,
        scheduled_count: 3,
        posted_count: 7,
        overdue_scheduled_count: 0,
        undated_scheduled_count: 0,
      },
      updateChanges: 1,
    });

    const state = await resumeClientAutomation(db, 'owner-1', 'hughesq-001', NOW);

    expect(state.status).toBe('active');
    expect(state.paused).toBe(false);
    const update = calls.find((call) => call.method === 'run');
    expect(update?.sql).toContain("SET status = 'active'");
    expect(update?.sql).toContain('NOT EXISTS');
    expect(update?.sql).toContain("p.status = 'Scheduled'");
    expect(update?.binds).toEqual(['hughesq-001', 'owner-1', 'owner-1', 'hughesq-001', NOW]);
  });

  it('pauses immediately at the client row', async () => {
    const { db, calls } = automationDb({
      client: { status: 'active' },
      counts: { draft_count: 4, scheduled_count: 3, posted_count: 7 },
    });

    const state = await pauseClientAutomation(db, 'owner-1', 'hughesq-001', NOW);

    expect(state.status).toBe('on_hold');
    expect(state.paused).toBe(true);
    expect(calls.find((call) => call.method === 'run')?.sql).toContain("SET status = 'on_hold'");
  });

  it('returns only overdue or undated scheduled posts to Draft and clears publish claims', async () => {
    const { db, calls } = automationDb({
      client: { status: 'on_hold' },
      counts: { draft_count: 18, scheduled_count: 0, posted_count: 7 },
      updateChanges: 2,
    });

    const result = await returnStaleScheduledPostsToDraft(db, 'owner-1', 'hughesq-001', NOW);

    expect(result.changed).toBe(2);
    const update = calls.find((call) => call.method === 'run');
    expect(update?.sql).toContain("SET status = 'Draft'");
    expect(update?.sql).toContain('scheduled_for = NULL');
    expect(update?.sql).toContain('claim_id = NULL');
    expect(update?.sql).toContain('claim_at = NULL');
    expect(update?.sql).toContain("status = 'Scheduled'");
    expect(update?.sql).toContain('scheduled_for IS NULL OR scheduled_for <= ?');
    expect(update?.binds).toEqual(['owner-1', 'hughesq-001', NOW]);
  });

  it('refuses queue cleanup unless the workspace is paused', async () => {
    const { db, calls } = automationDb({
      client: { status: 'active' },
      counts: { draft_count: 4, scheduled_count: 1, posted_count: 7, overdue_scheduled_count: 1 },
    });

    await expect(returnStaleScheduledPostsToDraft(db, 'owner-1', 'hughesq-001', NOW))
      .rejects.toBeInstanceOf(AutomationMustBePausedError);
    expect(calls.filter((call) => call.method === 'run')).toHaveLength(0);
  });
});
