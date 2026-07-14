import type { Env } from '../env';
import { createDecisionReceipt } from '../lib/learning/decision-repository';
import {
  normalizeWorkspaceIdentity,
  type WorkspaceOwnerKind,
} from '../lib/learning/types';
import { loadWorkspaceLearningMode } from '../lib/learning/workspace-mode';
import {
  loadForbiddenSubjects,
  loadForbiddenSubjectsForShop,
} from '../lib/profile-guards';
import type { HashtagCandidate } from '../lib/reach/hashtag-model';
import { buildReachPlan, type ReachPlanBrief } from '../lib/reach/reach-plan';
import { getLatestReachProfile } from '../lib/reach/reach-profile';
import {
  defaultReachTimingWindows,
  loadReachTimingEvidence,
} from '../lib/reach/timing-evidence';
import type {
  OrganicPlatform,
  ReachProfile,
  ReachWorkspaceScope,
} from '../lib/reach/types';

type ShadowPostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: string | null;
  owner_id: string | null;
  content: string | null;
  hashtags: string | null;
  image_prompt: string | null;
  image_url: string | null;
  platform: string | null;
  post_type: string | null;
  topic: string | null;
  pillar: string | null;
  scheduled_for: string | null;
  image_critique_score: number | null;
  image_critique_reasoning: string | null;
};

interface LearningShadowDeps {
  buildReachPlan(
    env: Env,
    scope: ReachWorkspaceScope,
    brief: ReachPlanBrief,
  ): Promise<{ id: string; status: string }>;
  getLatestReachProfile(
    db: D1Database,
    scope: ReachWorkspaceScope,
  ): Promise<ReachProfile | null>;
  loadReachTimingEvidence: typeof loadReachTimingEvidence;
  loadForbiddenSubjects: typeof loadForbiddenSubjects;
  loadForbiddenSubjectsForShop: typeof loadForbiddenSubjectsForShop;
}

const defaultDeps: LearningShadowDeps = {
  buildReachPlan,
  getLatestReachProfile,
  loadReachTimingEvidence,
  loadForbiddenSubjects,
  loadForbiddenSubjectsForShop,
};

function organicPlatform(value: string | null): OrganicPlatform {
  return value?.trim().toLowerCase() === 'instagram'
    ? 'instagram'
    : 'facebook';
}

function parseHashtags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((tag): tag is string => typeof tag === 'string');
    }
  } catch {
    // Legacy rows can store a space/comma-delimited string.
  }
  return value.split(/[\s,]+/).filter(Boolean);
}

function hashtagCandidates(post: ShadowPostRow): HashtagCandidate[] {
  return parseHashtags(post.hashtags).map((term) => ({
    term,
    platforms: ['facebook', 'instagram'] as const,
    score: 50,
    evidence: 'existing scheduled-post hashtag',
  }));
}

function shadowBrief(
  post: ShadowPostRow,
  profile: ReachProfile,
  timingEvidence: ReachPlanBrief['timingEvidence'],
  forbiddenSubjects: string[],
): ReachPlanBrief {
  const objective = post.topic?.trim()
    || post.pillar?.trim()
    || 'local_engagement';
  const locality = profile.baseLocation.locality.trim()
    || profile.serviceArea.included[0]?.trim()
    || '';
  const categoryTerms = [post.topic, post.pillar]
    .filter((term): term is string => Boolean(term?.trim()))
    .map((term) => term.trim());
  const content = post.content?.trim() || objective;
  return {
    postId: post.id,
    platform: organicPlatform(post.platform),
    objective,
    geographicFocus: locality ? [locality] : [],
    facebookCaption: content,
    instagramCaption: content,
    requiredMediaTags: categoryTerms,
    imagePrompt: post.image_prompt?.trim() || content,
    timingEvidence,
    fallbackWindows: defaultReachTimingWindows(),
    hashtagCandidates: hashtagCandidates(post),
    categoryTerms,
    brandTerms: [],
    forbiddenHashtagTerms: forbiddenSubjects,
    mediaHistory: [],
    experiment: null,
  };
}

async function findReusableShadowPlan(
  db: D1Database,
  scope: ReachWorkspaceScope,
  postId: string,
  contentHash: string,
  profileVersion: number,
): Promise<{ id: string; status: string } | null> {
  const identity = normalizeWorkspaceIdentity(
    scope.userId,
    scope.clientId,
    scope.ownerKind,
    scope.ownerId,
  );
  return db.prepare(`
    SELECT plan.id, plan.status
    FROM learning_decisions d
    JOIN reach_plans plan ON plan.id = d.reach_plan_id
      AND plan.user_id = d.user_id
      AND plan.workspace_key = d.workspace_key
    WHERE d.user_id = ? AND d.workspace_key = ? AND d.post_id = ?
      AND d.stage = 'snapshot' AND d.content_hash = ?
      AND plan.reach_profile_version = ? AND plan.status = 'shadow'
    ORDER BY d.updated_at DESC
    LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    postId,
    contentHash,
    profileVersion,
  ).first<{ id: string; status: string }>();
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function cronEvaluateLearningShadow(
  env: Env,
  overrides: Partial<LearningShadowDeps> = {},
): Promise<{ posts_processed: number }> {
  if (env.LEARNING_BRAIN_ENABLED !== 'true') {
    return { posts_processed: 0 };
  }
  const deps = { ...defaultDeps, ...overrides };

  // Posts use the publisher's AEST-without-offset storage convention.
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000)
    .toISOString().replace('Z', '');
  const lookaheadAEST = new Date(Date.now() + 34 * 60 * 60 * 1000)
    .toISOString().replace('Z', '');
  const rows = await env.DB.prepare(`
    SELECT
      p.id, p.user_id, p.client_id, p.owner_kind, p.owner_id,
      p.content, p.hashtags, p.image_prompt, p.image_url, p.platform,
      p.post_type, p.topic, p.pillar, p.scheduled_for,
      p.image_critique_score, p.image_critique_reasoning
    FROM posts p
    LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = p.user_id
    WHERE p.status = 'Scheduled'
      AND p.scheduled_for > ?
      AND p.scheduled_for <= ?
      AND (
        p.client_id IS NULL
        OR (c.id IS NOT NULL AND COALESCE(c.status, 'active') != 'on_hold')
      )
    ORDER BY p.scheduled_for ASC
    LIMIT 8
  `).bind(nowAEST, lookaheadAEST).all<ShadowPostRow>();

  let processed = 0;
  for (const post of rows.results ?? []) {
    const clientId = post.client_id ?? null;
    const ownerKind: WorkspaceOwnerKind = post.owner_kind === 'shop'
      ? 'shop'
      : clientId === null ? 'user' : 'client';
    const ownerId = post.owner_id?.trim() || clientId || post.user_id;
    const mode = await loadWorkspaceLearningMode(
      env,
      post.user_id,
      clientId,
      ownerKind,
      ownerId,
    );
    if (mode === 'off') continue;

    const contentHash = await sha256(JSON.stringify({
      content: post.content,
      image: post.image_url,
      platform: post.platform,
    }));

    let reachPlanId: string | null = null;
    let reachPlanSummary: Record<string, unknown> = { state: 'disabled' };
    if (env.ORGANIC_REACH_ENABLED === 'true') {
      if (env.ORGANIC_REACH_APPLY_ENABLED === 'true') {
        reachPlanSummary = { state: 'skipped_apply_mode' };
      } else {
        const scope: ReachWorkspaceScope = {
          userId: post.user_id,
          clientId,
          ownerKind,
          ownerId,
        };
        try {
          const profile = await deps.getLatestReachProfile(env.DB, scope);
          if (!profile) {
            reachPlanSummary = { state: 'no_profile' };
          } else {
            const reusable = await findReusableShadowPlan(
              env.DB,
              scope,
              post.id,
              contentHash,
              profile.version,
            );
            if (reusable) {
              reachPlanId = reusable.id;
              reachPlanSummary = {
                state: reusable.status,
                id: reusable.id,
                reused: true,
              };
            } else {
              const timingEvidence = await deps.loadReachTimingEvidence(
                env.DB,
                scope,
                profile.timezone,
              );
              const forbiddenSubjects = ownerKind === 'shop'
                ? await deps.loadForbiddenSubjectsForShop(env, ownerId)
                : await deps.loadForbiddenSubjects(env, post.user_id, clientId);
              const plan = await deps.buildReachPlan(
                env,
                scope,
                shadowBrief(post, profile, timingEvidence, forbiddenSubjects),
              );
              reachPlanId = plan.id;
              reachPlanSummary = { state: plan.status, id: plan.id };
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'unknown error';
          console.warn(`[learning-shadow] reach plan unavailable for ${post.id}: ${reason}`);
          reachPlanSummary = {
            state: 'unavailable',
            reason: reason.slice(0, 240),
          };
        }
      }
    }

    await createDecisionReceipt(env.DB, {
      userId: post.user_id,
      clientId,
      ownerKind,
      ownerId,
      postId: post.id,
      mode,
      stage: 'snapshot',
      releaseState: 'shadow_only',
      contentHash,
      reachPlanId,
      summary: {
        scheduledFor: post.scheduled_for,
        imageCritiqueScore: post.image_critique_score,
        imageCritiqueReasoning: post.image_critique_reasoning,
        reachPlan: reachPlanSummary,
      },
    });
    processed += 1;
  }

  return { posts_processed: processed };
}
