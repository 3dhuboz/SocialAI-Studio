import type { WorkspaceOwnerKind } from '../learning/types';

export type OrganicPlatform = 'facebook' | 'instagram';
export type ReachConfirmation = 'proposed' | 'confirmed';

export interface ReachProfile {
  id: string;
  userId: string;
  clientId: string | null;
  workspaceKey: string;
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
  version: number;
  confirmationStatus: ReachConfirmation;
  timezone: string;
  baseLocation: { country: string; region: string; locality: string };
  serviceArea: { radiusKm: number | null; included: string[] };
  excludedLocations: string[];
  platforms: OrganicPlatform[];
  cadence?: Record<string, unknown>;
  confirmedAt?: string | null;
}

export interface ReachWorkspaceScope {
  userId: string;
  clientId: string | null;
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
}

export interface ReachProfileDraft {
  timezone: string;
  baseLocation: ReachProfile['baseLocation'];
  serviceArea: ReachProfile['serviceArea'];
  excludedLocations?: string[];
  platforms?: OrganicPlatform[];
  cadence?: Record<string, unknown>;
}

export interface ApprovedMediaAsset {
  id: string;
  assetType: 'image' | 'video' | 'poster' | 'carousel';
  url: string;
  tags: string[];
  rightsStatus: 'confirmed' | 'blocked';
}

export interface MediaDirectorInput {
  assets: ApprovedMediaAsset[];
  requiredTags: string[];
  objective: string;
  platform: OrganicPlatform;
  history: Array<{
    format: ApprovedMediaAsset['assetType'];
    platform: OrganicPlatform;
    objective: string;
    score: number;
  }>;
}

export interface MediaDirection {
  source: 'approved_asset' | 'generated';
  assetId: string | null;
  format: ApprovedMediaAsset['assetType'];
  generate: boolean;
}

export function assertConfirmedReachProfile(profile: ReachProfile): void {
  if (profile.confirmationStatus !== 'confirmed') {
    throw new Error('Reach profile is not confirmed');
  }
  if (!profile.timezone.trim() || profile.serviceArea.included.length === 0) {
    throw new Error('Reach profile is incomplete');
  }
  new Intl.DateTimeFormat('en-AU', { timeZone: profile.timezone })
    .format(new Date());
}
