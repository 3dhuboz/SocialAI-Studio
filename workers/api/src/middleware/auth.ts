// Auth middleware — the canonical "is this request authenticated?" gate.
//
// Foundation pass (PR claude/workers-middleware-foundation):
// Before this middleware, 56 callsites in routes/*.ts each repeated the same
// 2-line block:
//
//   const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY,
//                                   c.env.CLERK_JWT_KEY, c.env.DB, c.env.ISS_EMBED_SECRET || c.env.PENNYBUILDER_PROVISION_SECRET);
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

function csvValues(value?: string): string[] {
  return [...new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401);
}

export async function stagingBearerIdentityGuard(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  if (c.env.ENVIRONMENT !== 'staging') return next();

  const authorization = c.req.raw.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return next();

  const allowedUserIds = new Set(csvValues(c.env.STAGING_AUTH_ALLOWED_USER_IDS));
  const authorizedParties = csvValues(c.env.STAGING_AUTH_AUTHORIZED_PARTIES);
  if (allowedUserIds.size === 0 || authorizedParties.length === 0) {
    console.warn('[auth] staging bearer rejected: identity allowlist is incomplete');
    return unauthorized(c);
  }

  const uid = await getAuthUserId(
    c.req.raw,
    c.env.CLERK_SECRET_KEY,
    c.env.CLERK_JWT_KEY,
    c.env.DB,
    c.env.ISS_EMBED_SECRET || c.env.PENNYBUILDER_PROVISION_SECRET,
    { authorizedParties },
  );
  if (!uid || !allowedUserIds.has(uid)) {
    console.warn('[auth] staging bearer rejected: identity is not allowlisted');
    return unauthorized(c);
  }

  c.set('uid', uid);
  return next();
}

export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const preverifiedUid = c.get('uid') as string | undefined;
  const uid = preverifiedUid ?? await getAuthUserId(
    c.req.raw,
    c.env.CLERK_SECRET_KEY,
    c.env.CLERK_JWT_KEY,
    c.env.DB,
    c.env.ISS_EMBED_SECRET || c.env.PENNYBUILDER_PROVISION_SECRET,
  );
  if (!uid) {
    return unauthorized(c);
  }
  c.set('uid', uid);
  return next();
}
