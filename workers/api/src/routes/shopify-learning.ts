import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { normalizeWorkspaceIdentity } from '../lib/learning/types';
import { verifySessionToken, type VerifiedSession } from '../lib/shopify-auth';

const COUNT_FIELDS = ['calls', 'messages', 'leads', 'bookings', 'sales'] as const;
type CountField = typeof COUNT_FIELDS[number];
type FeedbackField = CountField | 'orderValueCents';
type FeedbackValues = Record<FeedbackField, number | null>;
type ShopifyContext = Context<{ Bindings: Env }>;

function requireShopifyConfig(env: Env): { key: string; secret: string } | null {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) return null;
  return { key: env.SHOPIFY_API_KEY, secret: env.SHOPIFY_API_SECRET };
}

async function requireSession(c: ShopifyContext): Promise<VerifiedSession | Response> {
  const config = requireShopifyConfig(c.env);
  if (!config) return c.json({ error: 'Shopify app not configured' }, 500);

  const authorization = c.req.header('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const session = await verifySessionToken(
    authorization.slice(7),
    config.key,
    config.secret,
  );
  if (!session) return c.json({ error: 'Invalid session token' }, 401);
  return session;
}

function readFeedback(body: unknown): FeedbackValues {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object');
  }

  const payload = body as Record<string, unknown>;
  const feedback = {} as FeedbackValues;
  const fields: readonly FeedbackField[] = [...COUNT_FIELDS, 'orderValueCents'];

  for (const field of fields) {
    const value = payload[field];
    if (value === undefined || value === null) {
      feedback[field] = null;
      continue;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative integer`);
    }
    feedback[field] = value;
  }

  if (fields.every((field) => feedback[field] === null)) {
    throw new Error('At least one feedback metric is required');
  }
  return feedback;
}

export function registerShopifyLearningRoutes(
  app: Hono<{ Bindings: Env }>,
): void {
  app.post('/api/shopify/learning/outcomes/:postId/feedback', async (c) => {
    const sessionOrResponse = await requireSession(c);
    if (sessionOrResponse instanceof Response) return sessionOrResponse;

    let feedback: FeedbackValues;
    try {
      const body = await c.req.json();
      feedback = readFeedback(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON body';
      return c.json({ error: message }, 400);
    }

    const identity = normalizeWorkspaceIdentity(
      sessionOrResponse.shopDomain,
      null,
      'shop',
      sessionOrResponse.shopDomain,
    );
    const postId = c.req.param('postId');
    const post = await c.env.DB.prepare(`
      SELECT id
      FROM posts
      WHERE id = ?
        AND user_id = ?
        AND client_id IS NULL
        AND owner_kind = 'shop'
        AND owner_id = ?
      LIMIT 1
    `).bind(
      postId,
      identity.userId,
      identity.ownerId,
    ).first<{ id: string }>();

    if (!post) return c.json({ error: 'Not found' }, 404);

    const feedbackId = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO conversion_feedback (
        id, user_id, workspace_key, client_id, owner_kind, owner_id, post_id,
        calls, messages, leads, bookings, sales, order_value_cents, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      feedbackId,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      postId,
      feedback.calls,
      feedback.messages,
      feedback.leads,
      feedback.bookings,
      feedback.sales,
      feedback.orderValueCents,
      'owner',
    ).run();

    return c.json({ feedbackId });
  });
}
