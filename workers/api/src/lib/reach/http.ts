import { normalizeWorkspaceIdentity } from '../learning/types';
import type {
  OrganicPlatform,
  ReachProfileDraft,
  ReachWorkspaceScope,
} from './types';

type ReachPlanRow = Record<string, unknown> & {
  id: string;
  post_id: string;
  reach_profile_id?: string | null;
  reach_profile_version?: number | null;
  objective?: string | null;
  audience_segment_id?: string | null;
  status: string;
  created_at?: string | null;
  geographic_focus_json?: string | null;
  platform_plan_json?: string | null;
  timing_json?: string | null;
  language_json?: string | null;
  hashtag_json?: string | null;
  media_json?: string | null;
  experiment_json?: string | null;
};

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function readReachProfileDraft(value: unknown): ReachProfileDraft {
  const body = requireObject(value, 'Request body');
  const baseLocation = requireObject(body.baseLocation, 'baseLocation');
  const serviceArea = requireObject(body.serviceArea, 'serviceArea');
  const included = optionalStringArray(serviceArea.included, 'serviceArea.included');
  if (!included?.length) throw new Error('serviceArea.included is required');

  const radius = serviceArea.radiusKm;
  if (radius !== null && (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0)) {
    throw new Error('serviceArea.radiusKm must be a positive number or null');
  }

  const platforms = body.platforms === undefined
    ? undefined
    : optionalStringArray(body.platforms, 'platforms');
  if (platforms?.some((platform) => platform !== 'facebook' && platform !== 'instagram')) {
    throw new Error('platforms contains an unsupported platform');
  }

  const cadence = body.cadence === undefined
    ? undefined
    : requireObject(body.cadence, 'cadence');

  return {
    timezone: requireString(body.timezone, 'timezone'),
    baseLocation: {
      country: requireString(baseLocation.country, 'baseLocation.country'),
      region: requireString(baseLocation.region, 'baseLocation.region'),
      locality: requireString(baseLocation.locality, 'baseLocation.locality'),
    },
    serviceArea: {
      radiusKm: radius as number | null,
      included,
    },
    excludedLocations: optionalStringArray(
      body.excludedLocations,
      'excludedLocations',
    ),
    platforms: platforms as OrganicPlatform[] | undefined,
    cadence,
  };
}

export function reachScope(
  userId: string,
  clientId: string | null,
): ReachWorkspaceScope {
  return clientId
    ? { userId, clientId, ownerKind: 'client', ownerId: clientId }
    : { userId, clientId: null, ownerKind: 'user', ownerId: userId };
}

export function shopReachScope(shopDomain: string): ReachWorkspaceScope {
  const shop = shopDomain.trim().toLowerCase();
  return { userId: shop, clientId: null, ownerKind: 'shop', ownerId: shop };
}

export function reachWorkspaceKey(scope: ReachWorkspaceScope): string {
  return normalizeWorkspaceIdentity(
    scope.userId,
    scope.clientId,
    scope.ownerKind,
    scope.ownerId,
  ).workspaceKey;
}

export async function confirmAudienceSegment(
  db: D1Database,
  scope: ReachWorkspaceScope,
  reachProfileId: string,
  segmentId: string,
): Promise<void> {
  const result = await db.prepare(`
    UPDATE audience_segments
    SET status = 'confirmed', updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND workspace_key = ?
      AND reach_profile_id = ? AND status = 'predicted'
  `).bind(
    segmentId,
    scope.userId,
    reachWorkspaceKey(scope),
    reachProfileId,
  ).run();

  if (typeof result.meta?.changes === 'number' && result.meta.changes !== 1) {
    throw new Error('Audience segment not found');
  }
}

export async function listReachPlans(
  db: D1Database,
  userId: string,
  workspaceKey: string,
  postId: string,
): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(`
    SELECT * FROM reach_plans
    WHERE user_id = ? AND workspace_key = ? AND post_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(userId, workspaceKey, postId).all<ReachPlanRow>();

  return (result.results ?? []).map((row) => {
    return {
      id: row.id,
      postId: row.post_id,
      reachProfileId: row.reach_profile_id ?? null,
      reachProfileVersion: row.reach_profile_version ?? null,
      objective: row.objective ?? null,
      audienceSegmentId: row.audience_segment_id ?? null,
      status: row.status,
      createdAt: row.created_at ?? null,
      geographicFocus: parseJson<string[]>(row.geographic_focus_json, []),
      platformPlan: parseJson<Record<string, unknown>>(row.platform_plan_json, {}),
      timing: parseJson<unknown[]>(row.timing_json, []),
      language: parseJson<Record<string, unknown>>(row.language_json, {}),
      hashtags: parseJson<Record<string, unknown>>(row.hashtag_json, {}),
      media: parseJson<Record<string, unknown>>(row.media_json, {}),
      experiment: parseJson<Record<string, unknown>>(row.experiment_json, {}),
    };
  });
}
