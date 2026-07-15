import {
  UNTRUSTED_CONTENT_DIRECTIVE,
  wrapUntrusted,
} from '../prompt-safety';
import type { CriticSeverity, CriticVerdict } from './types';
import type { CriticKind, CriticResult } from './critic-types';
import type {
  TextCriticCandidate,
  TextCriticContext,
} from './deterministic-critics';

const TEXT_CRITIC_KINDS = [
  'brand',
  'fact',
  'repetition',
  'platform',
] as const satisfies readonly CriticKind[];
const VERDICTS = new Set(['pass', 'warn_repairable', 'block', 'unavailable']);
const SEVERITIES = new Set(['advisory', 'release_critical']);

export const STRICT_CRITIC_SCHEMA_INSTRUCTIONS =
  'Each requested critic value must use exactly {"kind":"<matching key>","verdict":"pass|warn_repairable|block|unavailable","severity":"advisory|release_critical","confidence":0..1,"evidence":["..."],"repairs":["..."]}. Use repairs=[] unless verdict is warn_repairable; warn_repairable requires at least one concrete repair.';

export interface CriticJsonResponse {
  text: string;
  provider?: string;
  model?: string;
}

export type CriticJsonCaller = (
  systemPrompt: string,
  prompt: string,
  context: { operation: string; userId: string; clientId: string | null; postId: string },
) => Promise<CriticJsonResponse>;

export function parseCriticResult(
  value: unknown,
  expectedKind: CriticKind,
): CriticResult {
  if (!value || typeof value !== 'object') {
    throw new Error(`Missing ${expectedKind} result`);
  }
  const row = value as Record<string, unknown>;
  if (
    row.kind !== expectedKind ||
    !VERDICTS.has(String(row.verdict)) ||
    !SEVERITIES.has(String(row.severity))
  ) {
    throw new Error(`Invalid ${expectedKind} enum`);
  }
  const confidence = Number(row.confidence);
  const evidence = Array.isArray(row.evidence)
    ? row.evidence.filter((item): item is string => typeof item === 'string')
    : [];
  const repairs = Array.isArray(row.repairs)
    ? row.repairs.filter((item): item is string => typeof item === 'string')
    : [];
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid ${expectedKind} confidence`);
  }
  if (row.verdict === 'warn_repairable' && repairs.length === 0) {
    throw new Error(`Missing ${expectedKind} repair`);
  }
  return {
    kind: expectedKind,
    verdict: row.verdict as CriticVerdict,
    severity: row.severity as CriticSeverity,
    confidence,
    evidence,
    repairs,
    provider: String(row.provider ?? ''),
    model: String(row.model ?? ''),
  };
}

function unavailable(kind: CriticKind, reason: string): CriticResult {
  return {
    kind,
    verdict: 'unavailable',
    severity: 'release_critical',
    confidence: 0,
    evidence: [reason],
    repairs: [],
    provider: 'unavailable',
    model: 'none',
  };
}

function exactObjectKeys(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Critic response must be an object');
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  const expectedKeys = [...expected].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Critic response keys do not match the requested council');
  }
  return row;
}

export async function runTextCriticCouncil(
  input: TextCriticCandidate,
  context: TextCriticContext,
  call: CriticJsonCaller,
): Promise<CriticResult[]> {
  const systemPrompt = `${UNTRUSTED_CONTENT_DIRECTIVE}\n\nYou are an independent social-post critic council. Return one strict verdict for brand, fact, repetition, and platform. Never approve unsupported claims.`;
  const prompt = [
    wrapUntrusted(input.content, 'candidate_caption', { maxLen: 4_000 }),
    wrapUntrusted(input.hashtags.join(' '), 'candidate_hashtags'),
    wrapUntrusted(JSON.stringify(context.profile), 'business_profile', { maxLen: 4_000 }),
    wrapUntrusted(context.verifiedFacts.join('\n'), 'verified_facts', { maxLen: 8_000 }),
    wrapUntrusted(context.forbiddenSubjects.join('\n'), 'forbidden_subjects'),
    wrapUntrusted(context.recentPostDigests.join('\n'), 'recent_posts', { maxLen: 8_000 }),
    `Return exactly one JSON object keyed by brand, fact, repetition, and platform. ${STRICT_CRITIC_SCHEMA_INSTRUCTIONS}`,
  ].join('\n\n');

  try {
    return await callStrictCritics(
      call,
      systemPrompt,
      prompt,
      {
        operation: 'learning_text_council',
        userId: input.userId,
        clientId: input.clientId,
        postId: input.postId,
      },
      TEXT_CRITIC_KINDS,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return TEXT_CRITIC_KINDS.map((kind) => unavailable(kind, reason));
  }
}

export function parseExactCriticObject(
  text: string,
  expectedKinds: readonly CriticKind[],
): Record<string, unknown> {
  return exactObjectKeys(JSON.parse(text), expectedKinds);
}

export async function callStrictCritics(
  call: CriticJsonCaller,
  systemPrompt: string,
  prompt: string,
  context: Parameters<CriticJsonCaller>[2],
  expectedKinds: readonly CriticKind[],
): Promise<CriticResult[]> {
  let validationError: unknown = new Error('Critic response failed strict validation');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptPrompt = attempt === 0
      ? prompt
      : `${prompt}\n\nThe previous output failed strict schema validation. Return the complete corrected JSON object only.`;
    const response = await call(systemPrompt, attemptPrompt, context);
    try {
      const parsed = parseExactCriticObject(response.text, expectedKinds);
      return expectedKinds.map((kind) => ({
        ...parseCriticResult(parsed[kind], kind),
        provider: response.provider ?? 'unknown',
        model: response.model ?? 'unknown',
      }));
    } catch (error) {
      validationError = error;
    }
  }
  throw validationError;
}

export function unavailableCritic(kind: CriticKind, reason: string): CriticResult {
  return unavailable(kind, reason);
}
