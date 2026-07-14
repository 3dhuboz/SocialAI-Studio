import type { Context, Hono } from 'hono';
import { isRateLimited } from '../auth';
import type { Env } from '../env';
import { proposeAudienceSegments } from '../lib/reach/audience-model';
import {
  confirmAudienceSegment,
  listReachAudienceSegments,
  listReachPlans,
  reachWorkspaceKey,
  readReachProfileDraft,
  shopReachScope,
} from '../lib/reach/http';
import {
  confirmReachProfile,
  getLatestReachProfile,
  proposeReachProfile,
} from '../lib/reach/reach-profile';
import type { ReachProfile, ReachWorkspaceScope } from '../lib/reach/types';
import { verifySessionToken } from '../lib/shopify-auth';

export interface ShopifyReachRoutesDeps {
  getProfile: typeof getLatestReachProfile;
  proposeProfile: typeof proposeReachProfile;
  confirmProfile: typeof confirmReachProfile;
  proposeSegments: typeof proposeAudienceSegments;
}

const defaultDeps: ShopifyReachRoutesDeps = {
  getProfile: getLatestReachProfile,
  proposeProfile: proposeReachProfile,
  confirmProfile: confirmReachProfile,
  proposeSegments: proposeAudienceSegments,
};

type App = Hono<{ Bindings: Env }>;

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
  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ') || !c.env.SHOPIFY_API_KEY || !c.env.SHOPIFY_API_SECRET) {
    return null;
  }
  return verifySessionToken(
    auth.slice(7),
    c.env.SHOPIFY_API_KEY,
    c.env.SHOPIFY_API_SECRET,
  );
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
  deps: ShopifyReachRoutesDeps,
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

export function registerShopifyReachRoutes(
  app: App,
  deps: ShopifyReachRoutesDeps = defaultDeps,
): void {
  app.get('/api/shopify/reach/profile', async (c) => {
    const session = await authenticate(c);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const scope = shopReachScope(session.shopDomain);
    try {
      const profile = await deps.getProfile(c.env.DB, scope);
      const segments = profile
        ? await listReachAudienceSegments(c.env.DB, profile)
        : [];
      return c.json({ profile, segments });
    } catch (error) {
      const failure = routeError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  app.post('/api/shopify/reach/profile/propose', async (c) => {
    const session = await authenticate(c);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const scope = shopReachScope(session.shopDomain);
    try {
      if (await isRateLimited(c.env.DB, `shopify-reach-profile:${scope.userId}`, 10)) {
        return c.json({ error: 'Too many reach profile requests' }, 429);
      }
      const body = await jsonBody(c.req.raw);
      const profile = await deps.proposeProfile(
        c.env.DB,
        scope,
        readReachProfileDraft(body),
      );
      return c.json({ profile });
    } catch (error) {
      const failure = routeError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  app.put('/api/shopify/reach/profile/confirm', async (c) => {
    const session = await authenticate(c);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const scope = shopReachScope(session.shopDomain);
    try {
      const body = await jsonBody(c.req.raw);
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

  app.post('/api/shopify/reach/segments/propose', async (c) => {
    const session = await authenticate(c);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const scope = shopReachScope(session.shopDomain);
    try {
      if (await isRateLimited(c.env.DB, `shopify-reach-segments:${scope.userId}`, 5)) {
        return c.json({ error: 'Too many audience requests' }, 429);
      }
      await jsonBody(c.req.raw);
      const profile = await latestConfirmedProfile(deps, c.env.DB, scope);
      return c.json({ segments: await deps.proposeSegments(c.env, profile) });
    } catch (error) {
      const failure = routeError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  app.put('/api/shopify/reach/segments/confirm', async (c) => {
    const session = await authenticate(c);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const scope = shopReachScope(session.shopDomain);
    try {
      const body = await jsonBody(c.req.raw);
      const profile = await latestConfirmedProfile(deps, c.env.DB, scope);
      const segmentId = requiredId(body.segmentId, 'segmentId');
      await confirmAudienceSegment(c.env.DB, scope, profile.id, segmentId);
      return c.json({ segmentId, status: 'confirmed' });
    } catch (error) {
      const failure = routeError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  });

  app.get('/api/shopify/reach/plans/:postId', async (c) => {
    const session = await authenticate(c);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const scope = shopReachScope(session.shopDomain);
    const postId = c.req.param('postId');
    const post = await c.env.DB.prepare(
      `SELECT id FROM posts
       WHERE id = ? AND owner_kind = 'shop' AND owner_id = ?
       LIMIT 1`,
    ).bind(postId, scope.ownerId).first<{ id: string }>();
    if (!post) return c.json({ error: 'Post not found' }, 404);

    return c.json({
      plans: await listReachPlans(
        c.env.DB,
        scope.userId,
        reachWorkspaceKey(scope),
        postId,
      ),
    });
  });
}
