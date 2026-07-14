import type { Env } from '../../env';
import { generateImageWithGuardrails } from '../image-gen';
import { buildSafeImagePrompt } from '../image-safety';
import {
  evaluateReleasePreflight,
  type PreflightDecision,
  type PublishablePost,
} from '../learning/release-preflight';
import { normalizeWorkspaceIdentity } from '../learning/types';
import { buildHashtagPlan, type HashtagCandidate, type HashtagPlan } from './hashtag-model';
import { chooseMediaDirection } from './media-director';
import {
  getLatestReachProfile,
  listApprovedAssets,
} from './reach-profile';
import {
  rankPostingWindows,
  type RankedWindow,
  type TimingEvidence,
} from './timing-model';
import {
  assertConfirmedReachProfile,
  type ApprovedMediaAsset,
  type MediaDirection,
  type MediaDirectorInput,
  type OrganicPlatform,
  type ReachProfile,
  type ReachWorkspaceScope,
} from './types';

export interface ReachPlanBrief {
  postId: string;
  platform: OrganicPlatform;
  objective: string;
  geographicFocus: string[];
  facebookCaption: string;
  instagramCaption: string;
  requiredMediaTags: string[];
  imagePrompt: string;
  timingEvidence: TimingEvidence[];
  fallbackWindows: RankedWindow[];
  hashtagCandidates: HashtagCandidate[];
  categoryTerms: string[];
  brandTerms: string[];
  forbiddenHashtagTerms: string[];
  mediaHistory: MediaDirectorInput['history'];
  experiment?: {
    control: Record<string, string | number>;
    test: Record<string, string | number>;
  } | null;
}

interface SegmentChoice {
  id: string;
  status: 'predicted' | 'confirmed' | 'disabled';
}

export interface ReachPlan {
  id: string;
  postId: string;
  status: 'shadow' | 'selected';
  objective: string;
  reachProfileId: string;
  reachProfileVersion: number;
  audienceSegmentId: string | null;
  geographicFocus: string[];
  treatments: ReturnType<typeof buildPlatformTreatments>;
  timing: RankedWindow[];
  hashtags: HashtagPlan;
  media: {
    facebook: MediaDirection;
    instagram: MediaDirection;
    generatedUrl: string | null;
  };
  experiment: ReachPlanBrief['experiment'];
}

export interface ReachPlanDeps {
  getProfile: typeof getLatestReachProfile;
  listAssets: typeof listApprovedAssets;
  loadSegment(
    db: D1Database,
    profile: ReachProfile,
    applyMode: boolean,
  ): Promise<SegmentChoice | null>;
  generateMedia(
    env: Env,
    scope: ReachWorkspaceScope,
    profile: ReachProfile,
    brief: ReachPlanBrief,
    direction: MediaDirection,
  ): Promise<string | null>;
  preflightMedia(env: Env, post: PublishablePost): Promise<PreflightDecision>;
  randomId(): string;
}

export function buildPlatformTreatments(input: {
  facebookCaption: string;
  instagramCaption: string;
  facebookTags: string[];
  instagramTags: string[];
}) {
  return {
    facebook: {
      caption: input.facebookCaption,
      hashtags: [...input.facebookTags],
    },
    instagram: {
      caption: input.instagramCaption,
      hashtags: [...input.instagramTags],
    },
  };
}

export function assertSingleExperimentChange(
  control: Record<string, string | number>,
  test: Record<string, string | number>,
): void {
  const keys = new Set([...Object.keys(control), ...Object.keys(test)]);
  const changed = [...keys].filter((key) => control[key] !== test[key]);
  if (changed.length > 1) {
    throw new Error(`Experiment changes ${changed.length} variables`);
  }
}

async function loadSegment(
  db: D1Database,
  profile: ReachProfile,
  applyMode: boolean,
): Promise<SegmentChoice | null> {
  const statusClause = applyMode
    ? "status = 'confirmed'"
    : "status IN ('confirmed','predicted')";
  return db.prepare(`
    SELECT id, status FROM audience_segments
    WHERE user_id = ? AND workspace_key = ? AND reach_profile_id = ?
      AND owner_kind = ? AND owner_id = ? AND ${statusClause}
    ORDER BY CASE status WHEN 'confirmed' THEN 0 ELSE 1 END, confidence DESC
    LIMIT 1
  `).bind(
    profile.userId,
    profile.workspaceKey,
    profile.id,
    profile.ownerKind,
    profile.ownerId,
  ).first<SegmentChoice>();
}

async function generateGuardedMedia(
  env: Env,
  scope: ReachWorkspaceScope,
  _profile: ReachProfile,
  brief: ReachPlanBrief,
  direction: MediaDirection,
): Promise<string | null> {
  if (direction.format === 'video') {
    throw new Error('Video reach generation must use the existing reel pipeline');
  }
  const caption = brief.platform === 'facebook'
    ? brief.facebookCaption
    : brief.instagramCaption;
  const safePrompt = buildSafeImagePrompt(brief.imagePrompt, caption);
  if (!safePrompt) throw new Error('Reach media prompt failed image guardrails');
  const generated = await generateImageWithGuardrails(
    env,
    scope.userId,
    scope.clientId,
    safePrompt,
    { caption, seedHint: brief.postId },
  );
  return generated.imageUrl;
}

const defaultDeps: ReachPlanDeps = {
  getProfile: getLatestReachProfile,
  listAssets: listApprovedAssets,
  loadSegment,
  generateMedia: generateGuardedMedia,
  preflightMedia: evaluateReleasePreflight,
  randomId: () => crypto.randomUUID(),
};

function assertProfileIdentity(
  profile: ReachProfile,
  scope: ReachWorkspaceScope,
): void {
  const identity = normalizeWorkspaceIdentity(
    scope.userId,
    scope.clientId,
    scope.ownerKind,
    scope.ownerId,
  );
  if (profile.userId !== identity.userId
    || profile.workspaceKey !== identity.workspaceKey
    || profile.ownerKind !== identity.ownerKind
    || profile.ownerId !== identity.ownerId) {
    throw new Error('Reach profile does not belong to this workspace');
  }
}

function assertGeographicFocus(profile: ReachProfile, focus: string[]): void {
  const normalize = (value: string) => value.trim().toLowerCase();
  const allowed = new Set([
    profile.baseLocation.locality,
    ...profile.serviceArea.included,
  ].map(normalize).filter(Boolean));
  const excluded = new Set(profile.excludedLocations.map(normalize).filter(Boolean));
  for (const location of focus) {
    const canonical = normalize(location);
    if (!canonical || excluded.has(canonical) || !allowed.has(canonical)) {
      throw new Error(`Geographic focus is outside the confirmed service area: ${location}`);
    }
  }
}

export async function buildReachPlan(
  env: Env,
  scope: ReachWorkspaceScope,
  brief: ReachPlanBrief,
  deps: ReachPlanDeps = defaultDeps,
): Promise<ReachPlan> {
  if (env.ORGANIC_REACH_ENABLED !== 'true') {
    throw new Error('Organic Reach Engine is disabled');
  }
  const applyMode = env.ORGANIC_REACH_APPLY_ENABLED === 'true';
  if (applyMode && env.LEARNING_RELEASE_ENFORCEMENT !== 'true') {
    throw new Error('Organic reach apply mode requires critic enforcement');
  }
  const profile = await deps.getProfile(env.DB, scope);
  if (!profile) throw new Error('Reach profile not found');
  assertProfileIdentity(profile, scope);
  if (applyMode) assertConfirmedReachProfile(profile);
  assertGeographicFocus(profile, brief.geographicFocus);

  const segment = await deps.loadSegment(env.DB, profile, applyMode);
  if (applyMode && (!segment || segment.status !== 'confirmed')) {
    throw new Error('Apply mode requires a confirmed audience segment');
  }
  const timing = rankPostingWindows(brief.timingEvidence, brief.fallbackWindows);
  const hashtags = buildHashtagPlan({
    locationTerms: brief.geographicFocus,
    categoryTerms: brief.categoryTerms,
    brandTerms: brief.brandTerms,
    candidates: brief.hashtagCandidates,
    forbiddenTerms: brief.forbiddenHashtagTerms,
  });
  const treatments = buildPlatformTreatments({
    facebookCaption: brief.facebookCaption,
    instagramCaption: brief.instagramCaption,
    facebookTags: hashtags.facebookTags,
    instagramTags: hashtags.instagramTags,
  });
  if (brief.experiment) {
    assertSingleExperimentChange(brief.experiment.control, brief.experiment.test);
  }
  const assets = await deps.listAssets(env.DB, scope);
  const media = {
    facebook: chooseMediaDirection({
      assets,
      requiredTags: brief.requiredMediaTags,
      objective: brief.objective,
      platform: 'facebook',
      history: brief.mediaHistory,
    }),
    instagram: chooseMediaDirection({
      assets,
      requiredTags: brief.requiredMediaTags,
      objective: brief.objective,
      platform: 'instagram',
      history: brief.mediaHistory,
    }),
    generatedUrl: null as string | null,
  };

  if (applyMode) {
    const direction = media[brief.platform];
    let selectedUrl = direction.assetId
      ? assets.find((asset: ApprovedMediaAsset) => asset.id === direction.assetId)?.url ?? null
      : null;
    if (direction.generate) {
      selectedUrl = await deps.generateMedia(env, scope, profile, brief, direction);
      media.generatedUrl = selectedUrl;
    }
    if (!selectedUrl) throw new Error('Selected reach media is unavailable');
    const target = treatments[brief.platform];
    const decision = await deps.preflightMedia(env, {
      id: brief.postId,
      user_id: profile.userId,
      client_id: profile.clientId,
      owner_kind: profile.ownerKind,
      owner_id: profile.ownerId,
      content: target.caption,
      platform: brief.platform,
      hashtags: JSON.stringify(target.hashtags),
      image_url: direction.format === 'video' ? null : selectedUrl,
      post_type: direction.format,
      video_url: direction.format === 'video' ? selectedUrl : null,
      video_status: direction.format === 'video' ? 'ready' : null,
      archetype_slug: null,
    });
    if (!decision.mayPublish || decision.mustHold) {
      throw new Error(`Reach media failed critic preflight: ${decision.state}`);
    }
  }

  const plan: ReachPlan = {
    id: deps.randomId(),
    postId: brief.postId,
    status: applyMode ? 'selected' : 'shadow',
    objective: brief.objective,
    reachProfileId: profile.id,
    reachProfileVersion: profile.version,
    audienceSegmentId: segment?.id ?? null,
    geographicFocus: [...brief.geographicFocus],
    treatments,
    timing,
    hashtags,
    media,
    experiment: brief.experiment ?? null,
  };
  await env.DB.prepare(`
    INSERT INTO reach_plans (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,post_id,
      reach_profile_id,reach_profile_version,objective,audience_segment_id,
      geographic_focus_json,platform_plan_json,timing_json,language_json,
      hashtag_json,media_json,experiment_json,status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    plan.id,
    profile.userId,
    profile.workspaceKey,
    profile.clientId,
    profile.ownerKind,
    profile.ownerId,
    plan.postId,
    plan.reachProfileId,
    plan.reachProfileVersion,
    plan.objective,
    plan.audienceSegmentId,
    JSON.stringify(plan.geographicFocus),
    JSON.stringify(plan.treatments),
    JSON.stringify(plan.timing),
    JSON.stringify(plan.treatments),
    JSON.stringify(plan.hashtags),
    JSON.stringify(plan.media),
    JSON.stringify(plan.experiment ?? {}),
    plan.status,
  ).run();
  return plan;
}
