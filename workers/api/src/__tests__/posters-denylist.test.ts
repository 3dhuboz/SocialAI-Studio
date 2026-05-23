import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

let rateLimitedNext = false;

vi.mock('../auth', () => ({
  getAuthUserId: async (req: Request) => req.headers.get('X-Test-Uid') || null,
  isRateLimited: async () => rateLimitedNext,
}));

vi.mock('../lib/billing-gate', () => ({
  checkBillingGate: async () => null,
}));

import { registerPostersRoutes } from '../routes/posters';
import type { Env } from '../env';

interface MiniDb {
  users: Map<string, Record<string, unknown>>;
  clients: Map<string, Record<string, unknown>>;
}

function makeD1(db: MiniDb): D1Database {
  function exec(sql: string, params: unknown[]): Record<string, unknown>[] {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/^SELECT plan, addon_features, poster_credits FROM users WHERE id = \?$/i.test(s)) {
      const user = db.users.get(params[0] as string);
      return user
        ? [{
            plan: user.plan ?? 'pro',
            addon_features: user.addon_features ?? null,
            poster_credits: user.poster_credits ?? 0,
          }]
        : [{ plan: 'pro', addon_features: null, poster_credits: 0 }];
    }

    if (/^SELECT profile FROM users WHERE id = \?$/i.test(s)) {
      const user = db.users.get(params[0] as string);
      return user ? [{ profile: user.profile ?? null }] : [];
    }

    if (/^SELECT profile FROM clients WHERE id = \? AND user_id = \?$/i.test(s)) {
      const [id, uid] = params as [string, string];
      const client = db.clients.get(id);
      return client && client.user_id === uid ? [{ profile: client.profile ?? null }] : [];
    }

    throw new Error(`MiniDb: unhandled SQL: ${s}`);
  }

  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first<T>() {
              return (exec(sql, params)[0] as T) ?? null;
            },
          };
        },
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function makeApp(db: MiniDb) {
  const app = new Hono<{ Bindings: Env }>();
  registerPostersRoutes(app);
  const env = {
    DB: makeD1(db),
    OPENROUTER_API_KEY: 'or-test',
    CLERK_SECRET_KEY: 'sk-test',
    CLERK_JWT_KEY: 'jwt-test',
  } as unknown as Env;
  return { app, env };
}

function successfulImageFetch() {
  return vi.fn(async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: 'data:image/png;base64,aGVsbG8=',
      },
    }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('POST /api/ai/poster-image forbidden subjects', () => {
  let db: MiniDb;

  beforeEach(() => {
    db = {
      users: new Map([
        ['user_a', {
          id: 'user_a',
          plan: 'pro',
          profile: JSON.stringify({ forbiddenSubjects: 'pork' }),
        }],
      ]),
      clients: new Map(),
    };
    rateLimitedNext = false;
    vi.stubGlobal('fetch', successfulImageFetch());
  });

  it('rejects a user-level forbidden subject before calling OpenRouter', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/ai/poster-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({ prompt: 'A poster showing pork ribs on a smoker' }),
    }, env);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ forbidden: 'pork' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a client-level forbidden subject when clientId is supplied', async () => {
    db.users.set('user_a', {
      id: 'user_a',
      plan: 'pro',
      profile: JSON.stringify({ forbiddenSubjects: '' }),
    });
    db.clients.set('client_1', {
      id: 'client_1',
      user_id: 'user_a',
      profile: JSON.stringify({ forbiddenSubjects: 'chicken' }),
    });

    const { app, env } = makeApp(db);
    const res = await app.request('/api/ai/poster-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_a' },
      body: JSON.stringify({
        prompt: 'A bright poster showing smoked chicken wings',
        clientId: 'client_1',
      }),
    }, env);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ forbidden: 'chicken' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
