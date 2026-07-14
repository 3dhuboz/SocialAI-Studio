import type { Context, Hono } from 'hono';
import { getAuthUserId, isRateLimited } from '../auth';
import type { Env } from '../env';
import { proposeAudienceSegments } from '../lib/reach/audience-model';
import {
  confirmAudienceSegment,
  listReachPlans,
  reachScope,
  reachWorkspaceKey,
  readReachProfileDraft,
} from '../lib/reach/http';
import {
  confirmReachProfile,
  getLatestReachProfile,
  proposeReachProfile,
} from '../lib/reach/reach-profile';
import type {
  ReachProfile,
  ReachProfileDraft,
  ReachWorkspaceScope,
} from '../lib/reach/types';

export interface ReachRoutesDeps {
  getProfile: typeof getLatestReachProfile;
  proposeProfile: typeof proposeReachProfile;
  confirmProfile: typeof confirmReachProfile;
  proposeSegments: typeof proposeAudienceSegments;
}

const defaultDeps: ReachRoutesDeps = {
  getProfile: getLatestReachProfile,
  proposeProfile: proposeReachProfile,
  confirmProfile: confirmReachProfile,
  proposeSegments: proposeAudienceSegments,
};

type App = Hono<{ Bindings: Env }>;

function optionalClientId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Request body must be an object');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error;
    throw new Error('Invalid JSON body');
  }
}

async function authenticate(c: Context<{ Bindings: Env }>) {
  const uid = await getAuthUserId(
    c.req.raw,
    c.env.CLERK_SECRET_KEY,
    c.env.CLERK_JWT_KEY,
    c.env.DB,
    c.env.ISS_EMBED_SECRET || c.env.PENNYBUILDER_PROVISION_SECRET,
  );
  return uid;
}

function routeError(error: unknown): { message: string; status: 400 | 404 | 500 } {
  const message = error instanceof Error ? error.message : 'Reach request failed';
  if (/not found|not installed|workspace/i.test(message)) return { message, status: 404 };
  if (/required|must be|unsupported|invalid|incomplete|not confirmed/i.test(message)) {
    return { message, status: 400 };
  }
  return { message: 'Reach request failed', status: 500 };
}

async function latestConfirmedProfile(
  deps: ReachRoutesDeps,
  db: D1Database,
  scope: ReachWorkspaceScope,
): Promise<ReachProfile> {
  const profile = await deps.getProfile(db, scope);
  if (!profile) throw new Error('Reach profile not found');
  if (profile.confirmationStatus !== 'confirmed') {
    throw new Error('Reach profile is not confirmed');
  }
  return profile;
}

export function registerReachRoutes(app: App, deps: ReachRoutesDeps = defaultDeps): void {
  app.get('/api/reach/profile', async (c) => {
    const uid = await authenticate(c);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const scope = reachScope(uid, optionalClientId(c.req.query('clientId')));
    try {
      return c.json({ profile: await deps.getProfile(c.env.DB, scope) });
    } catch (error) {
      const failure = routeError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  app.post('/api/reach/profile/propose', async (c) => {
    const uid = await authenticate(c);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const body = await jsonBody(c.req.raw);
      const scope = reachScope(uid, optionalClientId(body.clientId));
      if (await isRateLimited(c.env.DB, `reach-profile:${uid}`, 10)) {
        return c.json({ error: 'Too many reach profile requests' }, 429);
      }
      const draft: ReachProfileDraft = readReachProfileDraft(body);
      return c.json({ profile: await deps.proposeProfile(c.env.DB, scope, draft) });
    } catch (error) {
      const failure = routeError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  app.put('/api/reach/profile/confirm', async (c) => {
    const uid = await authenticate(c);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const body = await jsonBody(c.req.raw);
      const scope = reachScope(uid, optionalClientId(body.clientId));
      const profile = await deps.confirmProfile(
        c.env.DB,
        scope,
        requiredId(body.profileId, 'profileId'),
      );
      return c.json({ profile });
    } catch (error) {
      const failure = routeError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  app.post('/api/reach/segments/propose', async (c) => {
    const uid = await authenticate(c);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const body = await jsonBody(c.req.raw);
      const scope = reachScope(uid, optionalClientId(body.clientId));
      if (await isRateLimited(c.env.DB, `reach-segments:${uid}`, 5)) {
        return c.json({ error: 'Too many audience requests' }, 429);
      }
      const profile = await latestConfirmedProfile(deps, c.env.DB, scope);
      return c.json({ segments: await deps.proposeSegments(c.env, profile) });
    } catch (error) {
      const failure = routeError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  app.put('/api/reach/segments/confirm', async (c) => {
    const uid = await authenticate(c);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const body = await jsonBody(c.req.raw);
      const scope = reachScope(uid, optionalClientId(body.clientId));
      const profile = await latestConfirmedProfile(deps, c.env.DB, scope);
      const segmentId = requiredId(body.segmentId, 'segmentId');
      await confirmAudienceSegment(c.env.DB, scope, profile.id, segmentId);
      return c.json({ segmentId, status: 'confirmed' });
    } catch (error) {
      const failure = routeError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  app.get('/api/reach/plans/:postId', async (c) => {
    const uid = await authenticate(c);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const scope = reachScope(uid, optionalClientId(c.req.query('clientId')));
    const postId = c.req.param('postId');
    const post = await c.env.DB.prepare(
      'SELECT id, client_id FROM posts WHERE id = ? AND user_id = ? LIMIT 1',
    ).bind(postId, uid).first<{ id: string; client_id: string | null }>();
    if (!post || (post.client_id ?? null) !== scope.clientId) {
      return c.json({ error: 'Post not found' }, 404);
    }
    const plans = await listReachPlans(
      c.env.DB,
      uid,
      reachWorkspaceKey(scope),
      postId,
    );
    return c.json({ plans });
  });
}
