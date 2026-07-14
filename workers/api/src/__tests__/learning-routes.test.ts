import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { makeRecordingD1 } from './helpers/recording-d1';

vi.mock('../auth', () => ({
  getAuthUserId: async (request: Request) => request.headers.get('X-Test-Uid') || null,
}));

import { registerLearningRoutes } from '../routes/learning';
import { AUTOPILOT_POLICY_VERSION } from '../lib/learning/readiness';

function makeApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  registerLearningRoutes(app);
  return { app, env };
}

describe('learning receipt routes', () => {
  it('rejects unauthenticated requests before querying D1', async () => {
    const { db, calls } = makeRecordingD1();
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/api/learning/decisions/post_1', {}, env);

    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('returns receipts only after verifying owner-post ownership', async () => {
    const decision = {
      id: 'decision_1', post_id: 'post_1', release_state: 'pass_green',
      summary_json: '{"pipelineState":"pass_green"}',
    };
    const verdict = {
      id: 'verdict_1', decision_id: 'decision_1', critic_kind: 'brand',
      verdict: 'pass', severity: 'advisory', confidence: 1,
      evidence_json: '["brand.denylist"]', repair_json: '[]',
      provider: 'deterministic', model: 'rules-v1', attempt: 0,
    };
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{
        id: 'post_1', user_id: 'owner_1', client_id: null,
        owner_kind: 'user', owner_id: 'owner_1',
      }],
      'FROM learning_decisions': [decision],
      'FROM learning_critic_verdicts': [verdict],
    });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/api/learning/decisions/post_1', {
      headers: { 'X-Test-Uid': 'owner_1' },
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      decisions: [{
        ...decision,
        summary: { pipelineState: 'pass_green' },
        verdicts: [{
          ...verdict,
          evidence: ['brand.denylist'],
          repairs: [],
        }],
      }],
    });
    expect(calls[0].binds).toEqual(['post_1', 'owner_1']);
    expect(calls[1].binds).toEqual(['owner_1', '__owner__', 'post_1', 20]);
    expect(calls[2].binds).toEqual(['decision_1']);
  });

  it('never queries verdicts when the scoped parent has no decisions', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{
        id: 'post_1', user_id: 'owner_1', client_id: null,
        owner_kind: 'user', owner_id: 'owner_1',
      }],
      'FROM learning_decisions': [],
      'FROM learning_critic_verdicts': [{ id: 'orphan-verdict' }],
    });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/api/learning/decisions/post_1', {
      headers: { 'X-Test-Uid': 'owner_1' },
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ decisions: [] });
    expect(calls.some((call) => call.sql.includes('FROM learning_critic_verdicts'))).toBe(false);
  });

  it('uses a leak-safe 404 and never reads receipts for another owner', async () => {
    const { db, calls } = makeRecordingD1({ 'FROM posts': [] });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/api/learning/decisions/post_alice', {
      headers: { 'X-Test-Uid': 'owner_eve' },
    }, env);

    expect(response.status).toBe(404);
    expect(calls.some((call) => call.sql.includes('FROM learning_decisions'))).toBe(false);
  });

  it('rejects a client query that does not match the post workspace', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{
        id: 'post_1', user_id: 'owner_1', client_id: 'client_1',
        owner_kind: 'client', owner_id: 'client_1',
      }],
    });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request(
      '/api/learning/decisions/post_1?clientId=client_2',
      { headers: { 'X-Test-Uid': 'owner_1' } },
      env,
    );

    expect(response.status).toBe(404);
    expect(calls.some((call) => call.sql.includes('FROM learning_decisions'))).toBe(false);
  });

  it('reads canonical client and Shopify workspace keys', async () => {
    const clientDb = makeRecordingD1({
      'FROM posts': [{
        id: 'post_client', user_id: 'owner_1', client_id: 'client_1',
        owner_kind: 'client', owner_id: 'client_1',
      }],
      'FROM learning_decisions': [],
    });
    const clientApp = makeApp({ DB: clientDb.db } as Env);
    const clientResponse = await clientApp.app.request(
      '/api/learning/decisions/post_client?clientId=client_1',
      { headers: { 'X-Test-Uid': 'owner_1' } },
      clientApp.env,
    );
    expect(clientResponse.status).toBe(200);
    expect(clientDb.calls[1].binds).toEqual(['owner_1', 'client_1', 'post_client', 20]);

    const shopDb = makeRecordingD1({
      'FROM posts': [{
        id: 'post_shop', user_id: 'store.myshopify.com', client_id: null,
        owner_kind: 'shop', owner_id: 'Store.MyShopify.com',
      }],
      'FROM learning_decisions': [],
    });
    const shopApp = makeApp({ DB: shopDb.db } as Env);
    const shopResponse = await shopApp.app.request(
      '/api/learning/decisions/post_shop',
      { headers: { 'X-Test-Uid': 'store.myshopify.com' } },
      shopApp.env,
    );
    expect(shopResponse.status).toBe(200);
    expect(shopDb.calls[1].binds).toEqual([
      'store.myshopify.com', 'shop:store.myshopify.com', 'post_shop', 20,
    ]);
  });
});

describe('learning settings and release evidence routes', () => {
  const ownerHeaders = {
    'X-Test-Uid': 'owner_1',
    'Content-Type': 'application/json',
  };
  const adminHeaders = {
    ...ownerHeaders,
    Authorization: 'Bearer admin-token',
  };

  it('reads only the authenticated canonical client settings tuple', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM clients': [{ status: 'active' }],
      'FROM workspace_learning_settings': [{
        mode: 'approval',
        autopublish_consent_at: null,
        autopublish_policy_version: null,
        experiment_rate: 0.05,
        monthly_ai_budget_usd_cents: 1500,
        disabled_reason: null,
      }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
    } as Env;
    const { app } = makeApp(env);
    const response = await app.request(
      '/api/learning/settings?clientId=client_1',
      { headers: ownerHeaders },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      settings: {
        mode: 'approval', experimentRate: 0.05, monthlyAiBudgetUsdCents: 1500,
      },
      effectiveMode: 'approval',
    });
    const settingsRead = calls.find((call) => call.sql.includes('FROM workspace_learning_settings'))!;
    expect(settingsRead.binds).toEqual(['owner_1', 'client_1', 'client_1', 'client', 'client_1']);
  });

  it('requires explicit current consent and a positive budget for protected mode', async () => {
    const { db, calls } = makeRecordingD1({ 'FROM clients': [{ status: 'active' }] });
    const env = { DB: db, LEARNING_RELEASE_ENFORCEMENT: 'true' } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/settings', {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({
        mode: 'protected_autopilot', consent: false, monthlyAiBudgetUsdCents: 1000,
      }),
    }, env);

    expect(response.status).toBe(400);
    expect(calls.some((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);
  });

  it('stores one-time policy consent under the server-derived owner tuple', async () => {
    const { db, calls } = makeRecordingD1();
    const env = { DB: db, LEARNING_RELEASE_ENFORCEMENT: 'true' } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/settings', {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({
        mode: 'protected_autopilot', consent: true,
        monthlyAiBudgetUsdCents: 2500, experimentRate: 0.1,
        userId: 'attacker', workspaceKey: 'forged',
      }),
    }, env);

    expect(response.status).toBe(200);
    const write = calls.find((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))!;
    expect(write.binds.slice(1, 6)).toEqual([
      'owner_1', '__owner__', null, 'user', 'owner_1',
    ]);
    expect(write.binds).toContain(AUTOPILOT_POLICY_VERSION);
    expect(write.binds).not.toContain('attacker');
    expect(write.binds).not.toContain('forged');
  });

  it('clears consent and returns to rollout shadow when protected mode is disabled pre-enforcement', async () => {
    const { db, calls } = makeRecordingD1();
    const env = { DB: db, LEARNING_RELEASE_ENFORCEMENT: 'false' } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/settings', {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({ mode: 'approval' }),
    }, env);

    expect(response.status).toBe(200);
    const write = calls.find((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))!;
    expect(write.binds).toContain('shadow');
    await expect(response.json()).resolves.toMatchObject({ settings: { mode: 'shadow' } });
  });

  it('lets only an admin adjudicate a release decision and derives its tenant tuple', async () => {
    const decision = {
      id: 'decision-1', user_id: 'owner-2', workspace_key: 'client-2',
      client_id: 'client-2', owner_kind: 'client', owner_id: 'client-2',
    };
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM learning_decisions': [decision],
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/decisions/decision-1/adjudicate', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        expectedState: 'block_red', severity: 'release_critical', note: 'Unsafe claim',
        userId: 'forged-owner',
      }),
    }, env);

    expect(response.status).toBe(200);
    const write = calls.find((call) => call.sql.includes('INSERT INTO learning_adjudications'))!;
    expect(write.binds.slice(1, 7)).toEqual([
      'decision-1', 'owner-2', 'client-2', 'client-2', 'client', 'client-2',
    ]);
    expect(write.binds).not.toContain('forged-owner');
    expect(calls.some((call) => /UPDATE\s+posts/i.test(call.sql))).toBe(false);
  });

  it('rejects forged readiness results and validates immutable evidence hashes', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);

    const forged = await app.request('/api/learning/readiness/evidence', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        evidenceKind: 'kill_switch', passed: true, artifactHash: 'a'.repeat(64),
        note: 'test', ready: true,
      }),
    }, env);
    const invalid = await app.request('/api/learning/readiness/evidence', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        evidenceKind: 'staging_green', passed: true, artifactHash: 'not-sha256',
        note: 'test', ownerKind: 'client',
      }),
    }, env);
    expect(forged.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_release_evidence'))).toBe(false);
  });

  it('records validated current-policy evidence without accepting a readiness verdict', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/readiness/evidence', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        evidenceKind: 'staging_block', ownerKind: 'shop', passed: true,
        artifactHash: 'B'.repeat(64), note: 'Shop staging blocked the red fixture',
      }),
    }, env);

    expect(response.status).toBe(200);
    const write = calls.find((call) => call.sql.includes('INSERT INTO learning_release_evidence'))!;
    expect(write.binds).toContain(AUTOPILOT_POLICY_VERSION);
    expect(write.binds).toContain('staging_block');
    expect(write.binds).toContain('shop');
    expect(write.binds).toContain('b'.repeat(64));
    expect(write.binds).toContain('owner_1');
  });

  it('keeps the settings backfill admin-only and dry-run by default', async () => {
    const candidates = [
      {
        user_id: 'owner_1', workspace_key: '__owner__', client_id: null,
        owner_kind: 'user', owner_id: 'owner_1',
      },
      {
        user_id: 'owner_2', workspace_key: 'client_2', client_id: 'client_2',
        owner_kind: 'client', owner_id: 'client_2',
      },
    ];
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM (': candidates,
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/settings/backfill', {
      method: 'POST', headers: adminHeaders, body: '{}',
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dryRun: true,
      found: 2,
      applied: 0,
      workspaces: candidates,
    });
    expect(calls.some((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);
    const scan = calls.find((call) => call.sql.includes('FROM ('))!;
    expect(scan.sql).toContain("COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'");
    expect(scan.sql).toContain('s.uninstalled_at IS NULL');
    expect(scan.sql).toContain('NOT EXISTS');
    expect(scan.binds).toEqual([50]);
  });

  it('denies a non-admin settings backfill before scanning workspaces', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'owner@example.com', is_admin: 0 }],
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/settings/backfill', {
      method: 'POST', headers: ownerHeaders, body: '{}',
    }, env);

    expect(response.status).toBe(403);
    expect(calls.some((call) => call.sql.includes('FROM ('))).toBe(false);
    expect(calls.some((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);
  });

  it('applies only bounded canonical approval defaults without migrating consent', async () => {
    const candidates = [
      {
        user_id: 'owner_1', workspace_key: '__owner__', client_id: null,
        owner_kind: 'user', owner_id: 'owner_1',
      },
      {
        user_id: 'owner_2', workspace_key: 'client_2', client_id: 'client_2',
        owner_kind: 'client', owner_id: 'client_2',
      },
      {
        user_id: 'store.myshopify.com', workspace_key: 'shop:store.myshopify.com', client_id: null,
        owner_kind: 'shop', owner_id: 'store.myshopify.com',
      },
    ];
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM (': candidates,
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/settings/backfill', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ apply: true, limit: 3 }),
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ dryRun: false, found: 3, applied: 3 });
    const writes = calls.filter((call) => call.sql.includes('INSERT INTO workspace_learning_settings'));
    expect(writes).toHaveLength(3);
    for (const write of writes) {
      expect(write.sql).toContain("'approval'");
      expect(write.sql).toContain('ON CONFLICT(user_id,workspace_key) DO NOTHING');
      expect(write.sql).not.toContain('DO UPDATE');
      expect(write.binds).not.toContain(AUTOPILOT_POLICY_VERSION);
    }
    expect(calls.find((call) => call.sql.includes('FROM ('))?.binds).toEqual([3]);
  });

  it('rejects consent or protected-mode migration through the settings backfill', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/settings/backfill', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ apply: true, consent: true, mode: 'protected_autopilot' }),
    }, env);

    expect(response.status).toBe(400);
    expect(calls.some((call) => call.sql.includes('FROM ('))).toBe(false);
    expect(calls.some((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);
  });
});
