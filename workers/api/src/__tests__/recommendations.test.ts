/**
 * Integration tests for workers/api/src/routes/recommendations.ts —
 * the Auto-fix engine that powers the `auto-fix-checklist` recommendation
 * action type.
 *
 * Coverage:
 *   - Classification (sniffer fallback) routes each item to the right kind
 *   - AUDIT_DB handler returns findings using only D1 (no external calls)
 *   - AUTO_FIX_SCHEDULE handler shifts posts into Mon-Fri 9am-5pm UTC
 *   - Manual-only items pass through with the "Requires your action" hint
 *   - Rate-limit fires at 10/min per uid
 *   - Agency tenant guard rejects a clientId not owned by the caller
 *
 * Mirrors the in-memory D1 shim pattern from auth-security.test.ts /
 * postproxy-routes.test.ts. No fetch mock needed — the sniffer fallback
 * triggers when neither ANTHROPIC_API_KEY nor OPENROUTER_API_KEY is set,
 * which is the default in these tests. That keeps the suite hermetic.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// Auth + rate-limit mocks. The test injects "I am uid X" via a header,
// and rate-limit returns whatever the test sets on a shared variable.
let rateLimitedNext = false;
vi.mock('../auth', () => ({
  getAuthUserId: async (req: Request) => req.headers.get('X-Test-Uid') || null,
  isRateLimited: async () => rateLimitedNext,
}));

import {
  registerRecommendationsRoutes,
  isInsideWindow,
  nextWindowSlot,
} from '../routes/recommendations';
import type { Env } from '../env';

// ── Mini in-memory D1 ────────────────────────────────────────────────────
type Row = Record<string, unknown>;
interface MiniDb {
  users: Map<string, Row>;
  clients: Map<string, Row>;
  posts: Map<string, Row>;
  client_facts: Row[];
}

function makeDb(): MiniDb {
  return {
    users: new Map(),
    clients: new Map(),
    posts: new Map(),
    client_facts: [],
  };
}

function makeD1(db: MiniDb): D1Database {
  function exec(sql: string, params: unknown[]): { changes: number; rows: Row[] } {
    const s = sql.replace(/\s+/g, ' ').trim();

    // ── clients ─────────────────────────────────────────────────────────
    if (/^SELECT id FROM clients WHERE id = \? AND user_id = \?$/i.test(s)) {
      const [id, uid] = params as [string, string];
      const c = db.clients.get(id);
      if (c && c.user_id === uid) return { changes: 0, rows: [{ id }] };
      return { changes: 0, rows: [] };
    }

    // ── posts: read scheduled, COALESCE(client_id, '') = ? ─────────────
    if (/^SELECT scheduled_for FROM posts WHERE user_id = \? AND COALESCE\(client_id, ''\) = \? AND status = 'Scheduled' AND scheduled_for IS NOT NULL$/i.test(s)) {
      const [uid, clientId] = params as [string, string];
      const rows = [...db.posts.values()].filter((p) =>
        p.user_id === uid
        && (p.client_id || '') === clientId
        && p.status === 'Scheduled'
        && p.scheduled_for !== null
      ).map((p) => ({ scheduled_for: p.scheduled_for }));
      return { changes: 0, rows };
    }

    if (/^SELECT id, scheduled_for FROM posts WHERE user_id = \? AND COALESCE\(client_id, ''\) = \? AND status = 'Scheduled' AND scheduled_for IS NOT NULL$/i.test(s)) {
      const [uid, clientId] = params as [string, string];
      const rows = [...db.posts.values()].filter((p) =>
        p.user_id === uid
        && (p.client_id || '') === clientId
        && p.status === 'Scheduled'
        && p.scheduled_for !== null
      ).map((p) => ({ id: p.id, scheduled_for: p.scheduled_for }));
      return { changes: 0, rows };
    }

    // ── UPDATE posts SET scheduled_for = ? WHERE id = ? AND user_id = ?
    if (/^UPDATE posts SET scheduled_for = \? WHERE id = \? AND user_id = \?$/i.test(s)) {
      const [scheduled_for, id, uid] = params;
      const p = db.posts.get(id as string);
      if (!p || p.user_id !== uid) return { changes: 0, rows: [] };
      p.scheduled_for = scheduled_for;
      return { changes: 1, rows: [] };
    }

    // ── client_facts aggregate (AUDIT_DB)
    if (/^SELECT COUNT\(\*\) as cnt, AVG\(engagement_score\) as avg_score FROM client_facts/i.test(s)) {
      const [uid, clientId] = params as [string, string];
      const rows = db.client_facts.filter((f) =>
        f.user_id === uid
        && (f.client_id || '') === clientId
        && f.fact_type === 'own_post'
      );
      const cnt = rows.length;
      const avg = cnt > 0
        ? rows.reduce((s, f) => s + (f.engagement_score as number), 0) / cnt
        : null;
      return { changes: 0, rows: [{ cnt, avg_score: avg }] };
    }

    // ── social_tokens reads
    if (/^SELECT social_tokens FROM users WHERE id = \?$/i.test(s)) {
      const u = db.users.get(params[0] as string);
      return { changes: 0, rows: u ? [{ social_tokens: u.social_tokens ?? null }] : [] };
    }
    if (/^SELECT social_tokens FROM clients WHERE id = \? AND user_id = \?$/i.test(s)) {
      const [id, uid] = params as [string, string];
      const c = db.clients.get(id);
      if (c && c.user_id === uid) return { changes: 0, rows: [{ social_tokens: c.social_tokens ?? null }] };
      return { changes: 0, rows: [] };
    }

    // ── users profile read (SUGGEST_REWRITE context)
    if (/^SELECT profile FROM users WHERE id = \?$/i.test(s)) {
      const u = db.users.get(params[0] as string);
      return { changes: 0, rows: u ? [{ profile: u.profile ?? null }] : [] };
    }

    throw new Error(`MiniDb: unhandled SQL: ${s}`);
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
          async first<T = Row>(): Promise<T | null> {
            const { rows } = exec(sql, params);
            return (rows[0] as T) ?? null;
          },
          async all<T = Row>(): Promise<D1Result<T>> {
            const { rows } = exec(sql, params);
            return {
              results: rows as T[],
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

function makeApp(db: MiniDb) {
  const app = new Hono<{ Bindings: Env }>();
  registerRecommendationsRoutes(app);
  const env = {
    DB: makeD1(db),
    CLERK_SECRET_KEY: 'sk_test',
    // No LLM provider keys → classifier falls back to the keyword sniffer
    // (hermetic, no fetch needed).
  } as unknown as Env;
  return { app, env };
}

let db: MiniDb;
beforeEach(() => {
  db = makeDb();
  rateLimitedNext = false;
});

// ── Auth + rate-limit ────────────────────────────────────────────────────

describe('POST /api/recommendations/auto-fix-checklist — guards', () => {
  it('401s without X-Test-Uid', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: ['Audit page settings'] }),
    }, env);
    expect(res.status).toBe(401);
  });

  it('429s when isRateLimited returns true', async () => {
    rateLimitedNext = true;
    const { app, env } = makeApp(db);
    const res = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({ items: ['Audit page settings'] }),
    }, env);
    expect(res.status).toBe(429);
  });

  it('400s when items is missing or empty', async () => {
    const { app, env } = makeApp(db);
    const r1 = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({}),
    }, env);
    expect(r1.status).toBe(400);
    const r2 = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({ items: [] }),
    }, env);
    expect(r2.status).toBe(400);
  });

  it('403s when clientId is not owned by the caller (agency tenant guard)', async () => {
    db.clients.set('client_x', { id: 'client_x', user_id: 'OTHER_USER' });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({ items: ['anything'], clientId: 'client_x' }),
    }, env);
    expect(res.status).toBe(403);
  });

  it('accepts clientId owned by the caller', async () => {
    db.clients.set('client_x', { id: 'client_x', user_id: 'user_a' });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({
        items: ['Boost a post with $5-10 budget'],
        clientId: 'client_x',
      }),
    }, env);
    expect(res.status).toBe(200);
  });
});

// ── Classification → per-kind dispatch (uses the keyword sniffer) ──────

describe('classification fallback (sniffer) → per-kind dispatch', () => {
  it('routes each item to the right kind', async () => {
    const { app, env } = makeApp(db);
    const items = [
      'Boost a post with $5-10 budget to confirm audience exists',                   // MANUAL_ONLY
      'Audit page description and CTA — ensure it mentions App Development',         // SUGGEST_REWRITE (no FB tokens → failed)
      'Verify posting times align with Central QLD business hours (9am-5pm)',        // AUTO_FIX_SCHEDULE
      'Check page visibility settings - ensure page is public',                       // AUDIT_FB_PAGE (no FB tokens → failed)
      'Review follower count and growth trend',                                       // AUDIT_FB_PAGE
      'Look at recent engagement data',                                               // AUDIT_DB (default catch)
    ];
    const res = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({ items }),
    }, env);
    expect(res.status).toBe(200);
    const json = await res.json() as { results: Array<{ kind: string; status: string; item: string }> };
    expect(json.results.length).toBe(6);
    expect(json.results[0].kind).toBe('manual');
    expect(json.results[0].status).toBe('ok'); // manual items always 'ok'
    expect(json.results[1].kind).toBe('suggest'); // SUGGEST_REWRITE
    expect(json.results[2].kind).toBe('auto_fix'); // AUTO_FIX_SCHEDULE
    expect(json.results[3].kind).toBe('audit'); // AUDIT_FB_PAGE → no tokens, status failed
    expect(json.results[4].kind).toBe('audit');
    expect(json.results[5].kind).toBe('audit'); // AUDIT_DB
  });
});

// ── AUDIT_DB handler ────────────────────────────────────────────────────

describe('AUDIT_DB handler', () => {
  it('returns findings when scheduled posts fall outside the window', async () => {
    // Sunday 5am UTC — outside Mon-Fri 9am-5pm
    db.posts.set('p1', {
      id: 'p1', user_id: 'user_a', client_id: null,
      status: 'Scheduled', scheduled_for: '2026-05-17T05:00:00.000Z', // Sunday
    });
    // Tuesday 11am UTC — inside
    db.posts.set('p2', {
      id: 'p2', user_id: 'user_a', client_id: null,
      status: 'Scheduled', scheduled_for: '2026-05-19T11:00:00.000Z',
    });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({ items: ['Look at recent engagement data in the database'] }),
    }, env);
    const json = await res.json() as { results: Array<{ kind: string; status: string; payload?: any }> };
    expect(json.results[0].kind).toBe('audit');
    expect(json.results[0].status).toBe('finding');
    expect(json.results[0].payload.outside_window_count).toBe(1);
    expect(json.results[0].payload.scheduled_count).toBe(2);
  });

  it('returns ok when every scheduled post is inside the window', async () => {
    db.posts.set('p1', {
      id: 'p1', user_id: 'user_a', client_id: null,
      status: 'Scheduled', scheduled_for: '2026-05-19T11:00:00.000Z', // Tue 11am UTC
    });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({ items: ['Look at recent engagement data in the database'] }),
    }, env);
    const json = await res.json() as { results: Array<{ kind: string; status: string }> };
    expect(json.results[0].status).toBe('ok');
  });
});

// ── AUTO_FIX_SCHEDULE handler ───────────────────────────────────────────

describe('AUTO_FIX_SCHEDULE handler', () => {
  it('shifts posts outside the window into the next valid slot and updates D1', async () => {
    // Saturday 3am UTC — needs to move to Monday 9am UTC
    db.posts.set('p1', {
      id: 'p1', user_id: 'user_a', client_id: null,
      status: 'Scheduled', scheduled_for: '2026-05-16T03:00:00.000Z',
    });
    // Friday 10pm UTC — outside the window (after 5pm UTC), should move to Mon
    db.posts.set('p2', {
      id: 'p2', user_id: 'user_a', client_id: null,
      status: 'Scheduled', scheduled_for: '2026-05-15T22:00:00.000Z',
    });
    // Tuesday 2pm UTC — inside, should NOT move
    db.posts.set('p3', {
      id: 'p3', user_id: 'user_a', client_id: null,
      status: 'Scheduled', scheduled_for: '2026-05-19T14:00:00.000Z',
    });
    const original3 = db.posts.get('p3')!.scheduled_for;

    const { app, env } = makeApp(db);
    const res = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({
        items: ['Reschedule posts to align with business hours 9am-5pm'],
      }),
    }, env);
    const json = await res.json() as { results: Array<{ kind: string; status: string; payload?: any }> };
    expect(json.results[0].kind).toBe('auto_fix');
    expect(json.results[0].status).toBe('fixed');
    expect(json.results[0].payload.shifted).toBe(2);

    // p3 stayed where it was
    expect(db.posts.get('p3')!.scheduled_for).toBe(original3);
    // p1 + p2 both landed inside the window
    expect(isInsideWindow(db.posts.get('p1')!.scheduled_for as string)).toBe(true);
    expect(isInsideWindow(db.posts.get('p2')!.scheduled_for as string)).toBe(true);
  });

  it('returns ok when nothing needs shifting', async () => {
    db.posts.set('p1', {
      id: 'p1', user_id: 'user_a', client_id: null,
      status: 'Scheduled', scheduled_for: '2026-05-19T11:00:00.000Z',
    });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/recommendations/auto-fix-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({
        items: ['Reschedule posts into business hours'],
      }),
    }, env);
    const json = await res.json() as { results: Array<{ status: string; payload?: any }> };
    expect(json.results[0].status).toBe('ok');
    expect(json.results[0].payload.shifted).toBe(0);
  });
});

// ── Pure helpers ────────────────────────────────────────────────────────

describe('isInsideWindow + nextWindowSlot', () => {
  it.each([
    ['2026-05-19T09:00:00.000Z', true],   // Tue 9am UTC
    ['2026-05-19T16:59:00.000Z', true],   // Tue 4:59pm UTC
    ['2026-05-19T17:00:00.000Z', false],  // Tue 5pm UTC — at end of window
    ['2026-05-19T08:59:00.000Z', false],  // Tue 8:59am UTC
    ['2026-05-16T11:00:00.000Z', false],  // Sat 11am UTC — weekend
    ['2026-05-17T11:00:00.000Z', false],  // Sun 11am UTC — weekend
  ])('isInsideWindow("%s") = %s', (iso, expected) => {
    expect(isInsideWindow(iso)).toBe(expected);
  });

  it('nextWindowSlot moves a Saturday into the following Monday window', () => {
    const sat = '2026-05-16T03:00:00.000Z'; // Sat
    const next = nextWindowSlot(sat);
    expect(isInsideWindow(next)).toBe(true);
    // The returned time should be on a weekday (Mon-Fri)
    const day = new Date(next).getUTCDay();
    expect(day >= 1 && day <= 5).toBe(true);
  });

  it('nextWindowSlot leaves an already-inside time roughly in place', () => {
    const tue = '2026-05-19T11:00:00.000Z'; // Tue 11am UTC
    const next = nextWindowSlot(tue);
    expect(isInsideWindow(next)).toBe(true);
    // Same hour or the next valid hour — must not skip ahead by days.
    const diffMs = Math.abs(new Date(next).getTime() - new Date(tue).getTime());
    expect(diffMs).toBeLessThan(2 * 60 * 60 * 1000);
  });
});
