// Server-to-server integrations.
//
// Richo Road Butchery uses this endpoint from its staff-only ordering backend
// to hand off weekly specials and order-safe updates into Steve's SocialAI
// workspace. This deliberately does not use Clerk browser auth: it is a narrow
// machine-to-machine surface protected by a shared ingest key plus an expected
// owner/client mapping.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { timingSafeEqualStr } from '../lib/timing-safe';

const uuid = () => crypto.randomUUID();

type RichoBrief = {
  title?: unknown;
  copy?: unknown;
  channel?: unknown;
  callToAction?: unknown;
};

type RichoOrderItem = {
  name?: unknown;
  unit?: unknown;
  quantity?: unknown;
  finalLineTotalCents?: unknown;
  estimatedLineTotalCents?: unknown;
};

type RichoOrder = {
  id?: unknown;
  fulfillment?: unknown;
  status?: unknown;
  paymentStatus?: unknown;
  customerSuburb?: unknown;
  requestedWindow?: unknown;
  estimatedTotalCents?: unknown;
  finalTotalCents?: unknown;
  items?: unknown;
};

type RichoPayload = {
  source?: unknown;
  eventType?: unknown;
  idempotencyKey?: unknown;
  agentAccountId?: unknown;
  workspaceId?: unknown;
  actor?: unknown;
  createdAt?: unknown;
  order?: RichoOrder | null;
  brief?: RichoBrief | null;
};

function text(value: unknown, fallback = '', max = 2000): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : fallback;
}

function cents(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function dollars(value: unknown): string {
  const c = cents(value);
  if (c == null) return '';
  return `$${(c / 100).toFixed(2)}`;
}

function bearerToken(value: string | null): string {
  const raw = text(value, '', 4000);
  return raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : '';
}

function authSecret(env: Env): string {
  return text(env.RICHO_ROAD_INGEST_API_KEY || env.SOCIALAI_STUDIO_API_KEY, '', 4000);
}

function richoFactKey(payload: RichoPayload, eventType: string): string {
  const explicit = text(payload.idempotencyKey, '', 180);
  if (explicit) return `richo:${explicit}`;
  const orderId = text(payload.order?.id, '', 100);
  if (orderId) return `richo:${eventType}:${orderId}`;
  const title = text(payload.brief?.title, 'untitled', 100).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `richo:${eventType}:${title || 'untitled'}`;
}

function orderContext(order: RichoOrder | null | undefined): string {
  if (!order) return '';
  const items = Array.isArray(order.items) ? order.items as RichoOrderItem[] : [];
  const itemSummary = items
    .slice(0, 6)
    .map((item) => {
      const name = text(item.name, 'Item', 80);
      const qty = Number(item.quantity);
      const unit = text(item.unit, '', 20);
      const total = dollars(item.finalLineTotalCents) || dollars(item.estimatedLineTotalCents);
      return [name, Number.isFinite(qty) ? `${qty}${unit ? ` ${unit}` : ''}` : '', total].filter(Boolean).join(' - ');
    })
    .join('; ');
  const total = dollars(order.finalTotalCents) || dollars(order.estimatedTotalCents);
  const parts = [
    text(order.fulfillment, '', 40) && `Fulfilment: ${text(order.fulfillment, '', 40)}`,
    text(order.requestedWindow, '', 120) && `Window: ${text(order.requestedWindow, '', 120)}`,
    text(order.customerSuburb, '', 80) && `Suburb: ${text(order.customerSuburb, '', 80)}`,
    total && `Packed total: ${total}`,
    itemSummary && `Items: ${itemSummary}`,
  ].filter(Boolean);
  return parts.join('\n');
}

export function buildRichoDraftContent(payload: RichoPayload): string {
  const brief = payload.brief || {};
  const title = text(brief.title, 'Richo Road weekly special', 120);
  const copy = text(
    brief.copy,
    'Butcher-prepared packs, click-and-collect, and scheduled local delivery from Richo Road Butchery.',
    1400,
  );
  const cta = text(brief.callToAction, 'Order online from Richo Road Butchery', 180);
  return [title, copy, cta].filter(Boolean).join('\n\n');
}

function factContent(payload: RichoPayload, eventType: string): string {
  const briefTitle = text(payload.brief?.title, 'Richo Road handoff', 140);
  const briefCopy = text(payload.brief?.copy, '', 900);
  const order = orderContext(payload.order);
  return [
    `${briefTitle} (${eventType})`,
    briefCopy,
    order,
  ].filter(Boolean).join('\n\n').slice(0, 2200);
}

function safeMetadata(payload: RichoPayload, eventType: string, draftPostId: string) {
  return {
    source: 'richo-road-butchery',
    eventType,
    draftPostId,
    actor: text(payload.actor, '', 120),
    createdAt: text(payload.createdAt, new Date().toISOString(), 80),
    brief: {
      title: text(payload.brief?.title, '', 180),
      channel: text(payload.brief?.channel, 'facebook', 40),
      callToAction: text(payload.brief?.callToAction, '', 220),
    },
    order: payload.order ? {
      id: text(payload.order.id, '', 120),
      fulfillment: text(payload.order.fulfillment, '', 40),
      status: text(payload.order.status, '', 80),
      paymentStatus: text(payload.order.paymentStatus, '', 80),
      customerSuburb: text(payload.order.customerSuburb, '', 120),
      requestedWindow: text(payload.order.requestedWindow, '', 180),
      estimatedTotalCents: cents(payload.order.estimatedTotalCents),
      finalTotalCents: cents(payload.order.finalTotalCents),
      items: (Array.isArray(payload.order.items) ? payload.order.items as RichoOrderItem[] : [])
        .slice(0, 30)
        .map((item) => ({
          name: text(item.name, '', 120),
          unit: text(item.unit, '', 30),
          quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
          estimatedLineTotalCents: cents(item.estimatedLineTotalCents),
          finalLineTotalCents: cents(item.finalLineTotalCents),
        })),
    } : null,
  };
}

async function resolveWorkspace(env: Env, payload: RichoPayload, request: Request) {
  const expectedAgent = text(env.RICHO_ROAD_AGENT_ACCOUNT_ID, '', 200);
  const expectedWorkspace = text(env.RICHO_ROAD_WORKSPACE_ID, '', 200);
  const suppliedAgent = text(payload.agentAccountId, '', 200) || text(request.headers.get('x-richo-agent-account-id'), '', 200);
  const suppliedWorkspace = text(payload.workspaceId, '', 200) || text(request.headers.get('x-richo-workspace-id'), '', 200);

  const ownerUserId = expectedAgent || suppliedAgent;
  const clientId = expectedWorkspace || suppliedWorkspace || null;
  if (!ownerUserId) {
    return { error: 'Richo Road owner user id is not configured.', status: 503 as const };
  }
  if (expectedAgent && suppliedAgent && !timingSafeEqualStr(suppliedAgent, expectedAgent)) {
    return { error: 'Agent account id mismatch.', status: 403 as const };
  }
  if (expectedWorkspace && suppliedWorkspace && !timingSafeEqualStr(suppliedWorkspace, expectedWorkspace)) {
    return { error: 'Workspace id mismatch.', status: 403 as const };
  }

  if (clientId) {
    const client = await env.DB.prepare('SELECT id, name FROM clients WHERE id = ? AND user_id = ?')
      .bind(clientId, ownerUserId)
      .first<{ id: string; name: string }>();
    if (!client) {
      return { error: 'Richo Road workspace not found for configured owner.', status: 404 as const };
    }
    return { ownerUserId, clientId, workspaceName: client.name };
  }

  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(ownerUserId)
    .first<{ id: string; email: string | null }>();
  if (!user) {
    return { error: 'Richo Road owner user not found.', status: 404 as const };
  }
  return { ownerUserId, clientId: null, workspaceName: user.email || ownerUserId };
}

export function registerIntegrationRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/integrations/richo-road/events', async (c) => {
    const secret = authSecret(c.env);
    if (!secret) {
      return c.json({ error: 'Richo Road ingest is not configured.', requestId: c.get('requestId') }, 503);
    }

    const supplied = bearerToken(c.req.header('authorization') || null) || text(c.req.header('x-richo-ingest-key'), '', 4000);
    if (!supplied || !timingSafeEqualStr(supplied, secret)) {
      return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401);
    }

    const payload = await c.req.json<RichoPayload>().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return c.json({ error: 'Invalid JSON body.', requestId: c.get('requestId') }, 400);
    }
    if (text(payload.source, '', 100) && text(payload.source, '', 100) !== 'richo-road-butchery') {
      return c.json({ error: 'Unsupported integration source.', requestId: c.get('requestId') }, 400);
    }

    const workspace = await resolveWorkspace(c.env, payload, c.req.raw);
    if ('error' in workspace) {
      return c.json({ error: workspace.error, requestId: c.get('requestId') }, workspace.status);
    }

    const eventType = text(payload.eventType, payload.order ? 'order_update' : 'weekly_special', 80);
    const key = richoFactKey(payload, eventType);
    const channel = text(payload.brief?.channel, 'facebook', 40).toLowerCase();
    const content = buildRichoDraftContent(payload);
    const title = text(payload.brief?.title, 'Richo Road handoff', 160);
    const clientScope = workspace.clientId || '';

    const existingFact = await c.env.DB.prepare(
      `SELECT metadata FROM client_facts WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fb_id = ?`
    ).bind(workspace.ownerUserId, clientScope, key).first<{ metadata: string | null }>();

    let draftPostId = '';
    if (existingFact?.metadata) {
      try {
        const metadata = JSON.parse(existingFact.metadata);
        draftPostId = text(metadata?.draftPostId, '', 120);
      } catch {
        draftPostId = '';
      }
    }

    let draftMode: 'created' | 'updated' = 'created';
    if (draftPostId) {
      const update = await c.env.DB.prepare(
        `UPDATE posts
         SET content = ?, platform = ?, status = 'Draft', scheduled_for = NULL, hashtags = ?, topic = ?, pillar = ?
         WHERE id = ? AND user_id = ? AND COALESCE(client_id, '') = ? AND status = 'Draft'`
      ).bind(content, channel, JSON.stringify([]), title, 'Richo Road Butchery', draftPostId, workspace.ownerUserId, clientScope).run();
      if ((update.meta?.changes || 0) === 0) {
        draftPostId = '';
      } else {
        draftMode = 'updated';
      }
    }

    if (!draftPostId) {
      draftPostId = uuid();
      await c.env.DB.prepare(
        `INSERT INTO posts (id, user_id, client_id, content, platform, status, scheduled_for, hashtags, topic, pillar)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        draftPostId,
        workspace.ownerUserId,
        workspace.clientId,
        content,
        channel,
        'Draft',
        null,
        JSON.stringify([]),
        title,
        'Richo Road Butchery',
      ).run();
    }

    const metadata = safeMetadata(payload, eventType, draftPostId);
    await c.env.DB.prepare(
      `DELETE FROM client_facts WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fb_id = ?`
    ).bind(workspace.ownerUserId, clientScope, key).run();
    await c.env.DB.prepare(
      `INSERT INTO client_facts (user_id, client_id, fact_type, content, metadata, fb_id, engagement_score, verified_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      workspace.ownerUserId,
      workspace.clientId,
      eventType === 'weekly_special' ? 'own_post' : 'event',
      factContent(payload, eventType),
      JSON.stringify(metadata),
      key,
      eventType === 'weekly_special' ? 20 : 12,
      new Date().toISOString(),
    ).run();

    return c.json({
      ok: true,
      configured: true,
      ownerUserId: workspace.ownerUserId,
      clientId: workspace.clientId,
      workspaceName: workspace.workspaceName,
      draftPostId,
      draftMode,
      factKey: key,
      requestId: c.get('requestId'),
    });
  });
}
