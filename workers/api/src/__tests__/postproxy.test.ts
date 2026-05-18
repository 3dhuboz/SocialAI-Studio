/**
 * Unit tests for workers/api/src/lib/postproxy.ts — the typed HTTP client
 * for the Postproxy REST API.
 *
 * Focus is on the wire shape: every call's outbound payload must match
 * the contract Postproxy publishes. A regression here means the publish
 * cron silently breaks for every customer on Postproxy.
 *
 * Strategy: stub globalThis.fetch with vi.fn, capture (url, init), and
 * assert URL + headers + parsed JSON body. Returning canned responses
 * lets us also verify the typed shape of the parsed result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCreatePostPayload,
  createPost,
  ensureProfileGroup,
  getPost,
  initializeConnection,
  listPlacements,
  listProfiles,
} from '../lib/postproxy';
import type { Env } from '../env';

const env = {
  POSTPROXY_API_KEY: 'pp-test-key',
  POSTPROXY_BASE_URL: 'https://api.postproxy.dev/api',
} as unknown as Env;

function mockFetch(response: { status?: number; body?: unknown; text?: string }) {
  return vi.fn().mockImplementation(async () => {
    const status = response.status ?? 200;
    const text = response.text ?? (response.body !== undefined ? JSON.stringify(response.body) : '');
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('buildCreatePostPayload — wire shape', () => {
  it('feed post payload matches plan §4.3 shape', () => {
    const payload = buildCreatePostPayload({
      profileId: 'adUxm7',
      body: 'Hello from the cron path',
      media: ['https://r2.example.com/img.jpg'],
      format: 'feed',
      pageId: '108234567890123',
    });
    expect(payload).toEqual({
      post: { body: 'Hello from the cron path', draft: false },
      profiles: ['adUxm7'],
      media: ['https://r2.example.com/img.jpg'],
      platforms: {
        facebook: { format: 'feed', page_id: '108234567890123' },
      },
    });
  });

  it('reel post payload includes title (truncated to 60 chars)', () => {
    const longCaption = 'a'.repeat(120);
    const payload = buildCreatePostPayload({
      profileId: 'reelP',
      body: longCaption,
      media: ['https://r2.example.com/v.mp4'],
      format: 'reel',
      pageId: '108234567890123',
      title: longCaption,
    });
    const fb = (payload as any).platforms.facebook as Record<string, unknown>;
    expect(fb.format).toBe('reel');
    expect(fb.page_id).toBe('108234567890123');
    expect((fb.title as string).length).toBe(60);
    expect((fb.title as string)).toBe('a'.repeat(60));
  });

  it('reel post without explicit title omits the title key (no empty string)', () => {
    const payload = buildCreatePostPayload({
      profileId: 'reelP',
      body: 'hi',
      media: ['https://r2.example.com/v.mp4'],
      format: 'reel',
      pageId: '108234567890123',
    });
    const fb = (payload as any).platforms.facebook as Record<string, unknown>;
    expect('title' in fb).toBe(false);
  });
});

describe('createPost', () => {
  it('POSTs to /api/posts with the correct body + auth header', async () => {
    const fetchMock = mockFetch({ body: { id: 'pp_post_abc', status: 'pending' } });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createPost(env, {
      profileId: 'adUxm7',
      body: 'cron caption',
      media: ['https://r2.example.com/img.jpg'],
      format: 'feed',
      pageId: '108234567890123',
    });

    expect(result).toEqual({ id: 'pp_post_abc', status: 'pending' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://api.postproxy.dev/api/posts');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer pp-test-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      post: { body: 'cron caption', draft: false },
      profiles: ['adUxm7'],
      media: ['https://r2.example.com/img.jpg'],
      platforms: {
        facebook: { format: 'feed', page_id: '108234567890123' },
      },
    });
  });

  it('throws an Error with status + body slice on non-2xx', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 400, text: 'Bad placement_id' }));
    await expect(
      createPost(env, {
        profileId: 'x',
        body: 'y',
        media: [],
        format: 'feed',
        pageId: 'z',
      }),
    ).rejects.toThrow(/Postproxy POST \/posts -> 400/);
  });
});

describe('ensureProfileGroup', () => {
  it('returns an exact-match group when one already exists', async () => {
    vi.stubGlobal('fetch', mockFetch({
      body: { data: [
        { id: 'grp_other', name: 'Default', profiles_count: 1 },
        { id: 'grp_match', name: 'socialai-abc12345-own', profiles_count: 0 },
      ]},
    }));
    const result = await ensureProfileGroup(env, 'socialai-abc12345-own');
    expect(result).toEqual({ id: 'grp_match' });
  });

  it('falls back to first group when no exact match (POST 404 workaround)', async () => {
    // Mock the LIST call returning a default group, and the POST call returning 404.
    // The fallback path returns the first group from the list.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: [{ id: 'grp_default', name: 'Default' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ensureProfileGroup(env, 'socialai-new-workspace');
    expect(result).toEqual({ id: 'grp_default' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when the account has zero profile_groups', async () => {
    vi.stubGlobal('fetch', mockFetch({ body: { data: [] } }));
    await expect(ensureProfileGroup(env, 'whatever')).rejects.toThrow(/no profile_groups/);
  });
});

describe('initializeConnection', () => {
  it('returns the hosted OAuth URL from Postproxy', async () => {
    vi.stubGlobal('fetch', mockFetch({
      body: { url: 'https://auth.postproxy.dev/abc123', success: true },
    }));
    const result = await initializeConnection(env, 'grp_X', 'https://worker.example/callback?state=NONCE');
    expect(result.url).toBe('https://auth.postproxy.dev/abc123');
  });
});

describe('listProfiles + listPlacements', () => {
  it('listProfiles narrows to the requested group client-side as a defense', async () => {
    vi.stubGlobal('fetch', mockFetch({
      body: { data: [
        { id: 'pA', name: 'A', platform: 'facebook', status: 'active', profile_group_id: 'grp_match', post_count: 0 },
        { id: 'pB', name: 'B', platform: 'facebook', status: 'active', profile_group_id: 'grp_other', post_count: 0 },
      ]},
    }));
    const result = await listProfiles(env, 'grp_match');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('pA');
  });

  it('listPlacements returns the placements array', async () => {
    vi.stubGlobal('fetch', mockFetch({
      body: { data: [
        { id: '108234567890123', name: 'My Page' },
        { id: '108999000', name: 'My Other Page' },
      ]},
    }));
    const result = await listPlacements(env, 'pA');
    expect(result.map((p) => p.id)).toEqual(['108234567890123', '108999000']);
  });
});

describe('getPost', () => {
  it('returns the typed status payload', async () => {
    vi.stubGlobal('fetch', mockFetch({
      body: {
        id: 'pp_abc',
        status: 'pending',
        draft: false,
        platforms: [{
          platform: 'facebook',
          status: 'pending',
          permalink: null,
          error: null,
          attempted_at: null,
          params: {},
        }],
      },
    }));
    const result = await getPost(env, 'pp_abc');
    expect(result.id).toBe('pp_abc');
    expect(result.platforms[0].platform).toBe('facebook');
  });
});
