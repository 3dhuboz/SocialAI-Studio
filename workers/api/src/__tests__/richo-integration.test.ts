import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../env';
import { buildRichoDraftContent, registerIntegrationRoutes } from '../routes/integrations';

type Row = Record<string, any>;

type MiniDb = {
  users: Row[];
  clients: Row[];
  posts: Row[];
  client_facts: Row[];
};

function makeD1(db: MiniDb): D1Database {
  function exec(sql: string, params: unknown[]): { changes: number; rows: Row[] } {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/^SELECT id, name FROM clients WHERE id = \? AND user_id = \?$/i.test(s)) {
      const [id, userId] = params as [string, string];
      const row = db.clients.find((client) => client.id === id && client.user_id === userId);
      return { changes: 0, rows: row ? [{ id: row.id, name: row.name }] : [] };
    }

    if (/^SELECT id, email FROM users WHERE id = \?$/i.test(s)) {
      const [id] = params as [string];
      const row = db.users.find((user) => user.id === id);
      return { changes: 0, rows: row ? [{ id: row.id, email: row.email }] : [] };
    }

    if (/^SELECT metadata FROM client_facts WHERE user_id = \? AND COALESCE\(client_id, ''\) = \? AND fb_id = \?$/i.test(s)) {
      const [userId, clientScope, fbId] = params as [string, string, string];
      const row = db.client_facts.find((fact) =>
        fact.user_id === userId && (fact.client_id || '') === clientScope && fact.fb_id === fbId
      );
      return { changes: 0, rows: row ? [{ metadata: row.metadata }] : [] };
    }

    if (/^UPDATE posts SET content = \?, platform = \?, status = 'Draft', scheduled_for = NULL, hashtags = \?, topic = \?, pillar = \? WHERE id = \? AND user_id = \? AND COALESCE\(client_id, ''\) = \? AND status = 'Draft'$/i.test(s)) {
      const [content, platform, hashtags, topic, pillar, id, userId, clientScope] = params as string[];
      const row = db.posts.find((post) =>
        post.id === id && post.user_id === userId && (post.client_id || '') === clientScope && post.status === 'Draft'
      );
      if (!row) return { changes: 0, rows: [] };
      Object.assign(row, { content, platform, hashtags, topic, pillar, status: 'Draft', scheduled_for: null });
      return { changes: 1, rows: [] };
    }

    if (/^INSERT INTO posts \(id, user_id, client_id, content, platform, status, scheduled_for, hashtags, topic, pillar\) VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?\)$/i.test(s)) {
      const [id, user_id, client_id, content, platform, status, scheduled_for, hashtags, topic, pillar] = params;
      db.posts.push({ id, user_id, client_id, content, platform, status, scheduled_for, hashtags, topic, pillar });
      return { changes: 1, rows: [] };
    }

    if (/^DELETE FROM client_facts WHERE user_id = \? AND COALESCE\(client_id, ''\) = \? AND fb_id = \?$/i.test(s)) {
      const [userId, clientScope, fbId] = params as [string, string, string];
      const before = db.client_facts.length;
      db.client_facts = db.client_facts.filter((fact) =>
        !(fact.user_id === userId && (fact.client_id || '') === clientScope && fact.fb_id === fbId)
      );
      return { changes: before - db.client_facts.length, rows: [] };
    }

    if (/^INSERT INTO client_facts \(user_id, client_id, fact_type, content, metadata, fb_id, engagement_score, verified_at\) VALUES \(\?,\?,\?,\?,\?,\?,\?,\?\)$/i.test(s)) {
      const [user_id, client_id, fact_type, content, metadata, fb_id, engagement_score, verified_at] = params;
      db.client_facts.push({ id: db.client_facts.length + 1, user_id, client_id, fact_type, content, metadata, fb_id, engagement_score, verified_at });
      return { changes: 1, rows: [] };
    }

    throw new Error(`MiniDb (richo integration): unhandled SQL: ${s}`);
  }

  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const { changes } = exec(sql, params);
              return { success: true, meta: { changes } } as unknown as D1Result;
            },
            async first<T = Row>() {
              const { rows } = exec(sql, params);
              return (rows[0] as T) ?? null;
            },
            async all<T = Row>() {
              const { rows } = exec(sql, params);
              return { success: true, results: rows as T[], meta: { changes: 0 } } as unknown as D1Result<T>;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function makeEnv(db: MiniDb): Env {
  return {
    DB: makeD1(db),
    RICHO_ROAD_INGEST_API_KEY: 'rr-secret',
    RICHO_ROAD_AGENT_ACCOUNT_ID: 'user_steve',
    RICHO_ROAD_WORKSPACE_ID: 'client_richo',
  } as unknown as Env;
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  registerIntegrationRoutes(app);
  return app;
}

const payload = {
  source: 'richo-road-butchery',
  eventType: 'weekly_special',
  idempotencyKey: 'order:RRO-1:weekly',
  agentAccountId: 'user_steve',
  workspaceId: 'client_richo',
  actor: 'Steve',
  brief: {
    title: 'Friday freezer packs',
    copy: 'Family packs are ready for Friday click-and-collect.',
    channel: 'facebook',
    callToAction: 'Order online from Richo Road Butchery',
  },
  order: {
    id: 'RRO-1',
    fulfillment: 'delivery',
    customerSuburb: 'Kawana',
    requestedWindow: 'Friday 2:30-5:00pm',
    finalTotalCents: 15500,
    items: [{ name: 'Family freezer pack', quantity: 1, unit: 'pack', finalLineTotalCents: 15500 }],
  },
};

describe('Richo Road integration', () => {
  it('keeps customer-facing draft copy separate from order context', () => {
    const content = buildRichoDraftContent(payload);
    expect(content).toContain('Friday freezer packs');
    expect(content).toContain('Family packs are ready');
    expect(content).not.toContain('Kawana');
    expect(content).not.toContain('RRO-1');
  });

  it('rejects missing bearer auth', async () => {
    const db: MiniDb = { users: [], clients: [], posts: [], client_facts: [] };
    const res = await makeApp().request('http://localhost/api/integrations/richo-road/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, makeEnv(db));
    expect(res.status).toBe(401);
  });

  it('creates a draft post and idempotently updates it on repeat handoff', async () => {
    const db: MiniDb = {
      users: [{ id: 'user_steve', email: 'steve@example.com' }],
      clients: [{ id: 'client_richo', user_id: 'user_steve', name: 'Richo Road Butchery' }],
      posts: [],
      client_facts: [],
    };
    const app = makeApp();
    const first = await app.request('http://localhost/api/integrations/richo-road/events', {
      method: 'POST',
      headers: { Authorization: 'Bearer rr-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, makeEnv(db));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { draftPostId: string; draftMode: string };
    expect(firstBody.draftMode).toBe('created');
    expect(db.posts).toHaveLength(1);
    expect(db.client_facts).toHaveLength(1);

    const second = await app.request('http://localhost/api/integrations/richo-road/events', {
      method: 'POST',
      headers: { Authorization: 'Bearer rr-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        brief: { ...payload.brief, copy: 'Updated Friday family packs are ready.' },
      }),
    }, makeEnv(db));
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { draftPostId: string; draftMode: string };
    expect(secondBody.draftPostId).toBe(firstBody.draftPostId);
    expect(secondBody.draftMode).toBe('updated');
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0].content).toContain('Updated Friday family packs');
    expect(db.client_facts).toHaveLength(1);
  });
});
