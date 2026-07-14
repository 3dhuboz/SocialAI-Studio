import type { Hono } from 'hono';
import type { Env } from '../env';
import { listDecisionReceipts } from '../lib/learning/decision-repository';
import {
  normalizeWorkspaceIdentity,
  type WorkspaceIdentity,
  type WorkspaceOwnerKind,
} from '../lib/learning/types';
import { requireAuth } from '../middleware/auth';
import { createTrackingLink } from './tracking';

type OwnedPostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: string | null;
  owner_id: string | null;
};

type DecisionRow = Record<string, unknown> & {
  id: string;
  summary_json?: string | null;
};

type VerdictRow = Record<string, unknown> & {
  decision_id: string;
  evidence_json?: string | null;
  repair_json?: string | null;
};

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonStrings(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Request body must be an object');
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body must be an object') throw error;
    throw new Error('Invalid JSON body');
  }
}

function requestedClientId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function canonicalPostIdentity(
  post: OwnedPostRow,
  authenticatedUserId: string,
  clientId: string | null,
  allowShop = false,
): WorkspaceIdentity | null {
  const postClientId = post.client_id?.trim() || null;
  if (post.user_id !== authenticatedUserId || postClientId !== clientId) return null;
  const kind: WorkspaceOwnerKind = post.owner_kind === 'shop'
    ? 'shop'
    : postClientId === null ? 'user' : 'client';
  if ((!allowShop && kind === 'shop') || (post.owner_kind && post.owner_kind !== kind)) return null;
  try {
    return normalizeWorkspaceIdentity(
      authenticatedUserId,
      postClientId,
      kind,
      post.owner_id?.trim() || postClientId || authenticatedUserId,
    );
  } catch {
    return null;
  }
}

async function ownedPost(
  db: D1Database,
  postId: string,
  userId: string,
): Promise<OwnedPostRow | null> {
  return db.prepare(`
    SELECT id, user_id, client_id, owner_kind, owner_id
    FROM posts
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).bind(postId, userId).first<OwnedPostRow>();
}

const FEEDBACK_FIELDS = [
  'calls', 'messages', 'leads', 'bookings', 'sales', 'orderValueCents',
] as const;
type FeedbackField = typeof FEEDBACK_FIELDS[number];

function readMetric(body: Record<string, unknown>, key: FeedbackField): number | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  if (value < 0) throw new Error(`${key} must be non-negative`);
  return value;
}

export function registerLearningRoutes(app: Hono<{ Bindings: Env }>): void {
  app.use('/api/learning/*', requireAuth);

  app.get('/api/learning/decisions/:postId', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    const requestedClientId = c.req.query('clientId')?.trim() || null;
    const post = await c.env.DB.prepare(`
      SELECT id, user_id, client_id, owner_kind, owner_id
      FROM posts
      WHERE id = ? AND user_id = ?
    `).bind(postId, userId).first<OwnedPostRow>();

    if (!post) {
      return c.json({ error: 'Not found' }, 404);
    }

    const clientId = post.client_id?.trim() || null;
    if (requestedClientId !== clientId) {
      return c.json({ error: 'Not found' }, 404);
    }

    const ownerKind: WorkspaceOwnerKind = post.owner_kind === 'shop'
      ? 'shop'
      : clientId === null ? 'user' : 'client';
    if (post.owner_kind && post.owner_kind !== ownerKind) {
      return c.json({ error: 'Not found' }, 404);
    }
    const ownerId = post.owner_id?.trim() || clientId || userId;

    try {
      const decisions = await listDecisionReceipts(
        c.env.DB,
        userId,
        clientId,
        postId,
        20,
        ownerKind,
        ownerId,
      ) as DecisionRow[];
      if (decisions.length === 0) return c.json({ decisions: [] });

      // Decision ids come only from the tenant-scoped parent query above.
      // Verdict rows therefore cannot be fetched by an arbitrary id supplied
      // by the browser.
      const decisionIds = decisions.map((decision) => decision.id);
      const placeholders = decisionIds.map(() => '?').join(',');
      const verdictResult = await c.env.DB.prepare(`
        SELECT * FROM learning_critic_verdicts
        WHERE decision_id IN (${placeholders})
        ORDER BY decision_id, attempt ASC, critic_kind ASC
      `).bind(...decisionIds).all<VerdictRow>();
      const verdictsByDecision = new Map<string, Array<Record<string, unknown>>>();
      for (const verdict of verdictResult.results ?? []) {
        const normalized = {
          ...verdict,
          evidence: parseJsonStrings(verdict.evidence_json),
          repairs: parseJsonStrings(verdict.repair_json),
        };
        const rows = verdictsByDecision.get(verdict.decision_id) ?? [];
        rows.push(normalized);
        verdictsByDecision.set(verdict.decision_id, rows);
      }

      return c.json({
        decisions: decisions.map((decision) => ({
          ...decision,
          summary: parseJsonObject(decision.summary_json),
          verdicts: verdictsByDecision.get(decision.id) ?? [],
        })),
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  app.post('/api/learning/posts/:postId/tracking-link', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    try {
      const body = await jsonBody(c.req.raw);
      const clientId = requestedClientId(body.clientId);
      const post = await ownedPost(c.env.DB, postId, userId);
      const identity = post && canonicalPostIdentity(post, userId, clientId);
      if (!identity) return c.json({ error: 'Not found' }, 404);
      if (typeof body.destinationUrl !== 'string') {
        return c.json({ error: 'destinationUrl is required' }, 400);
      }
      const expiresAt = body.expiresAt === undefined || body.expiresAt === null
        ? null
        : typeof body.expiresAt === 'string' ? body.expiresAt : '__invalid__';
      const link = await createTrackingLink(c.env.DB, {
        identity,
        postId,
        destinationUrl: body.destinationUrl,
        expiresAt,
      });
      return c.json({ link });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });

  app.post('/api/learning/outcomes/:postId/feedback', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    try {
      const body = await jsonBody(c.req.raw);
      const metrics = Object.fromEntries(
        FEEDBACK_FIELDS.map((key) => [key, readMetric(body, key)]),
      ) as Record<FeedbackField, number | null>;
      if (FEEDBACK_FIELDS.every((key) => metrics[key] === null)) {
        return c.json({ error: 'At least one feedback metric is required' }, 400);
      }
      const clientId = requestedClientId(body.clientId);
      const post = await ownedPost(c.env.DB, postId, userId);
      const identity = post && canonicalPostIdentity(post, userId, clientId);
      if (!identity) return c.json({ error: 'Not found' }, 404);
      const id = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO conversion_feedback (
          id,user_id,workspace_key,client_id,owner_kind,owner_id,post_id,
          calls,messages,leads,bookings,sales,order_value_cents,source,recorded_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,
        identity.userId,
        identity.workspaceKey,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
        postId,
        metrics.calls,
        metrics.messages,
        metrics.leads,
        metrics.bookings,
        metrics.sales,
        metrics.orderValueCents,
        'owner',
        new Date().toISOString(),
      ).run();
      return c.json({ ok: true, feedbackId: id });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });
}
