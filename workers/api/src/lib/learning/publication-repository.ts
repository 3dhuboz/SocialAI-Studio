import {
  normalizeWorkspaceIdentity,
  type WorkspaceOwnerKind,
} from './types';

export type PublicationPlatform = 'facebook' | 'instagram';

export interface PublicationEventInput {
  userId: string;
  clientId: string | null;
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
  postId: string;
  platform: string;
  remotePostId: string | null;
  permalink: string | null;
  decisionId: string | null;
  reachPlanId: string | null;
  publishedAt: string;
}

export interface PersistedPublicationEvent {
  id: string;
  userId: string;
  clientId: string | null;
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
  workspaceKey: string;
  postId: string;
  platform: PublicationPlatform;
  remotePostId: string | null;
  permalink: string | null;
  decisionId: string | null;
  reachPlanId: string | null;
  publishedAt: string;
}

type PublishedPostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind;
  owner_id: string;
  platform: string | null;
  remote_post_id: string | null;
  permalink: string | null;
  decision_id: string | null;
  reach_plan_id: string | null;
  published_at: string;
};

export function normalizePublicationPlatform(value: string): PublicationPlatform {
  const platform = value.trim().toLowerCase();
  if (platform === 'facebook' || platform === 'fb') return 'facebook';
  if (platform === 'instagram' || platform === 'ig') return 'instagram';
  throw new Error(`Unsupported publication platform: ${value}`);
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Publication ${label} is required`);
  return normalized;
}

function requireTimestamp(value: string): string {
  const timestamp = value.trim();
  const naiveAest = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(timestamp);
  const parsed = new Date(naiveAest ? `${timestamp}+10:00` : timestamp);
  if (!timestamp || !Number.isFinite(parsed.getTime())) {
    throw new Error('Publication publishedAt must be a valid timestamp');
  }
  return parsed.toISOString();
}

export async function recordPublicationEvent(
  db: D1Database,
  input: PublicationEventInput,
): Promise<void> {
  const identity = normalizeWorkspaceIdentity(
    input.userId,
    input.clientId,
    input.ownerKind,
    input.ownerId,
  );
  const postId = requireNonEmpty(input.postId, 'postId');
  const platform = normalizePublicationPlatform(input.platform);
  const publishedAt = requireTimestamp(input.publishedAt);

  await db.prepare(`
    INSERT INTO publication_events (
      id, user_id, workspace_key, client_id, owner_kind, owner_id,
      post_id, platform, remote_post_id, permalink, decision_id,
      reach_plan_id, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id,workspace_key,post_id,platform) DO UPDATE SET
      remote_post_id = COALESCE(excluded.remote_post_id, publication_events.remote_post_id),
      permalink = COALESCE(excluded.permalink, publication_events.permalink),
      decision_id = COALESCE(excluded.decision_id, publication_events.decision_id),
      reach_plan_id = COALESCE(excluded.reach_plan_id, publication_events.reach_plan_id)
  `).bind(
    crypto.randomUUID(),
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    postId,
    platform,
    input.remotePostId,
    input.permalink,
    input.decisionId,
    input.reachPlanId,
    publishedAt,
  ).run();
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(250, Math.floor(value as number)));
}

export async function reconcilePublishedPosts(
  db: D1Database,
  limit?: number,
): Promise<number> {
  const result = await db.prepare(`
    SELECT
      p.id,
      TRIM(p.user_id) AS user_id,
      p.client_id,
      COALESCE(
        p.owner_kind,
        CASE WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
      ) AS owner_kind,
      COALESCE(p.owner_id, p.client_id, p.user_id) AS owner_id,
      CASE
        WHEN LOWER(TRIM(COALESCE(p.platform, 'facebook'))) IN ('instagram', 'ig')
          THEN 'instagram'
        ELSE 'facebook'
      END AS platform,
      CASE
        WHEN LOWER(TRIM(COALESCE(p.platform, 'facebook'))) IN ('instagram', 'ig')
          THEN COALESCE(p.postproxy_post_id, p.late_post_id)
        ELSE COALESCE(p.fb_video_id, p.postproxy_post_id, p.late_post_id)
      END AS remote_post_id,
      p.postproxy_permalink AS permalink,
      (
        SELECT d.id
        FROM learning_decisions d
        WHERE d.user_id = TRIM(p.user_id)
          AND d.workspace_key = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop'
              THEN 'shop:' || LOWER(TRIM(COALESCE(p.owner_id, p.user_id)))
            WHEN COALESCE(p.owner_kind, '') = 'client' OR p.client_id IS NOT NULL
              THEN TRIM(COALESCE(p.client_id, p.owner_id))
            ELSE '__owner__'
          END
          AND d.owner_kind = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop' THEN 'shop'
            WHEN COALESCE(p.owner_kind, '') = 'client' OR p.client_id IS NOT NULL THEN 'client'
            ELSE 'user'
          END
          AND d.owner_id = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop'
              THEN LOWER(TRIM(COALESCE(p.owner_id, p.user_id)))
            WHEN COALESCE(p.owner_kind, '') = 'client' OR p.client_id IS NOT NULL
              THEN TRIM(COALESCE(p.client_id, p.owner_id))
            ELSE TRIM(p.user_id)
          END
          AND d.post_id = p.id
          AND d.stage = 'release'
        ORDER BY d.updated_at DESC
        LIMIT 1
      ) AS decision_id,
      (
        SELECT rp.id
        FROM reach_plans rp
        WHERE rp.user_id = TRIM(p.user_id)
          AND rp.workspace_key = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop'
              THEN 'shop:' || LOWER(TRIM(COALESCE(p.owner_id, p.user_id)))
            WHEN COALESCE(p.owner_kind, '') = 'client' OR p.client_id IS NOT NULL
              THEN TRIM(COALESCE(p.client_id, p.owner_id))
            ELSE '__owner__'
          END
          AND rp.owner_kind = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop' THEN 'shop'
            WHEN COALESCE(p.owner_kind, '') = 'client' OR p.client_id IS NOT NULL THEN 'client'
            ELSE 'user'
          END
          AND rp.owner_id = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop'
              THEN LOWER(TRIM(COALESCE(p.owner_id, p.user_id)))
            WHEN COALESCE(p.owner_kind, '') = 'client' OR p.client_id IS NOT NULL
              THEN TRIM(COALESCE(p.client_id, p.owner_id))
            ELSE TRIM(p.user_id)
          END
          AND rp.post_id = p.id
          AND rp.status IN ('selected', 'shadow')
        ORDER BY CASE rp.status WHEN 'selected' THEN 0 ELSE 1 END, rp.created_at DESC
        LIMIT 1
      ) AS reach_plan_id,
      COALESCE(
        NULLIF(p.postproxy_finished_at, ''),
        NULLIF(p.fb_finished_at, ''),
        NULLIF(p.scheduled_for, ''),
        p.created_at
      ) AS published_at
    FROM posts p
    LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = TRIM(p.user_id)
    WHERE p.status IN ('Published', 'Posted')
      AND (
        p.client_id IS NULL
        OR (c.id IS NOT NULL AND COALESCE(c.status, 'active') != 'on_hold')
      )
      AND COALESCE(
        NULLIF(p.postproxy_finished_at, ''),
        NULLIF(p.fb_finished_at, ''),
        NULLIF(p.scheduled_for, ''),
        p.created_at
      ) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM publication_events pe
        WHERE pe.user_id = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop' THEN LOWER(TRIM(p.user_id))
            ELSE TRIM(p.user_id)
          END
          AND pe.workspace_key = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop'
              THEN 'shop:' || LOWER(TRIM(COALESCE(p.owner_id, p.user_id)))
            WHEN COALESCE(p.owner_kind, '') = 'client' OR p.client_id IS NOT NULL
              THEN TRIM(COALESCE(p.client_id, p.owner_id))
            ELSE '__owner__'
          END
          AND pe.owner_kind = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop' THEN 'shop'
            WHEN COALESCE(p.owner_kind, '') = 'client' OR p.client_id IS NOT NULL THEN 'client'
            ELSE 'user'
          END
          AND pe.owner_id = CASE
            WHEN COALESCE(p.owner_kind, '') = 'shop'
              THEN LOWER(TRIM(COALESCE(p.owner_id, p.user_id)))
            WHEN COALESCE(p.owner_kind, '') = 'client' OR p.client_id IS NOT NULL
              THEN TRIM(COALESCE(p.client_id, p.owner_id))
            ELSE TRIM(p.user_id)
          END
          AND pe.post_id = p.id
          AND pe.platform = CASE
            WHEN LOWER(TRIM(COALESCE(p.platform, 'facebook'))) IN ('instagram', 'ig')
              THEN 'instagram'
            ELSE 'facebook'
          END
      )
    ORDER BY published_at ASC, p.id ASC
    LIMIT ?
  `).bind(boundedLimit(limit)).all<PublishedPostRow>();

  let reconciled = 0;
  for (const row of result.results ?? []) {
    try {
      await recordPublicationEvent(db, {
        userId: row.user_id,
        clientId: row.client_id,
        ownerKind: row.owner_kind,
        ownerId: row.owner_id,
        postId: row.id,
        platform: row.platform ?? 'facebook',
        remotePostId: row.remote_post_id,
        permalink: row.permalink,
        decisionId: row.decision_id,
        reachPlanId: row.reach_plan_id,
        publishedAt: row.published_at,
      });
      reconciled += 1;
    } catch (error) {
      console.warn(
        `[CRON learning_outcomes] publication reconciliation skipped ${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return reconciled;
}
