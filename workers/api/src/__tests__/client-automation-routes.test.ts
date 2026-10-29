import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { registerClientsRoutes } from '../routes/clients';

type Post = { status: string; scheduled_for: string | null };

function makeRouteDb(portalClientId = 'hughesq-001') {
  let clientStatus = 'on_hold';
  const posts: Post[] = [
    ...Array.from({ length: 16 }, () => ({ status: 'Draft', scheduled_for: null })),
    { status: 'Scheduled', scheduled_for: '2026-07-28T12:00:00.000Z' },
    { status: 'Scheduled', scheduled_for: null },
    ...Array.from({ length: 7 }, () => ({ status: 'Posted', scheduled_for: '2026-07-01T12:00:00.000Z' })),
  ];
  const db = {
    prepare(sql: string) {
      const statement = { binds: [] as unknown[] };
      return {
        bind(...binds: unknown[]) {
          statement.binds = binds;
          return this;
        },
        async first<T>() {
          if (sql.includes('SELECT client_id FROM portal')) {
            return { client_id: portalClientId } as T;
          }
          if (sql.includes('FROM portal')) {
            return { user_id: 'owner-1', expires_at: '2099-01-01T00:00:00Z', revoked_at: null } as T;
          }
          if (sql.includes('SELECT status FROM clients')) {
            return { status: clientStatus } as T;
          }
          if (sql.includes('FROM posts')) {
            const now = String(statement.binds[0]);
            return {
              draft_count: posts.filter((post) => post.status === 'Draft').length,
              scheduled_count: posts.filter((post) => post.status === 'Scheduled').length,
              posted_count: posts.filter((post) => post.status === 'Posted').length,
              overdue_scheduled_count: posts.filter((post) => post.status === 'Scheduled' && post.scheduled_for !== null && post.scheduled_for <= now).length,
              undated_scheduled_count: posts.filter((post) => post.status === 'Scheduled' && post.scheduled_for === null).length,
            } as T;
          }
          return null;
        },
        async run() {
          if (sql.includes("SET status = 'on_hold'")) {
            clientStatus = 'on_hold';
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'active'")) {
            const now = String(statement.binds[4]);
            const blocked = posts.some((post) => post.status === 'Scheduled' && (post.scheduled_for === null || post.scheduled_for <= now));
            if (!blocked) clientStatus = 'active';
            return { success: true, meta: { changes: blocked ? 0 : 1 } };
          }
          if (sql.includes("SET status = 'Draft'")) {
            const now = String(statement.binds[2]);
            let changes = 0;
            for (const post of posts) {
              if (post.status === 'Scheduled' && (post.scheduled_for === null || post.scheduled_for <= now)) {
                post.status = 'Draft';
                post.scheduled_for = null;
                changes++;
              }
            }
            return { success: true, meta: { changes } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  } as unknown as D1Database;
  return db;
}

function makeApp(portalClientId = 'hughesq-001') {
  const app = new Hono<{ Bindings: Env }>();
  registerClientsRoutes(app);
  const env = {
    DB: makeRouteDb(portalClientId),
    CLERK_SECRET_KEY: 'sk_test',
  } as unknown as Env;
  const request = (method: 'GET' | 'PUT', body?: unknown) => app.request(
    '/api/db/clients/hughesq-001/automation',
    {
      method,
      headers: {
        Authorization: 'Portal valid-token',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
  );
  return { request };
}

describe('client automation routes', () => {
  it('rejects a portal token that belongs to a different client workspace', async () => {
    const { request } = makeApp('another-client');

    const response = await request('GET');

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'CLIENT_SCOPE_MISMATCH' });
  });

  it('exposes the paused production-shaped queue and returns a bounded 409 on resume', async () => {
    const { request } = makeApp();

    const read = await request('GET');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      automation: { paused: true, draftCount: 16, scheduledCount: 2, postedCount: 7, staleScheduledCount: 2, canResume: false },
    });

    const resume = await request('PUT', { action: 'resume' });
    expect(resume.status).toBe(409);
    expect(await resume.json()).toMatchObject({ code: 'STALE_SCHEDULED_POSTS', automation: { paused: true, staleScheduledCount: 2 } });
  });

  it('returns the stale queue to Draft before allowing an explicit resume', async () => {
    const { request } = makeApp();

    const review = await request('PUT', { action: 'return-stale-to-draft' });
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({ changed: 2, automation: { draftCount: 18, scheduledCount: 0, staleScheduledCount: 0, canResume: true } });

    const resume = await request('PUT', { action: 'resume' });
    expect(resume.status).toBe(200);
    expect(await resume.json()).toMatchObject({ automation: { status: 'active', paused: false } });
  });
});
