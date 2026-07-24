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
  currentVerifiedFacts?: string[];
  forbiddenSubjects: string[];
  recentPostDigests: string[];
}

const RULE_VERSION = '2026-07-24';
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
const VOLATILE_EVENT_PATTERN =
  /\b(?:tickets?|admission|entry fee|family pass|festival|event|competition|live music|market stalls?|food vendors?|cooking (?:demos?|demonstrations?)|workshops?|doors open|all day|father'?s day|mother'?s day|this weekend|next weekend|today|tomorrow|limited time|bookings?|rsvp)\b/i;
const MATERIAL_STOP_WORDS = new Set([
  'a',
  'all',
  'an',
  'and',
  'at',
  'bring',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'our',
  'the',
  'to',
  'with',
  'your',
]);

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
  const months =
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const patterns = [
    /(?:A\$|\$|AUD\s*)\d+(?:\.\d{1,2})?/gi,
    /\b\d{1,3}(?:\.\d+)?\s?%(?!\w)/g,
    /\b(?:\+?61|0)[2-478](?:[\s-]?\d){8}\b/g,
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g,
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${months}(?:\\s+\\d{4})?\\b`, 'gi'),
    new RegExp(`\\b${months}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'gi'),
    /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)(?:\s*[-\u2013]\s*\d{1,2}(?::\d{2})?\s?(?:am|pm))?\b/gi,
    /\b(?:father'?s|mother'?s)\s+day(?:\s+weekend)?\b/gi,
    /\b\d{1,5}\s+[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3}\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Highway|Hwy)\b/gi,
    /\b(?:free|half[ -]price|buy one get one|limited offer|save\s+\d+(?:\.\d+)?\s?%)\b/gi,
  ];
  return [...new Set(patterns.flatMap((pattern) => content.match(pattern) ?? []))];
}

function materialTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !MATERIAL_STOP_WORDS.has(token));
}

function currentFactCoverage(claim: string, currentFactCorpus: string): number {
  const tokens = [...new Set(materialTokens(claim))];
  if (tokens.length === 0 || !currentFactCorpus) return 0;
  const corpusTokens = new Set(materialTokens(currentFactCorpus));
  return tokens.filter((token) => corpusTokens.has(token)).length / tokens.length;
}

function volatileEventClaims(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && VOLATILE_EVENT_PATTERN.test(segment));
}

function conciseEvidence(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
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

  // Profiles guide brand voice but are not proof for volatile commercial claims.
  const currentFactCorpus = normalizeText(
    (context.currentVerifiedFacts ?? context.verifiedFacts).join(' '),
  );
  const unsupportedConcreteClaims = concreteClaims(input.content).filter(
    (claim) => !currentFactCorpus.includes(normalizeText(claim)),
  );
  const unsupportedEventClaims = volatileEventClaims(input.content).filter(
    (claim) => currentFactCoverage(claim, currentFactCorpus) < 0.6,
  );
  const unsupportedClaims = [
    ...unsupportedConcreteClaims,
    ...unsupportedEventClaims.map((claim) => `Event detail: ${conciseEvidence(claim)}`),
  ];
  const fact = unsupportedClaims.length > 0
    ? result('fact', {
        verdict: 'warn_repairable',
        severity: 'release_critical',
        evidence: [
          'fact.current_verified_claims',
          ...unsupportedClaims.slice(0, 3),
        ],
        repairs: [
          'Remove or replace unsupported prices, dates, venues, offers, availability, and event details using current verified facts only.',
        ],
      })
    : result('fact', {
        evidence: ['fact.verified_claims', 'fact.current_verified_claims'],
      });

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
