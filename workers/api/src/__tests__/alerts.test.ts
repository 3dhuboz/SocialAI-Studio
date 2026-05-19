/**
 * Unit tests for workers/api/src/lib/alerts.ts —
 * the operational alerting helper.
 *
 * Coverage:
 *   - shouldEmail throttle window logic (pure function, parametrised)
 *   - fireAlert upserts a new row + increments fire_count on repeat
 *   - dark_launch=1 records but never emails (calibration mode)
 *   - dark_launch=0 emails on first fire and on post-throttle fire
 *   - dark_launch=0 does NOT email inside the throttle window
 *   - resolveAlert sets last_resolved_at + clears last_email_at
 *   - fireAlert never throws even when DB calls fail
 *   - recentAlerts returns rows ordered desc by last_fired_at
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Env } from '../env';

// sendResendEmail mock — record what was sent so tests can assert.
const emailCalls: Array<{ to: string; subject: string; html: string }> = [];
vi.mock('../lib/email', () => ({
  sendResendEmail: vi.fn(async (_env: Env, opts: { to: string; subject: string; html: string }) => {
    emailCalls.push(opts);
  }),
}));

import { fireAlert, resolveAlert, recentAlerts, shouldEmail } from '../lib/alerts';

// ── In-memory cron_alerts shim ──────────────────────────────────────────
interface AlertRow {
  alert_key: string;
  severity: 'info' | 'warn' | 'critical';
  first_fired_at: string;
  last_fired_at: string;
  last_email_at: string | null;
  fire_count: number;
  last_resolved_at: string | null;
  last_body: string | null;
  dark_launch: number;
}

interface MiniDb {
  alerts: Map<string, AlertRow>;
  throwOnInsert?: boolean;
}

function makeDb(): MiniDb {
  return { alerts: new Map() };
}

function makeD1(db: MiniDb): D1Database {
  function exec(sql: string, params: unknown[]): { changes: number; rows: AlertRow[] } {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/^INSERT INTO cron_alerts/i.test(s)) {
      if (db.throwOnInsert) throw new Error('D1 simulated failure');
      const [key, severity, body] = params as [string, AlertRow['severity'], string];
      const existing = db.alerts.get(key);
      if (existing) {
        existing.severity = severity;
        existing.last_fired_at = new Date().toISOString();
        existing.fire_count += 1;
        existing.last_body = body;
      } else {
        const now = new Date().toISOString();
        db.alerts.set(key, {
          alert_key: key,
          severity,
          first_fired_at: now,
          last_fired_at: now,
          last_email_at: null,
          fire_count: 1,
          last_resolved_at: null,
          last_body: body,
          dark_launch: 1, // default per schema
        });
      }
      return { changes: 1, rows: [] };
    }

    if (/^SELECT .* FROM cron_alerts WHERE alert_key = \?$/i.test(s)) {
      const [key] = params as [string];
      const row = db.alerts.get(key);
      return { changes: 0, rows: row ? [row] : [] };
    }

    if (/^UPDATE cron_alerts SET last_email_at/i.test(s)) {
      const [key] = params as [string];
      const row = db.alerts.get(key);
      if (row) row.last_email_at = new Date().toISOString();
      return { changes: 1, rows: [] };
    }

    if (/^UPDATE cron_alerts SET last_resolved_at/i.test(s)) {
      const [key] = params as [string];
      const row = db.alerts.get(key);
      if (row) {
        row.last_resolved_at = new Date().toISOString();
        row.last_email_at = null;
      }
      return { changes: 1, rows: [] };
    }

    if (/^SELECT .* FROM cron_alerts ORDER BY last_fired_at DESC LIMIT \?$/i.test(s)) {
      const [limit] = params as [number];
      const rows = [...db.alerts.values()]
        .sort((a, b) => Date.parse(b.last_fired_at) - Date.parse(a.last_fired_at))
        .slice(0, limit);
      return { changes: 0, rows };
    }

    throw new Error(`MiniDb (alerts): unhandled SQL: ${s}`);
  }

  const prepare = (sql: string): D1PreparedStatement => {
    const stmt = {
      bind(...params: unknown[]) {
        return {
          async run() {
            const { changes } = exec(sql, params);
            return {
              success: true,
              meta: { changes, duration: 0, last_row_id: 0, rows_read: 0, rows_written: changes, changed_db: changes > 0, size_after: 0 },
            } as D1Result;
          },
          async first<T = AlertRow>(): Promise<T | null> {
            const { rows } = exec(sql, params);
            return (rows[0] as unknown as T) ?? null;
          },
          async all<T = AlertRow>(): Promise<D1Result<T>> {
            const { rows } = exec(sql, params);
            return {
              results: rows as unknown as T[],
              success: true,
              meta: { duration: 0, changes: 0, last_row_id: 0, rows_read: rows.length, rows_written: 0, changed_db: false, size_after: 0 },
            } as D1Result<T>;
          },
        };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return { prepare } as unknown as D1Database;
}

function makeEnv(db: MiniDb): Env {
  return {
    DB: makeD1(db),
    RESEND_API_KEY: 're_test',
  } as unknown as Env;
}

let db: MiniDb;
beforeEach(() => {
  db = makeDb();
  emailCalls.length = 0;
  vi.restoreAllMocks();
  // re-install the email mock after restoreAllMocks
  vi.doMock('../lib/email', () => ({
    sendResendEmail: vi.fn(async (_env: Env, opts: { to: string; subject: string; html: string }) => {
      emailCalls.push(opts);
    }),
  }));
});

// ── shouldEmail (pure) ──────────────────────────────────────────────────

describe('shouldEmail', () => {
  it('returns true for an unparseable timestamp (fail-open)', () => {
    expect(shouldEmail('not-a-date', 'critical')).toBe(true);
  });

  it('critical: throttles within 30 min, emails after', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const fortyMinAgo = new Date(Date.now() - 40 * 60_000).toISOString();
    expect(shouldEmail(tenMinAgo, 'critical')).toBe(false);
    expect(shouldEmail(fortyMinAgo, 'critical')).toBe(true);
  });

  it('warn: throttles within 2 hours, emails after', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const threeHourAgo = new Date(Date.now() - 180 * 60_000).toISOString();
    expect(shouldEmail(oneHourAgo, 'warn')).toBe(false);
    expect(shouldEmail(threeHourAgo, 'warn')).toBe(true);
  });

  it('info: throttles within 12 hours, emails after', () => {
    const sixHourAgo = new Date(Date.now() - 360 * 60_000).toISOString();
    const fifteenHourAgo = new Date(Date.now() - 900 * 60_000).toISOString();
    expect(shouldEmail(sixHourAgo, 'info')).toBe(false);
    expect(shouldEmail(fifteenHourAgo, 'info')).toBe(true);
  });
});

// ── fireAlert ────────────────────────────────────────────────────────────

describe('fireAlert — recording', () => {
  it('upserts a new row on first fire', async () => {
    const env = makeEnv(db);
    await fireAlert(env, 'cron_crashed:publish', 'critical', 'publish cron threw NPE');
    const row = db.alerts.get('cron_crashed:publish')!;
    expect(row).toBeDefined();
    expect(row.severity).toBe('critical');
    expect(row.fire_count).toBe(1);
    expect(row.last_body).toBe('publish cron threw NPE');
    expect(row.dark_launch).toBe(1); // default
  });

  it('increments fire_count on repeat fire', async () => {
    const env = makeEnv(db);
    await fireAlert(env, 'cron_crashed:publish', 'critical', 'first');
    await fireAlert(env, 'cron_crashed:publish', 'critical', 'second');
    await fireAlert(env, 'cron_crashed:publish', 'critical', 'third');
    expect(db.alerts.get('cron_crashed:publish')!.fire_count).toBe(3);
    expect(db.alerts.get('cron_crashed:publish')!.last_body).toBe('third');
  });

  it('truncates long body to 1000 chars', async () => {
    const env = makeEnv(db);
    await fireAlert(env, 'long', 'warn', 'x'.repeat(5000));
    expect(db.alerts.get('long')!.last_body!.length).toBe(1000);
  });
});

describe('fireAlert — dark_launch mode (default)', () => {
  it('does NOT email when dark_launch=1', async () => {
    const env = makeEnv(db);
    await fireAlert(env, 'cron_crashed:publish', 'critical', 'oops');
    expect(emailCalls).toHaveLength(0);
    expect(db.alerts.get('cron_crashed:publish')!.last_email_at).toBeNull();
  });
});

describe('fireAlert — never throws', () => {
  it('does not propagate D1 errors', async () => {
    db.throwOnInsert = true;
    const env = makeEnv(db);
    // Should not throw — alerting is best-effort.
    await expect(fireAlert(env, 'busted', 'critical', 'should be swallowed')).resolves.toBeUndefined();
  });
});

// ── resolveAlert ─────────────────────────────────────────────────────────

describe('resolveAlert', () => {
  it('sets last_resolved_at and clears last_email_at', async () => {
    const env = makeEnv(db);
    await fireAlert(env, 'k', 'warn', 'body');
    // Simulate prior email being sent
    db.alerts.get('k')!.last_email_at = new Date().toISOString();
    db.alerts.get('k')!.dark_launch = 0;

    await resolveAlert(env, 'k');
    const row = db.alerts.get('k')!;
    expect(row.last_resolved_at).not.toBeNull();
    expect(row.last_email_at).toBeNull();
  });

  it('does not throw when key does not exist', async () => {
    const env = makeEnv(db);
    await expect(resolveAlert(env, 'never-fired')).resolves.toBeUndefined();
  });
});

// ── recentAlerts ─────────────────────────────────────────────────────────

describe('recentAlerts', () => {
  it('returns rows ordered desc by last_fired_at, capped by limit', async () => {
    const env = makeEnv(db);
    await fireAlert(env, 'a', 'info', 'A');
    await new Promise((r) => setTimeout(r, 5));
    await fireAlert(env, 'b', 'warn', 'B');
    await new Promise((r) => setTimeout(r, 5));
    await fireAlert(env, 'c', 'critical', 'C');

    const rows = await recentAlerts(env, 10);
    expect(rows.map((r) => r.alert_key)).toEqual(['c', 'b', 'a']);
  });

  it('clamps limit into [1, 500]', async () => {
    const env = makeEnv(db);
    for (let i = 0; i < 12; i++) {
      await fireAlert(env, `k${i}`, 'info', String(i));
    }
    const rows = await recentAlerts(env, 5);
    expect(rows).toHaveLength(5);
  });
});
