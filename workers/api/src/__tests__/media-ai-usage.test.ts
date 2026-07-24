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
  cronAlerts?: Map<string, {
    alert_key: string;
    last_email_at: string | null;
    fire_count: number;
    last_resolved_at: string | null;
  }>;
}): D1Database {
  const photoRows = (options.photoUrls ?? []).map((url) => ({ metadata: JSON.stringify({ url }) }));
  const prewarmPosts = options.prewarmPosts ?? [];
  const cronAlerts = options.cronAlerts;
  const now = () => new Date().toISOString();

  return {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async first<T>() {
              if (/FROM cron_alerts WHERE alert_key = \?/i.test(sql)) {
                return (cronAlerts?.get(String(bindings[0])) ?? null) as T | null;
              }
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
              if (/INSERT INTO cron_alerts/i.test(sql) && cronAlerts) {
                const key = String(bindings[0]);
                const existing = cronAlerts.get(key);
                if (existing) {
                  existing.fire_count += 1;
                } else {
                  cronAlerts.set(key, {
                    alert_key: key,
                    last_email_at: null,
                    fire_count: 1,
                    last_resolved_at: null,
                  });
                }
              }
              if (/UPDATE cron_alerts SET last_email_at/i.test(sql) && cronAlerts) {
                const row = cronAlerts.get(String(bindings[0]));
                if (row) row.last_email_at = now();
              }
              if (/UPDATE cron_alerts\s+SET last_resolved_at/i.test(sql) && cronAlerts) {
                const row = cronAlerts.get(String(bindings[0]));
                if (row) {
                  row.last_resolved_at = now();
                  row.last_email_at = null;
                }
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
    DB: makeD1({
      usageCalls,
      photoUrls: ['https://brand.example/ref.jpg'],
      cronAlerts: new Map(),
    }),
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
    expect(usage?.sql).not.toContain('learning_decision_id');
    expect(usage?.bindings[10]).toBe(1);
  });

  it('logs successful nano-banana-pro image generation in the fal proxy', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        images: [{ url: 'https://fal.cdn/nano.png' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"score":9,"match":"yes","reasoning":"brand-consistent image matches the post"}' } }],
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
    const data = await res.json() as any;
    expect(data.imageUrl).toBe('https://fal.cdn/nano.png');
    expect(data.critique_score).toBe(9);
    const usage = usageByOperation(usageCalls, 'image-gen-nano-banana-pro');
    expect(usage?.bindings[0]).toBe('user_1');
    expect(usage?.bindings[1]).toBe('client_1');
    expect(usage?.bindings[2]).toBe('fal');
    expect(usage?.bindings[3]).toBe('nano-banana-pro');
    expect(usage?.bindings[7]).toBe(1);
    expect(usage?.sql).not.toContain('learning_decision_id');
    expect(usage?.bindings[10]).toBe(1);
  });

  it('uses caption/prompt seed and the diversified SaaS scene bank for default image generation', async () => {
    const falBodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('fal.run/fal-ai/')) {
        falBodies.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ images: [{ url: 'https://fal.cdn/saas.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"score":8,"match":"yes","reasoning":"relevant small-business workflow image"}' } }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const usageCalls: UsageCall[] = [];
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);

    const res = await app.request('/api/fal-proxy?action=generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_1' },
      body: JSON.stringify({
        prompt: 'dashboard with scheduling metrics, candid iPhone photo',
        caption: 'SocialAI Studio auto-publishes a content calendar for small business owners.',
      }),
    }, makeRouteEnv(usageCalls));

    expect(res.status).toBe(200);
    expect(String(falBodies[0]?.prompt).toLowerCase()).not.toMatch(/\b(car dashboard|highway|main street|golden hour|sunrise|sunset|road)\b/);
    expect(String(falBodies[0]?.prompt).toLowerCase()).toMatch(/\b(calendar|planner|sticky|checklist|timer|content|cards|notebook)\b/);
  });

  it('retries low-scoring manual brisket images through the critique gate before returning them', async () => {
    const falBodies: any[] = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        images: [{ url: 'https://fal.cdn/bad-brisket.png' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"score":2,"match":"no","reasoning":"image shows concentric-ring brisket anatomy instead of real cooked slices"}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        images: [{ url: 'https://fal.cdn/safe-brisket.png' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"score":8,"match":"yes","reasoning":"image shows a real BBQ tray scene that matches the brisket caption"}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('fal.run/fal-ai/')) {
        falBodies.push(JSON.parse(String(init?.body || '{}')));
      }
      return fetchMock(input, init);
    }));

    const usageCalls: UsageCall[] = [];
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);

    const res = await app.request('/api/fal-proxy?action=generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_1' },
      body: JSON.stringify({
        prompt: 'close-up of slow-smoked brisket bark on a butcher board, candid iPhone photo',
        caption: 'Our smoked brisket gets 12+ hours in the pit.',
      }),
    }, makeRouteEnv(usageCalls));

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.imageUrl).toBe('https://fal.cdn/safe-brisket.png');
    expect(String(data.model_used)).toContain('critique-retry');

    const retryFalBody = falBodies[1];
    expect(String(retryFalBody.prompt).toLowerCase()).toContain('overlapping slices');
    expect(String(retryFalBody.prompt).toLowerCase()).toContain('offset smoker');
  });

  it('rejects the generated image when both critic attempts score below the release threshold', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        images: [{ url: 'https://fal.cdn/bad-first.png' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"score":2,"match":"no","reasoning":"generic laptop image does not show the advertised workflow"}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        images: [{ url: 'https://fal.cdn/bad-retry.png' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"score":3,"match":"no","reasoning":"retry is still generic and unrelated to the caption"}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const usageCalls: UsageCall[] = [];
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);

    const res = await app.request('/api/fal-proxy?action=generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_1' },
      body: JSON.stringify({
        prompt: 'small business workflow automation in a bright office, candid iPhone photo',
        caption: 'Automate invoicing and save time every week.',
      }),
    }, makeRouteEnv(usageCalls));

    expect(res.status).toBe(422);
    const data = await res.json() as any;
    expect(data.imageUrl).toBeUndefined();
    expect(data.error).toMatch(/did not pass/i);
    expect(data.critique_score).toBe(3);
    expect(data.retryable).toBe(true);
  });

  it('does not release an image when no critic provider is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      images: [{ url: 'https://fal.cdn/unreviewed.png' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const usageCalls: UsageCall[] = [];
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);

    const res = await app.request('/api/fal-proxy?action=generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'user_1' },
      body: JSON.stringify({
        prompt: 'small business owner at work, candid iPhone photo',
        caption: 'A practical automation tip for local businesses.',
      }),
    }, makeRouteEnv(usageCalls, {
      OPENROUTER_API_KEY: '',
      ANTHROPIC_API_KEY: undefined,
    }));

    expect(res.status).toBe(503);
    const data = await res.json() as any;
    expect(data.imageUrl).toBeUndefined();
    expect(data.error).toMatch(/review unavailable/i);
    expect(data.retryable).toBe(true);
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
    expect(usage?.sql).not.toContain('learning_decision_id');
    expect(usage?.bindings[10]).toBe(1);
  });

  it('suppresses duplicate low-credit emails from manual fal credit checks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.fal.ai/v1/account/billing?expand=credits') {
        return new Response(JSON.stringify({
          username: 'socialai-studio',
          credits: { current_balance: 2.5, currency: 'USD' },
        }), { status: 200 });
      }
      if (url === 'https://api.resend.com/emails') {
        return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const usageCalls: UsageCall[] = [];
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);
    const env = makeRouteEnv(usageCalls, { RESEND_API_KEY: 'resend-test-key' });

    const first = await app.request('/api/fal-proxy?action=check-credits-alert', {
      headers: { 'X-Test-Uid': 'user_1' },
    }, env);
    const second = await app.request('/api/fal-proxy?action=check-credits-alert', {
      headers: { 'X-Test-Uid': 'user_1' },
    }, env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).alert).toBe('sent');
    expect((await second.json()).alert).toBe('suppressed');
    expect(fetchMock.mock.calls.filter(([url]) => url === 'https://api.resend.com/emails')).toHaveLength(1);
  });

  it('returns the current balance from fal account billing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.fal.ai/v1/account/billing?expand=credits');
      expect(init?.headers).toEqual({ Authorization: 'Key fal-admin-key' });
      return Response.json({
        username: 'socialai-studio',
        credits: { current_balance: 12.34, currency: 'USD' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);

    const res = await app.request('/api/fal-proxy?action=get-credits', {
      headers: { 'X-Test-Uid': 'user_1' },
    }, makeRouteEnv([], { FAL_ADMIN_API_KEY: 'fal-admin-key' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balance: 12.34, currency: 'USD' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a controlled gateway error for an invalid fal billing response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><title>Retired</title>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })));
    const app = new Hono<{ Bindings: Env }>();
    registerProxyRoutes(app);

    const res = await app.request('/api/fal-proxy?action=get-credits', {
      headers: { 'X-Test-Uid': 'user_1' },
    }, makeRouteEnv([]));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'fal.ai billing API returned an invalid response' });
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
    expect(completed?.sql).not.toContain('learning_decision_id');
    expect(completed?.bindings[10]).toBe(1);
  });
});
