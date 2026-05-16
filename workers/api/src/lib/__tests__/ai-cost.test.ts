/**
 * AI-cost regression tests — guards the 2026-05-16 cost-cuts PR.
 *
 * Three behaviours we never want to regress:
 *   (a) Score=5 ships (no regen). The audit raised the regen bar from
 *       "<=5 regen" to "<5 regen" because empirical retries on score=5
 *       rarely lift it but always cost ~$0.04 FLUX + $0.003 critique.
 *   (b) Draft posts are excluded from runBacklogRegen. Drafts may never
 *       publish, so paying to regen their images up front is waste.
 *   (c) logAiUsage writes a row to D1 with the canonical column set, so
 *       per-tenant spend attribution actually works.
 *
 * We assert via the SQL bodies + a fake D1 — no Cloudflare runtime needed.
 * Run with: `npm test`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBacklogRegen, backfillImagesForUser } from '../backfill';
import { logAiUsage } from '../ai-usage';
import type { Env } from '../../env';

// ── D1 fake ────────────────────────────────────────────────────────────────
// Minimal in-memory shim — records every prepare(sql).bind(...).run/all/first
// call so tests can assert against the actual SQL strings + bound params.

type PreparedCall = { sql: string; bindings: unknown[]; kind: 'run' | 'all' | 'first' };

function makeFakeDB(opts: {
  /** What the `pending` COUNT(*) query returns. Default n=0 (no work). */
  countResult?: { n: number };
  /** What the rows-to-process SELECT returns. */
  selectRows?: any[];
  /** Capture every prepared call for assertions. */
  calls?: PreparedCall[];
} = {}) {
  const calls = opts.calls ?? [];
  const countResult = opts.countResult ?? { n: 0 };
  const selectRows = opts.selectRows ?? [];

  // Match the COUNT(*) query vs the row-fetch SELECT to decide what to return.
  // SQL strings are pattern-matched on `as n` (COUNT) vs `SELECT id` (rows).
  const prepare = (sql: string) => ({
    bind: (...bindings: unknown[]) => ({
      first: async <T,>(): Promise<T | null> => {
        calls.push({ sql, bindings, kind: 'first' });
        if (/as\s+n\b/i.test(sql)) return countResult as unknown as T;
        return null;
      },
      all: async <T,>() => {
        calls.push({ sql, bindings, kind: 'all' });
        return { results: selectRows as T[] };
      },
      run: async () => {
        calls.push({ sql, bindings, kind: 'run' });
        return { success: true, meta: {} };
      },
    }),
  });

  return { prepare, calls };
}

function makeEnv(db: ReturnType<typeof makeFakeDB>, overrides: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as Env['DB'],
    CLERK_SECRET_KEY: 'test',
    OPENROUTER_API_KEY: 'test',
    FAL_API_KEY: 'test',
    ...overrides,
  } as Env;
}

describe('AI-cost regression — runBacklogRegen', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('(a) score=5 does NOT trigger regen — only score < 5 is pulled', async () => {
    // The threshold default is 5; the predicate is `score < ?` so a row
    // with score=5 must not appear in the COUNT(*) result. We simulate
    // this by having the fake D1 say "no pending work" (n=0) and asserting
    // that the COUNT query body uses `<`, not `<=`.
    const db = makeFakeDB({ countResult: { n: 0 } });
    const env = makeEnv(db);
    const result = await runBacklogRegen(env);
    expect(result.skipped).toBe(true);
    // Find the COUNT query (the cheap gate)
    const countCall = db.calls.find(c => /as\s+n\b/i.test(c.sql));
    expect(countCall, 'expected a COUNT(*) gate query').toBeDefined();
    // Critical assertion: must be strict-less-than, not less-equal.
    expect(countCall!.sql).toMatch(/image_critique_score\s*<\s*\?/);
    expect(countCall!.sql).not.toMatch(/image_critique_score\s*<=\s*\?/);
    // Threshold binding is the first positional param.
    expect(countCall!.bindings[0]).toBe(5);
  });

  it('(b) Draft posts are excluded from runBacklogRegen — status=Scheduled only', async () => {
    const db = makeFakeDB({ countResult: { n: 0 } });
    const env = makeEnv(db);
    await runBacklogRegen(env);
    const countCall = db.calls.find(c => /as\s+n\b/i.test(c.sql));
    expect(countCall).toBeDefined();
    // Must filter to Scheduled only — pre-fix it was status IN ('Scheduled','Draft').
    expect(countCall!.sql).toMatch(/status\s*=\s*'Scheduled'/);
    expect(countCall!.sql).not.toMatch(/IN\s*\(\s*'Scheduled'\s*,\s*'Draft'/i);
    // And exclude stale scheduled rows (>14 days old).
    expect(countCall!.sql).toMatch(/scheduled_for IS NOT NULL/i);
    expect(countCall!.sql).toMatch(/datetime\('now',\s*'-14 days'\)/i);
  });

  it('runBacklogRegen no-ops gracefully when FAL_API_KEY is unset', async () => {
    const db = makeFakeDB();
    const env = makeEnv(db, { FAL_API_KEY: undefined });
    const result = await runBacklogRegen(env);
    expect(result.skipped).toBe(true);
    // Must not have issued any D1 calls — the early return short-circuits.
    expect(db.calls.length).toBe(0);
  });
});

describe('AI-cost regression — manual backfill endpoint', () => {
  it('(c-stale-guard) backfillImagesForUser SQL excludes stale + draft rows', async () => {
    const db = makeFakeDB({ selectRows: [] });
    const env = makeEnv(db);
    await backfillImagesForUser(env, 'user_abc');
    // The route handler runs a single SELECT, then bails because rows=[].
    const selectCall = db.calls.find(c => /SELECT p\.id, p\.image_prompt/i.test(c.sql));
    expect(selectCall, 'expected the rows-to-process SELECT').toBeDefined();
    // Status filter must pin to Scheduled (not Draft).
    expect(selectCall!.sql).toMatch(/p\.status\s*=\s*'Scheduled'/);
    // Stale-row guard: 7-day cutoff (admin-facing endpoint is tighter than
    // the cron's 14-day window because the admin's intent is usually to fix
    // the *next* publish, not historical zombies).
    expect(selectCall!.sql).toMatch(/p\.scheduled_for IS NOT NULL/i);
    expect(selectCall!.sql).toMatch(/datetime\('now',\s*'-7 days'\)/i);
  });
});

describe('AI-cost regression — logAiUsage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('writes a row to ai_usage with the canonical column set', async () => {
    const db = makeFakeDB();
    const env = makeEnv(db);
    await logAiUsage(env, {
      userId: 'user_123',
      clientId: 'client_456',
      provider: 'fal',
      model: 'flux-dev',
      operation: 'image-gen',
      imagesGenerated: 1,
      estCostUsd: 0.025,
      postId: 'post_789',
      ok: true,
    });
    // Exactly one INSERT call.
    expect(db.calls.length).toBe(1);
    const call = db.calls[0];
    expect(call.kind).toBe('run');
    // SQL must target ai_usage and the 11 columns we agreed on.
    expect(call.sql).toMatch(/INSERT INTO ai_usage/i);
    expect(call.sql).toMatch(/user_id, client_id, provider, model, operation/);
    expect(call.sql).toMatch(/tokens_in, tokens_out, images_generated, est_cost_usd, post_id, ok/);
    // Positional bindings — column order from helper matches SQL.
    expect(call.bindings).toEqual([
      'user_123',
      'client_456',
      'fal',
      'flux-dev',
      'image-gen',
      null, // tokensIn unset
      null, // tokensOut unset
      1,    // imagesGenerated
      0.025,
      'post_789',
      1,    // ok=true → 1
    ]);
  });

  it('coerces ok=false to 0 and nulls out missing IDs', async () => {
    const db = makeFakeDB();
    const env = makeEnv(db);
    await logAiUsage(env, {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      operation: 'critique',
      ok: false,
    });
    expect(db.calls.length).toBe(1);
    const bindings = db.calls[0].bindings;
    expect(bindings[0]).toBeNull();        // userId
    expect(bindings[1]).toBeNull();        // clientId
    expect(bindings[bindings.length - 2]).toBeNull(); // postId
    expect(bindings[bindings.length - 1]).toBe(0);    // ok
  });

  it('is a no-op when env.ENVIRONMENT is set to anything other than production', async () => {
    const db = makeFakeDB();
    const env = makeEnv(db, { ENVIRONMENT: 'dev' } as any);
    await logAiUsage(env, {
      provider: 'fal',
      model: 'flux-dev',
      operation: 'image-gen',
    });
    // Must not have issued any D1 writes.
    expect(db.calls.length).toBe(0);
  });

  it('writes when env.ENVIRONMENT is undefined (today\'s prod deploy)', async () => {
    const db = makeFakeDB();
    const env = makeEnv(db); // no ENVIRONMENT field
    await logAiUsage(env, {
      provider: 'fal',
      model: 'flux-dev',
      operation: 'image-gen',
    });
    expect(db.calls.length).toBe(1);
  });

  it('writes when env.ENVIRONMENT="production"', async () => {
    const db = makeFakeDB();
    const env = makeEnv(db, { ENVIRONMENT: 'production' } as any);
    await logAiUsage(env, {
      provider: 'fal',
      model: 'flux-dev',
      operation: 'image-gen',
    });
    expect(db.calls.length).toBe(1);
  });

  it('swallows D1 errors so a logging failure never breaks the underlying op', async () => {
    // D1 stub that throws on .run() — simulates schema-drift or D1 outage.
    const env: Env = {
      DB: {
        prepare: () => ({
          bind: () => ({
            run: async () => { throw new Error('table ai_usage not found'); },
          }),
        }),
      } as unknown as Env['DB'],
      CLERK_SECRET_KEY: 'test',
    } as Env;
    // Spy on console.warn to confirm the swallowed error gets surfaced.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
    // Must not throw.
    await expect(logAiUsage(env, {
      provider: 'fal',
      model: 'flux-dev',
      operation: 'image-gen',
    })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
