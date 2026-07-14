import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { makeRecordingD1 } from './helpers/recording-d1';
import {
  chooseFormat,
  chooseMediaDirection,
} from '../lib/reach/media-director';
import {
  assertSingleExperimentChange,
  buildPlatformTreatments,
  buildReachPlan,
  type ReachPlanBrief,
} from '../lib/reach/reach-plan';
import type {
  ApprovedMediaAsset,
  MediaDirectorInput,
  ReachProfile,
} from '../lib/reach/types';

const asset = (patch: Partial<ApprovedMediaAsset> = {}): ApprovedMediaAsset => ({
  id: 'brisket-1',
  assetType: 'image',
  url: 'https://example.com/brisket.jpg',
  tags: ['brisket', 'gladstone'],
  rightsStatus: 'confirmed',
  ...patch,
});
const mediaInput: MediaDirectorInput = {
  assets: [asset()],
  requiredTags: ['brisket', 'gladstone'],
  objective: 'local_order',
  platform: 'facebook',
  history: [],
};
const profile: ReachProfile = {
  id: 'reach_1', userId: 'owner_1', clientId: null,
  workspaceKey: '__owner__', ownerKind: 'user', ownerId: 'owner_1',
  version: 2, confirmationStatus: 'confirmed', timezone: 'Australia/Brisbane',
  baseLocation: { country: 'Australia', region: 'Queensland', locality: 'Gladstone' },
  serviceArea: { radiusKm: 40, included: ['Gladstone', 'Boyne Island'] },
  excludedLocations: ['Rockhampton'], platforms: ['facebook', 'instagram'],
};
const brief: ReachPlanBrief = {
  postId: 'post_1',
  platform: 'facebook',
  objective: 'local_order',
  geographicFocus: ['Gladstone'],
  facebookCaption: 'Book locally',
  instagramCaption: 'Fresh today',
  requiredMediaTags: ['brisket', 'gladstone'],
  imagePrompt: 'Fresh sliced brisket served in Gladstone',
  timingEvidence: [],
  fallbackWindows: [{
    weekday: 5, startHour: 17, endHour: 19,
    platform: 'facebook', mediaType: 'image', expectedScore: 50,
    confidence: 0.25, sampleSize: 0, source: 'archetype',
  }],
  hashtagCandidates: [],
  categoryTerms: ['BBQ'],
  brandTerms: ['Probe BBQ'],
  forbiddenHashtagTerms: [],
  mediaHistory: [],
};

describe('media director', () => {
  it('prefers a fully matching rights-confirmed real asset', () => {
    expect(chooseMediaDirection(mediaInput)).toMatchObject({
      source: 'approved_asset', assetId: 'brisket-1', generate: false,
    });
  });

  it('never selects a blocked or only-partially-related asset', () => {
    const blocked = chooseMediaDirection({
      ...mediaInput,
      assets: [asset({ rightsStatus: 'blocked' })],
    });
    const unrelated = chooseMediaDirection({
      ...mediaInput,
      assets: [asset({ tags: ['brisket'] })],
    });
    expect(blocked.source).toBe('generated');
    expect(unrelated.source).toBe('generated');
  });

  it('requests generation only when no approved asset fully matches', () => {
    expect(chooseMediaDirection({ ...mediaInput, assets: [] }).generate).toBe(true);
    expect(chooseMediaDirection(mediaInput).generate).toBe(false);
  });

  it('never chooses a Facebook format from Instagram-only evidence', () => {
    const history = Array.from({ length: 5 }, () => ({
      format: 'video' as const,
      platform: 'instagram' as const,
      objective: 'local_order',
      score: 100,
    }));
    expect(chooseFormat('local_order', 'facebook', history)).toBe('image');
  });
});

describe('reach plan determinism', () => {
  it('creates Facebook and Instagram treatments separately', () => {
    const treatments = buildPlatformTreatments({
      facebookCaption: 'Book locally',
      instagramCaption: 'Fresh today',
      facebookTags: ['#GladstoneBBQ'],
      instagramTags: ['#GladstoneBBQ', '#LowAndSlow'],
    });
    expect(treatments.facebook.caption).not.toBe(treatments.instagram.caption);
    expect(treatments.facebook.hashtags).toHaveLength(1);
    expect(treatments.instagram.hashtags).toHaveLength(2);
  });

  it('rejects experiments that change more than one variable', () => {
    expect(() => assertSingleExperimentChange(
      { hour: 17, format: 'image' },
      { hour: 18, format: 'video' },
    )).toThrow();
    expect(() => assertSingleExperimentChange(
      { hour: 17, format: 'image' },
      { hour: 18, format: 'image' },
    )).not.toThrow();
  });
});

describe('reach plan orchestration', () => {
  it('persists shadow rationale without generating or applying media', async () => {
    const { db, calls } = makeRecordingD1();
    const generateMedia = vi.fn();
    const preflightMedia = vi.fn();
    const env = {
      DB: db,
      OPENROUTER_API_KEY: 'test',
      ORGANIC_REACH_ENABLED: 'true',
      ORGANIC_REACH_APPLY_ENABLED: 'false',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
    } as Env;

    const plan = await buildReachPlan(env, {
      userId: 'owner_1', clientId: null,
      ownerKind: 'user', ownerId: 'owner_1',
    }, brief, {
      getProfile: async () => ({ ...profile, confirmationStatus: 'proposed' }),
      listAssets: async () => [],
      loadSegment: async () => ({ id: 'segment_1', status: 'predicted' }),
      generateMedia,
      preflightMedia,
      randomId: () => 'plan_1',
    });

    expect(plan.status).toBe('shadow');
    expect(generateMedia).not.toHaveBeenCalled();
    expect(preflightMedia).not.toHaveBeenCalled();
    expect(calls.some((call) => call.sql.includes('INSERT INTO reach_plans'))).toBe(true);
  });

  it('requires critic enforcement before apply mode can generate media', async () => {
    const { db } = makeRecordingD1();
    const env = {
      DB: db,
      OPENROUTER_API_KEY: 'test',
      ORGANIC_REACH_ENABLED: 'true',
      ORGANIC_REACH_APPLY_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'false',
    } as Env;

    await expect(buildReachPlan(env, {
      userId: 'owner_1', clientId: null,
      ownerKind: 'user', ownerId: 'owner_1',
    }, brief, {
      getProfile: async () => profile,
      listAssets: async () => [],
      loadSegment: async () => ({ id: 'segment_1', status: 'confirmed' }),
      generateMedia: vi.fn(),
      preflightMedia: vi.fn(),
      randomId: () => 'plan_1',
    })).rejects.toThrow('critic enforcement');
  });

  it('runs generated apply media through guardrails and critic preflight', async () => {
    const { db } = makeRecordingD1();
    const generateMedia = vi.fn(async () => 'https://example.com/generated.jpg');
    const preflightMedia = vi.fn(async () => ({
      mode: 'protected_autopilot' as const,
      state: 'pass_green' as const,
      mayPublish: true,
      mustHold: false,
      decisionId: 'decision_1',
    }));
    const env = {
      DB: db,
      OPENROUTER_API_KEY: 'test',
      ORGANIC_REACH_ENABLED: 'true',
      ORGANIC_REACH_APPLY_ENABLED: 'true',
      LEARNING_RELEASE_ENFORCEMENT: 'true',
    } as Env;

    const plan = await buildReachPlan(env, {
      userId: 'owner_1', clientId: null,
      ownerKind: 'user', ownerId: 'owner_1',
    }, brief, {
      getProfile: async () => profile,
      listAssets: async () => [],
      loadSegment: async () => ({ id: 'segment_1', status: 'confirmed' }),
      generateMedia,
      preflightMedia,
      randomId: () => 'plan_1',
    });

    expect(plan.status).toBe('selected');
    expect(generateMedia).toHaveBeenCalledTimes(1);
    expect(preflightMedia).toHaveBeenCalledTimes(1);
    expect(plan.media.generatedUrl).toBe('https://example.com/generated.jpg');
  });

  it('rejects an out-of-area geographic focus', async () => {
    const { db } = makeRecordingD1();
    const env = {
      DB: db, OPENROUTER_API_KEY: 'test', ORGANIC_REACH_ENABLED: 'true',
      ORGANIC_REACH_APPLY_ENABLED: 'false',
    } as Env;
    await expect(buildReachPlan(env, {
      userId: 'owner_1', clientId: null,
      ownerKind: 'user', ownerId: 'owner_1',
    }, { ...brief, geographicFocus: ['Rockhampton'] }, {
      getProfile: async () => profile,
      listAssets: async () => [],
      loadSegment: async () => null,
      generateMedia: vi.fn(),
      preflightMedia: vi.fn(),
      randomId: () => 'plan_1',
    })).rejects.toThrow('outside');
  });
});
