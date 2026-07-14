import { scanForForbidden } from '../profile-guards';
import type { CriticKind, CriticResult } from './critic-types';

export interface TextCriticCandidate {
  userId: string;
  clientId: string | null;
  postId: string;
  content: string;
  platform: string;
  hashtags: string[];
}

export interface TextCriticContext {
  profile: Record<string, unknown>;
  verifiedFacts: string[];
  forbiddenSubjects: string[];
  recentPostDigests: string[];
}

const RULE_VERSION = '2026-07-14';
const PLATFORM_LIMITS: Record<string, { maxCaption: number; maxHashtags: number }> = {
  facebook: { maxCaption: 63_206, maxHashtags: 10 },
  instagram: { maxCaption: 2_200, maxHashtags: 30 },
};
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions/i,
  /(?:system|developer)\s+prompt/i,
  /you\s+are\s+now\s+(?:an?|the)/i,
  /reveal\s+(?:your|the)\s+(?:prompt|instructions)/i,
  /bypass\s+(?:the\s+)?(?:guardrails|safety)/i,
];

function result(
  kind: CriticKind,
  patch: Partial<CriticResult>,
): CriticResult {
  return {
    kind,
    verdict: 'pass',
    severity: 'advisory',
    confidence: 1,
    evidence: [],
    repairs: [],
    provider: 'deterministic',
    model: `rules-${RULE_VERSION}`,
    ...patch,
  };
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeText(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function concreteClaims(content: string): string[] {
  const patterns = [
    /(?:A\$|\$|AUD\s*)\d+(?:\.\d{1,2})?/gi,
    /\b\d{1,3}(?:\.\d+)?\s?%(?!\w)/g,
    /\b(?:\+?61|0)[2-478](?:[\s-]?\d){8}\b/g,
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g,
    /\b\d{1,5}\s+[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3}\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Highway|Hwy)\b/gi,
    /\b(?:free|half[ -]price|buy one get one|limited offer|save\s+\d+(?:\.\d+)?\s?%)\b/gi,
  ];
  return [...new Set(patterns.flatMap((pattern) => content.match(pattern) ?? []))];
}

export function runDeterministicCritics(
  input: TextCriticCandidate,
  context: TextCriticContext,
): CriticResult[] {
  const combinedText = `${input.content}\n${input.hashtags.join(' ')}`;
  const forbidden = scanForForbidden(combinedText, context.forbiddenSubjects);
  const promptInjection = PROMPT_INJECTION_PATTERNS.some((pattern) =>
    pattern.test(combinedText),
  );
  const brandEvidence = ['brand.denylist', 'brand.prompt_injection'];
  const brand = forbidden || promptInjection
    ? result('brand', {
        verdict: 'block',
        severity: 'release_critical',
        evidence: [
          ...brandEvidence,
          ...(forbidden ? [`Forbidden subject detected: ${forbidden}`] : []),
        ],
      })
    : result('brand', { evidence: brandEvidence });

  const trustedCorpus = normalizeText(
    `${JSON.stringify(context.profile)} ${context.verifiedFacts.join(' ')}`,
  );
  const unsupportedClaims = concreteClaims(input.content).filter(
    (claim) => !trustedCorpus.includes(normalizeText(claim)),
  );
  const fact = unsupportedClaims.length > 0
    ? result('fact', {
        verdict: 'warn_repairable',
        severity: 'release_critical',
        evidence: ['fact.verified_claims', ...unsupportedClaims],
        repairs: [
          `Remove or replace unsupported claims: ${unsupportedClaims.join(', ')}`,
        ],
      })
    : result('fact', { evidence: ['fact.verified_claims'] });

  const nearestDuplicate = context.recentPostDigests.find(
    (recent) =>
      normalizeText(recent) === normalizeText(input.content) ||
      tokenSimilarity(recent, input.content) >= 0.8,
  );
  const repetition = nearestDuplicate
    ? result('repetition', {
        verdict: 'warn_repairable',
        evidence: ['repetition.near_duplicate'],
        repairs: ['Rewrite with a materially different hook and structure'],
      })
    : result('repetition', { evidence: ['repetition.near_duplicate'] });

  const platform = input.platform.toLowerCase();
  const limits = PLATFORM_LIMITS[platform] ?? PLATFORM_LIMITS.facebook;
  const platformRepairs: string[] = [];
  if (input.content.length > limits.maxCaption) {
    platformRepairs.push(`Shorten caption to ${limits.maxCaption} characters or fewer`);
  }
  if (input.hashtags.length > limits.maxHashtags) {
    platformRepairs.push(`Reduce hashtags to ${limits.maxHashtags} or fewer`);
  }
  const platformResult = platformRepairs.length > 0
    ? result('platform', {
        verdict: 'warn_repairable',
        severity: 'release_critical',
        evidence: [`platform.${RULE_VERSION}`],
        repairs: platformRepairs,
      })
    : result('platform', { evidence: [`platform.${RULE_VERSION}`] });

  return [brand, fact, repetition, platformResult];
}
