import {
  UNTRUSTED_CONTENT_DIRECTIVE,
  wrapUntrusted,
} from '../prompt-safety';
import type { CriticResult } from './critic-types';
import type {
  TextCriticCandidate,
  TextCriticContext,
} from './deterministic-critics';
import {
  callStrictCritics,
  STRICT_CRITIC_SCHEMA_INSTRUCTIONS,
  unavailableCritic,
  type CriticJsonCaller,
} from './text-critic-council';

export async function runBusinessHarmCritic(
  input: TextCriticCandidate,
  context: TextCriticContext,
  call: CriticJsonCaller,
): Promise<CriticResult> {
  const systemPrompt = `${UNTRUSTED_CONTENT_DIRECTIVE}\n\nAct as an adversarial business-harm critic independent of post generation. Look for reputational, factual, safety, discrimination, legal, customer-trust, and brand harms. Never infer approval from missing evidence.`;
  const prompt = [
    wrapUntrusted(input.content, 'candidate_caption', { maxLen: 4_000 }),
    wrapUntrusted(input.hashtags.join(' '), 'candidate_hashtags'),
    wrapUntrusted(JSON.stringify(context.profile), 'business_profile', { maxLen: 4_000 }),
    wrapUntrusted(context.verifiedFacts.join('\n'), 'verified_facts', { maxLen: 8_000 }),
    wrapUntrusted(context.forbiddenSubjects.join('\n'), 'forbidden_subjects'),
    `Return exactly one JSON object keyed by business_harm. ${STRICT_CRITIC_SCHEMA_INSTRUCTIONS}`,
  ].join('\n\n');

  try {
    const [result] = await callStrictCritics(
      call,
      systemPrompt,
      prompt,
      {
        operation: 'learning_harm_critic',
        userId: input.userId,
        clientId: input.clientId,
        postId: input.postId,
      },
      ['business_harm'],
    );
    if (!result) throw new Error('Missing business_harm result');
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return unavailableCritic('business_harm', reason);
  }
}
