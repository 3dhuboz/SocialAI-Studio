import type { Env } from '../../env';
import {
  loadForbiddenSubjects,
  loadForbiddenSubjectsForShop,
} from '../profile-guards';
import {
  normalizeWorkspaceIdentity,
  type WorkspaceOwnerKind,
} from './types';

interface CriticFact {
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
  clientId: string | null;
  factType: string;
  content: string;
  verifiedAt: string | null;
}

interface CriticRecentPost {
  id: string;
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
  clientId: string | null;
  content: string;
  platform: string | null;
}

export interface CriticContext {
  profile: Record<string, unknown>;
  verifiedFacts: CriticFact[];
  recentPosts: CriticRecentPost[];
  forbiddenSubjects: string[];
}

interface FactRow {
  client_id?: string | null;
  fact_type: string;
  content: string;
  verified_at?: string | null;
}

interface PostRow {
  id: string;
  client_id?: string | null;
  content: string;
  platform?: string | null;
}

function parseProfile(profile: string | null | undefined): Record<string, unknown> {
  if (!profile) return {};
  try {
    const parsed = JSON.parse(profile);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function loadCriticContext(
  env: Env,
  userId: string,
  clientId: string | null,
  ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client',
  ownerId: string = clientId ?? userId,
): Promise<CriticContext> {
  const identity = normalizeWorkspaceIdentity(userId, clientId, ownerKind, ownerId);

  if (identity.ownerKind === 'shop') {
    const shop = identity.ownerId;
    const profileRow = await env.DB
      .prepare(
        'SELECT profile FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL',
      )
      .bind(shop)
      .first<{ profile: string | null }>();
    const facts = await env.DB
      .prepare(
        `SELECT fact_type, content, verified_at
           FROM shopify_facts
          WHERE shop_domain = ?
          ORDER BY engagement_score DESC, verified_at DESC
          LIMIT 80`,
      )
      .bind(shop)
      .all<FactRow>();
    const posts = await env.DB
      .prepare(
        `SELECT id, content, platform
           FROM posts
          WHERE owner_kind = 'shop' AND owner_id = ?
          ORDER BY created_at DESC
          LIMIT 30`,
      )
      .bind(shop)
      .all<PostRow>();

    return {
      profile: parseProfile(profileRow?.profile),
      verifiedFacts: (facts.results ?? []).map((row) => ({
        ownerKind: 'shop',
        ownerId: shop,
        clientId: null,
        factType: row.fact_type,
        content: row.content,
        verifiedAt: row.verified_at ?? null,
      })),
      recentPosts: (posts.results ?? []).map((row) => ({
        id: row.id,
        ownerKind: 'shop',
        ownerId: shop,
        clientId: null,
        content: row.content,
        platform: row.platform ?? null,
      })),
      forbiddenSubjects: await loadForbiddenSubjectsForShop(env, shop),
    };
  }

  const profileRow = identity.clientId
    ? await env.DB
        .prepare('SELECT profile FROM clients WHERE id = ? AND user_id = ?')
        .bind(identity.clientId, identity.userId)
        .first<{ profile: string | null }>()
    : await env.DB
        .prepare('SELECT profile FROM users WHERE id = ?')
        .bind(identity.userId)
        .first<{ profile: string | null }>();

  if (!profileRow) throw new Error('Workspace profile not found');

  const scope = identity.clientId === null ? 'client_id IS NULL' : 'client_id = ?';
  const factsStatement = env.DB.prepare(
    `SELECT client_id, fact_type, content, verified_at
       FROM client_facts
      WHERE user_id = ? AND ${scope}
      ORDER BY verified_at DESC
      LIMIT 80`,
  );
  const postsStatement = env.DB.prepare(
    `SELECT id, client_id, content, platform
       FROM posts
      WHERE user_id = ? AND ${scope}
      ORDER BY created_at DESC
      LIMIT 30`,
  );
  const facts = identity.clientId === null
    ? await factsStatement.bind(identity.userId).all<FactRow>()
    : await factsStatement.bind(identity.userId, identity.clientId).all<FactRow>();
  const posts = identity.clientId === null
    ? await postsStatement.bind(identity.userId).all<PostRow>()
    : await postsStatement.bind(identity.userId, identity.clientId).all<PostRow>();

  return {
    profile: parseProfile(profileRow.profile),
    verifiedFacts: (facts.results ?? []).map((row) => ({
      ownerKind: identity.ownerKind,
      ownerId: identity.ownerId,
      clientId: row.client_id ?? null,
      factType: row.fact_type,
      content: row.content,
      verifiedAt: row.verified_at ?? null,
    })),
    recentPosts: (posts.results ?? []).map((row) => ({
      id: row.id,
      ownerKind: identity.ownerKind,
      ownerId: identity.ownerId,
      clientId: row.client_id ?? null,
      content: row.content,
      platform: row.platform ?? null,
    })),
    forbiddenSubjects: await loadForbiddenSubjects(
      env,
      identity.userId,
      identity.clientId,
    ),
  };
}
