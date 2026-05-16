/**
 * Worker auth-security regression tests.
 *
 * Covers the four bugs closed by `fix(security): close 4 auth bypass bugs`:
 *   1. PUT /api/db/user rejects `isAdmin: true` (no-op, never promotes)
 *   2. PUT /api/db/portal/:slug rejects cross-user writes (404 leak-safe)
 *   3. POST /api/internal/activation requires X-Internal-Secret
 *   4. GET /api/db/activations rejects email mismatches (404 leak-safe)
 *
 * Tests use Hono's `app.request()` to dispatch synthetic requests against a
 * fully wired app, with the Clerk verifier mocked so we can pretend a given
 * uid is "the caller". D1 is replaced with an in-memory map so each test
 * starts from a known seed.
 *
 * Run with `npm test` from the repo root (vitest config is at the root).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// Mock the Clerk auth helper BEFORE importing routes so the registrations
// pick up the mocked module. The mock reads a custom header so each test
// can stamp "I am uid X".
vi.mock('../auth', () => ({
  getAuthUserId: async (req: Request) => req.headers.get('X-Test-Uid') || null,
  requireAdmin: async () => new Response('Forbidden', { status: 403 }),
  isRateLimited: async () => false,
}));

import { registerUserRoutes } from '../routes/user';
import { registerPortalRoutes } from '../routes/portal';
import { registerActivationRoutes } from '../routes/activations';
import type { Env } from '../env';

// ── Mini in-memory D1 ────────────────────────────────────────────────────
// Only models the handful of tables/queries the four fixed endpoints touch.
// Each test re-seeds via the global `db` reset in beforeEach.
type Row = Record<string, unknown>;
interface MiniDb {
  users: Map<string, Row>;
  portal: Map<string, Row>;
  pending_activations: Map<string, Row>;
  pending_cancellations: Map<string, Row>;
}

function makeDb(): MiniDb {
  return {
    users: new Map(),
    portal: new Map(),
    pending_activations: new Map(),
    pending_cancellations: new Map(),
  };
}

function makeD1(db: MiniDb): D1Database {
  // Minimal sql→handler matcher. Each branch returns { bind() → { run/first/all } }.
  // The order of branches matters — list more-specific patterns first.
  function exec(sql: string, params: unknown[]): { changes: number; rows: Row[] } {
    const s = sql.replace(/\s+/g, ' ').trim();

    // user.ts: SELECT id FROM users WHERE id = ?
    if (/^SELECT id FROM users WHERE id = \?$/i.test(s)) {
      const row = db.users.get(params[0] as string);
      return { changes: 0, rows: row ? [{ id: row.id }] : [] };
    }
    // user.ts: SELECT * FROM users WHERE id = ?
    if (/^SELECT \* FROM users WHERE id = \?$/i.test(s)) {
      const row = db.users.get(params[0] as string);
      return { changes: 0, rows: row ? [row] : [] };
    }
    // activations.ts: SELECT email FROM users WHERE id = ?
    if (/^SELECT email FROM users WHERE id = \?$/i.test(s)) {
      const row = db.users.get(params[0] as string);
      return { changes: 0, rows: row ? [{ email: row.email ?? null }] : [] };
    }
    // user.ts: full UPSERT INSERT INTO users(...)
    if (/^INSERT INTO users/i.test(s)) {
      const [id, email, plan, setup_status, is_admin, onboarding_done, intake_form_done,
        agency_billing_url, late_profile_id, late_connected_platforms, late_account_ids,
        fal_api_key, paypal_subscription_id, profile, stats, insight_report, billing_cycle] = params;
      db.users.set(id as string, {
        id, email, plan, setup_status, is_admin, onboarding_done, intake_form_done,
        agency_billing_url, late_profile_id, late_connected_platforms, late_account_ids,
        fal_api_key, paypal_subscription_id, profile, stats, insight_report, billing_cycle,
      });
      return { changes: 1, rows: [] };
    }
    // user.ts: UPDATE users SET ... WHERE id = ?
    const userUpdate = s.match(/^UPDATE users SET (.*) WHERE id = \?$/i);
    if (userUpdate) {
      const cols = userUpdate[1].split(',').map((p) => p.trim().split(' = ')[0]);
      const id = params[params.length - 1] as string;
      const row = db.users.get(id);
      if (!row) return { changes: 0, rows: [] };
      cols.forEach((col, i) => { row[col] = params[i]; });
      return { changes: 1, rows: [] };
    }

    // portal.ts: SELECT user_id FROM portal WHERE slug = ?
    if (/^SELECT user_id FROM portal WHERE slug = \?$/i.test(s)) {
      const row = db.portal.get(params[0] as string);
      return { changes: 0, rows: row ? [{ user_id: row.user_id }] : [] };
    }
    // portal.ts: INSERT INTO portal ... ON CONFLICT(slug) DO UPDATE ...
    if (/^INSERT INTO portal/i.test(s)) {
      const [slug, email, password, portal_token, user_id, client_id, expires_at] = params;
      db.portal.set(slug as string, {
        slug, email, password, portal_token, user_id, client_id, expires_at, revoked_at: null,
      });
      return { changes: 1, rows: [] };
    }
    // portal.ts: UPDATE portal SET (hero_*) WHERE slug = ? AND user_id = ?
    const portalContent = s.match(/^UPDATE portal SET (.*) WHERE slug = \? AND user_id = \?$/i);
    if (portalContent) {
      const cols = portalContent[1].split(',').map((p) => p.trim().split(' = ')[0]);
      const slug = params[params.length - 2] as string;
      const uid = params[params.length - 1] as string;
      const row = db.portal.get(slug);
      if (!row || row.user_id !== uid) return { changes: 0, rows: [] };
      cols.forEach((col, i) => { row[col] = params[i]; });
      return { changes: 1, rows: [] };
    }
    // portal.ts: legacy UPDATE portal SET (hero_*) WHERE slug = ?
    // (pre-fix path — left in for completeness; should never hit post-fix)
    const portalContentLegacy = s.match(/^UPDATE portal SET (.*) WHERE slug = \?$/i);
    if (portalContentLegacy) {
      throw new Error('Legacy UPDATE portal WHERE slug = ? path hit — Fix 2 regression');
    }

    // activations.ts: SELECT * FROM pending_activations WHERE id = ? AND consumed = 0
    if (/^SELECT \* FROM pending_activations WHERE id = \? AND consumed = 0$/i.test(s)) {
      const row = db.pending_activations.get(params[0] as string);
      return { changes: 0, rows: row && row.consumed === 0 ? [row] : [] };
    }
    // activations.ts: SELECT * FROM pending_activations WHERE email = ? AND consumed = 0
    if (/^SELECT \* FROM pending_activations WHERE email = \? AND consumed = 0$/i.test(s)) {
      const target = (params[0] as string).toLowerCase();
      const matches = [...db.pending_activations.values()].filter(
        (r) => (r.email as string)?.toLowerCase() === target && r.consumed === 0,
      );
      return { changes: 0, rows: matches.slice(0, 1) };
    }
    // activations.ts: SELECT id, email FROM pending_activations WHERE id = ?
    if (/^SELECT id, email FROM pending_activations WHERE id = \?$/i.test(s)) {
      const row = db.pending_activations.get(params[0] as string);
      return { changes: 0, rows: row ? [{ id: row.id, email: row.email }] : [] };
    }
    // activations.ts: UPDATE pending_activations SET consumed = 1 WHERE id = ?
    if (/^UPDATE pending_activations SET consumed = 1 WHERE id = \?$/i.test(s)) {
      const row = db.pending_activations.get(params[0] as string);
      if (!row) return { changes: 0, rows: [] };
      row.consumed = 1;
      return { changes: 1, rows: [] };
    }
    // activations.ts: SELECT * FROM pending_cancellations WHERE ...
    if (/^SELECT \* FROM pending_cancellations WHERE id = \? AND consumed = 0$/i.test(s)) {
      const row = db.pending_cancellations.get(params[0] as string);
      return { changes: 0, rows: row && row.consumed === 0 ? [row] : [] };
    }
    if (/^SELECT \* FROM pending_cancellations WHERE email = \? AND consumed = 0$/i.test(s)) {
      const target = (params[0] as string).toLowerCase();
      const matches = [...db.pending_cancellations.values()].filter(
        (r) => (r.email as string)?.toLowerCase() === target && r.consumed === 0,
      );
      return { changes: 0, rows: matches.slice(0, 1) };
    }
    // activations.ts: INSERT OR IGNORE INTO pending_activations ...
    if (/^INSERT OR IGNORE INTO pending_activations/i.test(s)) {
      const [id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at] = params;
      if (!db.pending_activations.has(id as string)) {
        db.pending_activations.set(id as string, {
          id, plan, email, paypal_subscription_id, paypal_customer_id, activated_at, consumed: 0,
        });
      }
      return { changes: 1, rows: [] };
    }
    // activations.ts: INSERT INTO pending_cancellations ...
    if (/^INSERT INTO pending_cancellations/i.test(s)) {
      const [id, email, paypal_subscription_id, cancelled_at] = params;
      db.pending_cancellations.set(id as string, {
        id, email, paypal_subscription_id, cancelled_at, consumed: 0,
      });
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
            return { success: true, meta: { changes, duration: 0, last_row_id: 0, rows_read: 0, rows_written: changes, changed_db: changes > 0, size_after: 0 } } as D1Result;
          },
          async first<T = Row>(): Promise<T | null> {
            const { rows } = exec(sql, params);
            return (rows[0] as T) ?? null;
          },
          async all<T = Row>(): Promise<D1Result<T>> {
            const { rows } = exec(sql, params);
            return { results: rows as T[], success: true, meta: { duration: 0, changes: 0, last_row_id: 0, rows_read: rows.length, rows_written: 0, changed_db: false, size_after: 0 } } as D1Result<T>;
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
  registerUserRoutes(app);
  registerPortalRoutes(app);
  registerActivationRoutes(app);
  const env = {
    DB: makeD1(db),
    CLERK_SECRET_KEY: 'sk_test',
    FACTS_BOOTSTRAP_SECRET: 'shh-internal',
  } as unknown as Env;
  return { app, env };
}

let db: MiniDb;
beforeEach(() => { db = makeDb(); });

// ────────────────────────────────────────────────────────────────────────
// Fix 1 — PUT /api/db/user rejects isAdmin promotion attempt.
// ────────────────────────────────────────────────────────────────────────
describe('Fix 1: PUT /api/db/user does not honour isAdmin in body', () => {
  it('UPDATE branch: existing non-admin user staying non-admin after isAdmin:true', async () => {
    // Seed: user exists, is_admin = 0.
    db.users.set('user_alice', { id: 'user_alice', email: 'alice@example.com', is_admin: 0 });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/db/user', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_alice' },
      body: JSON.stringify({ isAdmin: true, email: 'alice@example.com' }),
    }, env);
    expect(res.status).toBe(200);
    const row = db.users.get('user_alice')!;
    // isAdmin in body MUST NOT have been written to is_admin column.
    expect(row.is_admin).toBe(0);
  });

  it('INSERT branch: brand-new user with isAdmin:true is NOT promoted', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/db/user', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_eve' },
      body: JSON.stringify({ isAdmin: true, email: 'eve@example.com' }),
    }, env);
    expect(res.status).toBe(200);
    const row = db.users.get('user_eve')!;
    // INSERT branch hard-codes is_admin = 0 regardless of body.
    expect(row.is_admin).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fix 2 — PUT /api/db/portal/:slug rejects cross-user writes.
// ────────────────────────────────────────────────────────────────────────
describe('Fix 2: PUT /api/db/portal/:slug ownership-scoped', () => {
  it('returns 404 when slug is owned by a different user', async () => {
    // Seed: slug "picklenick" belongs to user_alice.
    db.portal.set('picklenick', {
      slug: 'picklenick', email: 'alice@example.com', password: 'pw',
      portal_token: 'tok_alice', user_id: 'user_alice', client_id: 'picklenick',
      expires_at: '2099-01-01', revoked_at: null,
    });
    const { app, env } = makeApp(db);
    // user_eve tries to overwrite the picklenick portal.
    const res = await app.request('/api/db/portal/picklenick', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_eve' },
      body: JSON.stringify({ email: 'eve@example.com', password: 'hacked' }),
    }, env);
    expect(res.status).toBe(404);
    // Slug row must remain owned by alice — no fields rewritten.
    const row = db.portal.get('picklenick')!;
    expect(row.user_id).toBe('user_alice');
    expect(row.portal_token).toBe('tok_alice');
    expect(row.email).toBe('alice@example.com');
  });

  it('lets the owner update their own slug', async () => {
    db.portal.set('alicesite', {
      slug: 'alicesite', email: 'alice@example.com', password: 'pw',
      portal_token: 'tok_alice', user_id: 'user_alice', client_id: null,
      expires_at: '2099-01-01', revoked_at: null,
    });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/db/portal/alicesite', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_alice' },
      body: JSON.stringify({ email: 'alice2@example.com', password: 'pw2' }),
    }, env);
    expect(res.status).toBe(200);
    expect(db.portal.get('alicesite')!.email).toBe('alice2@example.com');
  });

  it('lets a user claim a brand-new (unowned) slug', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/db/portal/freshslug', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_bob' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'pw' }),
    }, env);
    expect(res.status).toBe(200);
    expect(db.portal.get('freshslug')!.user_id).toBe('user_bob');
  });

  it('PUT /content: returns 404 when slug is owned by a different user', async () => {
    db.portal.set('picklenick', {
      slug: 'picklenick', email: 'alice@example.com', password: 'pw',
      portal_token: 'tok_alice', user_id: 'user_alice', client_id: 'picklenick',
      expires_at: '2099-01-01', revoked_at: null,
      hero_title: 'Alice Hero', hero_subtitle: null, hero_cta_text: null,
    });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/db/portal/picklenick/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_eve' },
      body: JSON.stringify({ hero_title: 'Eve Was Here' }),
    }, env);
    expect(res.status).toBe(404);
    expect(db.portal.get('picklenick')!.hero_title).toBe('Alice Hero');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fix 3 — /api/internal/activation requires X-Internal-Secret.
// ────────────────────────────────────────────────────────────────────────
describe('Fix 3: /api/internal/* requires X-Internal-Secret', () => {
  it('rejects POST /api/internal/activation with no secret', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/internal/activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'agency', email: 'a@b.com' }),
    }, env);
    expect(res.status).toBe(401);
    expect(db.pending_activations.size).toBe(0);
  });

  it('rejects POST /api/internal/activation with WRONG secret', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/internal/activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': 'wrong' },
      body: JSON.stringify({ plan: 'agency', email: 'a@b.com' }),
    }, env);
    expect(res.status).toBe(401);
    expect(db.pending_activations.size).toBe(0);
  });

  it('accepts POST /api/internal/activation with the right secret', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/internal/activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': 'shh-internal' },
      body: JSON.stringify({ plan: 'agency', email: 'a@b.com' }),
    }, env);
    expect(res.status).toBe(200);
    expect(db.pending_activations.size).toBe(1);
  });

  it('rejects POST /api/internal/cancellation with no secret', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/internal/cancellation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    }, env);
    expect(res.status).toBe(401);
    expect(db.pending_cancellations.size).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fix 4 — GET /api/db/activations + PUT /:id/consume require email match.
// ────────────────────────────────────────────────────────────────────────
describe('Fix 4: activations email-scope check', () => {
  it('GET ?email=victim from attacker returns 404, not victim row', async () => {
    db.users.set('user_eve', { id: 'user_eve', email: 'eve@example.com' });
    db.pending_activations.set('act_v', {
      id: 'act_v', email: 'victim@example.com', plan: 'agency', consumed: 0,
      paypal_subscription_id: 'I-VICTIM', paypal_customer_id: null, activated_at: '2026-05-01',
    });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/db/activations?email=victim@example.com', {
      headers: { 'X-Test-Uid': 'user_eve' },
    }, env);
    expect(res.status).toBe(404);
    const body = await res.json() as { activation: unknown };
    expect(body.activation).toBeNull();
  });

  it('GET ?email=self from owner returns their own row', async () => {
    db.users.set('user_alice', { id: 'user_alice', email: 'alice@example.com' });
    db.pending_activations.set('act_a', {
      id: 'act_a', email: 'alice@example.com', plan: 'agency', consumed: 0,
      paypal_subscription_id: 'I-ALICE', paypal_customer_id: null, activated_at: '2026-05-01',
    });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/db/activations?email=alice@example.com', {
      headers: { 'X-Test-Uid': 'user_alice' },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { activation: { id: string } };
    expect(body.activation.id).toBe('act_a');
  });

  it('PUT /:id/consume rejects when row email != caller email', async () => {
    db.users.set('user_eve', { id: 'user_eve', email: 'eve@example.com' });
    db.pending_activations.set('act_v', {
      id: 'act_v', email: 'victim@example.com', plan: 'agency', consumed: 0,
      paypal_subscription_id: 'I-VICTIM', paypal_customer_id: null, activated_at: '2026-05-01',
    });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/db/activations/act_v/consume', {
      method: 'PUT', headers: { 'X-Test-Uid': 'user_eve' },
    }, env);
    expect(res.status).toBe(404);
    // Row must remain unconsumed so the real owner can still claim it.
    expect(db.pending_activations.get('act_v')!.consumed).toBe(0);
  });

  it('PUT /:id/consume succeeds when row email == caller email', async () => {
    db.users.set('user_alice', { id: 'user_alice', email: 'alice@example.com' });
    db.pending_activations.set('act_a', {
      id: 'act_a', email: 'alice@example.com', plan: 'agency', consumed: 0,
      paypal_subscription_id: 'I-ALICE', paypal_customer_id: null, activated_at: '2026-05-01',
    });
    const { app, env } = makeApp(db);
    const res = await app.request('/api/db/activations/act_a/consume', {
      method: 'PUT', headers: { 'X-Test-Uid': 'user_alice' },
    }, env);
    expect(res.status).toBe(200);
    expect(db.pending_activations.get('act_a')!.consumed).toBe(1);
  });
});
