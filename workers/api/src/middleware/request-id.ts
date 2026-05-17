// Request-ID middleware — assigns a stable correlation id to every request.
//
// Honours an inbound X-Request-Id (so the frontend can stitch its own client
// id through CF Pages → worker), otherwise mints a UUID. The id is mirrored
// on the response (X-Request-Id) AND stashed on the Hono context for the
// auth middleware, the onError handler, and ad-hoc logs to read via
// `c.get('requestId')`.
//
// Mount at the very top of the request pipeline — every other middleware
// (CORS, auth, onError) expects `requestId` to already be set.

import type { Context, Next } from 'hono';

export async function requestIdMiddleware(c: Context, next: Next) {
  const id = c.req.header('X-Request-Id') || crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
}
