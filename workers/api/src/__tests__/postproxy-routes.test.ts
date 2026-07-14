/**
 * Integration tests for workers/api/src/routes/postproxy.ts — focused
 * on the webhook endpoint's auth (HMAC + query-secret fallback) and
 * idempotent re-delivery behaviour. The connect/save-placement routes
 * are exercised by manual QA + the Frontend specialist's tests; the
 * webhook is where dedup correctness matters most.
 *
 * Pattern mirrors __tests__/auth-security.test.ts: a tiny in-memory D1
 * shim + Hono's app.request() dispatcher. Pure stdlib so no extra
 * dev-deps needed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// Auth mock — not used by /webhook but required for the other routes
// when this file is loaded. /webhook is publicly reachable, so it never
// reads X-Test-Uid.
vi.mock('../auth', () => ({
  getAuthUserId: async (req: Request) => req.headers.get('X-Test-Uid') || null,
  requireAdmin: async () => new Response('Forbidden', { status: 403 }),
  isRateLimited: async () => false,
}));

import { registerPostproxyRoutes } from '../routes/postproxy';
import type { Env } from '../env';

// ── Mini in-memory D1 ────────────────────────────────────────────────────
type Row = Record<string, unknown>;
interface MiniDb {
  posts: Map<string, Row>;
  postproxy_profiles: Map<string, Row>;
  postproxy_webhook_events: Map<string, Row>;
  publication_events: Map<string, Row>;
}

function makeDb(): MiniDb {
  return {
    posts: new Map(),
    postproxy_profiles: new Map(),
    postproxy_webhook_events: new Map(),
    publication_events: new Map(),
  };
}

function makeD1(db: MiniDb): D1Database {
  function exec(sql: string, params: unknown[]): { changes: number; rows: Row[] } {
    const s = sql.replace(/\s+/g, ' ').trim();

    // INSERT OR IGNORE INTO postproxy_webhook_events
    if (/^INSERT OR IGNORE INTO postproxy_webhook_events/i.test(s)) {
      const [event_id, event_type, post_id, payload] = params;
      if (db.postproxy_webhook_events.has(event_id as string)) {
        return { changes: 0, rows: [] }; // dedup
      }
      db.postproxy_webhook_events.set(event_id as string, {
        event_id, event_type, post_id, payload, received_at: new Date().toISOString(),
      });
      return { changes: 1, rows: [] };
    }

    // SELECT ... FROM posts WHERE postproxy_post_id = ? LIMIT 1
    if (/^SELECT id, user_id, client_id, owner_kind, owner_id, platform FROM posts WHERE postproxy_post_id = \? LIMIT 1$/i.test(s)) {
      const ppId = params[0] as string;
      const match = [...db.posts.values()].find((p) => p.postproxy_post_id === ppId);
      return { changes: 0, rows: match ? [match] : [] };
    }

    if (/^SELECT id, reach_plan_id FROM learning_decisions/i.test(s)) {
      return { changes: 0, rows: [] };
    }

    if (/^INSERT INTO publication_events/i.test(s)) {
      const [id, user_id, workspace_key, client_id, owner_kind, owner_id,
        post_id, platform, remote_post_id, permalink, decision_id,
        reach_plan_id, published_at] = params;
      const key = `${user_id}:${workspace_key}:${post_id}:${platform}`;
      db.publication_events.set(key, {
        id, user_id, workspace_key, client_id, owner_kind, owner_id,
        post_id, platform, remote_post_id, permalink, decision_id,
        reach_plan_id, published_at,
      });
      return { changes: 1, rows: [] };
    }

    // UPDATE posts SET status='Posted' ...
    if (/^UPDATE posts SET status = 'Posted'/i.test(s)) {
      // params: permalink, finished_at, id
      const [permalink, finished_at, id] = params;
      const row = db.posts.get(id as string);
      if (!row) return { changes: 0, rows: [] };
      row.status = 'Posted';
      row.postproxy_status = 'published';
      row.postproxy_permalink = permalink;
      row.postproxy_finished_at = finished_at;
      row.claim_id = null;
      row.claim_at = null;
      return { changes: 1, rows: [] };
    }

    // UPDATE posts SET status='Missed' ... (webhook mark_failed path)
    if (/^UPDATE posts SET status = 'Missed'/i.test(s) && /postproxy_status = 'failed'/i.test(s)) {
      const [finished_at, reasoning, id] = params;
      const row = db.posts.get(id as string);
      if (!row) return { changes: 0, rows: [] };
      row.status = 'Missed';
      row.postproxy_status = 'failed';
      row.postproxy_finished_at = finished_at;
      row.reasoning = reasoning;
      row.claim_id = null;
      row.claim_at = null;
      return { changes: 1, rows: [] };
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
              meta: {
                changes, duration: 0, last_row_id: 0, rows_read: 0,
                rows_written: changes, changed_db: changes > 0, size_after: 0,
              },
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
              meta: {
                duration: 0, changes: 0, last_row_id: 0, rows_read: rows.length,
                rows_written: 0, changed_db: false, size_after: 0,
              },
            } as D1Result<T>;
          },
        };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return { prepare } as unknown as D1Database;
}

function makeApp(db: MiniDb, env: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  registerPostproxyRoutes(app);
  const fullEnv = {
    DB: makeD1(db),
    CLERK_SECRET_KEY: 'sk_test',
    POSTPROXY_API_KEY: 'pp_test',
    POSTPROXY_BASE_URL: 'https://api.postproxy.dev/api',
    ...env,
  } as unknown as Env;
  return { app, env: fullEnv };
}

async function hmacHex(body: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let db: MiniDb;
beforeEach(() => { db = makeDb(); });

describe('POST /api/postproxy/webhook — auth', () => {
  it('returns 401 when neither HMAC nor query secret is supplied', async () => {
    const { app, env } = makeApp(db, {
      POSTPROXY_WEBHOOK_SECRET: 'hmac-secret',
      POSTPROXY_WEBHOOK_QUERY_SECRET: 'query-secret',
    });
    const res = await app.request('/api/postproxy/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: 'e1', event_type: 'post.processed', data: { id: 'p1', status: 'processed' } }),
    }, env);
    expect(res.status).toBe(401);
  });

  it('accepts valid HMAC signature → 200', async () => {
    const { app, env } = makeApp(db, { POSTPROXY_WEBHOOK_SECRET: 'hmac-secret' });
    const body = JSON.stringify({
      event_id: 'e_hmac', event_type: 'post.processed',
      data: { id: 'pp_x', status: 'processed' },
    });
    const sig = await hmacHex(body, 'hmac-secret');
    const res = await app.request('/api/postproxy/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Postproxy-Signature': sig },
      body,
    }, env);
    expect(res.status).toBe(200);
    expect(db.postproxy_webhook_events.size).toBe(1);
  });

  it('rejects invalid HMAC signature → 401', async () => {
    const { app, env } = makeApp(db, { POSTPROXY_WEBHOOK_SECRET: 'hmac-secret' });
    const body = JSON.stringify({
      event_id: 'e_bad', event_type: 'post.processed',
      data: { id: 'pp_x', status: 'processed' },
    });
    // Sign with the WRONG secret
    const sig = await hmacHex(body, 'attacker-secret');
    const res = await app.request('/api/postproxy/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Postproxy-Signature': sig },
      body,
    }, env);
    expect(res.status).toBe(401);
    expect(db.postproxy_webhook_events.size).toBe(0);
  });

  it('query-string fallback succeeds when HMAC unavailable', async () => {
    const { app, env } = makeApp(db, { POSTPROXY_WEBHOOK_QUERY_SECRET: 'query-secret' });
    const body = JSON.stringify({
      event_id: 'e_qs', event_type: 'post.processed',
      data: { id: 'pp_x', status: 'processed' },
    });
    const res = await app.request('/api/postproxy/webhook?secret=query-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, env);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.ok).toBe(true);
  });
});

describe('POST /api/postproxy/webhook — idempotency + side effects', () => {
  it('second POST with same event_id returns dedup:true and does NOT re-update', async () => {
    db.posts.set('post_a', {
      id: 'post_a', user_id: 'user_x', client_id: null,
      owner_kind: 'user', owner_id: 'user_x', platform: 'facebook',
      postproxy_post_id: 'pp_a', status: 'Publishing',
    });
    const { app, env } = makeApp(db, { POSTPROXY_WEBHOOK_QUERY_SECRET: 'qs' });
    const body = JSON.stringify({
      event_id: 'evt_dup',
      event_type: 'platform_post.published',
      data: {
        id: 'pp_a', status: 'published',
        platforms: [{ platform: 'facebook', status: 'published', permalink: 'https://fb.com/1' }],
      },
    });

    // First delivery
    const r1 = await app.request('/api/postproxy/webhook?secret=qs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }, env);
    expect(r1.status).toBe(200);
    const j1 = await r1.json() as any;
    expect(j1.kind).toBe('mark_published');
    expect(db.posts.get('post_a')!.status).toBe('Posted');
    expect(db.posts.get('post_a')!.postproxy_permalink).toBe('https://fb.com/1');
    expect(db.publication_events.size).toBe(1);

    // Manually corrupt the post to assert the second call doesn't overwrite
    db.posts.get('post_a')!.status = 'Tampered';

    // Second delivery — same event_id
    const r2 = await app.request('/api/postproxy/webhook?secret=qs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }, env);
    expect(r2.status).toBe(200);
    const j2 = await r2.json() as any;
    expect(j2.dedup).toBe(true);
    // Crucially: the post row was NOT updated again on the duplicate.
    expect(db.posts.get('post_a')!.status).toBe('Tampered');
    expect(db.publication_events.size).toBe(1);
  });

  it('platform_post.failed marks post Missed and persists reasoning', async () => {
    db.posts.set('post_b', {
      id: 'post_b', user_id: 'user_y', client_id: null,
      postproxy_post_id: 'pp_b', status: 'Publishing',
    });
    const { app, env } = makeApp(db, { POSTPROXY_WEBHOOK_QUERY_SECRET: 'qs' });
    const body = JSON.stringify({
      event_id: 'evt_fail',
      event_type: 'platform_post.failed',
      data: {
        id: 'pp_b', status: 'failed',
        platforms: [{ platform: 'facebook', status: 'failed', error: 'Page not found' }],
      },
    });
    const res = await app.request('/api/postproxy/webhook?secret=qs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }, env);
    expect(res.status).toBe(200);
    expect(db.posts.get('post_b')!.status).toBe('Missed');
    expect(db.posts.get('post_b')!.reasoning).toBe('Page not found');
  });

  it('returns ok with post_not_found when postproxy_post_id has no matching row', async () => {
    const { app, env } = makeApp(db, { POSTPROXY_WEBHOOK_QUERY_SECRET: 'qs' });
    const body = JSON.stringify({
      event_id: 'evt_orphan',
      event_type: 'platform_post.published',
      data: {
        id: 'pp_never_existed', status: 'published',
        platforms: [{ platform: 'facebook', status: 'published', permalink: 'x' }],
      },
    });
    const res = await app.request('/api/postproxy/webhook?secret=qs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }, env);
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.post_not_found).toBe(true);
  });
});
