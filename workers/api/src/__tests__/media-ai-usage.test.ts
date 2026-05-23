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
import { registerProxyRoutes } from '../routes/proxies';
import { cronPrewarmVideos } from '../cron/prewarm-videos';
import type { Env } from '../env';

type UsageCall = { sql: string; bindings: unknown[] };

function makeD1(options: {
  usageCalls: UsageCall[];
  photoUrls?: string[];
  prewarmPosts?: Array<Record<string, unknown>>;
}): D1Database {
  const photoRows = (options.photoUrls ?? []).map((url) => ({ metadata: JSON.stringify({ url }) }));
  const prewarmPosts = options.prewarmPosts ?? [];

  return {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async first<T>() {
              if (/SELECT plan, addon_features, poster_credits FROM users/i.test(sql)) {
                return { plan: 'pro', addon_features: null, poster_credits: 0 } as T;
              }
              if (/SELECT profile FROM users/i.test(sql)) return { profile: null } as T;
              if (/SELECT profile FROM clients/i.test(sql)) return null as T;
              return null as T;
            },
            async all<T>() {
              if (/FROM client_facts/i.test(sql)) {
                return { results: photoRows } as T;
              }
              if (/FROM posts/i.test(sql)) {
                return { results: prewarmPosts } as T;
              }
              return { results: [] } as T;
            },
            async run() {
              if (/INSERT INTO ai_usage/i.test(sql)) {
                options.usageCalls.push({ sql, bindings });
              }
              return { success: true };
            },
          };
        },
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function makeRouteEnv(usageCalls: UsageCall[], extra: Partial<Env> = {}): Env {
  return {
    DB: makeD1({ usageCalls, photoUrls: ['https://brand.example/ref.jpg'] }),
    OPENROUTER_API_KEY: 'openrouter-test-key',
    FAL_API_KEY: 'fal-test-key',
    RUNWAY_API_KEY: 'runway-test-key',
    CLERK_SECRET_KEY: 'sk-test',
    CLERK_JWT_KEY: 'jwt-test',
    ENVIRONMENT: 'production',
    ...extra,
  } as unknown as Env;
}

function usageByOperation(calls: UsageCall[], operation: string): UsageCall | undefined {
  return calls.find((call) => call.bindings[4] === operation);
}

describe('media routes ai_usage telemetry', () => {
  beforeEach(() => {
    rateLimitedNext = false;
    vi.restoreAllMocks();
  });

  it('logs successful poster image generation through OpenRouter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'data:image/png;base64,aGVsbG8=' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const usageCalls: UsageCall[] = [];
    const app = new Hono<{ Bindings: Env }>();
    registerPostersRoutes(app);

    const res = await app.request('/api/ai/poster-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_1' },
      body: JSON.stringify({ prompt: 'bright product poster', aspectRatio: '1:1', clientId: 'client_1' }),
    }, makeRouteEnv(usageCalls));

    expect(res.status).toBe(200);
    const usage = usageByOperation(usageCalls, 'poster-image');
    expect(usage?.bindings[0]).toBe('user_1');
    expect(usage?.bindings[1]).toBe('client_1');
    expect(usage?.bindings[2]).toBe('openrouter');
    expect(usage?.bindings[3]).toBe('google/gemini-2.5-flash-image');
    expect(usage?.bindings[7]).toBe(1);
    expect(usage?.bindings[10]).toBe(1);
  });

  it('logs successful nano-banana-pro image generation in the fal proxy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      images: [{ url: 'https://fal.cdn/nano.png' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const usageCalls: UsageCall[] = [];
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);

    const res = await app.request('/api/fal-proxy?action=generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_1' },
      body: JSON.stringify({
        prompt: 'branded launch image',
        clientId: 'client_1',
        forceModel: 'nano-banana-pro',
      }),
    }, makeRouteEnv(usageCalls));

    expect(res.status).toBe(200);
    const usage = usageByOperation(usageCalls, 'image-gen-nano-banana-pro');
    expect(usage?.bindings[0]).toBe('user_1');
    expect(usage?.bindings[1]).toBe('client_1');
    expect(usage?.bindings[2]).toBe('fal');
    expect(usage?.bindings[3]).toBe('nano-banana-pro');
    expect(usage?.bindings[7]).toBe(1);
    expect(usage?.bindings[10]).toBe(1);
  });

  it('logs Kling video starts and completed task results in the fal proxy', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/image-to-video')) {
        return new Response(JSON.stringify({ request_id: 'req_123' }), { status: 200 });
      }
      return new Response(JSON.stringify({ video: { url: 'https://fal.cdn/reel.mp4' } }), { status: 200 });
    }));
    const usageCalls: UsageCall[] = [];
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);
    const env = makeRouteEnv(usageCalls);

    const startRes = await app.request('/api/fal-proxy?action=generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_1' },
      body: JSON.stringify({ promptImage: 'https://example.com/thumb.png', promptText: 'pan slowly' }),
    }, env);
    const resultRes = await app.request('/api/fal-proxy?action=task-result&requestId=req_123', {
      headers: { 'X-Test-Uid': 'user_1' },
    }, env);

    expect(startRes.status).toBe(200);
    expect(resultRes.status).toBe(200);
    expect(usageByOperation(usageCalls, 'video-start')?.bindings[3]).toBe('kling-video/v1.6/standard/image-to-video');
    expect(usageByOperation(usageCalls, 'video-result')?.bindings[3]).toBe('kling-video');
  });

  it('logs Runway passthrough calls without altering the provider response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'runway_task' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })));
    const usageCalls: UsageCall[] = [];
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);

    const res = await app.request('/api/runway-proxy/image_to_video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_1' },
      body: JSON.stringify({ promptImage: 'https://example.com/thumb.png' }),
    }, makeRouteEnv(usageCalls));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'runway_task' });
    const usage = usageByOperation(usageCalls, 'runway-proxy');
    expect(usage?.bindings[0]).toBe('user_1');
    expect(usage?.bindings[2]).toBe('runway');
    expect(usage?.bindings[3]).toBe('/image_to_video');
    expect(usage?.bindings[10]).toBe(1);
  });
});

describe('prewarm video ai_usage telemetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logs Kling starts and successful completed video results', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/image-to-video')) {
        return new Response(JSON.stringify({ request_id: 'req_start' }), { status: 200 });
      }
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 });
      }
      if (url.includes('/requests/req_done')) {
        return new Response(JSON.stringify({ video: { url: 'https://fal.cdn/reel.mp4' } }), { status: 200 });
      }
      return new Response('mp4', { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    }));
    const usageCalls: UsageCall[] = [];
    const env = {
      DB: makeD1({
        usageCalls,
        prewarmPosts: [
          { id: 'post_start', image_url: 'https://example.com/thumb.png', video_script: 'pan slowly', video_status: null },
          { id: 'post_done', video_status: 'generating', video_request_id: 'req_done' },
        ],
      }),
      FAL_API_KEY: 'fal-test-key',
      ENVIRONMENT: 'production',
      REELS_R2: { put: vi.fn(async () => undefined) },
      R2_REELS_PUBLIC_BASE: 'https://reels.example.com',
    } as unknown as Env;

    const result = await cronPrewarmVideos(env);

    expect(result.posts_processed).toBe(2);
    expect(usageByOperation(usageCalls, 'prewarm-video-start')?.bindings[9]).toBe('post_start');
    const completed = usageByOperation(usageCalls, 'prewarm-video-result');
    expect(completed?.bindings[2]).toBe('fal');
    expect(completed?.bindings[3]).toBe('kling-video');
    expect(completed?.bindings[9]).toBe('post_done');
    expect(completed?.bindings[10]).toBe(1);
  });
});
