import type { LearningMode, WorkspaceOwnerKind } from './types';
import {
  BASE_REQUIRED_CRITICS,
  reduceCriticResults,
  type CriticKind,
  type CriticResult,
} from './critic-types';

export interface CandidateMedia {
  kind: 'none' | 'image' | 'video';
  url: string | null;
  thumbnailUrl: string | null;
  status?: string | null;
  archetypeSlug?: string | null;
}

export interface CandidateInput {
  userId: string;
  clientId: string | null;
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
  postId: string;
  mode: LearningMode;
  content: string;
  platform: string;
  hashtags: string[];
  media: CandidateMedia;
  requestedMediaKind?: 'none' | 'image' | 'video';
  videoScript?: string | null;
  videoShots?: string[];
}

export interface ReleaseContext {
  profile: Record<string, unknown>;
  verifiedFacts: string[];
  forbiddenSubjects: string[];
  recentPostDigests: string[];
}

export interface ReleaseJudgeInput {
  candidate: CandidateInput;
  context: ReleaseContext;
  results: CriticResult[];
  repairHistory: string[][];
}

export type ReleaseJudgeStatus =
  | 'available'
  | 'unavailable'
  | 'not_run'
  | 'unknown';

type ReleaseState = 'pass_green' | 'hold_amber' | 'block_red';
export type ReleaseJudgeExecutionStatus = Exclude<ReleaseJudgeStatus, 'unknown'>;

export interface ReleaseJudgeOutcome {
  state: ReleaseState;
  status: ReleaseJudgeExecutionStatus;
}

export interface ReleasePipelineResult {
  state: ReleaseState;
  candidate: CandidateInput;
  attempts: CriticResult[][];
  repairHistory: string[][];
  judgeStatus: ReleaseJudgeExecutionStatus;
}

export interface ReleasePipelineDeps {
  runDeterministicCritics(
    input: CandidateInput,
    context: ReleaseContext,
  ): Promise<CriticResult[]>;
  runTextCouncil(
    input: CandidateInput,
    context: ReleaseContext,
  ): Promise<CriticResult[]>;
  runHarmCritic(
    input: CandidateInput,
    context: ReleaseContext,
  ): Promise<CriticResult>;
  runMediaCritic?(
    input: CandidateInput,
    context: ReleaseContext,
  ): Promise<CriticResult>;
  repair(
    input: CandidateInput,
    repairs: string[],
    context: ReleaseContext,
  ): Promise<CandidateInput>;
  judge(
    input: ReleaseJudgeInput,
  ): Promise<ReleaseJudgeOutcome>;
}

function judgeCandidate(candidate: CandidateInput): CandidateInput {
  return {
    userId: candidate.userId,
    clientId: candidate.clientId,
    ownerKind: candidate.ownerKind,
    ownerId: candidate.ownerId,
    postId: candidate.postId,
    mode: candidate.mode,
    content: candidate.content,
    platform: candidate.platform,
    hashtags: [...candidate.hashtags],
    media: { ...candidate.media },
    requestedMediaKind: candidate.requestedMediaKind,
    videoScript: candidate.videoScript ?? null,
    videoShots: candidate.videoShots ? [...candidate.videoShots] : [],
  };
}

function unavailableMedia(kind: CriticKind): CriticResult {
  return {
    kind,
    verdict: 'unavailable',
    severity: 'release_critical',
    confidence: 0,
    evidence: ['Media critic unavailable'],
    repairs: [],
    provider: 'internal',
    model: 'none',
  };
}

export async function runReleasePipeline(
  input: CandidateInput,
  context: ReleaseContext,
  deps: ReleasePipelineDeps,
): Promise<ReleasePipelineResult> {
  let candidate = judgeCandidate(input);
  const attempts: CriticResult[][] = [];
  const repairHistory: string[][] = [];

  for (let repairAttempt = 0; repairAttempt <= 2; repairAttempt += 1) {
    const deterministic = await deps.runDeterministicCritics(candidate, context);
    if (deterministic.some((result) => result.verdict === 'block')) {
      return {
        state: 'block_red',
        candidate,
        attempts: [[...deterministic]],
        repairHistory,
        judgeStatus: 'not_run',
      };
    }

    const results = [
      ...deterministic,
      ...await deps.runTextCouncil(candidate, context),
      await deps.runHarmCritic(candidate, context),
    ];
    const mediaKind: CriticKind | null = candidate.media.kind === 'image'
      ? 'image'
      : candidate.media.kind === 'video'
        ? 'video_manifest'
        : null;
    if (mediaKind) {
      results.push(
        deps.runMediaCritic
          ? await deps.runMediaCritic(candidate, context)
          : unavailableMedia(mediaKind),
      );
    }
    attempts.push(results);

    const requiredKinds = mediaKind
      ? [...BASE_REQUIRED_CRITICS, mediaKind]
      : BASE_REQUIRED_CRITICS;
    const reduced = reduceCriticResults(results, requiredKinds);
    if (reduced.state === 'block_red') {
      return {
        state: 'block_red', candidate, attempts, repairHistory, judgeStatus: 'not_run',
      };
    }
    if (reduced.state === 'hold_amber') {
      return {
        state: 'hold_amber', candidate, attempts, repairHistory, judgeStatus: 'not_run',
      };
    }
    if (reduced.state === 'pass_green') {
      try {
        const judgment = await deps.judge({
          candidate: judgeCandidate(candidate),
          context,
          results,
          repairHistory,
        });
        if (
          judgment.status !== 'available'
          || !['pass_green', 'hold_amber', 'block_red'].includes(judgment.state)
        ) {
          return {
            state: 'hold_amber',
            candidate,
            attempts,
            repairHistory,
            judgeStatus: judgment.status === 'not_run' ? 'not_run' : 'unavailable',
          };
        }
        return {
          state: judgment.state,
          candidate,
          attempts,
          repairHistory,
          judgeStatus: 'available',
        };
      } catch {
        return {
          state: 'hold_amber',
          candidate,
          attempts,
          repairHistory,
          judgeStatus: 'unavailable',
        };
      }
    }
    if (repairAttempt === 2) {
      return {
        state: 'hold_amber', candidate, attempts, repairHistory, judgeStatus: 'not_run',
      };
    }

    repairHistory.push([...reduced.repairs]);
    try {
      candidate = judgeCandidate(
        await deps.repair(candidate, reduced.repairs, context),
      );
    } catch {
      return {
        state: 'hold_amber', candidate, attempts, repairHistory, judgeStatus: 'not_run',
      };
    }
  }

  return {
    state: 'hold_amber', candidate, attempts, repairHistory, judgeStatus: 'not_run',
  };
}
