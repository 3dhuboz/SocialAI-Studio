/**
 * Unit tests for cron/health-sweep.ts — the threshold-based sweep that
 * complements lib/alerts.ts's crash alerting with statistical failure
 * detection (5+ Missed in 30min, posts stuck Publishing > 30min).
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

function makeEnv(countByPattern: Record<string, number>): Env {
  const prepare = vi.fn().mockImplementation((sql: string) => {
    return {
      bind: () => ({
        first: async () => {
          // Match the test SQL against canned counts by substring.
          for (const [pattern, n] of Object.entries(countByPattern)) {
            if (sql.includes(pattern)) return { n };
          }
          return { n: 0 };
        },
      }),
      first: async () => {
        for (const [pattern, n] of Object.entries(countByPattern)) {
          if (sql.includes(pattern)) return { n };
        }
        return { n: 0 };
      },
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

// ── Sweep orchestration ─────────────────────────────────────────────────

describe('cronHealthSweep', () => {
  it('runs both checks and reports fire count', async () => {
    const env = makeEnv({
      "status = 'Missed'": __test.THRESHOLDS.publishFailuresIn30Min + 1,
      "status = 'Publishing'": 2,
    });
    const result = await cronHealthSweep(env);
    expect(result.checks).toHaveLength(2);
    expect(result.posts_processed).toBe(2); // both fired
    expect(alertCalls.map((a) => a.key).sort()).toEqual(['publish_failure_burst', 'publish_zombie']);
  });

  it('quiet day: zero alerts fired, both resolve', async () => {
    const env = makeEnv({});
    const result = await cronHealthSweep(env);
    expect(result.posts_processed).toBe(0);
    expect(alertCalls).toHaveLength(0);
    expect(resolveCalls.sort()).toEqual(['publish_failure_burst', 'publish_zombie']);
  });

  it('a single check throwing does not block the others', async () => {
    // First check throws; second still runs. We simulate this by making
    // the burst query throw via a bad prepare implementation, but still
    // return a clean zombie count.
    let firstCallSeen = false;
    const prepare = vi.fn().mockImplementation((sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes("status = 'Missed'") && !firstCallSeen) {
            firstCallSeen = true;
            throw new Error('simulated D1 failure');
          }
          if (sql.includes("status = 'Publishing'")) return { n: 0 };
          return { n: 0 };
        },
      }),
      first: async () => {
        if (sql.includes("status = 'Missed'") && !firstCallSeen) {
          firstCallSeen = true;
          throw new Error('simulated D1 failure');
        }
        if (sql.includes("status = 'Publishing'")) return { n: 0 };
        return { n: 0 };
      },
    }));
    const env = { DB: { prepare } } as unknown as Env;
    const result = await cronHealthSweep(env);
    expect(result.checks).toHaveLength(2);
    // The throwing check produces a `health_sweep_check_failed:...` alert,
    // and the other check still ran and resolved.
    expect(alertCalls.find((a) => a.key.startsWith('health_sweep_check_failed:'))).toBeDefined();
    expect(resolveCalls).toContain('publish_zombie');
  });
});
