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
  deletePost,
  ensureProfileGroup,
  getPost,
  getPostStats,
  getProfileWithLatestStats,
  initializeConnection,
  listPlacements,
  listPostComments,
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
  it('Facebook post payload matches Postproxy shape', () => {
    const payload = buildCreatePostPayload({
      profileId: 'adUxm7',
      body: 'Hello from the cron path',
      media: ['https://r2.example.com/img.jpg'],
      format: 'post',
      pageId: '108234567890123',
    });
    expect(payload).toEqual({
      post: { body: 'Hello from the cron path', draft: false },
      profiles: ['adUxm7'],
      media: ['https://r2.example.com/img.jpg'],
      platforms: {
        facebook: { format: 'post', page_id: '108234567890123' },
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

describe('buildCreatePostPayload — Instagram wire shape (ig-wire)', () => {
  it('IG post emits platforms.instagram with no page_id', () => {
    const payload = buildCreatePostPayload({
      profileId: 'ig_prof_x',
      body: 'IG caption',
      media: ['https://r2.example.com/img.jpg'],
      format: 'post',
      pageId: '', // ignored for IG
      platform: 'instagram',
    });
    expect((payload as any).platforms).toEqual({
      instagram: { format: 'post' },
    });
    // Critical: no FB block leaked through
    expect((payload as any).platforms.facebook).toBeUndefined();
  });

  it('IG reel sets format=reel and truncates title to 60', () => {
    const payload = buildCreatePostPayload({
      profileId: 'ig_prof_x',
      body: 'caption',
      media: ['https://r2.example.com/v.mp4'],
      format: 'reel',
      pageId: '',
      platform: 'instagram',
      title: 'x'.repeat(120),
    });
    const ig = (payload as any).platforms.instagram as Record<string, unknown>;
    expect(ig.format).toBe('reel');
    expect(ig.title).toBe('x'.repeat(60));
    expect('page_id' in ig).toBe(false);
  });

  it('IG story format passes through verbatim', () => {
    const payload = buildCreatePostPayload({
      profileId: 'ig_prof_x',
      body: '',
      media: ['https://r2.example.com/story.jpg'],
      format: 'story',
      pageId: '',
      platform: 'instagram',
    });
    expect((payload as any).platforms.instagram.format).toBe('story');
  });

  it('IG first_comment passes through, capped at 2196 chars', () => {
    const payload = buildCreatePostPayload({
      profileId: 'ig_prof_x',
      body: 'caption',
      media: ['https://r2.example.com/img.jpg'],
      format: 'post',
      pageId: '',
      platform: 'instagram',
      firstComment: 'c'.repeat(3000),
    });
    const ig = (payload as any).platforms.instagram as Record<string, unknown>;
    expect((ig.first_comment as string).length).toBe(2196);
  });

  it('FB payload (no platform arg) still emits the legacy shape byte-identically', () => {
    const ig = buildCreatePostPayload({
      profileId: 'ig_prof_x', body: 'a', media: [], format: 'post', pageId: '', platform: 'instagram',
    });
    const fb = buildCreatePostPayload({
      profileId: 'fb_prof', body: 'a', media: [], format: 'post', pageId: '123',
    });
    // Sanity check: defaulting platform to 'facebook' produces the original shape
    expect((fb as any).platforms.facebook).toEqual({ format: 'post', page_id: '123' });
    expect((fb as any).platforms.instagram).toBeUndefined();
    // And IG block has no page_id key
    expect((ig as any).platforms.instagram).toEqual({ format: 'post' });
  });
});

describe('initializeConnection — platform parameter', () => {
  it('defaults to facebook when platform arg omitted', async () => {
    const fetchMock = mockFetch({ body: { url: 'https://auth.example/123', success: true } });
    vi.stubGlobal('fetch', fetchMock);
    await initializeConnection(env, 'grp_X', 'https://worker.example/cb');
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string);
    expect(body.platform).toBe('facebook');
  });

  it('passes platform=instagram when explicitly set', async () => {
    const fetchMock = mockFetch({ body: { url: 'https://auth.example/abc', success: true } });
    vi.stubGlobal('fetch', fetchMock);
    await initializeConnection(env, 'grp_X', 'https://worker.example/cb', 'instagram');
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string);
    expect(body.platform).toBe('instagram');
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
      format: 'post',
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
        facebook: { format: 'post', page_id: '108234567890123' },
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
        format: 'post',
        pageId: 'z',
      }),
    // Error prefix is "Upstream" not "Postproxy" — we strip the third-party
    // name from any error string that might bubble to the UI.
    ).rejects.toThrow(/Upstream POST \/posts -> 400/);
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

  it('listPlacements returns the placements array and forwards profile_group_id', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ data: [
        { id: '108234567890123', name: 'My Page' },
        { id: '108999000', name: 'My Other Page' },
      ]}), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const result = await listPlacements(env, 'pA', 'grp_match');
    expect(result.map((p) => p.id)).toEqual(['108234567890123', '108999000']);
    // Regression guard: Postproxy returns 404 without this query param.
    expect(capturedUrl).toContain('profile_group_id=grp_match');
    expect(capturedUrl).toContain('/profiles/pA/placements');
  });
});

describe('deletePost', () => {
  it('passes delete_on_platform and profile_group_id query params', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const result = await deletePost(env, 'pp_abc', {
      groupId: 'grp_123',
      deleteOnPlatform: true,
    });

    expect(result.deleted).toBe(true);
    expect(capturedInit?.method).toBe('DELETE');
    expect(capturedUrl).toContain('/posts/pp_abc?');
    expect(capturedUrl).toContain('delete_on_platform=true');
    expect(capturedUrl).toContain('profile_group_id=grp_123');
  });
});

describe('getPostStats', () => {
  it('returns the typed nested platforms.records payload', async () => {
    vi.stubGlobal('fetch', mockFetch({
      body: {
        data: {
          pp_abc: {
            platforms: [{
              profile_id: 'adUxm7',
              platform: 'facebook',
              records: [
                { stats: { impressions: 1200, likes: 34, clicks: 8 }, recorded_at: '2026-05-19T03:00:00Z' },
              ],
            }],
          },
        },
      },
    }));
    const result = await getPostStats(env, ['pp_abc'], { profiles: 'adUxm7' });
    expect(result.data.pp_abc.platforms[0].platform).toBe('facebook');
    expect(result.data.pp_abc.platforms[0].records[0].stats.impressions).toBe(1200);
  });

  it('passes post_ids and profiles query params', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: {} }) };
    }));
    await getPostStats(env, ['a', 'b', 'c'], { profiles: 'profX' });
    expect(capturedUrl).toContain('/posts/stats');
    expect(capturedUrl).toContain('post_ids=a%2Cb%2Cc');
    expect(capturedUrl).toContain('profiles=profX');
  });

  it('no-ops on empty post_ids without an HTTP call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await getPostStats(env, []);
    expect(result).toEqual({ data: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when post_ids exceed 50 (caller must chunk)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getPostStats(env, Array.from({ length: 51 }, (_, i) => `pp_${i}`))).rejects.toThrow(/max 50 post IDs/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getProfileWithLatestStats', () => {
  it('returns profile + summary_stats', async () => {
    vi.stubGlobal('fetch', mockFetch({
      body: {
        id: 'adUxm7',
        name: 'My Page',
        platform: 'facebook',
        status: 'active',
        profile_group_id: 'grp_X',
        post_count: 12,
        latest_stats: [{ placement_id: '108234567890123', stats: { fan_count: 412 }, recorded_at: '2026-05-19T01:00:00Z' }],
        summary_stats: { stats: { fan_count: 412, page_impressions: 9300 }, recorded_at: '2026-05-19T01:00:00Z' },
      },
    }));
    const result = await getProfileWithLatestStats(env, 'adUxm7');
    expect(result.id).toBe('adUxm7');
    expect(result.summary_stats?.stats.fan_count).toBe(412);
    expect(result.latest_stats?.[0].placement_id).toBe('108234567890123');
  });
});

describe('listPostComments', () => {
  it('forwards profile_id and returns the data array', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          total: 2,
          page: 1,
          per_page: 20,
          data: [
            { id: 'c1', body: 'Looks delicious!', like_count: 3, author_username: 'jane.doe' },
            { id: 'c2', body: 'Hours tomorrow?', like_count: 0, author_username: 'mark.k' },
          ],
        }),
      };
    }));
    const result = await listPostComments(env, 'pp_abc', 'adUxm7', { perPage: 20 });
    expect(result.data).toHaveLength(2);
    expect(result.data[0].body).toBe('Looks delicious!');
    expect(capturedUrl).toContain('/posts/pp_abc/comments');
    expect(capturedUrl).toContain('profile_id=adUxm7');
    expect(capturedUrl).toContain('per_page=20');
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

  it('passes profile_group_id when fetching a post status', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'pp_abc',
          status: 'pending',
          draft: false,
          platforms: [],
        }),
      };
    }));

    await getPost(env, 'pp_abc', 'grp_123');

    expect(capturedUrl).toBe('https://api.postproxy.dev/api/posts/pp_abc?profile_group_id=grp_123');
  });
});
