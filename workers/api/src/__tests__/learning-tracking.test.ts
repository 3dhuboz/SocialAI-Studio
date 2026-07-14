import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { normalizeWorkspaceIdentity } from '../lib/learning/types';
import { makeRecordingD1 } from './helpers/recording-d1';

const auth = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));
vi.mock('../auth', () => auth);

import { registerLearningRoutes } from '../routes/learning';
import {
  createTrackingLink,
  normalizeHttpsDestination,
  registerTrackingRoutes,
} from '../routes/tracking';

function makeApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  registerTrackingRoutes(app);
  registerLearningRoutes(app);
  return { app, env };
}

beforeEach(() => {
  auth.getAuthUserId.mockReset();
  auth.getAuthUserId.mockImplementation(async (request: Request) =>
    request.headers.get('X-Test-Uid') || null);
});

describe('anonymous aggregate tracking links', () => {
  it('allows only credential-free https destinations', () => {
    expect(normalizeHttpsDestination('https://example.com/menu?from=social'))
      .toBe('https://example.com/menu?from=social');
    expect(() => normalizeHttpsDestination('http://example.com/menu')).toThrow(/https/i);
    expect(() => normalizeHttpsDestination('https://user:secret@example.com/menu')).toThrow(/credentials/i);
    expect(() => normalizeHttpsDestination('not-a-url')).toThrow(/destination/i);
  });

  it('retries an atomic insert when a generated short code collides', async () => {
    const attempted: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            return {
              async run() {
                expect(sql).toContain('INSERT OR IGNORE INTO tracking_links');
                const code = String(binds[0]);
                attempted.push(code);
                return { success: true, meta: { changes: code === 'duplicate' ? 0 : 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const codes = ['duplicate', 'unique123'];

    const link = await createTrackingLink(db, {
      identity: normalizeWorkspaceIdentity('owner-1', null, 'user', 'owner-1'),
      postId: 'post-1',
      destinationUrl: 'https://example.com/order',
      expiresAt: null,
    }, {
      randomCode: () => codes.shift() ?? 'fallback',
      now: () => '2026-07-14T00:00:00.000Z',
    });

    expect(attempted).toEqual(['duplicate', 'unique123']);
    expect(link.code).toBe('unique123');
  });

  it('rejects a non-canonical workspace identity before writing', async () => {
    const prepare = vi.fn(() => {
      throw new Error('database should not be reached');
    });
    const identity = normalizeWorkspaceIdentity('owner-1', null, 'user', 'owner-1');

    await expect(createTrackingLink({ prepare } as unknown as D1Database, {
      identity: { ...identity, workspaceKey: 'client-forged' },
      postId: 'post-1',
      destinationUrl: 'https://example.com/order',
      expiresAt: null,
    })).rejects.toThrow(/canonical/i);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('redirects and increments only an aggregate counter for a human request', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM tracking_links': [{
        code: 'menu123', destination_url: 'https://example.com/menu',
      }],
    });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/r/menu123', {
      headers: { 'User-Agent': 'Mozilla/5.0 iPhone Safari' },
    }, env);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://example.com/menu');
    const read = calls.find((call) => call.sql.includes('FROM tracking_links'))!;
    expect(read.sql).toContain('expires_at IS NULL');
    const update = calls.find((call) => call.sql.includes('click_count = click_count + 1'))!;
    expect(update.binds).toEqual(['menu123']);
    expect(update.sql).not.toMatch(/ip|cookie|fingerprint|user_id/i);
  });

  it('does not increment bot requests and returns 404 for absent or expired links', async () => {
    const botDb = makeRecordingD1({
      'FROM tracking_links': [{ code: 'menu123', destination_url: 'https://example.com/menu' }],
    });
    const botApp = makeApp({ DB: botDb.db } as Env);
    const botResponse = await botApp.app.request('/r/menu123', {
      headers: { 'User-Agent': 'Googlebot/2.1' },
    }, botApp.env);
    expect(botResponse.status).toBe(302);
    expect(botDb.calls.some((call) => call.sql.includes('click_count = click_count + 1'))).toBe(false);

    const expiredDb = makeRecordingD1({ 'FROM tracking_links': [] });
    const expiredApp = makeApp({ DB: expiredDb.db } as Env);
    const expired = await expiredApp.app.request('/r/expired1', {}, expiredApp.env);
    expect(expired.status).toBe(404);
  });

  it('contains no personal-tracking storage path', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/routes/tracking.ts'), 'utf8').toLowerCase();
    for (const forbidden of ['cf-connecting-ip', 'x-forwarded-for', 'fingerprint', 'set-cookie']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('mounts the public redirect route in the Worker entry point', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    expect(source).toContain("import { registerTrackingRoutes } from './routes/tracking'");
    expect(source).toContain('registerTrackingRoutes(app);');
  });
});

describe('owner conversion feedback', () => {
  it('uses embed-aware auth and writes integer metrics to the exact post workspace', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{
        id: 'post-1', user_id: 'owner-1', client_id: 'client-1',
        owner_kind: 'client', owner_id: 'client-1',
      }],
    });
    const { app, env } = makeApp({ DB: db, ISS_EMBED_SECRET: 'embed-secret' } as Env);

    const response = await app.request('/api/learning/outcomes/post-1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'owner-1' },
      body: JSON.stringify({
        clientId: 'client-1', calls: 2, messages: 3, leads: 1,
        bookings: 1, sales: 1, orderValueCents: 12900,
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(auth.getAuthUserId.mock.calls[0][4]).toBe('embed-secret');
    expect(calls[0].binds).toEqual(['post-1', 'owner-1']);
    const write = calls.find((call) => call.sql.includes('INSERT INTO conversion_feedback'))!;
    expect(write.binds).toEqual(expect.arrayContaining([
      'owner-1', 'client-1', 'client', 'post-1', 2, 3, 1, 1, 1, 12900, 'owner',
    ]));
  });

  it.each([
    [{ calls: -1 }, 'non-negative'],
    [{ leads: 1.5 }, 'integer'],
    [{ orderValueCents: 12.34 }, 'integer'],
    [{}, 'metric'],
  ])('rejects invalid feedback %j', async (payload, expected) => {
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{
        id: 'post-1', user_id: 'owner-1', client_id: null,
        owner_kind: 'user', owner_id: 'owner-1',
      }],
    });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/api/learning/outcomes/post-1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'owner-1' },
      body: JSON.stringify(payload),
    }, env);

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(new RegExp(expected, 'i'));
    expect(calls.some((call) => call.sql.includes('INSERT INTO conversion_feedback'))).toBe(false);
  });

  it('returns a leak-safe 404 when the requested client does not own the post', async () => {
    const { db, calls } = makeRecordingD1({
      'FROM posts': [{
        id: 'post-1', user_id: 'owner-1', client_id: 'client-1',
        owner_kind: 'client', owner_id: 'client-1',
      }],
    });
    const { app, env } = makeApp({ DB: db } as Env);

    const response = await app.request('/api/learning/outcomes/post-1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Uid': 'owner-1' },
      body: JSON.stringify({ clientId: 'client-2', leads: 1 }),
    }, env);

    expect(response.status).toBe(404);
    expect(calls.some((call) => call.sql.includes('INSERT INTO conversion_feedback'))).toBe(false);
  });
});
