import type { Env } from '../../env';
import {
  UNTRUSTED_CONTENT_DIRECTIVE,
  wrapUntrusted,
} from '../prompt-safety';
import { BASE_REQUIRED_CRITICS, type CriticKind } from './critic-types';
import { callIndependentJson } from './independent-json';
import type {
  CandidateInput,
  ReleaseJudgeInput,
  ReleaseJudgeOutcome,
} from './release-pipeline';
import type { CriticJsonCaller } from './text-critic-council';

const RELEASE_STATES = new Set<string>([
  'pass_green',
  'hold_amber',
  'block_red',
]);

export type ReleaseJudgeTelemetry = ReleaseJudgeOutcome;

function safeCandidate(candidate: CandidateInput): Record<string, unknown> {
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
    requestedMediaKind: candidate.requestedMediaKind ?? null,
    videoScript: candidate.videoScript ?? null,
    videoShots: candidate.videoShots ? [...candidate.videoShots] : [],
  };
}

function requiredKinds(input: ReleaseJudgeInput): CriticKind[] {
  if (input.candidate.media.kind === 'image') {
    return [...BASE_REQUIRED_CRITICS, 'image'];
  }
  if (input.candidate.media.kind === 'video') {
    return [...BASE_REQUIRED_CRITICS, 'video_manifest'];
  }
  return BASE_REQUIRED_CRITICS;
}

export async function runReleaseJudgeWithTelemetry(
  env: Env,
  input: ReleaseJudgeInput,
  injectedCall?: CriticJsonCaller,
): Promise<ReleaseJudgeTelemetry> {
  const required = requiredKinds(input);
  if (input.results.some((result) => result.verdict === 'block')) {
    return { state: 'block_red', status: 'not_run' };
  }
  if (
    required.some((kind) => !input.results.some((result) => result.kind === kind)) ||
    input.results.some(
      (result) =>
        required.includes(result.kind) &&
        (result.verdict === 'unavailable' || result.verdict === 'warn_repairable'),
    )
  ) {
    return { state: 'hold_amber', status: 'not_run' };
  }

  const call: CriticJsonCaller = injectedCall ?? (
    (systemPrompt, prompt, context) =>
      callIndependentJson(env, systemPrompt, prompt, context)
  );
  const systemPrompt = `${UNTRUSTED_CONTENT_DIRECTIVE}\n\nYou are the independent final Release Judge. You did not generate or repair this post. Return pass_green only when all supplied critic evidence supports unattended release. Return hold_amber for uncertainty and block_red for persistent business harm.`;
  const prompt = [
    wrapUntrusted(JSON.stringify(safeCandidate(input.candidate)), 'candidate', { maxLen: 8_000 }),
    wrapUntrusted(JSON.stringify(input.context.profile), 'business_profile', { maxLen: 4_000 }),
    wrapUntrusted(input.context.verifiedFacts.join('\n'), 'verified_facts', { maxLen: 8_000 }),
    wrapUntrusted(input.context.forbiddenSubjects.join('\n'), 'forbidden_subjects'),
    wrapUntrusted(JSON.stringify(input.results), 'critic_results', { maxLen: 12_000 }),
    wrapUntrusted(JSON.stringify(input.repairHistory), 'repair_history', { maxLen: 4_000 }),
    'Return JSON only: {"state":"pass_green|hold_amber|block_red"}.',
  ].join('\n\n');

  try {
    const response = await call(systemPrompt, prompt, {
      operation: 'learning_release_judge',
      userId: input.candidate.userId,
      clientId: input.candidate.clientId,
      postId: input.candidate.postId,
    });
    const parsed = JSON.parse(response.text) as { state?: unknown };
    if (!RELEASE_STATES.has(String(parsed.state))) {
      return { state: 'hold_amber', status: 'unavailable' };
    }
    return {
      state: parsed.state as ReleaseJudgeOutcome['state'],
      status: 'available',
    };
  } catch {
    return { state: 'hold_amber', status: 'unavailable' };
  }
}

export async function runReleaseJudge(
  env: Env,
  input: ReleaseJudgeInput,
  injectedCall?: CriticJsonCaller,
): Promise<ReleaseJudgeOutcome['state']> {
  return (await runReleaseJudgeWithTelemetry(env, input, injectedCall)).state;
}
