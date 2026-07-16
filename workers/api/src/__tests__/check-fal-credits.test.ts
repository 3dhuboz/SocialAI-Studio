import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { checkFalCreditsAlert, cronCheckFalCredits } from '../cron/check-fal-credits';

interface AlertRow {
  alert_key: string;
  severity: string;
  first_fired_at: string;
  last_fired_at: string;
  last_email_at: string | null;
  fire_count: number;
  last_resolved_at: string | null;
  last_body: string | null;
  dark_launch: number;
}

function makeD1(rows = new Map<string, AlertRow>()): D1Database {
  const now = () => new Date().toISOString();

  function exec(sql: string, params: unknown[]): { changes: number; rows: AlertRow[] } {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/^INSERT INTO cron_alerts/i.test(s)) {
      const [key, severity, body] = params as [string, string, string];
      const existing = rows.get(key);
      if (existing) {
        existing.severity = severity;
        existing.last_fired_at = now();
        existing.fire_count += 1;
        existing.last_body = body;
      } else {
        const t = now();
        rows.set(key, {
          alert_key: key,
          severity,
          first_fired_at: t,
          last_fired_at: t,
          last_email_at: null,
          fire_count: 1,
          last_resolved_at: null,
          last_body: body,
          dark_launch: 0,
        });
      }
      return { changes: 1, rows: [] };
    }

    if (/^SELECT .* FROM cron_alerts WHERE alert_key = \?$/i.test(s)) {
      const [key] = params as [string];
      const row = rows.get(key);
      return { changes: 0, rows: row ? [row] : [] };
    }

    if (/^UPDATE cron_alerts SET last_email_at/i.test(s)) {
      const [key] = params as [string];
      const row = rows.get(key);
      if (row) row.last_email_at = now();
      return { changes: 1, rows: [] };
    }

    if (/^UPDATE cron_alerts SET last_resolved_at/i.test(s)) {
      const [key] = params as [string];
      const row = rows.get(key);
      if (row) {
        row.last_resolved_at = now();
        row.last_email_at = null;
      }
      return { changes: 1, rows: [] };
    }

    throw new Error(`Unhandled SQL in fal credit test: ${s}`);
  }

  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const { changes } = exec(sql, params);
              return {
                success: true,
                meta: { changes, duration: 0, last_row_id: 0, rows_read: 0, rows_written: changes, changed_db: changes > 0, size_after: 0 },
              } as D1Result;
            },
            async first<T>() {
              const { rows: resultRows } = exec(sql, params);
              return (resultRows[0] as T) ?? null;
            },
          };
        },
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function makeEnv(rows?: Map<string, AlertRow>): Env {
  return {
    DB: makeD1(rows),
    FAL_API_KEY: 'fal_test',
    RESEND_API_KEY: 're_test',
  } as unknown as Env;
}

function mockFalAndResend(balances: number[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === 'https://api.fal.ai/v1/account/billing?expand=credits') {
      expect(init?.headers).toEqual({ Authorization: 'Key fal_test' });
      const balance = balances.shift();
      return Response.json({
        username: 'socialai-studio',
        credits: { current_balance: balance, currency: 'USD' },
      });
    }
    if (url === 'https://api.resend.com/emails') {
      return Response.json({ id: 'email_test' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function resendCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => url === 'https://api.resend.com/emails');
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('cronCheckFalCredits', () => {
  it('sends only one low-credit email while the balance remains below threshold', async () => {
    const rows = new Map<string, AlertRow>();
    const env = makeEnv(rows);
    const fetchMock = mockFalAndResend([3.21, 2.5]);

    await cronCheckFalCredits(env);
    await cronCheckFalCredits(env);

    expect(resendCalls(fetchMock)).toHaveLength(1);
    expect(rows.get('fal_credits_low')?.fire_count).toBe(2);
    expect(rows.get('fal_credits_low')?.last_email_at).toBeTruthy();
  });

  it('re-arms the low-credit email after the balance recovers', async () => {
    const rows = new Map<string, AlertRow>();
    const env = makeEnv(rows);
    const fetchMock = mockFalAndResend([3.21, 9, 2.5]);

    await cronCheckFalCredits(env);
    await cronCheckFalCredits(env);
    await cronCheckFalCredits(env);

    expect(resendCalls(fetchMock)).toHaveLength(2);
    expect(rows.get('fal_credits_low')?.fire_count).toBe(2);
    expect(rows.get('fal_credits_low')?.last_resolved_at).toBeTruthy();
  });

  it('reports a controlled error when fal returns a non-JSON billing response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><title>Retired</title>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })));

    await expect(checkFalCreditsAlert(makeEnv())).rejects.toThrow(
      'fal.ai billing API returned an invalid response',
    );
  });
});
