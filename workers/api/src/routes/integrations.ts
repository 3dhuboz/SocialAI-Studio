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

type MyAssistantBrief = {
  title?: unknown;
  copy?: unknown;
  prompt?: unknown;
  channel?: unknown;
  platform?: unknown;
  callToAction?: unknown;
  scheduledFor?: unknown;
  topic?: unknown;
  pillar?: unknown;
};

type MyAssistantCampaign = {
  title?: unknown;
  instruction?: unknown;
  channel?: unknown;
  platform?: unknown;
  postCount?: unknown;
  durationDays?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  callToAction?: unknown;
  topic?: unknown;
  pillar?: unknown;
  approvalRequired?: unknown;
};

type MyAssistantInbound = {
  channel?: unknown;
  platform?: unknown;
  body?: unknown;
  authorName?: unknown;
  providerMessageId?: unknown;
  postId?: unknown;
  url?: unknown;
};

type MyAssistantPayload = {
  source?: unknown;
  eventType?: unknown;
  idempotencyKey?: unknown;
  organizationId?: unknown;
  conversationId?: unknown;
  messageId?: unknown;
  taskId?: unknown;
  agentAccountId?: unknown;
  workspaceId?: unknown;
  actor?: unknown;
  approvalState?: unknown;
  createdAt?: unknown;
  brief?: MyAssistantBrief | null;
  campaign?: MyAssistantCampaign | null;
  inbound?: MyAssistantInbound | null;
  context?: unknown;
  replyPolicy?: unknown;
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

function myAssistantAuthSecret(env: Env): string {
  return text(env.MY_ASSISTANT_INGEST_API_KEY || env.SOCIALAI_STUDIO_API_KEY, '', 4000);
}

function richoFactKey(payload: RichoPayload, eventType: string): string {
  const explicit = text(payload.idempotencyKey, '', 180);
  if (explicit) return `richo:${explicit}`;
  const orderId = text(payload.order?.id, '', 100);
  if (orderId) return `richo:${eventType}:${orderId}`;
  const title = text(payload.brief?.title, 'untitled', 100).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `richo:${eventType}:${title || 'untitled'}`;
}

function myAssistantFactKey(payload: MyAssistantPayload, eventType: string, suffix = ''): string {
  const explicit = text(payload.idempotencyKey, '', 180);
  const base = explicit || [eventType, text(payload.conversationId, '', 100), text(payload.messageId, '', 100), text(payload.taskId, '', 100)]
    .filter(Boolean)
    .join(':') || text(payload.brief?.title ?? payload.campaign?.title, 'untitled', 100).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `my-assistant:${base}${suffix}`;
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

function safeMyAssistantMetadata(payload: MyAssistantPayload, eventType: string, extra: Record<string, unknown> = {}) {
  return {
    source: 'my-assistant',
    eventType,
    idempotencyKey: text(payload.idempotencyKey, '', 220),
    organizationId: text(payload.organizationId, '', 160),
    conversationId: text(payload.conversationId, '', 160),
    messageId: text(payload.messageId, '', 160),
    taskId: text(payload.taskId, '', 160),
    actor: text(payload.actor, '', 120),
    approvalState: text(payload.approvalState, 'draft_requested', 80),
    createdAt: text(payload.createdAt, new Date().toISOString(), 80),
    brief: payload.brief ? {
      title: text(payload.brief.title, '', 180),
      channel: text(payload.brief.channel ?? payload.brief.platform, 'facebook', 40),
      callToAction: text(payload.brief.callToAction, '', 220),
      scheduledFor: text(payload.brief.scheduledFor, '', 80),
      topic: text(payload.brief.topic, '', 180),
      pillar: text(payload.brief.pillar, '', 180),
    } : null,
    campaign: payload.campaign ? {
      title: text(payload.campaign.title, '', 180),
      instruction: text(payload.campaign.instruction, '', 1200),
      channel: text(payload.campaign.channel ?? payload.campaign.platform, 'facebook', 40),
      postCount: boundedNumber(payload.campaign.postCount, 7, 1, 21),
      durationDays: boundedNumber(payload.campaign.durationDays, 7, 1, 31),
      startsAt: text(payload.campaign.startsAt, '', 80),
      endsAt: text(payload.campaign.endsAt, '', 80),
      callToAction: text(payload.campaign.callToAction, '', 220),
      topic: text(payload.campaign.topic, '', 180),
      pillar: text(payload.campaign.pillar, '', 180),
    } : null,
    inbound: payload.inbound ? {
      channel: text(payload.inbound.channel ?? payload.inbound.platform, 'facebook', 40),
      authorName: text(payload.inbound.authorName, '', 160),
      providerMessageId: text(payload.inbound.providerMessageId, '', 220),
      postId: text(payload.inbound.postId, '', 220),
      url: text(payload.inbound.url, '', 500),
    } : null,
    ...extra,
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

async function resolveMyAssistantWorkspace(env: Env, payload: MyAssistantPayload, request: Request) {
  const expectedAgent = text(env.MY_ASSISTANT_AGENT_ACCOUNT_ID, '', 200);
  const expectedWorkspace = text(env.MY_ASSISTANT_WORKSPACE_ID, '', 200);
  const suppliedAgent = text(payload.agentAccountId, '', 200) || text(request.headers.get('x-my-assistant-agent-account-id'), '', 200);
  const suppliedWorkspace = text(payload.workspaceId, '', 200) || text(request.headers.get('x-my-assistant-workspace-id'), '', 200);

  const ownerUserId = expectedAgent || suppliedAgent;
  const clientId = expectedWorkspace || suppliedWorkspace || null;
  if (!ownerUserId) {
    return { error: 'My Assistant owner user id is not configured.', status: 503 as const };
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
      return { error: 'My Assistant workspace not found for configured owner.', status: 404 as const };
    }
    return { ownerUserId, clientId, workspaceName: client.name };
  }

  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(ownerUserId)
    .first<{ id: string; email: string | null }>();
  if (!user) {
    return { error: 'My Assistant owner user not found.', status: 404 as const };
  }
  return { ownerUserId, clientId: null, workspaceName: user.email || ownerUserId };
}

function buildMyAssistantDraftContent(payload: MyAssistantPayload): string {
  const brief = payload.brief || {};
  const title = text(brief.title, 'My Assistant social brief', 140);
  const copy = text(brief.copy, '', 1600);
  const prompt = text(brief.prompt, '', 1600);
  const cta = text(brief.callToAction, '', 180);
  const body = copy || prompt || 'Draft a customer-safe social post from this My Assistant handoff.';
  return [title, body, cta].filter(Boolean).join('\n\n');
}

function buildMyAssistantCampaignContent(payload: MyAssistantPayload, index: number, total: number, scheduledFor: string): string {
  const campaign = payload.campaign || {};
  const title = text(campaign.title, 'My Assistant campaign', 140);
  const instruction = text(campaign.instruction, '', 1600);
  const cta = text(campaign.callToAction, '', 180);
  return [
    `${title} - draft ${index + 1} of ${total}`,
    `Suggested slot: ${scheduledFor}`,
    instruction || 'Create a customer-safe campaign post from this My Assistant request.',
    cta,
    'Review before scheduling or publishing. Do not include private customer details or unsupported promises.',
  ].filter(Boolean).join('\n\n');
}

function myAssistantFactContent(payload: MyAssistantPayload, eventType: string): string {
  const title = text(payload.brief?.title ?? payload.campaign?.title, 'My Assistant handoff', 140);
  const copy = text(payload.brief?.copy ?? payload.brief?.prompt ?? payload.campaign?.instruction ?? payload.inbound?.body, '', 1400);
  return [`${title} (${eventType})`, copy].filter(Boolean).join('\n\n').slice(0, 2200);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function parseIsoOrNow(value: unknown): Date {
  const raw = text(value, '', 80);
  const date = raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function campaignSlots(payload: MyAssistantPayload): string[] {
  const campaign = payload.campaign || {};
  const count = boundedNumber(campaign.postCount, 7, 1, 21);
  const durationDays = boundedNumber(campaign.durationDays, 7, 1, 31);
  const start = parseIsoOrNow(campaign.startsAt || payload.createdAt);
  const slots: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const slot = new Date(start.getTime());
    const dayOffset = Math.floor((i * durationDays) / count);
    slot.setUTCDate(slot.getUTCDate() + dayOffset);
    slot.setUTCHours(9 + ((i % 3) * 3), 0, 0, 0);
    slots.push(slot.toISOString());
  }

  return slots;
}

async function readExistingDraftIds(env: Env, ownerUserId: string, clientScope: string, key: string): Promise<string[]> {
  const existingFact = await env.DB.prepare(
    `SELECT metadata FROM client_facts WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fb_id = ?`
  ).bind(ownerUserId, clientScope, key).first<{ metadata: string | null }>();

  if (!existingFact?.metadata) return [];
  try {
    const metadata = JSON.parse(existingFact.metadata);
    if (Array.isArray(metadata?.draftPostIds)) {
      return metadata.draftPostIds.map((id: unknown) => text(id, '', 120)).filter(Boolean);
    }
    const id = text(metadata?.draftPostId, '', 120);
    return id ? [id] : [];
  } catch {
    return [];
  }
}

async function upsertDraftPost(env: Env, input: {
  ownerUserId: string;
  clientId: string | null;
  existingDraftPostId?: string;
  content: string;
  channel: string;
  title: string;
  pillar: string;
  scheduledFor?: string | null;
}) {
  const clientScope = input.clientId || '';
  let draftPostId = text(input.existingDraftPostId, '', 120);
  let draftMode: 'created' | 'updated' = 'created';

  if (draftPostId) {
    const update = await env.DB.prepare(
      `UPDATE posts
       SET content = ?, platform = ?, status = 'Draft', scheduled_for = ?, hashtags = ?, topic = ?, pillar = ?
       WHERE id = ? AND user_id = ? AND COALESCE(client_id, '') = ? AND status = 'Draft'`
    ).bind(input.content, input.channel, input.scheduledFor || null, JSON.stringify([]), input.title, input.pillar, draftPostId, input.ownerUserId, clientScope).run();
    if ((update.meta?.changes || 0) === 0) {
      draftPostId = '';
    } else {
      draftMode = 'updated';
    }
  }

  if (!draftPostId) {
    draftPostId = uuid();
    await env.DB.prepare(
      `INSERT INTO posts (id, user_id, client_id, content, platform, status, scheduled_for, hashtags, topic, pillar)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      draftPostId,
      input.ownerUserId,
      input.clientId,
      input.content,
      input.channel,
      'Draft',
      input.scheduledFor || null,
      JSON.stringify([]),
      input.title,
      input.pillar,
    ).run();
  }

  return { draftPostId, draftMode };
}

async function replaceMyAssistantFact(env: Env, input: {
  ownerUserId: string;
  clientId: string | null;
  key: string;
  eventType: string;
  content: string;
  metadata: Record<string, unknown>;
  engagementScore?: number;
}) {
  const clientScope = input.clientId || '';
  await env.DB.prepare(
    `DELETE FROM client_facts WHERE user_id = ? AND COALESCE(client_id, '') = ? AND fb_id = ?`
  ).bind(input.ownerUserId, clientScope, input.key).run();
  await env.DB.prepare(
    `INSERT INTO client_facts (user_id, client_id, fact_type, content, metadata, fb_id, engagement_score, verified_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    input.ownerUserId,
    input.clientId,
    input.eventType === 'social_reply_request' ? 'event' : 'own_post',
    input.content,
    JSON.stringify(input.metadata),
    input.key,
    input.engagementScore ?? 10,
    new Date().toISOString(),
  ).run();
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

  app.post('/api/integrations/my-assistant/social-posts', async (c) => {
    const secret = myAssistantAuthSecret(c.env);
    if (!secret) {
      return c.json({ error: 'My Assistant ingest is not configured.', requestId: c.get('requestId') }, 503);
    }

    const supplied = bearerToken(c.req.header('authorization') || null) || text(c.req.header('x-my-assistant-ingest-key'), '', 4000);
    if (!supplied || !timingSafeEqualStr(supplied, secret)) {
      return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401);
    }

    const payload = await c.req.json<MyAssistantPayload>().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return c.json({ error: 'Invalid JSON body.', requestId: c.get('requestId') }, 400);
    }
    if (text(payload.source, '', 100) && text(payload.source, '', 100) !== 'my-assistant') {
      return c.json({ error: 'Unsupported integration source.', requestId: c.get('requestId') }, 400);
    }
    if (!payload.brief) {
      return c.json({ error: 'brief is required.', requestId: c.get('requestId') }, 400);
    }

    const workspace = await resolveMyAssistantWorkspace(c.env, payload, c.req.raw);
    if ('error' in workspace) {
      return c.json({ error: workspace.error, requestId: c.get('requestId') }, workspace.status);
    }

    const eventType = text(payload.eventType, 'social_post_request', 80);
    const key = myAssistantFactKey(payload, eventType);
    const clientScope = workspace.clientId || '';
    const [existingDraftPostId] = await readExistingDraftIds(c.env, workspace.ownerUserId, clientScope, key);
    const channel = text(payload.brief.channel ?? payload.brief.platform, 'facebook', 40).toLowerCase();
    const title = text(payload.brief.title, 'My Assistant social brief', 160);
    const pillar = text(payload.brief.pillar, 'My Assistant', 160);
    const scheduledFor = text(payload.brief.scheduledFor, '', 80) || null;
    const content = buildMyAssistantDraftContent(payload);
    const draft = await upsertDraftPost(c.env, {
      ownerUserId: workspace.ownerUserId,
      clientId: workspace.clientId,
      existingDraftPostId,
      content,
      channel,
      title,
      pillar,
      scheduledFor,
    });

    const metadata = safeMyAssistantMetadata(payload, eventType, { draftPostId: draft.draftPostId });
    await replaceMyAssistantFact(c.env, {
      ownerUserId: workspace.ownerUserId,
      clientId: workspace.clientId,
      key,
      eventType,
      content: myAssistantFactContent(payload, eventType),
      metadata,
      engagementScore: 14,
    });

    return c.json({
      ok: true,
      configured: true,
      ownerUserId: workspace.ownerUserId,
      clientId: workspace.clientId,
      workspaceName: workspace.workspaceName,
      draftPostId: draft.draftPostId,
      draftMode: draft.draftMode,
      factKey: key,
      requestId: c.get('requestId'),
    });
  });

  app.post('/api/integrations/my-assistant/social-campaigns', async (c) => {
    const secret = myAssistantAuthSecret(c.env);
    if (!secret) {
      return c.json({ error: 'My Assistant ingest is not configured.', requestId: c.get('requestId') }, 503);
    }

    const supplied = bearerToken(c.req.header('authorization') || null) || text(c.req.header('x-my-assistant-ingest-key'), '', 4000);
    if (!supplied || !timingSafeEqualStr(supplied, secret)) {
      return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401);
    }

    const payload = await c.req.json<MyAssistantPayload>().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return c.json({ error: 'Invalid JSON body.', requestId: c.get('requestId') }, 400);
    }
    if (text(payload.source, '', 100) && text(payload.source, '', 100) !== 'my-assistant') {
      return c.json({ error: 'Unsupported integration source.', requestId: c.get('requestId') }, 400);
    }
    if (!payload.campaign || !text(payload.campaign.instruction, '', 1800)) {
      return c.json({ error: 'campaign.instruction is required.', requestId: c.get('requestId') }, 400);
    }

    const workspace = await resolveMyAssistantWorkspace(c.env, payload, c.req.raw);
    if ('error' in workspace) {
      return c.json({ error: workspace.error, requestId: c.get('requestId') }, workspace.status);
    }

    const eventType = text(payload.eventType, 'social_campaign_request', 80);
    const key = myAssistantFactKey(payload, eventType);
    const clientScope = workspace.clientId || '';
    const existingDraftPostIds = await readExistingDraftIds(c.env, workspace.ownerUserId, clientScope, key);
    const channel = text(payload.campaign.channel ?? payload.campaign.platform, 'facebook', 40).toLowerCase();
    const title = text(payload.campaign.title, 'My Assistant campaign', 160);
    const pillar = text(payload.campaign.pillar, 'Promotion', 160);
    const slots = campaignSlots(payload);
    const draftPostIds: string[] = [];
    const draftModes: Array<'created' | 'updated'> = [];

    for (let i = 0; i < slots.length; i += 1) {
      const draft = await upsertDraftPost(c.env, {
        ownerUserId: workspace.ownerUserId,
        clientId: workspace.clientId,
        existingDraftPostId: existingDraftPostIds[i],
        content: buildMyAssistantCampaignContent(payload, i, slots.length, slots[i]),
        channel,
        title,
        pillar,
        scheduledFor: slots[i],
      });
      draftPostIds.push(draft.draftPostId);
      draftModes.push(draft.draftMode);
    }

    const metadata = safeMyAssistantMetadata(payload, eventType, {
      draftPostIds,
      campaignRequestId: key,
      scheduleSlots: slots,
    });
    await replaceMyAssistantFact(c.env, {
      ownerUserId: workspace.ownerUserId,
      clientId: workspace.clientId,
      key,
      eventType,
      content: myAssistantFactContent(payload, eventType),
      metadata,
      engagementScore: 18,
    });

    return c.json({
      ok: true,
      configured: true,
      ownerUserId: workspace.ownerUserId,
      clientId: workspace.clientId,
      workspaceName: workspace.workspaceName,
      campaignRequestId: key,
      status: 'draft_requested',
      draftPostIds,
      draftModes,
      postCount: draftPostIds.length,
      factKey: key,
      requestId: c.get('requestId'),
    });
  });

  app.post('/api/integrations/my-assistant/social-replies', async (c) => {
    const secret = myAssistantAuthSecret(c.env);
    if (!secret) {
      return c.json({ error: 'My Assistant ingest is not configured.', requestId: c.get('requestId') }, 503);
    }

    const supplied = bearerToken(c.req.header('authorization') || null) || text(c.req.header('x-my-assistant-ingest-key'), '', 4000);
    if (!supplied || !timingSafeEqualStr(supplied, secret)) {
      return c.json({ error: 'unauthorized', requestId: c.get('requestId') }, 401);
    }

    const payload = await c.req.json<MyAssistantPayload>().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return c.json({ error: 'Invalid JSON body.', requestId: c.get('requestId') }, 400);
    }
    if (text(payload.source, '', 100) && text(payload.source, '', 100) !== 'my-assistant') {
      return c.json({ error: 'Unsupported integration source.', requestId: c.get('requestId') }, 400);
    }
    if (!payload.inbound || !text(payload.inbound.body, '', 1800)) {
      return c.json({ error: 'inbound.body is required.', requestId: c.get('requestId') }, 400);
    }

    const workspace = await resolveMyAssistantWorkspace(c.env, payload, c.req.raw);
    if ('error' in workspace) {
      return c.json({ error: workspace.error, requestId: c.get('requestId') }, workspace.status);
    }

    const eventType = text(payload.eventType, 'social_reply_request', 80);
    const key = myAssistantFactKey(payload, eventType);
    const replyDraftId = text(payload.idempotencyKey, '', 160) || uuid();
    const metadata = safeMyAssistantMetadata(payload, eventType, {
      replyDraftId,
      status: 'approval_required',
    });
    await replaceMyAssistantFact(c.env, {
      ownerUserId: workspace.ownerUserId,
      clientId: workspace.clientId,
      key,
      eventType,
      content: myAssistantFactContent(payload, eventType),
      metadata,
      engagementScore: 8,
    });

    return c.json({
      ok: true,
      configured: true,
      ownerUserId: workspace.ownerUserId,
      clientId: workspace.clientId,
      workspaceName: workspace.workspaceName,
      replyDraftId,
      status: 'approval_required',
      factKey: key,
      requestId: c.get('requestId'),
    });
  });
}
