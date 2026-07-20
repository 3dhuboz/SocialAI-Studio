import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../middleware/auth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    const uid = c.req.header('X-Test-Uid');
    if (!uid) return c.json({ error: 'unauthorized' }, 401);
    c.set('uid', uid);
    return next();
  },
}));

import type { Env } from '../env';
import { MAX_REEL_UPLOAD_BYTES, registerReelMediaRoutes } from '../routes/reel-media';

type StoredObject = {
  body: ArrayBuffer;
  options?: R2PutOptions;
};

function makeR2(store: Map<string, StoredObject>): R2Bucket {
  return {
    async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions) {
      let body: ArrayBuffer;
      if (value instanceof ReadableStream) {
        body = await new Response(value).arrayBuffer();
      } else if (value instanceof Blob) {
        body = await value.arrayBuffer();
      } else if (typeof value === 'string') {
        body = new TextEncoder().encode(value).buffer;
      } else if (value === null) {
        body = new ArrayBuffer(0);
      } else if (ArrayBuffer.isView(value)) {
        body = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
      } else {
        body = value;
      }
      store.set(key, { body, options });
      return { key, size: body.byteLength } as R2Object;
    },
    async get(key: string) {
      const stored = store.get(key);
      if (!stored) return null;
      const body = stored.body.slice(0);
      return {
        key,
        size: body.byteLength,
        body: new Response(body).body,
        customMetadata: stored.options?.customMetadata,
        httpMetadata: stored.options?.httpMetadata,
        async arrayBuffer() { return body; },
        async text() { return new TextDecoder().decode(body); },
        async json<T>() { return JSON.parse(new TextDecoder().decode(body)) as T; },
        async blob() { return new Blob([body]); },
        writeHttpMetadata() {},
      } as unknown as R2ObjectBody;
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as R2Bucket;
}

function makeMedia(calls: MediaTransformationOutputOptions[] = []): MediaBinding {
  return {
    input() {
      return {
        output(options?: MediaTransformationOutputOptions) {
          calls.push(options || {});
          const isFrame = options?.mode === 'frame';
          const bytes = new TextEncoder().encode(isFrame ? 'finished-cover' : 'finished-video');
          return {
            async media() { return new Response(bytes).body!; },
            async response() { return new Response(bytes); },
            async contentType() { return isFrame ? 'image/jpeg' : 'video/mp4'; },
          };
        },
        transform() {
          throw new Error('Unexpected transform call');
        },
      };
    },
  } as MediaBinding;
}

function makeD1(ownedClientIds: string[]): D1Database {
  return {
    prepare(sql: string) {
      if (!/^SELECT id FROM clients WHERE id = \? AND user_id = \?$/i.test(sql.replace(/\s+/g, ' ').trim())) {
        throw new Error(`Unhandled SQL: ${sql}`);
      }
      return {
        bind(clientId: string) {
          return {
            async first<T>() {
              return (ownedClientIds.includes(clientId) ? { id: clientId } : null) as T | null;
            },
          };
        },
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function makeApp(overrides: Partial<Env> = {}, ownedClientIds = ['client_richo']) {
  const store = new Map<string, StoredObject>();
  const app = new Hono<{ Bindings: Env }>();
  registerReelMediaRoutes(app);
  const env = {
    DB: makeD1(ownedClientIds),
    REELS_R2: makeR2(store),
    R2_REELS_PUBLIC_BASE: 'https://reels.example.com',
    ...overrides,
  } as unknown as Env;
  return { app, env, store };
}

function uploadRequest(overrides: {
  uid?: string;
  clientId?: string;
  contentType?: string;
  size?: number;
  filename?: string;
  body?: Uint8Array;
} = {}) {
  const body = overrides.body ?? new Uint8Array([0, 1, 2, 3]);
  const headers = new Headers({
    'Content-Type': overrides.contentType ?? 'video/mp4',
    'X-Reel-Size': String(overrides.size ?? body.byteLength),
    'X-Reel-Filename': encodeURIComponent(overrides.filename ?? 'counter-special.mp4'),
  });
  if (overrides.uid !== '') headers.set('X-Test-Uid', overrides.uid ?? 'user_steve');
  if (overrides.clientId !== '') headers.set('X-Client-Id', overrides.clientId ?? 'client_richo');
  return {
    method: 'POST',
    headers,
    body,
  } satisfies RequestInit;
}

describe('POST /api/reel-media/uploads', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('requires an authenticated SocialAI session', async () => {
    const { app, env } = makeApp();
    const res = await app.request('/api/reel-media/uploads', uploadRequest({ uid: '' }), env);
    expect(res.status).toBe(401);
  });

  it('stores an owned workspace upload in the durable reels bucket', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-4333-8444-555555555555');
    const { app, env, store } = makeApp();
    const res = await app.request('/api/reel-media/uploads', uploadRequest(), env);

    expect(res.status).toBe(201);
    const json = await res.json() as {
      key: string;
      url: string;
      contentType: string;
      sizeBytes: number;
    };
    expect(json).toEqual({
      key: 'reels/uploads/11111111-2222-4333-8444-555555555555.mp4',
      url: 'https://reels.example.com/reels/uploads/11111111-2222-4333-8444-555555555555.mp4',
      contentType: 'video/mp4',
      sizeBytes: 4,
    });

    const stored = store.get(json.key);
    expect(stored?.body.byteLength).toBe(4);
    expect(stored?.options?.httpMetadata).toMatchObject({
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(stored?.options?.customMetadata).toMatchObject({
      ownerId: 'user_steve',
      clientId: 'client_richo',
      originalName: 'counter-special.mp4',
      source: 'reel-studio',
    });
  });

  it('rejects a client workspace the signed-in user does not own', async () => {
    const { app, env, store } = makeApp({}, []);
    const res = await app.request('/api/reel-media/uploads', uploadRequest(), env);
    expect(res.status).toBe(404);
    expect(store.size).toBe(0);
  });

  it('rejects unsupported media before writing to R2', async () => {
    const { app, env, store } = makeApp();
    const res = await app.request('/api/reel-media/uploads', uploadRequest({
      contentType: 'image/jpeg',
      filename: 'not-a-reel.jpg',
    }), env);
    expect(res.status).toBe(415);
    expect(store.size).toBe(0);
  });

  it('rejects uploads over the safe Worker request limit', async () => {
    const { app, env, store } = makeApp();
    const res = await app.request('/api/reel-media/uploads', uploadRequest({
      size: MAX_REEL_UPLOAD_BYTES + 1,
    }), env);
    expect(res.status).toBe(413);
    expect(store.size).toBe(0);
  });

  it('fails closed when durable reel storage is not configured', async () => {
    const { app, env } = makeApp({ REELS_R2: undefined, R2_REELS_PUBLIC_BASE: undefined });
    const res = await app.request('/api/reel-media/uploads', uploadRequest(), env);
    expect(res.status).toBe(503);
  });
});

function finishRequest(overrides: Record<string, unknown> = {}, uid = 'user_steve') {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Uid': uid,
    },
    body: JSON.stringify({
      key: 'reels/uploads/source.mp4',
      clientId: 'client_richo',
      startSeconds: 2.25,
      endSeconds: 18.75,
      coverSeconds: 6.5,
      ...overrides,
    }),
  } satisfies RequestInit;
}

describe('POST /api/reel-media/finish', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('requires an authenticated SocialAI session', async () => {
    const { app, env } = makeApp({ MEDIA: makeMedia() });
    const res = await app.request('/api/reel-media/finish', finishRequest({}, ''), env);
    expect(res.status).toBe(401);
  });

  it('fails closed when Media Transformations is not bound', async () => {
    const { app, env, store } = makeApp();
    store.set('reels/uploads/source.mp4', {
      body: new Uint8Array([1, 2, 3]).buffer,
      options: {
        customMetadata: {
          ownerId: 'user_steve',
          clientId: 'client_richo',
          durationMs: '30000',
        },
      },
    });
    const res = await app.request('/api/reel-media/finish', finishRequest(), env);
    expect(res.status).toBe(503);
  });

  it('rejects invalid trim and cover timing before transforming', async () => {
    const calls: MediaTransformationOutputOptions[] = [];
    const { app, env, store } = makeApp({ MEDIA: makeMedia(calls) });
    store.set('reels/uploads/source.mp4', {
      body: new Uint8Array([1, 2, 3]).buffer,
      options: {
        customMetadata: {
          ownerId: 'user_steve',
          clientId: 'client_richo',
          durationMs: '30000',
        },
      },
    });
    const res = await app.request('/api/reel-media/finish', finishRequest({
      startSeconds: 8,
      endSeconds: 8.5,
      coverSeconds: 10,
    }), env);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('does not expose another workspace upload', async () => {
    const calls: MediaTransformationOutputOptions[] = [];
    const { app, env, store } = makeApp({ MEDIA: makeMedia(calls) });
    store.set('reels/uploads/source.mp4', {
      body: new Uint8Array([1, 2, 3]).buffer,
      options: {
        customMetadata: {
          ownerId: 'user_someone_else',
          clientId: 'client_richo',
          durationMs: '30000',
        },
      },
    });
    const res = await app.request('/api/reel-media/finish', finishRequest(), env);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('stores an audio-preserving MP4 clip and selected JPEG cover', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    const calls: MediaTransformationOutputOptions[] = [];
    const { app, env, store } = makeApp({ MEDIA: makeMedia(calls) });
    store.set('reels/uploads/source.mp4', {
      body: new Uint8Array([1, 2, 3]).buffer,
      options: {
        httpMetadata: { contentType: 'video/mp4' },
        customMetadata: {
          ownerId: 'user_steve',
          clientId: 'client_richo',
          durationMs: '30000',
          originalName: 'counter-special.mp4',
        },
      },
    });

    const res = await app.request('/api/reel-media/finish', finishRequest(), env);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      key: 'reels/finished/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.mp4',
      url: 'https://reels.example.com/reels/finished/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.mp4',
      coverKey: 'reels/covers/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg',
      coverUrl: 'https://reels.example.com/reels/covers/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg',
      contentType: 'video/mp4',
      startSeconds: 2.25,
      endSeconds: 18.75,
      coverSeconds: 6.5,
    });
    expect(calls).toEqual([
      { mode: 'video', time: '2.25s', duration: '16.5s', audio: true },
      { mode: 'frame', time: '6.5s', format: 'jpg' },
    ]);
    expect(store.get('reels/finished/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.mp4')?.options?.customMetadata)
      .toMatchObject({ ownerId: 'user_steve', clientId: 'client_richo', sourceKey: 'reels/uploads/source.mp4' });
    expect(store.get('reels/covers/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg')?.options?.httpMetadata)
      .toMatchObject({ contentType: 'image/jpeg' });
  });
});
