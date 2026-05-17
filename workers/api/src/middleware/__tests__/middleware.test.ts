// Foundation tests for the auth + request-id + onError pipeline.
//
// The full src/index.ts is too entangled to import in a unit test — it pulls
// in Clerk, every route module, the CORS allowlist, etc. — so these tests
// build a miniature Hono app that wires up the same three pieces (request id
// middleware, requireAuth, onError) and exercise the contract:
//
//   1. An unauthenticated request gets a JSON 401 with `requestId` in the
//      body AND a matching X-Request-Id header.
//   2. A handler that throws is caught by `app.onError` and returns a JSON
//      500 with `requestId` — NOT Hono's default text/html stack-trace page.
//
// If either contract breaks, the frontend's JSON fetch wrappers will start
// failing in production. These tests pin the shape.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from '../request-id';
import { requireAuth } from '../auth';

// Minimal Env shape — auth.ts only reads CLERK_SECRET_KEY/CLERK_JWT_KEY/DB,
// and an unauthenticated request never reaches the Clerk call (returns null
// when the Authorization header is missing). So we can pass empty strings.
type TestEnv = {
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  DB: unknown;
};

function buildApp() {
  const app = new Hono<{ Bindings: TestEnv }>();
  app.use('*', requestIdMiddleware);
  app.use('/private/*', requireAuth as never);
  app.get('/private/hello', (c) => c.json({ ok: true, uid: c.get('uid') }));
  app.get('/boom', () => {
    throw new Error('simulated crash');
  });
  app.onError((err, c) => {
    const requestId = c.get('requestId');
    return c.json({ error: 'internal_error', message: err.message, requestId }, 500);
  });
  app.notFound((c) =>
    c.json({ error: 'not_found', path: c.req.path, requestId: c.get('requestId') }, 404),
  );
  return app;
}

const env: TestEnv = { CLERK_SECRET_KEY: 'sk_test_unused', DB: null };

describe('middleware foundation', () => {
  it('unauthenticated request returns JSON 401 with requestId in body + header', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('http://test.local/private/hello'),
      env as never,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const headerRequestId = res.headers.get('X-Request-Id');
    expect(headerRequestId).toBeTruthy();

    const body = (await res.json()) as { error: string; requestId: string };
    expect(body.error).toBe('unauthorized');
    expect(body.requestId).toBe(headerRequestId);
  });

  it('honours an inbound X-Request-Id so client and server logs correlate', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('http://test.local/private/hello', {
        headers: { 'X-Request-Id': 'client-supplied-abc-123' },
      }),
      env as never,
    );

    expect(res.headers.get('X-Request-Id')).toBe('client-supplied-abc-123');
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe('client-supplied-abc-123');
  });

  it('errored handler returns JSON 500 with requestId — not Hono default HTML', async () => {
    // Swallow Hono's default error log so the test output stays clean.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = buildApp();
      const res = await app.fetch(new Request('http://test.local/boom'), env as never);

      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);

      const body = (await res.json()) as { error: string; message: string; requestId: string };
      expect(body.error).toBe('internal_error');
      expect(body.message).toBe('simulated crash');
      expect(body.requestId).toBeTruthy();
      expect(body.requestId).toBe(res.headers.get('X-Request-Id'));
    } finally {
      errSpy.mockRestore();
    }
  });

  it('404 falls through to JSON notFound handler with path + requestId', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('http://test.local/does-not-exist'), env as never);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; path: string; requestId: string };
    expect(body.error).toBe('not_found');
    expect(body.path).toBe('/does-not-exist');
    expect(body.requestId).toBe(res.headers.get('X-Request-Id'));
  });
});
