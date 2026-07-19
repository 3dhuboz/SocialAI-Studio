import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { logAiUsage } from '../lib/ai-usage';
import { makeRecordingD1 } from './helpers/recording-d1';

vi.mock('../auth', () => ({
  getAuthUserId: async (request: Request) => request.headers.get('X-Test-Uid') || null,
}));

vi.mock('../lib/learning/release-preflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/learning/release-preflight')>();
  return { ...actual, runAndPersistReleasePipeline: vi.fn() };
});

import { registerLearningRoutes } from '../routes/learning';
import { AUTOPILOT_POLICY_VERSION } from '../lib/learning/readiness';
import {
  buildReleaseContentHash,
  runAndPersistReleasePipeline,
  type PublishablePost,
} from '../lib/learning/release-preflight';

const runPilotPipeline = vi.mocked(runAndPersistReleasePipeline);

const adjudicationPost: PublishablePost = {
  id: 'post-sample-1',
  user_id: 'owner-2',
  client_id: 'client-2',
  owner_kind: 'client',
  owner_id: 'client-2',
  content: 'Fresh brisket, smoked low and slow in Gladstone.',
  platform: 'facebook',
  hashtags: '["#GladstoneEats","#LowAndSlow"]',
  image_url: 'https://cdn.example.test/brisket.jpg',
  post_type: 'image',
  video_url: null,
  video_status: null,
  video_script: null,
  video_shots: null,
  archetype_slug: 'bbq-restaurant',
};

async function adjudicationSourceFields(
  post: PublishablePost = adjudicationPost,
): Promise<Record<string, unknown>> {
  return {
    review_content_hash: await buildReleaseContentHash(post),
    review_content: post.content,
    review_platform: post.platform,
    review_hashtags: post.hashtags,
    review_image_url: post.image_url,
    review_post_type: post.post_type,
    review_video_url: post.video_url,
    review_video_status: post.video_status,
    review_video_script: post.video_script,
    review_video_shots: post.video_shots,
    review_archetype_slug: post.archetype_slug,
  };
}

function makeApp(env: Env) {
  env.ENVIRONMENT ??= 'staging';
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

  it('keeps every approval-pilot operation isolated to staging', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
    });
    const env = {
      DB: db,
      ENVIRONMENT: 'production',
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);
    const adminRequestHeaders = {
      'X-Test-Uid': 'owner_1',
      'Content-Type': 'application/json',
    };
    const requests: Array<[string, RequestInit]> = [
      ['/api/learning/pilot/enroll', {
        method: 'POST',
        headers: adminRequestHeaders,
        body: JSON.stringify({ monthlyAiBudgetUsdCents: 500 }),
      }],
      ['/api/learning/pilot/candidates', { headers: adminRequestHeaders }],
      ['/api/learning/pilot/attest/post-1', {
        method: 'POST',
        headers: adminRequestHeaders,
        body: JSON.stringify({
          realPostConfirmed: true,
          note: 'Confirmed as a genuine owner post.',
        }),
      }],
      ['/api/learning/pilot/validate/post-1', {
        method: 'POST',
        headers: adminRequestHeaders,
      }],
      ['/api/learning/pilot/disqualify/decision-1', {
        method: 'POST',
        headers: adminRequestHeaders,
        body: JSON.stringify({
          reason: 'synthetic_qa',
          note: 'Synthetic staging evidence only.',
        }),
      }],
    ];

    for (const [path, init] of requests) {
      const response = await app.request(path, init, env);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'Approval-pilot operations are available only in isolated staging',
        code: 'pilot_staging_only',
      });
    }
    expect(calls).toHaveLength(requests.length);
    expect(calls.every((call) => call.sql.includes('SELECT email, is_admin'))).toBe(true);
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
    expect(calls[1].binds).toEqual([
      'owner_1', '__owner__', null, 'user', 'owner_1', 'post_1', 20,
    ]);
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
    expect(clientDb.calls[1].binds).toEqual([
      'owner_1', 'client_1', 'client_1', 'client', 'client_1', 'post_client', 20,
    ]);

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
      'store.myshopify.com', 'shop:store.myshopify.com', null,
      'shop', 'store.myshopify.com', 'post_shop', 20,
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

  beforeEach(() => {
    runPilotPipeline.mockReset();
  });

  it('returns the authenticated client learning summary under its canonical tuple', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM clients': [{ status: 'active' }],
      'FROM learning_profiles': [{
        version: 2, profile_json: '{}', approved: 0,
        created_at: '2026-07-14T00:00:00.000Z',
      }],
      'FROM learning_signals ls': [],
      'FROM learning_outcomes lo': [],
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);
    const response = await app.request(
      '/api/learning/profile?clientId=client_1&userId=forged',
      { headers: ownerHeaders },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: { version: 2 }, signals: [], outcomes: [],
    });
    for (const call of calls.filter((entry) =>
      entry.sql.includes('FROM learning_profiles')
      || entry.sql.includes('FROM learning_signals ls')
      || entry.sql.includes('FROM learning_outcomes lo'))) {
      expect(call.binds).toContain('owner_1');
      expect(call.binds).toContain('client_1');
      expect(call.binds).not.toContain('forged');
    }
  });

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

  it('reports current-month metered cost and literal global readiness switches', async () => {
    const evaluatedAt = new Date().toISOString();
    const { db } = makeRecordingD1({
      'FROM workspace_learning_settings': [{
        mode: 'approval', autopublish_consent_at: null,
        autopublish_policy_version: null, experiment_rate: 0,
        monthly_ai_budget_usd_cents: 2500, disabled_reason: null,
      }],
      'FROM learning_release_readiness': [{
        id: 'ready-1', ready: 0, metrics_json: '{}', checks_json: '{}',
        evaluated_by: 'cron', evaluated_at: evaluatedAt,
      }],
      'FROM ai_usage': [{ spend_usd: 7.25, telemetry_count: 4 }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);
    const response = await app.request(
      '/api/learning/readiness',
      { headers: ownerHeaders },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cost: {
        monthlyAiSpendUsdCents: 725,
        monthlyAiBudgetUsdCents: 2500,
        telemetryCount: 4,
        withinBudget: true,
      },
      globalSwitches: {
        learningBrain: true,
        releaseEnforcement: false,
        protectedAutopilot: false,
      },
    });
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

  it('does not persist protected consent for an on-hold client workspace', async () => {
    const { db, calls } = makeRecordingD1({ 'FROM clients': [{ status: 'on_hold' }] });
    const env = { DB: db, LEARNING_RELEASE_ENFORCEMENT: 'true' } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/settings', {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({
        clientId: 'client_1', mode: 'protected_autopilot', consent: true,
        monthlyAiBudgetUsdCents: 1000,
      }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Protected Autopilot cannot be requested while this client is on hold',
    });
    expect(calls.some((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);
  });

  it('does not bank protected consent before every activation gate passes', async () => {
    const evaluatedAt = new Date().toISOString();
    const disabledGates: Array<[string, Partial<Env>]> = [
      ['learning brain', { LEARNING_BRAIN_ENABLED: 'false' }],
      ['release enforcement', { LEARNING_RELEASE_ENFORCEMENT: 'false' }],
      ['protected autopilot', { LEARNING_AUTOPILOT_ENABLED: 'false' }],
    ];

    for (const [gate, disabled] of disabledGates) {
      const { db, calls } = makeRecordingD1({
        'FROM learning_release_readiness': [{
          id: 'ready-1', ready: 1, policy_version: AUTOPILOT_POLICY_VERSION,
          metrics_json: '{}',
          checks_json: JSON.stringify({ tenancyProofs: { user: true } }),
          evaluated_by: 'cron', evaluated_at: evaluatedAt,
        }],
        'FROM ai_usage': [{ spend_usd: 0.5, telemetry_count: 1 }],
      });
      const env = {
        DB: db,
        LEARNING_BRAIN_ENABLED: 'true',
        LEARNING_RELEASE_ENFORCEMENT: 'true',
        LEARNING_AUTOPILOT_ENABLED: 'true',
        ...disabled,
      } as Env;
      const { app } = makeApp(env);

      const response = await app.request('/api/learning/settings', {
        method: 'PUT',
        headers: ownerHeaders,
        body: JSON.stringify({
          mode: 'protected_autopilot', consent: true,
          monthlyAiBudgetUsdCents: 2500, experimentRate: 0,
        }),
      }, env);

      expect(response.status, gate).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'Protected Autopilot is unavailable until every activation gate passes',
        code: 'protected_autopilot_not_ready',
      });
      expect(
        calls.some((call) => call.sql.includes('INSERT INTO workspace_learning_settings')),
        gate,
      ).toBe(false);
    }
  });

  it('does not skip the protected experiment ramp on first activation', async () => {
    const evaluatedAt = new Date().toISOString();
    const { db, calls } = makeRecordingD1({
      'FROM learning_release_readiness': [{
        id: 'ready-1', ready: 1, policy_version: AUTOPILOT_POLICY_VERSION,
        metrics_json: '{}',
        checks_json: JSON.stringify({ tenancyProofs: { user: true } }),
        evaluated_by: 'cron', evaluated_at: evaluatedAt,
      }],
      'FROM ai_usage': [{ spend_usd: 0.5, telemetry_count: 1 }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'true',
      LEARNING_AUTOPILOT_ENABLED: 'true',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/settings', {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({
        mode: 'protected_autopilot', consent: true,
        monthlyAiBudgetUsdCents: 2500, experimentRate: 0.1,
      }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Protected Autopilot experiments must start at 0 and advance only to 0.10 then 0.15',
      code: 'protected_autopilot_experiment_ramp',
    });
    expect(calls.some((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);
  });

  it('stores one-time policy consent under the server-derived owner tuple', async () => {
    const evaluatedAt = new Date().toISOString();
    const { db, calls } = makeRecordingD1({
      'FROM learning_release_readiness': [{
        id: 'ready-1', ready: 1, policy_version: AUTOPILOT_POLICY_VERSION,
        metrics_json: '{}',
        checks_json: JSON.stringify({ tenancyProofs: { user: true } }),
        evaluated_by: 'cron', evaluated_at: evaluatedAt,
      }],
      'FROM ai_usage': [{ spend_usd: 0.5, telemetry_count: 1 }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'true',
      LEARNING_AUTOPILOT_ENABLED: 'true',
    } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/settings', {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({
        mode: 'protected_autopilot', consent: true,
        monthlyAiBudgetUsdCents: 2500, experimentRate: 0,
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

  it('validates one real active-client draft in approval mode without mutating the post', async () => {
    const draft = {
      id: 'draft-1', user_id: 'owner_1', client_id: 'client-1',
      owner_kind: 'client', owner_id: 'client-1', status: 'Draft',
      content: 'Real customer draft', platform: 'Facebook', hashtags: '[]',
      image_url: 'https://images.example/draft.jpg', post_type: 'image',
      video_url: null, video_status: null, video_script: null, video_shots: null,
      archetype_slug: 'bbq-smokehouse', client_status: 'active',
    };
    const sampleHash = await buildReleaseContentHash(draft as PublishablePost);
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM posts p': [draft],
      'SELECT status FROM clients': [{ status: 'active' }],
      'FROM workspace_learning_settings': [{
        mode: 'approval', autopublish_consent_at: null,
        autopublish_policy_version: null, experiment_rate: 0,
        monthly_ai_budget_usd_cents: 500, disabled_reason: null,
      }],
      'FROM learning_pilot_enrollments pen': [{
        id: 'pilot-enrollment-1', monthly_ai_budget_usd_cents: 500,
        pilot_sample_content_hash: sampleHash,
        pilot_sample_basis: 'customer_real_post',
        pilot_sample_attested_at: '2026-07-17T00:00:00.000Z',
      }],
      'SELECT profile FROM clients': [{
        profile: '{"productsServices":"Brisket catering and smoked meats"}',
      }],
      'FROM client_facts': [],
      'FROM posts': [],
      'FROM ai_usage': [{ spend_usd: 0, telemetry_count: 0 }],
      'INSERT INTO learning_decisions': [{ id: 'decision-claim-1' }],
    });
    runPilotPipeline.mockImplementation(async (scopedEnv) => {
      await logAiUsage(scopedEnv, {
        userId: 'owner_1',
        clientId: 'client-1',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        operation: 'learning_release_judge',
        postId: 'draft-1',
        estCostUsd: 0.003,
      });
      return { id: 'decision-claim-1', state: 'pass_green' };
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/validate/draft-1', {
      method: 'POST', headers: adminHeaders,
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      decisionId: 'decision-claim-1', releaseState: 'pass_green',
      postId: 'draft-1', sourceStatus: 'Draft', postMutated: false,
    });
    expect(runPilotPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        DB: db,
        LEARNING_BRAIN_ENABLED: 'true',
        LEARNING_RELEASE_ENFORCEMENT: 'false',
        LEARNING_AUTOPILOT_ENABLED: 'false',
      }),
      expect.objectContaining({
        id: 'draft-1', user_id: 'owner_1', client_id: 'client-1',
        owner_kind: 'client', owner_id: 'client-1', content: 'Real customer draft',
      }),
      'approval',
    );
    const postRead = calls.find((call) => call.sql.includes('FROM posts p'))!;
    expect(postRead.sql).not.toContain('p.archetype_slug');
    expect(postRead.sql).toContain(
      'COALESCE(c.archetype_slug, u.archetype_slug) AS archetype_slug',
    );
    expect(postRead.sql).toContain('LEFT JOIN users u ON u.id = p.user_id');
    expect(calls.some((call) => /UPDATE\s+posts/i.test(call.sql))).toBe(false);
    expect(calls.some((call) => /INSERT\s+INTO\s+posts/i.test(call.sql))).toBe(false);
    const enrollmentRead = calls.find((call) =>
      call.sql.includes('FROM learning_pilot_enrollments pen'))!;
    expect(enrollmentRead.sql).toContain("pen.consent_basis = 'customer_attested'");
    expect(enrollmentRead.sql).toContain('LEFT JOIN learning_pilot_samples sample');
    expect(enrollmentRead.sql).toContain('sample.post_id = ?');
    expect(enrollmentRead.sql).toContain(
      'unixepoch(sample.attested_at) >= unixepoch(pen.consent_confirmed_at)',
    );
    expect(enrollmentRead.sql).toContain('unixepoch(sample.attested_at) <= unixepoch(?)');
    expect(enrollmentRead.sql).toContain("w.mode = 'approval'");
    expect(enrollmentRead.sql).toContain('w.monthly_ai_budget_usd_cents > 0');
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_decisions'))).toBe(true);
  });

  it('appends a positive real-post attestation without mutating the draft', async () => {
    const draft = {
      id: 'draft-real-client', user_id: 'owner_1', client_id: 'client-1',
      owner_kind: 'client', owner_id: 'client-1', status: 'Draft',
      content: 'Real customer catering post.', platform: 'Facebook', hashtags: '[]',
      image_url: null, post_type: 'text', video_url: null, video_status: null,
      video_script: null, video_shots: null, archetype_slug: 'bbq-smokehouse',
      client_status: 'active',
    };
    const contentHash = await buildReleaseContentHash(draft as PublishablePost);
    const sample = {
      id: 'pilot-sample-1', post_id: draft.id, user_id: 'owner_1',
      workspace_key: 'client-1', client_id: 'client-1', owner_kind: 'client',
      owner_id: 'client-1', content_hash: contentHash,
      attestation_basis: 'customer_real_post',
      note: 'Customer confirmed this is a genuine business-page draft.',
      attested_by: 'owner_1', attested_at: '2026-07-19T07:00:00.000Z',
    };
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'INSERT OR IGNORE INTO learning_pilot_samples': [sample],
      'FROM posts p': [draft],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/attest/draft-real-client', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        realPostConfirmed: true,
        note: sample.note,
      }),
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sampleId: sample.id,
      postId: draft.id,
      contentHash,
      attestationBasis: 'customer_real_post',
      attestedAt: sample.attested_at,
      created: true,
      postMutated: false,
    });
    const write = calls.find((call) =>
      call.sql.includes('INSERT OR IGNORE INTO learning_pilot_samples'))!;
    expect(write.sql).toContain('INNER JOIN learning_pilot_enrollments pen');
    expect(write.sql).toContain("pen.consent_basis = 'customer_attested'");
    expect(write.sql).toContain('unixepoch(pen.consent_confirmed_at) <= unixepoch(?)');
    expect(write.sql).toContain('COALESCE(c.archetype_slug, u.archetype_slug) IS ?');
    expect(write.sql).toContain("COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'");
    expect(write.sql).toContain(
      'INNER JOIN learning_decision_disqualifications synthetic_disq',
    );
    expect(write.sql).toContain("synthetic_disq.reason = 'synthetic_qa'");
    expect(write.binds).toContain(contentHash);
    expect(calls.some((call) => /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+posts\b/i.test(call.sql)))
      .toBe(false);
  });

  it('refuses to attest a post quarantined as synthetic QA', async () => {
    const draft = {
      id: 'draft-synthetic-qa', user_id: 'owner_1', client_id: null,
      owner_kind: 'user', owner_id: 'owner_1', status: 'Draft',
      content: 'Synthetic fixture content.', platform: 'Facebook', hashtags: '[]',
      image_url: null, post_type: 'text', video_url: null, video_status: null,
      video_script: null, video_shots: null, archetype_slug: 'tech-saas-agency',
      client_status: null,
    };
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM posts p': [draft],
      'INNER JOIN learning_decision_disqualifications synthetic_disq': [{ quarantined: 1 }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/attest/draft-synthetic-qa', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        realPostConfirmed: true,
        note: 'This fixture must never count as genuine pilot evidence.',
      }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Known synthetic-QA posts cannot enter real pilot evidence',
      code: 'pilot_sample_synthetic_qa',
    });
    expect(calls.some((call) => call.sql.includes('INSERT OR IGNORE INTO learning_pilot_samples')))
      .toBe(false);
    expect(calls.some((call) => /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+posts\b/i.test(call.sql)))
      .toBe(false);
  });

  it('refuses validation before context or spend when the exact draft is not attested', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM posts p': [{
        id: 'draft-unattested', user_id: 'owner_1', client_id: null,
        owner_kind: 'user', owner_id: 'owner_1', status: 'Draft',
        content: 'Real owner draft.', platform: 'Facebook', hashtags: '[]',
        image_url: null, post_type: 'text', video_url: null, video_status: null,
        video_script: null, video_shots: null, archetype_slug: 'tech-saas-agency',
        client_status: null,
      }],
      'FROM workspace_learning_settings': [{
        mode: 'approval', autopublish_consent_at: null,
        autopublish_policy_version: null, experiment_rate: 0,
        monthly_ai_budget_usd_cents: 500, disabled_reason: null,
      }],
      'FROM learning_pilot_enrollments pen': [{
        id: 'pilot-enrollment-owner', monthly_ai_budget_usd_cents: 500,
        pilot_sample_content_hash: null,
        pilot_sample_basis: null,
        pilot_sample_attested_at: null,
      }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/validate/draft-unattested', {
      method: 'POST', headers: adminHeaders,
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Exact draft version has no positive real-post pilot attestation',
      code: 'pilot_sample_not_attested',
    });
    expect(calls.some((call) => call.sql.includes('SELECT profile FROM users'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('FROM ai_usage'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_decisions'))).toBe(false);
  });

  it('stops pilot validation before critic spend when the budget reserve is unavailable', async () => {
    const draft = {
      id: 'draft-budget-stop', user_id: 'owner_1', client_id: null,
      owner_kind: 'user', owner_id: 'owner_1', status: 'Draft',
      content: 'Owner draft', platform: 'Facebook', hashtags: '[]',
      image_url: null, post_type: 'text', video_url: null, video_status: null,
      video_script: null, video_shots: null, archetype_slug: 'tech-saas-agency',
      client_status: null,
    };
    const sampleHash = await buildReleaseContentHash(draft as PublishablePost);
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM posts p': [draft],
      'FROM workspace_learning_settings': [{
        mode: 'approval', autopublish_consent_at: null,
        autopublish_policy_version: null, experiment_rate: 0,
        monthly_ai_budget_usd_cents: 500, disabled_reason: null,
      }],
      'FROM learning_pilot_enrollments pen': [{
        id: 'pilot-enrollment-owner', monthly_ai_budget_usd_cents: 500,
        pilot_sample_content_hash: sampleHash,
        pilot_sample_basis: 'owner_real_post',
        pilot_sample_attested_at: '2026-07-17T00:00:00.000Z',
      }],
      'SELECT profile FROM users': [{
        profile: '{"description":"Custom software and workflow automation"}',
      }],
      'FROM client_facts': [],
      'FROM posts': [],
      'FROM ai_usage': [{ spend_usd: 4.51, telemetry_count: 30 }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/validate/draft-budget-stop', {
      method: 'POST', headers: adminHeaders,
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Pilot AI budget reserve is unavailable; no critics ran',
    });
    expect(runPilotPipeline).not.toHaveBeenCalled();
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_decisions'))).toBe(false);
    expect(calls.some((call) => /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+posts\b/i.test(call.sql)))
      .toBe(false);
  });

  it('refuses pilot validation before budget or critic spend when business context is empty', async () => {
    const draft = {
      id: 'draft-empty-context', user_id: 'owner_1', client_id: null,
      owner_kind: 'user', owner_id: 'owner_1', status: 'Draft',
      content: 'A claim-free workflow observation.', platform: 'Facebook', hashtags: '[]',
      image_url: null, post_type: 'text', video_url: null, video_status: null,
      video_script: null, video_shots: null, archetype_slug: 'tech-saas-agency',
      client_status: null,
    };
    const sampleHash = await buildReleaseContentHash(draft as PublishablePost);
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM posts p': [draft],
      'FROM workspace_learning_settings': [{
        mode: 'approval', autopublish_consent_at: null,
        autopublish_policy_version: null, experiment_rate: 0,
        monthly_ai_budget_usd_cents: 500, disabled_reason: null,
      }],
      'FROM learning_pilot_enrollments pen': [{
        id: 'pilot-enrollment-owner', monthly_ai_budget_usd_cents: 500,
        pilot_sample_content_hash: sampleHash,
        pilot_sample_basis: 'owner_real_post',
        pilot_sample_attested_at: '2026-07-17T00:00:00.000Z',
      }],
      'SELECT profile FROM users': [{
        profile: '{"name":"Penny Wise I.T","tone":"Professional","location":"Gladstone"}',
      }],
      'FROM client_facts': [],
      'FROM posts': [],
      'FROM ai_usage': [{ spend_usd: 0, telemetry_count: 0 }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/validate/draft-empty-context', {
      method: 'POST', headers: adminHeaders,
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Pilot business context is incomplete; complete the business profile or add a verified fact before running critics',
      code: 'pilot_context_not_ready',
      readiness: {
        meaningfulProfileFieldCount: 0,
        verifiedFactCount: 0,
      },
    });
    expect(runPilotPipeline).not.toHaveBeenCalled();
    expect(calls.some((call) => call.sql.includes('FROM ai_usage'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_decisions'))).toBe(false);
    expect(calls.some((call) => /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+posts\b/i.test(call.sql)))
      .toBe(false);
  });

  it('refuses pilot validation when approval settings exist without an enrollment receipt', async () => {
    const { db } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM posts p': [{
        id: 'draft-without-receipt', user_id: 'owner_1', client_id: null,
        owner_kind: 'user', owner_id: 'owner_1', status: 'Draft',
        content: 'Owner draft', platform: 'Facebook', hashtags: '[]',
        image_url: null, post_type: 'text', video_url: null, video_status: null,
        video_script: null, video_shots: null, archetype_slug: 'tech-saas-agency',
        client_status: null,
      }],
      'FROM workspace_learning_settings': [{
        mode: 'approval', autopublish_consent_at: null,
        autopublish_policy_version: null, experiment_rate: 0,
        monthly_ai_budget_usd_cents: 500, disabled_reason: null,
      }],
      'FROM learning_pilot_enrollments pen': [],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/validate/draft-without-receipt', {
      method: 'POST', headers: adminHeaders,
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Workspace has no current-policy pilot enrollment receipt',
    });
    expect(runPilotPipeline).not.toHaveBeenCalled();
  });

  it('refuses pilot validation for an on-hold client before running critics', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM posts p': [{
        id: 'held-draft', user_id: 'owner_1', client_id: 'hughesq-001',
        owner_kind: 'client', owner_id: 'hughesq-001', status: 'Draft',
        content: 'Held draft', platform: 'Facebook', hashtags: '[]',
        image_url: null, post_type: 'text', video_url: null, video_status: null,
        video_script: null, video_shots: null, archetype_slug: 'bbq-smokehouse',
        client_status: 'on_hold',
      }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/validate/held-draft', {
      method: 'POST', headers: adminHeaders,
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Pilot validation cannot include an on-hold client',
    });
    expect(runPilotPipeline).not.toHaveBeenCalled();
    expect(calls.some((call) => /UPDATE\s+posts/i.test(call.sql))).toBe(false);
  });

  it('appends a staging-only synthetic QA disqualification without mutating evidence', async () => {
    const note = 'Authenticated staging QA fixture created for release-gate testing.';
    const receipt = {
      id: 'disqualification-1',
      decision_id: 'decision-qa-1',
      user_id: 'owner_1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner_1',
      reason: 'synthetic_qa',
      note,
      excluded_by: 'owner_1',
      created_at: '2026-07-17T13:00:00.000Z',
    };
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'INSERT INTO learning_decision_disqualifications': [receipt],
      'FROM learning_decision_disqualifications': [],
    });
    const env = {
      DB: db,
      ENVIRONMENT: 'staging',
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request(
      '/api/learning/pilot/disqualify/decision-qa-1',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ reason: 'synthetic_qa', note }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      disqualificationId: 'disqualification-1',
      decisionId: 'decision-qa-1',
      reason: 'synthetic_qa',
      createdAt: '2026-07-17T13:00:00.000Z',
      created: true,
      postMutated: false,
    });
    const write = calls.find((call) =>
      call.sql.includes('INSERT INTO learning_decision_disqualifications'))!;
    expect(write.method).toBe('first');
    expect(write.binds.slice(1)).toEqual([
      'synthetic_qa',
      note,
      'owner_1',
      expect.any(String),
      AUTOPILOT_POLICY_VERSION,
      'decision-qa-1',
    ]);
    expect(write.sql).toContain('INNER JOIN learning_pilot_enrollments pen');
    expect(write.sql).toContain("pen.consent_basis = 'owner_self'");
    expect(write.sql).toContain("pen.consent_basis = 'customer_attested'");
    expect(write.sql).toContain("LOWER(TRIM(COALESCE(p.status, ''))) = 'draft'");
    expect(write.sql).toContain(
      "NULLIF(TRIM(COALESCE(p.scheduled_for, '')), '') IS NULL",
    );
    expect(write.sql).toContain('FROM learning_adjudications a');
    expect(write.sql).toContain('FROM publication_events pe');
    expect(write.sql).toContain(
      "COALESCE(LOWER(TRIM(pilot_client.status)), 'active') <> 'on_hold'",
    );
    expect(calls.some((call) =>
      /\b(?:UPDATE|DELETE FROM)\s+(?:posts|learning_decisions)\b/i.test(call.sql)))
      .toBe(false);
  });

  it('returns the existing immutable disqualification idempotently', async () => {
    const existing = {
      id: 'disqualification-existing',
      decision_id: 'decision-qa-existing',
      user_id: 'owner_1',
      workspace_key: '__owner__',
      client_id: null,
      owner_kind: 'user',
      owner_id: 'owner_1',
      reason: 'synthetic_qa',
      note: 'Existing authenticated staging QA fixture.',
      excluded_by: 'owner_1',
      created_at: '2026-07-17T12:00:00.000Z',
    };
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM learning_decision_disqualifications': [existing],
    });
    const env = {
      DB: db,
      ENVIRONMENT: 'staging',
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request(
      '/api/learning/pilot/disqualify/decision-qa-existing',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          reason: 'synthetic_qa',
          note: 'A repeat request must not create a second receipt.',
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      disqualificationId: 'disqualification-existing',
      decisionId: 'decision-qa-existing',
      created: false,
      postMutated: false,
    });
    expect(calls.some((call) =>
      call.sql.includes('INSERT INTO learning_decision_disqualifications'))).toBe(false);
  });

  it('rejects non-admin, non-staging, malformed, and unsafe disqualifications', async () => {
    const nonAdminDb = makeRecordingD1({ 'SELECT email, is_admin': [] });
    const stagingEnv = {
      DB: nonAdminDb.db,
      ENVIRONMENT: 'staging',
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const stagingApp = makeApp(stagingEnv);
    const nonAdmin = await stagingApp.app.request(
      '/api/learning/pilot/disqualify/decision-qa',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ reason: 'synthetic_qa', note: 'Synthetic QA receipt.' }),
      },
      stagingEnv,
    );
    expect(nonAdmin.status).toBe(403);
    expect(nonAdminDb.calls.some((call) =>
      call.sql.includes('learning_decision_disqualifications'))).toBe(false);

    const productionDb = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
    });
    const productionEnv = {
      DB: productionDb.db,
      ENVIRONMENT: 'production',
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const productionApp = makeApp(productionEnv);
    const production = await productionApp.app.request(
      '/api/learning/pilot/disqualify/decision-qa',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ reason: 'synthetic_qa', note: 'Synthetic QA receipt.' }),
      },
      productionEnv,
    );
    expect(production.status).toBe(409);
    expect(productionDb.calls.some((call) =>
      call.sql.includes('learning_decision_disqualifications'))).toBe(false);

    const unsafeDb = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM learning_decision_disqualifications': [],
      'INSERT INTO learning_decision_disqualifications': [],
    });
    const unsafeEnv = { ...stagingEnv, DB: unsafeDb.db } as Env;
    const unsafeApp = makeApp(unsafeEnv);
    const malformed = await unsafeApp.app.request(
      '/api/learning/pilot/disqualify/decision-qa',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          reason: 'customer_request',
          note: 'Wrong reason must fail.',
          force: true,
        }),
      },
      unsafeEnv,
    );
    expect(malformed.status).toBe(400);
    expect(unsafeDb.calls.some((call) =>
      call.sql.includes('INSERT INTO learning_decision_disqualifications'))).toBe(false);

    const unsafe = await unsafeApp.app.request(
      '/api/learning/pilot/disqualify/decision-published',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          reason: 'synthetic_qa',
          note: 'Published or adjudicated evidence must fail closed.',
        }),
      },
      unsafeEnv,
    );
    expect(unsafe.status).toBe(409);
    expect(unsafeDb.calls.find((call) =>
      call.sql.includes('INSERT INTO learning_decision_disqualifications'))?.sql)
      .toContain('NOT EXISTS');
  });

  it('enrolls one active client into record-only approval validation with an explicit cost ceiling', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'SELECT status FROM clients': [{ status: 'active' }],
      'SELECT profile FROM clients': [{
        profile: '{"description":"Active client with verified business context."}',
      }],
      'COUNT(*) AS draft_count': [{ draft_count: 4 }],
      'COUNT(*) AS approval_count': [{ approval_count: 0 }],
      'SELECT id, enrolled_at': [{
        id: 'pilot-enrollment-1', enrolled_at: '2026-07-15T00:00:00.000Z',
      }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/enroll', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        clientId: 'client-1',
        monthlyAiBudgetUsdCents: 500,
        customerConsentConfirmed: true,
        customerConsentNote: 'Customer confirmed record-only pilot participation by phone.',
      }),
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workspaceKey: 'client-1', ownerKind: 'client', ownerId: 'client-1',
      mode: 'approval', monthlyAiBudgetUsdCents: 500,
      autopublishConsentAt: null, recordOnly: true,
      pilotEnrollmentId: 'pilot-enrollment-1',
      pilotPolicyVersion: AUTOPILOT_POLICY_VERSION,
      enrolledAt: '2026-07-15T00:00:00.000Z',
    });
    const write = calls.find((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))!;
    expect(write.binds.slice(1, 11)).toEqual([
      'owner_1', 'client-1', 'client-1', 'client', 'client-1',
      'approval', null, null, 0, 500,
    ]);
    const enrollmentWrite = calls.find((call) =>
      call.sql.includes('INSERT OR IGNORE INTO learning_pilot_enrollments'))!;
    expect(enrollmentWrite.binds).toEqual([
      expect.any(String), 'owner_1', 'client-1', 'client-1', 'client', 'client-1',
      AUTOPILOT_POLICY_VERSION, 'owner_1', expect.any(String), 1,
      'customer_attested', expect.any(String),
      'Customer confirmed record-only pilot participation by phone.',
    ]);
    const enrollmentWriteIndex = calls.indexOf(enrollmentWrite);
    const settingsWriteIndex = calls.indexOf(write);
    expect(settingsWriteIndex).toBeGreaterThan(enrollmentWriteIndex);
    expect(calls.some((call) => /UPDATE\s+posts/i.test(call.sql))).toBe(false);
  });

  it('leaves no approval settings when another request wins the unique client pilot slot', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'SELECT status FROM clients': [{ status: 'active' }],
      'SELECT profile FROM clients': [{
        profile: '{"description":"Consented client business context."}',
      }],
      'COUNT(*) AS draft_count': [{ draft_count: 3 }],
      'COUNT(*) AS approval_count': [{ approval_count: 0 }],
      'SELECT id, enrolled_at': [],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/enroll', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        clientId: 'client-race-loser',
        monthlyAiBudgetUsdCents: 500,
        customerConsentConfirmed: true,
        customerConsentNote: 'Customer confirmed record-only pilot participation in writing.',
      }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Only one client workspace may be enrolled in the approval pilot',
    });
    expect(calls.some((call) =>
      call.sql.includes('INSERT OR IGNORE INTO learning_pilot_enrollments'))).toBe(true);
    expect(calls.some((call) =>
      call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);
  });

  it('requires an explicit customer consent attestation before enrolling a client pilot', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'SELECT status FROM clients': [{ status: 'active' }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/enroll', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ clientId: 'client-1', monthlyAiBudgetUsdCents: 500 }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Client pilot enrollment requires a customer consent attestation and note',
    });
    expect(calls.some((call) => call.sql.includes('workspace_learning_settings'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('learning_pilot_enrollments'))).toBe(false);
  });

  it('refuses pilot enrollment before recording consent when business context is incomplete', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'SELECT status FROM clients': [{ status: 'active' }],
      'SELECT profile FROM clients': [{ profile: '{}' }],
      'COUNT(*) AS draft_count': [{ draft_count: 1 }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/enroll', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        clientId: 'client-without-context',
        monthlyAiBudgetUsdCents: 500,
        customerConsentConfirmed: true,
        customerConsentNote: 'Customer confirmed record-only pilot participation in writing.',
      }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Pilot business context is incomplete; complete the business profile or add a verified fact before enrollment',
      code: 'pilot_context_not_ready',
      readiness: {
        meaningfulProfileFieldCount: 0,
        verifiedFactCount: 0,
      },
    });
    expect(calls.some((call) =>
      call.sql.includes('INSERT OR IGNORE INTO learning_pilot_enrollments'))).toBe(false);
    expect(calls.some((call) =>
      call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);
  });

  it('refuses to enroll an on-hold client or exceed one client pilot workspace', async () => {
    const heldDb = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'SELECT status FROM clients': [{ status: 'on_hold' }],
    });
    const heldEnv = {
      DB: heldDb.db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const heldApp = makeApp(heldEnv);
    const held = await heldApp.app.request('/api/learning/pilot/enroll', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        clientId: 'hughesq-001', monthlyAiBudgetUsdCents: 500,
        customerConsentConfirmed: true,
        customerConsentNote: 'Customer confirmed record-only pilot participation.',
      }),
    }, heldEnv);
    expect(held.status).toBe(409);
    expect(heldDb.calls.some((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);

    const cappedDb = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'SELECT status FROM clients': [{ status: 'active' }],
      'SELECT profile FROM clients': [{
        profile: '{"description":"Second active client business context."}',
      }],
      'COUNT(*) AS draft_count': [{ draft_count: 2 }],
      'COUNT(*) AS approval_count': [{ approval_count: 1 }],
    });
    const cappedEnv = { ...heldEnv, DB: cappedDb.db } as Env;
    const cappedApp = makeApp(cappedEnv);
    const capped = await cappedApp.app.request('/api/learning/pilot/enroll', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        clientId: 'client-2', monthlyAiBudgetUsdCents: 500,
        customerConsentConfirmed: true,
        customerConsentNote: 'Customer confirmed record-only pilot participation.',
      }),
    }, cappedEnv);
    expect(capped.status).toBe(409);
    await expect(capped.json()).resolves.toEqual({
      error: 'Only one client workspace may be enrolled in the approval pilot',
    });
    const cohortCap = cappedDb.calls.find((call) =>
      call.sql.includes('COUNT(*) AS approval_count'))!;
    expect(cohortCap.binds).toEqual([
      AUTOPILOT_POLICY_VERSION, 'client', 'owner_1', 'client-2',
    ]);
    expect(cohortCap.sql).toContain('NOT (user_id = ? AND workspace_key = ?)');
    expect(cappedDb.calls.some((call) => call.sql.includes('INSERT INTO workspace_learning_settings'))).toBe(false);
  });

  it('returns a server-selected queue of eligible non-held drafts and their enrollment state', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM posts p': [
        {
          user_id: 'owner_1', client_id: null, owner_kind: 'user',
          owner_id: 'owner_1', workspace_key: '__owner__', label: 'My workspace',
          eligible_draft_count: 5, sample_post_id: 'draft-owner',
          enrolled: 1, monthly_ai_budget_usd_cents: 500,
          profile_json: '{"description":"Owner business context."}',
          verified_fact_contents_json: '[]',
        },
        {
          user_id: 'owner_1', client_id: 'client-1', owner_kind: 'client',
          owner_id: 'client-1', workspace_key: 'client-1', label: 'Active Client',
          eligible_draft_count: 4, sample_post_id: 'draft-client',
          enrolled: 0, monthly_ai_budget_usd_cents: null,
          profile_json: '{}',
          verified_fact_contents_json: '["Verified trading location."]',
        },
      ],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);

    const response = await app.request('/api/learning/pilot/candidates', {
      headers: adminHeaders,
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recordOnly: true,
      candidates: [
        {
          clientId: null, ownerKind: 'user', ownerId: 'owner_1',
          workspaceKey: '__owner__', label: 'My workspace', eligibleDraftCount: 5,
          samplePostId: 'draft-owner', enrolled: true, monthlyAiBudgetUsdCents: 500,
          contextReady: true, contextReason: 'business_profile',
          meaningfulProfileFieldCount: 1, verifiedFactCount: 0,
        },
        {
          clientId: 'client-1', ownerKind: 'client', ownerId: 'client-1',
          workspaceKey: 'client-1', label: 'Active Client', eligibleDraftCount: 4,
          samplePostId: 'draft-client', enrolled: false, monthlyAiBudgetUsdCents: null,
          contextReady: true, contextReason: 'verified_facts',
          meaningfulProfileFieldCount: 0, verifiedFactCount: 1,
        },
      ],
    });
    const query = calls.find((call) => call.sql.includes('FROM posts p'))!;
    expect(query.binds).toEqual([AUTOPILOT_POLICY_VERSION, 'owner_1']);
    expect(query.sql).toContain('LEFT JOIN learning_pilot_enrollments pen');
    expect(query.sql).toContain('pen.policy_version = ?');
    expect(query.sql).toContain("p.status = 'Draft'");
    expect(query.sql).toContain("LOWER(TRIM(COALESCE(c.status, 'active'))) != 'on_hold'");
    expect(query.sql).toContain('NOT EXISTS');
    expect(query.sql).toContain("d.stage = 'release'");
    expect(query.sql).toContain("d.release_state IN ('pass_green','hold_amber','block_red')");
    expect(query.sql).toContain(
      'INNER JOIN learning_decision_disqualifications synthetic_disq',
    );
    expect(query.sql).toContain("synthetic_disq.reason = 'synthetic_qa'");
    expect(query.sql).toContain("$.verdictCount");
    expect(query.sql).toContain('CASE WHEN p.client_id IS NULL THEN u.profile ELSE c.profile END');
    expect(query.sql).toContain('json_group_array(f.content)');
  });

  it('lets only an admin adjudicate a release decision and derives its tenant tuple', async () => {
    const decision = {
      id: 'decision-1', user_id: 'owner-2', workspace_key: 'client-2',
      client_id: 'client-2', owner_kind: 'client', owner_id: 'client-2',
      sample_post_id: adjudicationPost.id,
      ...await adjudicationSourceFields(),
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
    const sourceRead = calls.find((call) => call.sql.includes('FROM learning_decisions'))!;
    expect(sourceRead.sql).toContain('INNER JOIN learning_pilot_enrollments');
    expect(sourceRead.sql).toContain('INNER JOIN learning_pilot_samples sample');
    expect(sourceRead.sql).toContain('sample.content_hash = d.content_hash');
    expect(sourceRead.sql).toContain('pen.policy_version = ?');
    expect(sourceRead.sql).toContain('LEFT JOIN learning_decision_disqualifications disq');
    expect(sourceRead.sql).toContain('disq.id IS NULL');
    expect(sourceRead.sql).toContain('LEFT JOIN posts p');
    expect(sourceRead.binds).toEqual([AUTOPILOT_POLICY_VERSION, 'decision-1']);
  });

  it('rejects an adjudication when the current source no longer matches the receipt hash', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM learning_decisions': [{
        id: 'decision-stale', user_id: 'owner-2', workspace_key: 'client-2',
        client_id: 'client-2', owner_kind: 'client', owner_id: 'client-2',
        sample_post_id: adjudicationPost.id,
        ...await adjudicationSourceFields(),
        review_content_hash: '0'.repeat(64),
      }],
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/decisions/decision-stale/adjudicate', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        expectedState: 'pass_green', severity: 'advisory', note: 'Source is safe',
      }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Decision source evidence is unavailable or has changed; create a fresh receipt before adjudication',
    });
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_adjudications'))).toBe(false);
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

  it('rejects release evidence whose requested lifetime exceeds seven days', async () => {
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
    });
    const env = { DB: db } as Env;
    const { app } = makeApp(env);
    const response = await app.request('/api/learning/readiness/evidence', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        evidenceKind: 'kill_switch', passed: true,
        artifactHash: 'c'.repeat(64), note: 'Fresh kill-switch exercise',
        expiresAt: '2100-01-01T00:00:00.000Z',
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'expiresAt cannot be more than seven days in the future',
    });
    expect(calls.some((call) => call.sql.includes('INSERT INTO learning_release_evidence'))).toBe(false);
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

  it('returns bounded admin operational metrics from immutable release evidence', async () => {
    const evaluatedAt = new Date().toISOString();
    const evidenceRecordedAt = new Date(Date.now() - 60_000).toISOString();
    const evidenceExpiresAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
    const releaseEvidence = [
      ['replay_red_team', null],
      ['kill_switch', null],
      ['publish_regression', null],
      ['staging_green', 'user'],
      ['staging_block', 'user'],
      ['staging_green', 'client'],
      ['staging_block', 'client'],
      ['staging_green', 'shop'],
      ['staging_block', 'shop'],
    ].map(([evidence_kind, owner_kind]) => ({
      evidence_kind, owner_kind, passed: 1,
      recorded_at: evidenceRecordedAt, expires_at: evidenceExpiresAt,
    }));
    const sourceFields = await adjudicationSourceFields();
    const { db, calls } = makeRecordingD1({
      'SELECT email, is_admin': [{ email: 'admin@example.com', is_admin: 1 }],
      'FROM learning_release_readiness': [{
        id: 'ready-1', ready: 0,
        metrics_json: JSON.stringify({
          pilotDecisions: 12, pilotWorkspaceCount: 2,
          pilotUserDecisions: 5, pilotClientDecisions: 7,
          adjudicatedDecisions: 8,
        }),
        checks_json: '{"pilot":false}', evaluated_by: 'cron', evaluated_at: evaluatedAt,
      }],
      'WITH latest_evidence AS': releaseEvidence,
      'WITH pilot_cohort AS': [{
        user_id: 'owner-2', workspace_key: 'client-2', client_id: 'client-2',
        owner_kind: 'client', owner_id: 'client-2', mode: 'approval',
        autopublish_policy_version: null, updated_at: evaluatedAt,
        client_status: 'on_hold', shop_uninstalled_at: null,
        decision_count: 20, hold_count: 4, adjudicated_count: 10,
        false_hold_count: 1, severe_false_passes: 0,
        critic_total: 200, critic_available: 198,
        judge_total: 20, judge_available: 20, judge_telemetry_count: 20,
        sample_decision_id: 'decision-sample-1', sample_post_id: 'post-sample-1',
        ...sourceFields,
      }],
    });
    const env = {
      DB: db,
      LEARNING_BRAIN_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
      LEARNING_AUTOPILOT_ENABLED: 'false',
    } as Env;
    const { app } = makeApp(env);
    const response = await app.request(
      '/api/learning/admin/operations?limit=10',
      { headers: adminHeaders },
      env,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, any>;
    expect(payload).toMatchObject({
      readiness: {
        ready: false,
        checks: { pilot: false },
        metrics: { pilotDecisions: 12 },
      },
      globalSwitches: {
        learningBrain: true,
        releaseEnforcement: false,
        protectedAutopilot: false,
      },
      releaseEvidence: {
        validCount: 9,
        requiredCount: 9,
        invalidOrMissingCount: 0,
        expiredCount: 0,
        complete: true,
        nextExpiryAt: evidenceExpiresAt,
      },
      workspaces: [{
        workspaceKey: 'client-2', ownerKind: 'client', mode: 'approval',
        onHold: true, decisionCount: 20, holdRate: 0.2,
        sampledFalseHoldRate: 0.1, criticAvailability: 0.99,
        judgeAvailability: 1, severeFalsePasses: 0,
        judgeTelemetryCoverage: 1,
        adjudicationCoverage: 0.5, globalKillSwitchEnabled: false,
        sampleDecisionId: 'decision-sample-1', samplePostId: 'post-sample-1',
        sampleEvidenceStatus: 'verified',
        sampleEvidence: {
          content: adjudicationPost.content,
          platform: 'facebook',
          hashtags: ['#GladstoneEats', '#LowAndSlow'],
          mediaKind: 'image',
          mediaUrl: adjudicationPost.image_url,
          thumbnailUrl: null,
          contentHash: sourceFields.review_content_hash,
        },
      }],
    });
    expect(payload.workspaces[0]).not.toHaveProperty('sampleReleaseState');
    const operations = calls.find((call) => call.sql.includes('WITH pilot_cohort AS'))!;
    expect(operations.sql).toContain('ROW_NUMBER() OVER');
    expect(operations.sql).toContain('verdict_attempts AS');
    expect(operations.sql).toContain('verdict_sources AS');
    expect(operations.sql).toContain('verdict_slots AS');
    expect(operations.sql).toContain('decision_critic_paths AS');
    expect(operations.sql).toContain('expected_critic_metrics AS');
    expect(operations.sql).toContain(
      'PARTITION BY v.decision_id, v.critic_lane, v.critic_kind',
    );
    expect(operations.sql).toContain("WHEN v.provider = 'deterministic'");
    expect(operations.sql).toContain("THEN 'deterministic'");
    expect(operations.sql).toContain('MAX(v.attempt) OVER');
    expect(operations.sql).toContain('v.attempt = v.latest_attempt');
    expect(operations.sql).toContain(
      "MAX(CASE WHEN v.verdict != 'unavailable' THEN 1 ELSE 0 END)",
    );
    expect(operations.sql).toContain("'image'");
    expect(operations.sql).toContain("'video_manifest'");
    expect(operations.sql).toContain('AS critic_total');
    expect(operations.sql).toContain('deterministic_block');
    expect(operations.sql).toContain('THEN v.available ELSE 0 END');
    expect(operations.sql).toContain('AS judge_total');
    expect(operations.sql).toContain('AS judge_telemetry_count');
    expect(operations.sql).not.toContain('WITH recent AS');
    expect(operations.sql).not.toContain('r.rn <= 30');
    expect(operations.sql).toContain("w.owner_kind = 'client'");
    expect(operations.sql).toContain("w.owner_kind = 'shop'");
    expect(operations.sql).toContain('a.id IS NULL');
    expect(operations.sql).toContain('sample_rank = 1');
    expect(operations.sql).toContain('INNER JOIN learning_pilot_enrollments pen');
    expect(operations.sql).toContain('INNER JOIN learning_pilot_samples sample');
    expect(operations.sql).toContain('sample.content_hash = d.content_hash');
    expect(operations.sql).toContain('pen.policy_version = ?');
    expect(operations.sql).toContain('LEFT JOIN learning_decision_disqualifications disq');
    expect(operations.sql).toContain('disq.id IS NULL');
    expect(operations.sql).toContain('LEFT JOIN posts p');
    expect(operations.sql).not.toContain('sample_release_state');
    expect(operations.binds).toEqual([AUTOPILOT_POLICY_VERSION, 10]);
    const evidenceQuery = calls.find((call) => call.sql.includes('WITH latest_evidence AS'))!;
    expect(evidenceQuery.sql).toContain('ROW_NUMBER() OVER');
    expect(evidenceQuery.sql).toContain("PARTITION BY evidence_kind, COALESCE(owner_kind, '')");
    expect(evidenceQuery.sql).toContain('WHERE evidence_rank = 1');
    expect(evidenceQuery.sql).toContain('LIMIT ?');
    expect(evidenceQuery.binds).toEqual([AUTOPILOT_POLICY_VERSION, 9]);
  });
});
