import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { AUTOPILOT_POLICY_VERSION } from '../lib/learning/readiness';
import {
  evaluateReleasePreflight,
  type PublishablePost,
} from '../lib/learning/release-preflight';
import { loadWorkspaceLearningMode } from '../lib/learning/workspace-mode';
import {
  publishPersistedPost,
  type PublishOrchestratorDeps,
} from '../lib/publishing/publish-orchestrator';
import { ensureWorkspaceLearningSettings } from '../lib/provisioning';
import { learningReadinessChecks } from './helpers/learning-readiness';
import { makeRecordingD1 } from './helpers/recording-d1';

const userPost: PublishablePost = {
  id: 'post-user',
  user_id: 'u1',
  client_id: null,
  owner_kind: 'user',
  owner_id: 'u1',
  content: 'Safe local update',
  platform: 'facebook',
  hashtags: '[]',
  image_url: 'https://cdn.example/safe.jpg',
  post_type: 'image',
  video_url: null,
  video_status: null,
};

const clientPost: PublishablePost = {
  ...userPost,
  id: 'post-client',
  client_id: 'c1',
  owner_kind: 'client',
  owner_id: 'c1',
};

function modeEnv(options: {
  requested?: 'off' | 'shadow' | 'approval' | 'protected_autopilot';
  enforcement?: boolean;
  autopilot?: boolean;
  activeClient?: boolean;
  consent?: boolean;
  readiness?: boolean;
  readinessChecks?: unknown;
} = {}): Env {
  const fixtures: Record<string, unknown[]> = {
    'FROM clients': options.activeClient === false ? [] : [{ status: 'active' }],
    'FROM workspace_learning_settings': options.requested == null ? [] : [{
      mode: options.requested,
      autopublish_consent_at: options.consent ? new Date().toISOString() : null,
      autopublish_policy_version: options.consent ? AUTOPILOT_POLICY_VERSION : null,
      experiment_rate: 0,
      monthly_ai_budget_usd_cents: 10_000,
      disabled_reason: null,
    }],
    'FROM learning_release_readiness': options.readiness === false ? [] : [{
      ready: 1,
      policy_version: AUTOPILOT_POLICY_VERSION,
      checks_json: JSON.stringify(options.readinessChecks ?? learningReadinessChecks()),
      evaluated_at: new Date().toISOString(),
    }],
    'FROM ai_usage': [{ spend_usd: 1, telemetry_count: 1 }],
  };
  const { db } = makeRecordingD1(fixtures);
  return {
    DB: db,
    LEARNING_BRAIN_ENABLED: 'true',
    LEARNING_RELEASE_ENFORCEMENT: options.enforcement === false ? 'false' : 'true',
    LEARNING_AUTOPILOT_ENABLED: options.autopilot === false ? 'false' : 'true',
  } as Env;
}

async function evaluateWithState(
  env: Env,
  post: PublishablePost,
  state: 'pass_green' | 'hold_amber' | 'block_red',
) {
  const modes: string[] = [];
  const result = await evaluateReleasePreflight(env, post, {
    loadMode: loadWorkspaceLearningMode,
    runPipeline: async (_env, _post, mode) => {
      modes.push(mode);
      return { id: `decision-${state}`, state };
    },
  });
  return { result, modes };
}

describe('permanent release preflight', () => {
  it('preserves legacy off and record-only shadow delivery before enforcement', async () => {
    const offEnv = modeEnv({ requested: 'off', enforcement: false });
    const off = await evaluateWithState(offEnv, clientPost, 'block_red');
    expect(off.result).toMatchObject({ mode: 'off', mayPublish: true, mustHold: false });
    expect(off.modes).toEqual([]);

    const shadowEnv = modeEnv({ requested: 'shadow', enforcement: false });
    const shadow = await evaluateWithState(shadowEnv, clientPost, 'block_red');
    expect(shadow.result).toMatchObject({
      mode: 'shadow',
      state: 'shadow_only',
      mayPublish: true,
      mustHold: false,
    });
    expect(shadow.modes).toEqual(['shadow']);
  });

  it('runs the critic pipeline for active missing, off, and shadow settings after enforcement', async () => {
    for (const requested of [undefined, 'off', 'shadow'] as const) {
      const { result, modes } = await evaluateWithState(
        modeEnv({ requested, enforcement: true }),
        clientPost,
        'pass_green',
      );
      expect(result).toMatchObject({ mode: 'approval', state: 'pass_green', mayPublish: true });
      expect(modes).toEqual(['approval']);
    }
  });

  it('publishes a fully gated protected post and holds unresolved amber or red posts', async () => {
    const protectedResult = await evaluateWithState(
      modeEnv({
        requested: 'protected_autopilot',
        consent: true,
        readiness: true,
      }),
      clientPost,
      'pass_green',
    );
    expect(protectedResult.result).toMatchObject({
      mode: 'protected_autopilot',
      state: 'pass_green',
      mayPublish: true,
    });

    for (const state of ['hold_amber', 'block_red'] as const) {
      const { result } = await evaluateWithState(
        modeEnv({ requested: 'approval' }),
        clientPost,
        state,
      );
      expect(result).toMatchObject({ state, mayPublish: false, mustHold: true });
    }
  });

  it('downgrades protected autopilot to approval when the emergency switch is off', async () => {
    const { result, modes } = await evaluateWithState(
      modeEnv({ requested: 'protected_autopilot', consent: true, autopilot: false }),
      clientPost,
      'pass_green',
    );
    expect(result.mode).toBe('approval');
    expect(modes).toEqual(['approval']);
  });

  it('downgrades protected autopilot when a ready receipt has truncated checks', async () => {
    const { result, modes } = await evaluateWithState(
      modeEnv({
        requested: 'protected_autopilot',
        consent: true,
        readiness: true,
        readinessChecks: { tenancyProofs: { client: true } },
      }),
      clientPost,
      'pass_green',
    );

    expect(result.mode).toBe('approval');
    expect(modes).toEqual(['approval']);
  });

  it('makes zero critic and network calls for malformed or on-hold workspaces', async () => {
    for (const testCase of [
      {
        post: { ...clientPost, owner_id: 'different-client' },
        fixtures: {},
      },
      {
        post: clientPost,
        fixtures: { 'FROM clients': [{ status: 'on_hold' }] },
      },
    ]) {
      const { db } = makeRecordingD1(testCase.fixtures);
      const calls = { critic: 0, network: 0 };
      const deps: Partial<PublishOrchestratorDeps> = {
        evaluatePreflight: async () => {
          calls.critic += 1;
          return {
            mode: 'approval',
            state: 'pass_green',
            mayPublish: true,
            mustHold: false,
            decisionId: 'decision-1',
          };
        },
        createPost: async () => {
          calls.network += 1;
          return { id: 'remote-1' } as never;
        },
        graphFetch: async () => {
          calls.network += 1;
          return new Response('{}', { status: 200 });
        },
      };

      await expect(publishPersistedPost(
        { DB: db } as Env,
        testCase.post,
        {
          backend: 'postproxy',
          payload: {
            profileId: 'profile-1',
            body: 'Safe local update',
            media: [],
            format: 'post',
            pageId: 'page-1',
            platform: 'facebook',
          },
        },
        deps,
      )).rejects.toThrow(/workspace|owner/i);
      expect(calls).toEqual({ critic: 0, network: 0 });
    }
  });
});

describe('learning settings provisioning', () => {
  it('creates one canonical approval row without updating consent or posts', async () => {
    const { db, calls } = makeRecordingD1();
    await ensureWorkspaceLearningSettings(db, 'u1', 'c1', 'client', 'c1');

    const write = calls.find((call) => call.method === 'run');
    expect(write?.sql).toContain('INSERT INTO workspace_learning_settings');
    expect(write?.sql).toContain('ON CONFLICT(user_id,workspace_key) DO NOTHING');
    expect(write?.sql).toContain("'approval'");
    expect(write?.sql).not.toContain('DO UPDATE');
    expect(write?.sql).not.toContain('posts');
    expect(write?.binds).toEqual(expect.arrayContaining([
      'u1', 'c1', 'c1', 'client', 'c1',
    ]));
  });

  it('rejects a non-canonical tuple before touching D1', async () => {
    const { db, calls } = makeRecordingD1();
    await expect(
      ensureWorkspaceLearningSettings(db, 'u1', 'c1', 'client', 'other-client'),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('initializes settings in every user, client, portal, and Shopify creation path', () => {
    const root = resolve(process.cwd(), 'src/routes');
    const clients = readFileSync(resolve(root, 'clients.ts'), 'utf8');
    const onboarding = readFileSync(resolve(root, 'onboarding.ts'), 'utf8');
    const portals = readFileSync(resolve(root, 'admin-actions.ts'), 'utf8');
    const shopify = readFileSync(resolve(root, 'shopify-oauth.ts'), 'utf8');

    expect(clients).toContain('ensureWorkspaceLearningSettings');
    expect(clients).toMatch(
      /ensureWorkspaceLearningSettings\(c\.env\.DB,\s*uid,\s*id,\s*'client',\s*id/,
    );
    expect(onboarding).toMatch(
      /ensureWorkspaceLearningSettings\(c\.env\.DB,\s*uid,\s*null,\s*'user',\s*uid/,
    );
    expect(portals).toMatch(
      /ensureWorkspaceLearningSettings\(\s*c\.env\.DB,\s*body\.ownerUserId,\s*clientId,\s*'client',\s*clientId/,
    );
    expect(shopify.match(/ensureWorkspaceLearningSettings\(/g)).toHaveLength(2);
    expect(shopify.match(
      /ensureWorkspaceLearningSettings\(c\.env\.DB,\s*shop,\s*null,\s*'shop',\s*shop/g,
    )).toHaveLength(2);
  });
});
