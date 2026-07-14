import {
  normalizeWorkspaceIdentity,
  type WorkspaceIdentity,
} from '../learning/types';
import type {
  ApprovedMediaAsset,
  OrganicPlatform,
  ReachProfile,
  ReachProfileDraft,
  ReachWorkspaceScope,
} from './types';

type ReachProfileRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  workspace_key: string;
  owner_kind: ReachProfile['ownerKind'];
  owner_id: string;
  version: number;
  latest_version?: number | null;
  confirmation_status: ReachProfile['confirmationStatus'];
  timezone: string;
  base_location_json: string;
  service_area_json: string;
  excluded_locations_json: string;
  platforms_json: string;
  cadence_json?: string | null;
  confirmed_at?: string | null;
};

type MediaAssetRow = {
  id: string;
  asset_type: ApprovedMediaAsset['assetType'];
  url: string;
  tags_json: string;
  rights_status: ApprovedMediaAsset['rightsStatus'];
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function identityFor(scope: ReachWorkspaceScope): WorkspaceIdentity {
  return normalizeWorkspaceIdentity(
    scope.userId,
    scope.clientId,
    scope.ownerKind,
    scope.ownerId,
  );
}

async function assertWorkspaceAccess(
  db: D1Database,
  identity: WorkspaceIdentity,
): Promise<void> {
  if (identity.ownerKind === 'client') {
    const client = await db.prepare(
      'SELECT id FROM clients WHERE id = ? AND user_id = ?',
    ).bind(identity.ownerId, identity.userId).first<{ id: string }>();
    if (!client) throw new Error('Client workspace not found');
    return;
  }

  if (identity.ownerKind === 'shop') {
    const shop = await db.prepare(
      `SELECT shop_domain FROM shopify_stores
       WHERE shop_domain = ? AND uninstalled_at IS NULL`,
    ).bind(identity.ownerId).first<{ shop_domain: string }>();
    if (!shop) throw new Error('Shop workspace not installed');
    return;
  }

  const user = await db.prepare(
    'SELECT id FROM users WHERE id = ?',
  ).bind(identity.userId).first<{ id: string }>();
  if (!user) throw new Error('Owner workspace not found');
}

function mapReachProfile(row: ReachProfileRow): ReachProfile {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    workspaceKey: row.workspace_key,
    ownerKind: row.owner_kind,
    ownerId: row.owner_id,
    version: Number(row.version),
    confirmationStatus: row.confirmation_status,
    timezone: row.timezone,
    baseLocation: parseJson(row.base_location_json, {
      country: '', region: '', locality: '',
    }),
    serviceArea: parseJson(row.service_area_json, {
      radiusKm: null, included: [],
    }),
    excludedLocations: parseJson<string[]>(row.excluded_locations_json, []),
    platforms: parseJson<OrganicPlatform[]>(row.platforms_json, []),
    cadence: parseJson<Record<string, unknown>>(row.cadence_json, {}),
    confirmedAt: row.confirmed_at ?? null,
  };
}

export async function getLatestReachProfile(
  db: D1Database,
  scope: ReachWorkspaceScope,
): Promise<ReachProfile | null> {
  const identity = identityFor(scope);
  await assertWorkspaceAccess(db, identity);
  const row = await db.prepare(`
    SELECT * FROM reach_profiles
    WHERE user_id = ? AND workspace_key = ?
      AND owner_kind = ? AND owner_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.ownerKind,
    identity.ownerId,
  ).first<ReachProfileRow>();
  return row ? mapReachProfile(row) : null;
}

export async function proposeReachProfile(
  db: D1Database,
  scope: ReachWorkspaceScope,
  draft: ReachProfileDraft,
): Promise<ReachProfile> {
  const identity = identityFor(scope);
  await assertWorkspaceAccess(db, identity);
  new Intl.DateTimeFormat('en-AU', { timeZone: draft.timezone }).format(new Date());
  const latest = await db.prepare(`
    SELECT COALESCE(MAX(version), 0) AS version
    FROM reach_profiles
    WHERE user_id = ? AND workspace_key = ?
  `).bind(identity.userId, identity.workspaceKey).first<{ version: number }>();
  const profile: ReachProfile = {
    id: crypto.randomUUID(),
    ...identity,
    version: Number(latest?.version ?? 0) + 1,
    confirmationStatus: 'proposed',
    timezone: draft.timezone,
    baseLocation: draft.baseLocation,
    serviceArea: draft.serviceArea,
    excludedLocations: draft.excludedLocations ?? [],
    platforms: draft.platforms ?? ['facebook', 'instagram'],
    cadence: draft.cadence ?? {},
    confirmedAt: null,
  };
  await insertProfile(db, profile);
  return profile;
}

export async function confirmReachProfile(
  db: D1Database,
  scope: ReachWorkspaceScope,
  profileId: string,
  confirmedAt: string = new Date().toISOString(),
): Promise<ReachProfile> {
  const identity = identityFor(scope);
  await assertWorkspaceAccess(db, identity);
  const row = await db.prepare(`
    SELECT rp.*,
      (SELECT COALESCE(MAX(version), 0) FROM reach_profiles
       WHERE user_id = ? AND workspace_key = ?) AS latest_version
    FROM reach_profiles rp
    WHERE rp.user_id = ? AND rp.workspace_key = ?
      AND rp.owner_kind = ? AND rp.owner_id = ? AND rp.id = ?
    LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.userId,
    identity.workspaceKey,
    identity.ownerKind,
    identity.ownerId,
    profileId,
  ).first<ReachProfileRow>();
  if (!row) throw new Error('Reach profile not found');

  const source = mapReachProfile(row);
  const confirmed: ReachProfile = {
    ...source,
    id: crypto.randomUUID(),
    version: Number(row.latest_version ?? source.version) + 1,
    confirmationStatus: 'confirmed',
    confirmedAt,
  };
  await insertProfile(db, confirmed);
  return confirmed;
}

export async function listApprovedAssets(
  db: D1Database,
  scope: ReachWorkspaceScope,
): Promise<ApprovedMediaAsset[]> {
  const identity = identityFor(scope);
  await assertWorkspaceAccess(db, identity);
  const result = await db.prepare(`
    SELECT id, asset_type, url, tags_json, rights_status
    FROM approved_media_assets
    WHERE user_id = ? AND workspace_key = ?
      AND owner_kind = ? AND owner_id = ?
      AND rights_status = 'confirmed'
    ORDER BY created_at DESC
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.ownerKind,
    identity.ownerId,
  ).all<MediaAssetRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    assetType: row.asset_type,
    url: row.url,
    tags: parseJson<string[]>(row.tags_json, []),
    rightsStatus: row.rights_status,
  }));
}

async function insertProfile(db: D1Database, profile: ReachProfile): Promise<void> {
  await db.prepare(`
    INSERT INTO reach_profiles (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,version,
      confirmation_status,timezone,base_location_json,service_area_json,
      excluded_locations_json,platforms_json,cadence_json,confirmed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    profile.id,
    profile.userId,
    profile.workspaceKey,
    profile.clientId,
    profile.ownerKind,
    profile.ownerId,
    profile.version,
    profile.confirmationStatus,
    profile.timezone,
    JSON.stringify(profile.baseLocation),
    JSON.stringify(profile.serviceArea),
    JSON.stringify(profile.excludedLocations),
    JSON.stringify(profile.platforms),
    JSON.stringify(profile.cadence ?? {}),
    profile.confirmedAt ?? null,
  ).run();
}
