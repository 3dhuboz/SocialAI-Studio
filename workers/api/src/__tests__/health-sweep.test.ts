/**
 * Unit tests for cron/health-sweep.ts — the threshold-based sweep that
 * complements lib/alerts.ts's crash alerting with statistical failure
 * detection (5+ Missed in 30min, posts stuck Publishing > 30min, and stale
 * weekly calibration receipts after the monitor has been established).
 *
 * Each test exercises ONE check in isolation by mocking the D1 COUNT
 * response, then asserts whether fireAlert OR resolveAlert was called
 * (sweep checks call exactly one per tick depending on threshold).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Env } from '../env';

const alertCalls: Array<{ key: string; severity: string; body: string }> = [];
const resolveCalls: string[] = [];
vi.mock('../lib/alerts', () => ({
  fireAlert: vi.fn(async (_env: Env, key: string, severity: string, body: string) => {
    alertCalls.push({ key, severity, body });
  }),
  resolveAlert: vi.fn(async (_env: Env, key: string) => {
    resolveCalls.push(key);
  }),
}));

import { cronHealthSweep, __test } from '../cron/health-sweep';

type CannedRow = number | Record<string, unknown>;

function makeEnv(rowByPattern: Record<string, CannedRow>): Env {
  const prepare = vi.fn().mockImplementation((sql: string) => {
    const cannedRow = (): Record<string, unknown> => {
      for (const [pattern, value] of Object.entries(rowByPattern)) {
        if (!sql.includes(pattern)) continue;
        return typeof value === 'number' ? { n: value } : value;
      }
      if (sql.includes('FROM sqlite_master')) {
        return { alert_tables: 1, alert_indexes: 2 };
      }
      return { n: 0 };
    };
    return {
      bind: () => ({
        first: async () => cannedRow(),
      }),
      first: async () => cannedRow(),
    };
  });
  return { DB: { prepare } } as unknown as Env;
}

beforeEach(() => {
  alertCalls.length = 0;
  resolveCalls.length = 0;
});

// ── checkPublishFailureBurst ────────────────────────────────────────────

describe('checkPublishFailureBurst', () => {
  it('fires critical alert when count exceeds threshold', async () => {
    const env = makeEnv({ "status = 'Missed'": __test.THRESHOLDS.publishFailuresIn30Min + 2 });
    const result = await __test.checkPublishFailureBurst(env);
    expect(result.fired).toBe(true);
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0].key).toBe('publish_failure_burst');
    expect(alertCalls[0].severity).toBe('critical');
    expect(alertCalls[0].body).toContain(String(__test.THRESHOLDS.publishFailuresIn30Min + 2));
  });

  it('fires exactly at threshold (>=)', async () => {
    const env = makeEnv({ "status = 'Missed'": __test.THRESHOLDS.publishFailuresIn30Min });
    const result = await __test.checkPublishFailureBurst(env);
    expect(result.fired).toBe(true);
    expect(alertCalls).toHaveLength(1);
  });

  it('does NOT fire below threshold; calls resolveAlert', async () => {
    const env = makeEnv({ "status = 'Missed'": __test.THRESHOLDS.publishFailuresIn30Min - 1 });
    const result = await __test.checkPublishFailureBurst(env);
    expect(result.fired).toBe(false);
    expect(alertCalls).toHaveLength(0);
    expect(resolveCalls).toContain('publish_failure_burst');
  });

  it('does NOT fire when count is 0; calls resolveAlert', async () => {
    const env = makeEnv({});
    const result = await __test.checkPublishFailureBurst(env);
    expect(result.fired).toBe(false);
    expect(alertCalls).toHaveLength(0);
    expect(resolveCalls).toContain('publish_failure_burst');
  });
});

// ── checkPublishZombie ──────────────────────────────────────────────────

describe('checkPublishZombie', () => {
  it('fires warn alert when any post is stuck Publishing >30 min', async () => {
    const env = makeEnv({ "status = 'Publishing'": 3 });
    const result = await __test.checkPublishZombie(env);
    expect(result.fired).toBe(true);
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0].key).toBe('publish_zombie');
    expect(alertCalls[0].severity).toBe('warn');
    expect(alertCalls[0].body).toContain('3 posts stuck');
  });

  it('does NOT fire when zero stuck; calls resolveAlert', async () => {
    const env = makeEnv({ "status = 'Publishing'": 0 });
    const result = await __test.checkPublishZombie(env);
    expect(result.fired).toBe(false);
    expect(alertCalls).toHaveLength(0);
    expect(resolveCalls).toContain('publish_zombie');
  });
});

describe('checkLearningCalibrationFreshness', () => {
  const now = new Date('2026-07-26T22:01:00.000Z');

  it('stays neutral before the first successful weekly receipt establishes monitoring', async () => {
    const env = makeEnv({ FROM_cron_runs_never_matches: 0 });

    const result = await __test.checkLearningCalibrationFreshness(env, now);

    expect(result).toMatchObject({ fired: false, detail: 'monitor not established' });
    expect(alertCalls).toHaveLength(0);
    expect(resolveCalls).not.toContain('learning_calibration_receipt_stale');
  });

  it('resolves the stale-receipt alert while the latest success is within the weekly window', async () => {
    const env = makeEnv({
      'FROM cron_runs': { last_success_at: '2026-07-19 21:01:00' },
    });

    const result = await __test.checkLearningCalibrationFreshness(env, now);

    expect(result.fired).toBe(false);
    expect(alertCalls).toHaveLength(0);
    expect(resolveCalls).toContain('learning_calibration_receipt_stale');
  });

  it('fires critical after one weekly interval plus the one-hour grace period', async () => {
    const env = makeEnv({
      'FROM cron_runs': { last_success_at: '2026-07-19 21:00:00' },
    });

    const result = await __test.checkLearningCalibrationFreshness(env, now);

    expect(result.fired).toBe(true);
    expect(alertCalls).toEqual([expect.objectContaining({
      key: 'learning_calibration_receipt_stale',
      severity: 'critical',
      body: expect.stringMatching(/last successful.*older than.*operator review/i),
    })]);
    expect(resolveCalls).not.toContain('learning_calibration_receipt_stale');
  });

  it.each(['not-a-timestamp', '2026-07-27 00:00:00'])(
    'fails closed for invalid or future receipt timestamp %s',
    async (lastSuccessAt) => {
      const env = makeEnv({ 'FROM cron_runs': { last_success_at: lastSuccessAt } });

      const result = await __test.checkLearningCalibrationFreshness(env, now);

      expect(result.fired).toBe(true);
      expect(alertCalls[0]).toMatchObject({
        key: 'learning_calibration_receipt_stale',
        severity: 'critical',
      });
    },
  );
});

describe('checkAlertPersistenceSchema', () => {
  it('accepts the alert table only when both operational indexes exist', async () => {
    const env = makeEnv({});

    const result = await __test.checkAlertPersistenceSchema(env);

    expect(result).toMatchObject({
      key: 'alert_persistence_schema',
      fired: false,
      detail: 'table=1 indexes=2',
    });
  });

  it.each([
    [{ alert_tables: 0, alert_indexes: 0 }, 'table=0 indexes=0'],
    [{ alert_tables: 1, alert_indexes: 1 }, 'table=1 indexes=1'],
  ])('fails closed for incomplete alert persistence %#', async (schema, detail) => {
    const env = makeEnv({ 'FROM sqlite_master': schema });

    await expect(__test.checkAlertPersistenceSchema(env))
      .rejects.toThrow(`Alert persistence schema is incomplete (${detail})`);
  });
});

// ── Sweep orchestration ─────────────────────────────────────────────────

describe('cronHealthSweep', () => {
  it('runs all checks and reports fire count', async () => {
    const env = makeEnv({
      "status = 'Missed'": __test.THRESHOLDS.publishFailuresIn30Min + 1,
      "status = 'Publishing'": 2,
    });
    const result = await cronHealthSweep(env);
    expect(result.checks).toHaveLength(4);
    expect(result.posts_processed).toBe(2);
    expect(alertCalls.map((a) => a.key).sort()).toEqual(['publish_failure_burst', 'publish_zombie']);
  });

  it('quiet day: zero alerts fired, both resolve', async () => {
    const env = makeEnv({});
    const result = await cronHealthSweep(env);
    expect(result.checks).toHaveLength(4);
    expect(result.posts_processed).toBe(0);
    expect(alertCalls).toHaveLength(0);
    expect(resolveCalls.sort()).toEqual(['publish_failure_burst', 'publish_zombie']);
  });

  it('continues remaining checks then fails the cron receipt when one check throws', async () => {
    // First check throws; second still runs. We simulate this by making
    // the burst query throw via a bad prepare implementation, but still
    // return a clean zombie count.
    let firstCallSeen = false;
    const prepare = vi.fn().mockImplementation((sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes('FROM sqlite_master')) {
            return { alert_tables: 1, alert_indexes: 2 };
          }
          if (sql.includes("status = 'Missed'") && !firstCallSeen) {
            firstCallSeen = true;
            throw new Error('simulated D1 failure');
          }
          if (sql.includes("status = 'Publishing'")) return { n: 0 };
          return { n: 0 };
        },
      }),
      first: async () => {
        if (sql.includes('FROM sqlite_master')) {
          return { alert_tables: 1, alert_indexes: 2 };
        }
        if (sql.includes("status = 'Missed'") && !firstCallSeen) {
          firstCallSeen = true;
          throw new Error('simulated D1 failure');
        }
        if (sql.includes("status = 'Publishing'")) return { n: 0 };
        return { n: 0 };
      },
    }));
    const env = { DB: { prepare } } as unknown as Env;
    await expect(cronHealthSweep(env)).rejects.toThrow(
      'Health sweep completed with 1 failed check: checkPublishFailureBurst',
    );
    // The throwing check produces a `health_sweep_check_failed:...` alert,
    // and the other check still ran and resolved.
    expect(alertCalls.find((a) => a.key.startsWith('health_sweep_check_failed:'))).toBeDefined();
    expect(resolveCalls).toContain('publish_zombie');
  });
});
