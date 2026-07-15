import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import {
  publishPersistedPost,
  recordPublishedPostBestEffort,
  type PersistedPublishPost,
  type PublishOrchestratorDeps,
  type PublicationRecordDeps,
} from '../lib/publishing/publish-orchestrator';
import { makeRecordingD1 } from './helpers/recording-d1';

const fixturePost: PersistedPublishPost = {
  id: 'p1',
  user_id: 'u1',
  client_id: null,
  owner_kind: 'user',
  owner_id: 'u1',
  content: 'Safe caption',
  platform: 'facebook',
  hashtags: '[]',
  image_url: 'https://cdn.example/image.jpg',
  post_type: 'image',
  video_url: null,
  video_status: null,
};

const postproxyTarget = {
  backend: 'postproxy' as const,
  payload: {
    profileId: 'profile-1',
    body: 'Safe caption',
    media: ['https://cdn.example/image.jpg'],
    format: 'post' as const,
    pageId: 'page-1',
    platform: 'facebook' as const,
  },
};

const graphTarget = {
  backend: 'graph' as const,
  url: 'https://graph.facebook.com/v21.0/page/feed',
  init: { method: 'POST' },
};

function safeDeps(calls: { critic: number; postproxy: number; graph: number }): Partial<PublishOrchestratorDeps> {
  return {
    validateWorkspace: async () => undefined,
    evaluatePreflight: async () => {
      calls.critic += 1;
      return {
        mode: 'off',
        state: 'pending',
        mayPublish: true,
        mustHold: false,
        decisionId: null,
      };
    },
    createPost: async () => {
      calls.postproxy += 1;
      return { id: 'postproxy-1' } as any;
    },
    graphFetch: async () => {
      calls.graph += 1;
      return new Response('{"id":"facebook-1"}', { status: 200 });
    },
  };
}

describe('publishPersistedPost', () => {
  it('makes zero Postproxy or Graph calls when preflight holds', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.evaluatePreflight = async () => {
      calls.critic += 1;
      return {
        mode: 'approval',
        state: 'hold_amber',
        mayPublish: false,
        mustHold: true,
        decisionId: 'decision-1',
      };
    };
    deps.persistHold = async () => undefined;

    await expect(
      publishPersistedPost({} as Env, fixturePost, postproxyTarget, deps),
    ).rejects.toThrow('release preflight');

    expect(calls).toEqual({ critic: 1, postproxy: 0, graph: 0 });
  });

  it('preserves Postproxy and Graph delivery when preflight allows it', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);

    const postproxy = await publishPersistedPost(
      {} as Env,
      fixturePost,
      postproxyTarget,
      deps,
    );
    const graph = await publishPersistedPost(
      {} as Env,
      fixturePost,
      graphTarget,
      deps,
    );

    expect(postproxy.backend).toBe('postproxy');
    expect(graph.backend).toBe('graph');
    expect(calls).toEqual({ critic: 2, postproxy: 1, graph: 1 });
  });

  it('runs both Facebook reel kick requests only after one preflight pass', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.graphFetch = async (url) => {
      calls.graph += 1;
      return String(url).includes('/video_reels')
        ? new Response(
            JSON.stringify({
              video_id: 'video-1',
              upload_url: 'https://upload.facebook.example/video-1',
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    const outcome = await publishPersistedPost(
      {} as Env,
      {
        ...fixturePost,
        post_type: 'video',
        video_url: 'https://cdn.example/final.mp4',
        video_status: 'ready',
      },
      {
        backend: 'graph_reel',
        pageId: 'page-1',
        pageAccessToken: 'token-1',
        description: 'Safe reel',
        videoUrl: 'https://cdn.example/final.mp4',
      },
      deps,
    );

    expect(outcome).toMatchObject({ backend: 'graph_reel', videoId: 'video-1' });
    expect(calls).toEqual({ critic: 1, postproxy: 0, graph: 2 });
  });

  it('runs Instagram container and publish requests after one preflight pass', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.graphFetch = async (url) => {
      calls.graph += 1;
      return String(url).endsWith('/media')
        ? new Response(JSON.stringify({ id: 'container-1' }), { status: 200 })
        : new Response(JSON.stringify({ id: 'instagram-1' }), { status: 200 });
    };

    const outcome = await publishPersistedPost(
      {} as Env,
      { ...fixturePost, platform: 'instagram' },
      {
        backend: 'graph_instagram',
        accountId: 'ig-1',
        pageAccessToken: 'token-1',
        caption: 'Safe caption',
        imageUrl: 'https://cdn.example/image.jpg',
      },
      deps,
    );

    expect(outcome).toMatchObject({
      backend: 'graph_instagram',
      mediaId: 'instagram-1',
    });
    expect(calls).toEqual({ critic: 1, postproxy: 0, graph: 2 });
  });

  it('makes zero critic and network calls for invalid or on-hold ownership', async () => {
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.validateWorkspace = async () => {
      throw new Error('workspace inactive');
    };

    await expect(
      publishPersistedPost({} as Env, fixturePost, postproxyTarget, deps),
    ).rejects.toThrow('workspace inactive');

    expect(calls).toEqual({ critic: 0, postproxy: 0, graph: 0 });
  });

  it('persists enforced holds as Draft with all publish claims cleared', async () => {
    const { db, calls: sqlCalls } = makeRecordingD1();
    const calls = { critic: 0, postproxy: 0, graph: 0 };
    const deps = safeDeps(calls);
    deps.evaluatePreflight = async () => ({
      mode: 'approval',
      state: 'block_red',
      mayPublish: false,
      mustHold: true,
      decisionId: 'decision-red',
    });

    await expect(
      publishPersistedPost(
        { DB: db } as Env,
        fixturePost,
        postproxyTarget,
        deps,
      ),
    ).rejects.toThrow('release preflight');

    const hold = sqlCalls.find((call) => call.sql.includes("status = 'Draft'"));
    expect(hold?.sql).toContain('scheduled_for = NULL');
    expect(hold?.sql).toContain('claim_id = NULL');
    expect(hold?.sql).toContain('claim_at = NULL');
    expect(hold?.sql).toContain('reasoning = ?');
    expect(hold?.binds).toEqual(expect.arrayContaining(['p1', 'u1', 'user']));
    expect(hold?.binds.some((value) => String(value).includes('decision-red'))).toBe(true);
    expect(calls.postproxy).toBe(0);
    expect(calls.graph).toBe(0);
  });
});

describe('recordPublishedPostBestEffort', () => {
  it('resolves decision context with the complete canonical owner tuple', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM learning_decisions': [{ id: 'decision-1', reach_plan_id: 'reach-1' }],
    });

    await expect(recordPublishedPostBestEffort(
      { DB: db } as Env,
      fixturePost,
      {
        platform: 'facebook',
        remotePostId: 'facebook-1',
        permalink: null,
        decisionId: 'decision-1',
        publishedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        recordPublicationEvent: async () => undefined,
        fireAlert: async () => undefined,
      },
    )).resolves.toBe(true);

    const contextRead = calls.find((call) => call.sql.includes('FROM learning_decisions'))!;
    expect(contextRead.sql).toContain('owner_kind = ?');
    expect(contextRead.sql).toContain('owner_id = ?');
    expect(contextRead.binds).toEqual(expect.arrayContaining(['u1', '__owner__', 'user']));
  });

  it('records the actual destination and release context after remote success', async () => {
    const records: unknown[] = [];
    const deps: PublicationRecordDeps = {
      resolveDecisionContext: async () => ({
        decisionId: 'decision-1',
        reachPlanId: 'reach-1',
      }),
      recordPublicationEvent: async (_db, input) => {
        records.push(input);
      },
      fireAlert: async () => undefined,
    };

    const recorded = await recordPublishedPostBestEffort(
      { DB: {} as D1Database } as Env,
      fixturePost,
      {
        platform: 'facebook',
        remotePostId: 'facebook-1',
        permalink: 'https://facebook.example/posts/facebook-1',
        decisionId: 'decision-1',
        publishedAt: '2026-07-14T00:00:00.000Z',
      },
      deps,
    );

    expect(recorded).toBe(true);
    expect(records).toEqual([expect.objectContaining({
      userId: 'u1',
      clientId: null,
      ownerKind: 'user',
      ownerId: 'u1',
      postId: 'p1',
      platform: 'facebook',
      remotePostId: 'facebook-1',
      decisionId: 'decision-1',
      reachPlanId: 'reach-1',
    })]);
  });

  it('alerts but never throws when event recording fails after publication', async () => {
    const alerts: Array<{ key: string; body: string }> = [];
    const deps: PublicationRecordDeps = {
      resolveDecisionContext: async () => ({ decisionId: null, reachPlanId: null }),
      recordPublicationEvent: async () => {
        throw new Error('D1 write unavailable');
      },
      fireAlert: async (_env, key, _severity, body) => {
        alerts.push({ key, body });
      },
    };

    await expect(recordPublishedPostBestEffort(
      { DB: {} as D1Database } as Env,
      fixturePost,
      {
        platform: 'facebook',
        remotePostId: 'facebook-1',
        permalink: null,
        decisionId: null,
        publishedAt: '2026-07-14T00:00:00.000Z',
      },
      deps,
    )).resolves.toBe(false);

    expect(alerts).toEqual([expect.objectContaining({
      key: 'publication_event_missing',
      body: expect.stringContaining('p1'),
    })]);
  });
});

describe('publish egress source contracts', () => {
  const workerRoot = resolve(process.cwd(), 'src');
  const repoRoot = resolve(process.cwd(), '../..');

  it('routes manual Postproxy publishing through the orchestrator', () => {
    const source = readFileSync(
      resolve(workerRoot, 'routes/postproxy.ts'),
      'utf8',
    );

    expect(source).toContain('publishPersistedPost');
    expect(source).not.toContain('await createPost(c.env');
  });

  it('routes cron Postproxy and final Graph publishing through the orchestrator', () => {
    const source = readFileSync(
      resolve(workerRoot, 'cron/publish-missed.ts'),
      'utf8',
    );

    expect(source).toContain('publishPersistedPost');
    expect(source).not.toContain('postproxyCreatePost(env');
    expect(source).not.toContain('kickFacebookReelUpload(');
    expect(source).not.toContain('fbRes = await fetch(`${base}/${pageId}/photos');
    expect(source).not.toContain('fbRes = await fetch(`${base}/${pageId}/feed');
  });

  it('records only confirmed publication completion paths for later outcome collection', () => {
    const publishCron = readFileSync(
      resolve(workerRoot, 'cron/publish-missed.ts'),
      'utf8',
    );
    const reelPoll = readFileSync(
      resolve(workerRoot, 'cron/poll-pending-reels.ts'),
      'utf8',
    );
    const postproxyRoutes = readFileSync(
      resolve(workerRoot, 'routes/postproxy.ts'),
      'utf8',
    );

    expect(publishCron.match(/recordPublishedPostBestEffort\(/g)).toHaveLength(2);
    expect(reelPoll.match(/recordPublishedPostBestEffort\(/g)).toHaveLength(1);
    expect(postproxyRoutes.match(/recordPublishedPostBestEffort\(/g)).toHaveLength(2);

    expect(publishCron).not.toMatch(/graph_reel[\s\S]{0,900}recordPublishedPostBestEffort/);
    expect(postproxyRoutes).not.toMatch(/postproxy_status = 'pending'[\s\S]{0,500}recordPublishedPostBestEffort/);
  });

  it('routes Quick Post and Calendar publishing through the Worker only', () => {
    const source = readFileSync(resolve(repoRoot, 'src/App.tsx'), 'utf8');

    expect(source).not.toMatch(
      /FacebookService\.(postToPageDirect|postToPageWithImageUrl|postToInstagram)/,
    );
    expect(source).toContain('postproxyService.publishNow');
  });

  it('removes every frontend direct-publish helper and banned Facebook scheduling path', () => {
    const source = readFileSync(
      resolve(repoRoot, 'src/services/facebookService.ts'),
      'utf8',
    );

    for (const helper of [
      'postToPageDirect',
      'postToPageWithImageUrl',
      'postToPageScheduled',
      'postToInstagram',
      'postReelToInstagram',
    ]) {
      expect(source).not.toContain(`${helper}: async`);
    }
    expect(source).not.toContain('scheduled_publish_time');
    expect(source).not.toContain('/media_publish');
  });

  it('records preflight receipts after final image and ready-video persistence', () => {
    const imageSource = readFileSync(
      resolve(repoRoot, 'workers/api/src/cron/prewarm-images.ts'),
      'utf8',
    );
    const videoSource = readFileSync(
      resolve(repoRoot, 'workers/api/src/cron/prewarm-videos.ts'),
      'utf8',
    );

    expect(imageSource).toContain('evaluateReleasePreflight');
    expect(videoSource).toContain('evaluateReleasePreflight');
    expect(imageSource.indexOf('SET image_url = ?')).toBeLessThan(
      imageSource.lastIndexOf('evaluateReleasePreflight'),
    );
    expect(videoSource.indexOf("SET video_status = 'ready'")).toBeLessThan(
      videoSource.lastIndexOf('evaluateReleasePreflight'),
    );
    for (const source of [imageSource, videoSource]) {
      expect(source).toContain('owner_kind');
      expect(source).toContain('owner_id');
      expect(source).toContain('video_script');
      expect(source).toContain('video_shots');
    }
  });

  it('carries video script and shot context into manual and cron preflight candidates', () => {
    const routeSource = readFileSync(
      resolve(repoRoot, 'workers/api/src/routes/postproxy.ts'),
      'utf8',
    );
    const cronSource = readFileSync(
      resolve(repoRoot, 'workers/api/src/cron/publish-missed.ts'),
      'utf8',
    );

    for (const source of [routeSource, cronSource]) {
      expect(source).toContain('video_script');
      expect(source).toContain('video_shots');
    }
    expect(routeSource).toMatch(/video_script:\s*post\.video_script/);
    expect(routeSource).toMatch(/video_shots:\s*post\.video_shots/);
    expect(cronSource).toMatch(/video_script:\s*typeof post\.video_script/);
    expect(cronSource).toMatch(/video_shots:\s*typeof post\.video_shots/);
  });
});
