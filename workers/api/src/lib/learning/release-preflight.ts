import type { Env } from '../../env';
import { critiqueImageInternal } from '../critique';
import {
  UNTRUSTED_CONTENT_DIRECTIVE,
  wrapUntrusted,
} from '../prompt-safety';
import { runBusinessHarmCritic } from './business-harm-critic';
import { loadCriticContext } from './critic-context';
import {
  createDecisionReceipt,
  findFreshReleaseReceipt,
  replaceCriticVerdicts,
} from './decision-repository';
import { runDeterministicCritics } from './deterministic-critics';
import { callIndependentJson } from './independent-json';
import { runMediaCritic } from './media-critic';
import {
  runReleasePipeline,
  type CandidateInput,
  type ReleaseContext,
  type ReleasePipelineResult,
} from './release-pipeline';
import { runReleaseJudge } from './release-judge';
import {
  parseCriticResult,
  parseExactCriticObject,
  unavailableCritic,
  runTextCriticCouncil,
  type CriticJsonCaller,
} from './text-critic-council';
import type {
  DecisionReceiptInput,
  LearningMode,
  ReleaseState,
  WorkspaceOwnerKind,
} from './types';
import { loadWorkspaceLearningMode } from './workspace-mode';

export interface PublishablePost {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind;
  owner_id: string;
  content: string;
  platform: string;
  hashtags: string | null;
  image_url: string | null;
  post_type: string | null;
  video_url: string | null;
  video_status: string | null;
  video_script?: string | null;
  video_shots?: string | null;
  archetype_slug?: string | null;
}

export interface PreflightDecision {
  mode: LearningMode;
  state: ReleaseState;
  mayPublish: boolean;
  mustHold: boolean;
  decisionId: string | null;
}

export interface ReleasePreflightDeps {
  loadMode(
    env: Env,
    userId: string,
    clientId: string | null,
    ownerKind: WorkspaceOwnerKind,
    ownerId: string,
  ): Promise<LearningMode>;
  runPipeline(
    env: Env,
    post: PublishablePost,
    mode: LearningMode,
  ): Promise<{ id: string; state: ReleaseState }>;
}

interface ReleasePipelineRunnerDeps {
  findFreshReceipt: typeof findFreshReleaseReceipt;
  loadContext(env: Env, post: PublishablePost): Promise<ReleaseContext>;
  executePipeline(
    env: Env,
    candidate: CandidateInput,
    context: ReleaseContext,
  ): Promise<ReleasePipelineResult>;
  createReceipt(db: D1Database, input: DecisionReceiptInput): Promise<string>;
  replaceVerdicts: typeof replaceCriticVerdicts;
}

type FinalReleaseState = Extract<
  ReleaseState,
  'pass_green' | 'hold_amber' | 'block_red'
>;

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((value) => {
          if (typeof value === 'string') return value.trim();
          if (value && typeof value === 'object') {
            const row = value as Record<string, unknown>;
            return String(row.description ?? row.action ?? row.shot ?? '').trim();
          }
          return '';
        })
        .filter(Boolean);
    }
  } catch {
    // Legacy hashtag rows can contain a plain space-separated string.
  }
  return raw.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
}

function buildCandidate(
  post: PublishablePost,
  mode: LearningMode,
): CandidateInput {
  const requestedVideo = /^(video|reel)$/i.test(post.post_type ?? '');
  const media = post.video_url
    ? {
        kind: 'video' as const,
        url: post.video_url,
        thumbnailUrl: post.image_url,
        status: post.video_status,
        archetypeSlug: post.archetype_slug ?? null,
      }
    : post.image_url
      ? {
          kind: 'image' as const,
          url: post.image_url,
          thumbnailUrl: null,
          status: null,
          archetypeSlug: post.archetype_slug ?? null,
        }
      : {
          kind: 'none' as const,
          url: null,
          thumbnailUrl: null,
          status: null,
          archetypeSlug: post.archetype_slug ?? null,
        };

  return {
    userId: post.user_id,
    clientId: post.client_id,
    ownerKind: post.owner_kind,
    ownerId: post.owner_id,
    postId: post.id,
    mode,
    content: post.content,
    platform: post.platform.toLowerCase(),
    hashtags: parseStringArray(post.hashtags),
    media,
    requestedMediaKind: requestedVideo
      ? 'video'
      : post.image_url || post.post_type === 'image'
        ? 'image'
        : 'none',
    videoScript: post.video_script ?? null,
    videoShots: parseStringArray(post.video_shots),
  };
}

function candidatePayload(candidate: CandidateInput): Record<string, unknown> {
  return {
    content: candidate.content,
    platform: candidate.platform,
    hashtags: candidate.hashtags,
    media: candidate.media,
    requestedMediaKind: candidate.requestedMediaKind ?? null,
    videoScript: candidate.videoScript ?? null,
    videoShots: candidate.videoShots ?? [],
  };
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

export async function buildReleaseContentHash(
  post: PublishablePost,
): Promise<string> {
  return sha256(JSON.stringify(candidatePayload(buildCandidate(post, 'off'))));
}

async function loadReleaseContext(
  env: Env,
  post: PublishablePost,
): Promise<ReleaseContext> {
  const context = await loadCriticContext(
    env,
    post.user_id,
    post.client_id,
    post.owner_kind,
    post.owner_id,
  );
  return {
    profile: context.profile,
    verifiedFacts: context.verifiedFacts.map(
      (fact) => `${fact.factType}: ${fact.content}`,
    ),
    forbiddenSubjects: [...context.forbiddenSubjects],
    recentPostDigests: context.recentPosts
      .filter((recent) => recent.id !== post.id)
      .map((recent) => recent.content),
  };
}

function independentCaller(env: Env): CriticJsonCaller {
  return (systemPrompt, prompt, context) =>
    callIndependentJson(env, systemPrompt, prompt, context);
}

async function reviewVideoText(
  env: Env,
  input: CandidateInput,
  context: ReleaseContext,
) {
  if (!input.videoScript?.trim()) {
    return unavailableCritic('video_manifest', 'Video script missing');
  }
  const systemPrompt = `${UNTRUSTED_CONTENT_DIRECTIVE}\n\nYou are an independent video script and storyboard critic. Check factual support, brand fit, forbidden subjects, and consistency with the final caption. Return a release-critical warning or block whenever evidence is uncertain.`;
  const prompt = [
    wrapUntrusted(input.content, 'candidate_caption', { maxLen: 4_000 }),
    wrapUntrusted(input.videoScript, 'video_script', { maxLen: 4_000 }),
    wrapUntrusted((input.videoShots ?? []).join('\n'), 'video_shots', { maxLen: 6_000 }),
    wrapUntrusted(JSON.stringify(context.profile), 'business_profile', { maxLen: 4_000 }),
    wrapUntrusted(context.verifiedFacts.join('\n'), 'verified_facts', { maxLen: 8_000 }),
    wrapUntrusted(context.forbiddenSubjects.join('\n'), 'forbidden_subjects'),
    'Return exactly {"video_manifest":{"kind":"video_manifest","verdict":"pass|warn_repairable|block|unavailable","severity":"advisory|release_critical","confidence":0..1,"evidence":[],"repairs":[]}}.',
  ].join('\n\n');
  try {
    const response = await callIndependentJson(env, systemPrompt, prompt, {
      operation: 'learning_video_manifest_critic',
      userId: input.userId,
      clientId: input.clientId,
      postId: input.postId,
    });
    const parsed = parseExactCriticObject(response.text, ['video_manifest']);
    return {
      ...parseCriticResult(parsed.video_manifest, 'video_manifest'),
      provider: response.provider,
      model: response.model,
    };
  } catch (error) {
    return unavailableCritic(
      'video_manifest',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function repairTextCandidate(
  env: Env,
  input: CandidateInput,
  repairs: string[],
  context: ReleaseContext,
): Promise<CandidateInput> {
  const systemPrompt = `${UNTRUSTED_CONTENT_DIRECTIVE}\n\nRepair only the caption and hashtags. Use only supplied verified facts. Never add prices, dates, offers, locations, guarantees, superlatives, or product claims that are not explicitly verified. Preserve the business voice without copying recent posts.`;
  const prompt = [
    wrapUntrusted(input.content, 'candidate_caption', { maxLen: 4_000 }),
    wrapUntrusted(input.hashtags.join(' '), 'candidate_hashtags'),
    wrapUntrusted(repairs.join('\n'), 'required_repairs', { maxLen: 4_000 }),
    wrapUntrusted(JSON.stringify(context.profile), 'business_profile', { maxLen: 4_000 }),
    wrapUntrusted(context.verifiedFacts.join('\n'), 'verified_facts', { maxLen: 8_000 }),
    wrapUntrusted(context.forbiddenSubjects.join('\n'), 'forbidden_subjects'),
    wrapUntrusted(context.recentPostDigests.join('\n'), 'recent_posts', { maxLen: 8_000 }),
    'Return JSON only with exactly two keys: {"content":"...","hashtags":["#tag"]}.',
  ].join('\n\n');
  const response = await callIndependentJson(env, systemPrompt, prompt, {
    operation: 'learning_text_repair',
    userId: input.userId,
    clientId: input.clientId,
    postId: input.postId,
  });
  const parsed = JSON.parse(response.text) as Record<string, unknown>;
  if (
    Object.keys(parsed).sort().join(',') !== 'content,hashtags' ||
    typeof parsed.content !== 'string' ||
    !parsed.content.trim() ||
    !Array.isArray(parsed.hashtags) ||
    parsed.hashtags.some((value) => typeof value !== 'string')
  ) {
    throw new Error('Invalid independent repair response');
  }
  return {
    ...input,
    content: parsed.content.trim(),
    hashtags: (parsed.hashtags as string[]).map((value) => value.trim()).filter(Boolean),
  };
}

async function executeReleasePipeline(
  env: Env,
  candidate: CandidateInput,
  context: ReleaseContext,
): Promise<ReleasePipelineResult> {
  const call = independentCaller(env);
  return runReleasePipeline(candidate, context, {
    runDeterministicCritics: async (input, releaseContext) =>
      runDeterministicCritics(input, releaseContext),
    runTextCouncil: (input, releaseContext) =>
      runTextCriticCouncil(input, releaseContext, call),
    runHarmCritic: (input, releaseContext) =>
      runBusinessHarmCritic(input, releaseContext, call),
    runMediaCritic: (input, releaseContext) =>
      runMediaCritic(env, input, releaseContext, {
        critiqueImage: critiqueImageInternal,
        inspectVideo: async (url) => {
          const response = await fetch(url, { method: 'HEAD' });
          if (!response.ok) throw new Error(`Media HEAD returned ${response.status}`);
          const length = response.headers.get('content-length');
          return {
            contentType: response.headers.get('content-type'),
            contentLength: length ? Number(length) : null,
          };
        },
        reviewVideoText: (videoInput, videoContext) =>
          reviewVideoText(env, videoInput, videoContext),
      }),
    repair: (input, repairs, releaseContext) =>
      repairTextCandidate(env, input, repairs, releaseContext),
    judge: (judgeInput) => runReleaseJudge(env, judgeInput),
  });
}

const defaultRunnerDeps: ReleasePipelineRunnerDeps = {
  findFreshReceipt: findFreshReleaseReceipt,
  loadContext: loadReleaseContext,
  executePipeline: executeReleasePipeline,
  createReceipt: createDecisionReceipt,
  replaceVerdicts: replaceCriticVerdicts,
};

export async function runAndPersistReleasePipeline(
  env: Env,
  post: PublishablePost,
  mode: LearningMode,
  deps: ReleasePipelineRunnerDeps = defaultRunnerDeps,
): Promise<{ id: string; state: FinalReleaseState }> {
  const contentHash = await buildReleaseContentHash(post);
  const fresh = await deps.findFreshReceipt(
    env.DB,
    post.user_id,
    post.client_id,
    post.owner_kind,
    post.owner_id,
    post.id,
    contentHash,
    mode,
  );
  if (fresh) return fresh;

  const context = await deps.loadContext(env, post);
  const original = buildCandidate(post, mode);
  const result = await deps.executePipeline(env, original, context);
  const candidateChanged = JSON.stringify(candidatePayload(original)) !==
    JSON.stringify(candidatePayload(result.candidate));
  const state: FinalReleaseState = result.state === 'pass_green' && candidateChanged
    ? 'hold_amber'
    : result.state;
  const verdictCount = result.attempts.reduce(
    (total, attempt) => total + attempt.length,
    0,
  );
  const summary = {
    pipelineState: result.state,
    candidateChanged,
    mediaKind: original.media.kind,
    requestedMediaKind: original.requestedMediaKind ?? null,
    attemptCount: result.attempts.length,
    repairCount: result.repairHistory.length,
    verdictCount,
  };
  const receiptInput: DecisionReceiptInput = {
    userId: post.user_id,
    clientId: post.client_id,
    ownerKind: post.owner_kind,
    ownerId: post.owner_id,
    postId: post.id,
    mode,
    stage: 'release',
    releaseState: state,
    contentHash,
    summary: { ...summary, verdictCount: -1, persistenceState: 'writing' },
  };
  const decisionId = await deps.createReceipt(env.DB, receiptInput);
  await deps.replaceVerdicts(env.DB, decisionId, result.attempts);
  const completedId = await deps.createReceipt(env.DB, {
    ...receiptInput,
    summary: { ...summary, persistenceState: 'complete' },
  });
  return { id: completedId, state };
}

const defaultDeps: ReleasePreflightDeps = {
  loadMode: loadWorkspaceLearningMode,
  runPipeline: runAndPersistReleasePipeline,
};

export async function evaluateReleasePreflight(
  env: Env,
  post: PublishablePost,
  deps: ReleasePreflightDeps = defaultDeps,
): Promise<PreflightDecision> {
  const mode = await deps.loadMode(
    env,
    post.user_id,
    post.client_id,
    post.owner_kind,
    post.owner_id,
  );
  if (mode === 'off') {
    return {
      mode,
      state: 'pending',
      mayPublish: true,
      mustHold: false,
      decisionId: null,
    };
  }

  const recordOnly =
    mode === 'shadow' || env.LEARNING_RELEASE_ENFORCEMENT !== 'true';
  try {
    const result = await deps.runPipeline(env, post, mode);
    if (recordOnly) {
      return {
        mode,
        state: 'shadow_only',
        mayPublish: true,
        mustHold: false,
        decisionId: result.id,
      };
    }
    const mayPublish = result.state === 'pass_green';
    return {
      mode,
      state: result.state,
      mayPublish,
      mustHold: !mayPublish,
      decisionId: result.id,
    };
  } catch {
    if (recordOnly) {
      return {
        mode,
        state: 'shadow_only',
        mayPublish: true,
        mustHold: false,
        decisionId: null,
      };
    }
    return {
      mode,
      state: 'hold_amber',
      mayPublish: false,
      mustHold: true,
      decisionId: null,
    };
  }
}
