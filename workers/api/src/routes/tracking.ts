import type { Hono } from 'hono';
import type { Env } from '../env';
import {
  normalizeWorkspaceIdentity,
  type WorkspaceIdentity,
} from '../lib/learning/types';

const CODE_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_CODE_ATTEMPTS = 8;
const BOT_USER_AGENT = /bot|crawler|spider|slurp|facebookexternalhit|whatsapp|preview|headless|monitor/i;

export interface CreateTrackingLinkInput {
  identity: WorkspaceIdentity;
  postId: string;
  destinationUrl: string;
  expiresAt: string | null;
}

export interface CreateTrackingLinkDeps {
  randomCode(): string;
  now(): string;
}

export interface CreatedTrackingLink {
  code: string;
  destinationUrl: string;
  expiresAt: string | null;
}

type TrackingLinkRow = {
  code: string;
  destination_url: string;
};

function randomCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

const defaultDeps: CreateTrackingLinkDeps = {
  randomCode,
  now: () => new Date().toISOString(),
};

export function normalizeHttpsDestination(value: string): string {
  let destination: URL;
  try {
    destination = new URL(value.trim());
  } catch {
    throw new Error('Tracking destination must be a valid URL');
  }
  if (destination.protocol !== 'https:') {
    throw new Error('Tracking destination must use https');
  }
  if (destination.username || destination.password) {
    throw new Error('Tracking destination must not contain credentials');
  }
  return destination.toString();
}

function canonicalExpiry(value: string | null, now: string): string | null {
  if (value === null) return null;
  const expires = Date.parse(value);
  const current = Date.parse(now);
  if (!Number.isFinite(expires) || !Number.isFinite(current) || expires <= current) {
    throw new Error('Tracking link expiry must be a future timestamp');
  }
  return new Date(expires).toISOString();
}

function insertedRows(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  const meta = (result as { meta?: { changes?: unknown } }).meta;
  return typeof meta?.changes === 'number' && Number.isFinite(meta.changes)
    ? meta.changes
    : 0;
}

export async function createTrackingLink(
  db: D1Database,
  input: CreateTrackingLinkInput,
  deps: CreateTrackingLinkDeps = defaultDeps,
): Promise<CreatedTrackingLink> {
  const identity = normalizeWorkspaceIdentity(
    input.identity.userId,
    input.identity.clientId,
    input.identity.ownerKind,
    input.identity.ownerId,
  );
  if (identity.workspaceKey !== input.identity.workspaceKey) {
    throw new Error('Tracking link identity must be canonical');
  }
  const postId = input.postId.trim();
  if (!postId) throw new Error('Tracking link postId is required');
  const destinationUrl = normalizeHttpsDestination(input.destinationUrl);
  const createdAt = deps.now();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Tracking timestamp is invalid');
  const expiresAt = canonicalExpiry(input.expiresAt, createdAt);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = deps.randomCode();
    if (!CODE_PATTERN.test(code)) throw new Error('Generated tracking code is invalid');
    const result = await db.prepare(`
      INSERT OR IGNORE INTO tracking_links (
        code,user_id,workspace_key,client_id,owner_kind,owner_id,post_id,
        destination_url,click_count,created_at,expires_at
      ) VALUES (?,?,?,?,?,?,?,?,0,?,?)
    `).bind(
      code,
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      postId,
      destinationUrl,
      createdAt,
      expiresAt,
    ).run();
    if (insertedRows(result) > 0) return { code, destinationUrl, expiresAt };
  }
  throw new Error('Could not allocate a unique tracking code');
}

function isHumanRequest(userAgent: string | undefined): boolean {
  return Boolean(userAgent?.trim()) && !BOT_USER_AGENT.test(userAgent ?? '');
}

export function registerTrackingRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/r/:code', async (c) => {
    const code = c.req.param('code');
    if (!CODE_PATTERN.test(code)) return c.json({ error: 'Not found' }, 404);
    const now = new Date().toISOString();
    const link = await c.env.DB.prepare(`
      SELECT code, destination_url
      FROM tracking_links
      WHERE code = ?
        AND (expires_at IS NULL OR datetime(expires_at) > datetime(?))
      LIMIT 1
    `).bind(code, now).first<TrackingLinkRow>();
    if (!link) return c.json({ error: 'Not found' }, 404);

    let destination: string;
    try {
      destination = normalizeHttpsDestination(link.destination_url);
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
    if (isHumanRequest(c.req.header('User-Agent'))) {
      await c.env.DB.prepare(`
        UPDATE tracking_links
        SET click_count = click_count + 1
        WHERE code = ?
      `).bind(code).run();
    }
    return c.redirect(destination, 302);
  });
}
