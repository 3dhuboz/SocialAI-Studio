import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import {
  publishPersistedPost,
  type PersistedPublishPost,
  type PublishOrchestratorDeps,
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

  it('routes Quick Post and Calendar publishing through the Worker only', () => {
    const source = readFileSync(resolve(repoRoot, 'src/App.tsx'), 'utf8');

    expect(source).not.toMatch(
      /FacebookService\.(postToPageDirect|postToPageWithImageUrl|postToInstagram)/,
    );
    expect(source).toContain('postproxyService.publishNow');
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
