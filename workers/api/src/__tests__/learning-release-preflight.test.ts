import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import {
  buildReleaseContentHash,
  evaluateReleasePreflight,
  runAndPersistReleasePipeline,
  type PublishablePost,
} from '../lib/learning/release-preflight';
import type { CriticResult } from '../lib/learning/critic-types';
import type { ReleasePipelineResult } from '../lib/learning/release-pipeline';
import type { ReleaseState } from '../lib/learning/types';

const post: PublishablePost = {
  id: 'p1',
  user_id: 'u1',
  client_id: null,
  owner_kind: 'user',
  owner_id: 'u1',
  content: 'Safe copy',
  platform: 'facebook',
  hashtags: '',
  image_url: null,
  post_type: 'image',
  video_url: null,
  video_status: null,
};

const pipelineResult = (state: ReleaseState) => ({
  id: `decision-${state}`,
  state,
});

describe('evaluateReleasePreflight', () => {
  it('off mode makes no critic calls and preserves publishing', async () => {
    let calls = 0;
    const decision = await evaluateReleasePreflight({} as Env, post, {
      loadMode: async () => 'off',
      runPipeline: async () => {
        calls += 1;
        return pipelineResult('block_red');
      },
    });

    expect(decision).toMatchObject({
      mode: 'off',
      state: 'pending',
      mayPublish: true,
      mustHold: false,
      decisionId: null,
    });
    expect(calls).toBe(0);
  });

  it('shadow mode records red but preserves publishing', async () => {
    const decision = await evaluateReleasePreflight({} as Env, post, {
      loadMode: async () => 'shadow',
      runPipeline: async () => pipelineResult('block_red'),
    });

    expect(decision).toMatchObject({
      state: 'shadow_only',
      mayPublish: true,
      mustHold: false,
      decisionId: 'decision-block_red',
    });
  });

  it('global enforcement false makes approval mode shadow-only', async () => {
    const decision = await evaluateReleasePreflight(
      { LEARNING_RELEASE_ENFORCEMENT: 'false' } as Env,
      post,
      {
        loadMode: async () => 'approval',
        runPipeline: async () => pipelineResult('block_red'),
      },
    );

    expect(decision).toMatchObject({
      state: 'shadow_only',
      mayPublish: true,
      mustHold: false,
    });
  });

  it('approval mode holds unresolved work when enforcement is enabled', async () => {
    const decision = await evaluateReleasePreflight(
      { LEARNING_RELEASE_ENFORCEMENT: 'true' } as Env,
      post,
      {
        loadMode: async () => 'approval',
        runPipeline: async () => pipelineResult('hold_amber'),
      },
    );

    expect(decision).toMatchObject({
      state: 'hold_amber',
      mayPublish: false,
      mustHold: true,
    });
  });

  it('protected autopilot publishes only pass_green', async () => {
    const env = { LEARNING_RELEASE_ENFORCEMENT: 'true' } as Env;
    const green = await evaluateReleasePreflight(env, post, {
      loadMode: async () => 'protected_autopilot',
      runPipeline: async () => pipelineResult('pass_green'),
    });
    const red = await evaluateReleasePreflight(env, post, {
      loadMode: async () => 'protected_autopilot',
      runPipeline: async () => pipelineResult('block_red'),
    });

    expect(green.mayPublish).toBe(true);
    expect(green.mustHold).toBe(false);
    expect(red.mayPublish).toBe(false);
    expect(red.mustHold).toBe(true);
  });

  it('passes canonical Shopify identity into mode resolution', async () => {
    let scope: unknown[] = [];
    await evaluateReleasePreflight(
      {} as Env,
      {
        ...post,
        user_id: 'store.myshopify.com',
        owner_kind: 'shop',
        owner_id: 'store.myshopify.com',
      },
      {
        loadMode: async (_env, userId, clientId, ownerKind, ownerId) => {
          scope = [userId, clientId, ownerKind, ownerId];
          return 'shadow';
        },
        runPipeline: async () => pipelineResult('pass_green'),
      },
    );

    expect(scope).toEqual([
      'store.myshopify.com',
      null,
      'shop',
      'store.myshopify.com',
    ]);
  });

  it('passes the resolved mode into the persisted pipeline runner', async () => {
    let receivedMode = '';
    await evaluateReleasePreflight({} as Env, post, {
      loadMode: async () => 'approval',
      runPipeline: async (_env, _post, mode) => {
        receivedMode = mode;
        return pipelineResult('pass_green');
      },
    });
    expect(receivedMode).toBe('approval');
  });

  it('fails open only in shadow when the critic pipeline is unavailable', async () => {
    const shadow = await evaluateReleasePreflight({} as Env, post, {
      loadMode: async () => 'shadow',
      runPipeline: async () => {
        throw new Error('provider outage');
      },
    });
    const enforced = await evaluateReleasePreflight(
      { LEARNING_RELEASE_ENFORCEMENT: 'true' } as Env,
      post,
      {
        loadMode: async () => 'approval',
        runPipeline: async () => {
          throw new Error('provider outage');
        },
      },
    );

    expect(shadow).toMatchObject({ mayPublish: true, state: 'shadow_only' });
    expect(enforced).toMatchObject({ mayPublish: false, state: 'hold_amber' });
  });
});

const verdict: CriticResult = {
  kind: 'brand',
  verdict: 'pass',
  severity: 'advisory',
  confidence: 1,
  evidence: ['brand.denylist'],
  repairs: [],
  provider: 'deterministic',
  model: 'rules-v1',
};

describe('runAndPersistReleasePipeline', () => {
  it('runs the council against actual publish media and persists a complete receipt', async () => {
    let candidateSeen: any;
    let receiptSeen: any;
    let verdictsSeen: CriticResult[][] = [];
    const imagePost: PublishablePost = {
      ...post,
      image_url: 'https://cdn.example/final.jpg',
      post_type: 'image',
    };
    const pipeline: ReleasePipelineResult = {
      state: 'pass_green',
      candidate: {} as any,
      attempts: [[verdict]],
      repairHistory: [],
      judgeStatus: 'available',
    };

    const result = await runAndPersistReleasePipeline(
      { DB: {} as D1Database } as Env,
      imagePost,
      'shadow',
      {
        findFreshReceipt: async () => null,
        loadContext: async () => ({
          profile: { name: 'Example' },
          verifiedFacts: ['location: Gladstone'],
          forbiddenSubjects: ['raw meat anatomy'],
          recentPostDigests: ['Earlier post'],
        }),
        executePipeline: async (_env, candidate) => {
          candidateSeen = candidate;
          return { ...pipeline, candidate };
        },
        predictOutcome: async () => 77,
        createReceipt: async (_db, input) => {
          receiptSeen = input;
          return 'decision-1';
        },
        replaceVerdicts: async (_db, _id, attempts) => {
          verdictsSeen = attempts;
        },
      },
    );

    expect(candidateSeen).toMatchObject({
      mode: 'shadow',
      content: 'Safe copy',
      media: {
        kind: 'image',
        url: 'https://cdn.example/final.jpg',
        thumbnailUrl: null,
      },
    });
    expect(receiptSeen).toMatchObject({
      postId: 'p1',
      stage: 'release',
      releaseState: 'pass_green',
      summary: {
        verdictCount: 1,
        attemptCount: 1,
        predictedOutcomeScore: 77,
        judgeStatus: 'available',
        judgeTelemetryVersion: 1,
      },
    });
    expect(verdictsSeen).toEqual([[verdict]]);
    expect(result).toEqual({ id: 'decision-1', state: 'pass_green' });
  });

  it('reuses a fresh receipt without loading context or calling critics', async () => {
    let expensiveCalls = 0;
    const result = await runAndPersistReleasePipeline(
      { DB: {} as D1Database } as Env,
      post,
      'shadow',
      {
        findFreshReceipt: async () => ({ id: 'cached', state: 'hold_amber' }),
        loadContext: async () => { expensiveCalls += 1; throw new Error('not expected'); },
        executePipeline: async () => { expensiveCalls += 1; throw new Error('not expected'); },
        createReceipt: async () => { expensiveCalls += 1; return 'not-expected'; },
        replaceVerdicts: async () => { expensiveCalls += 1; },
      },
    );

    expect(result).toEqual({ id: 'cached', state: 'hold_amber' });
    expect(expensiveCalls).toBe(0);
  });

  it('never marks an unapplied repaired candidate green', async () => {
    let receiptState = '';
    const result = await runAndPersistReleasePipeline(
      { DB: {} as D1Database } as Env,
      post,
      'shadow',
      {
        findFreshReceipt: async () => null,
        loadContext: async () => ({
          profile: {}, verifiedFacts: [], forbiddenSubjects: [], recentPostDigests: [],
        }),
        executePipeline: async (_env, candidate) => ({
          state: 'pass_green',
          candidate: { ...candidate, content: 'Repaired but not persisted' },
          attempts: [[verdict]],
          repairHistory: [['rewrite']],
        }),
        createReceipt: async (_db, input) => {
          receiptState = input.releaseState;
          return 'decision-repair';
        },
        replaceVerdicts: async () => {},
      },
    );

    expect(receiptState).toBe('hold_amber');
    expect(result.state).toBe('hold_amber');
  });

  it('hashes selected media and video readiness so stale receipts cannot be reused', async () => {
    const noMedia = await buildReleaseContentHash(post);
    const image = await buildReleaseContentHash({
      ...post,
      image_url: 'https://cdn.example/final.jpg',
      post_type: 'image',
    });
    const videoPending = await buildReleaseContentHash({
      ...post,
      image_url: 'https://cdn.example/thumb.jpg',
      video_url: 'https://cdn.example/reel.mp4',
      video_status: 'pending',
      post_type: 'video',
    });
    const videoReady = await buildReleaseContentHash({
      ...post,
      image_url: 'https://cdn.example/thumb.jpg',
      video_url: 'https://cdn.example/reel.mp4',
      video_status: 'ready',
      post_type: 'video',
    });

    expect(new Set([noMedia, image, videoPending, videoReady]).size).toBe(4);
  });
});
