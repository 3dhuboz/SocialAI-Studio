// Auth middleware — the canonical "is this request authenticated?" gate.
//
// Foundation pass (PR claude/workers-middleware-foundation):
// Before this middleware, 56 callsites in routes/*.ts each repeated the same
// 2-line block:
//
//   const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY,
//                                   c.env.CLERK_JWT_KEY, c.env.DB);
//   if (!uid) return c.json({ error: 'Unauthorized' }, 401);
//
// Every variant of that block had to be kept in sync (parameter order,
// error shape, status code, etc.). Now they collapse to one wrapper at the
// top of a route group and `const uid = c.get('uid')!` inside the handler.
//
// The 401 response includes the X-Request-Id captured by requestIdMiddleware
// so the frontend can surface it in a toast for support follow-up.

import type { Context, Next } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';

export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
  if (!uid) {
    return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401);
  }
  c.set('uid', uid);
  return next();
}
