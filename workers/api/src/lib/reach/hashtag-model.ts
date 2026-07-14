import type { OrganicPlatform } from './types';

export const FACEBOOK_HASHTAG_LIMIT = 3;
export const INSTAGRAM_HASHTAG_LIMIT = 8;

export interface HashtagCandidate {
  term: string;
  platforms: readonly OrganicPlatform[];
  score: number;
  evidence?: string;
}

export interface HashtagPlanInput {
  locationTerms: string[];
  categoryTerms: string[];
  brandTerms: string[];
  candidates: HashtagCandidate[];
  forbiddenTerms?: string[];
}

export interface HashtagPlan {
  localKeywords: string[];
  facebookTags: string[];
  instagramTags: string[];
  excluded: string[];
  evidence: string[];
}

const SPAM_TERMS = new Set([
  'follow4follow', 'f4f', 'like4like', 'l4l', 'followme',
  'instagood', 'viral', 'explorepage', 'gainfollowers',
]);

function normalizeTerm(term: string): string {
  return term
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildHashtagPlan(input: HashtagPlanInput): HashtagPlan {
  const forbidden = new Set((input.forbiddenTerms ?? []).map(normalizeTerm).filter(Boolean));
  const excluded: string[] = [];
  const isAllowed = (term: string): boolean => {
    const normalized = normalizeTerm(term);
    const allowed = Boolean(normalized)
      && !SPAM_TERMS.has(normalized)
      && !forbidden.has(normalized);
    if (!allowed && normalized) excluded.push(normalized);
    return allowed;
  };
  const normalizeAllowed = (terms: string[]): string[] => unique(
    terms.filter(isAllowed).map(normalizeTerm),
  );
  const localKeywords = normalizeAllowed(input.locationTerms);
  const categoryKeywords = normalizeAllowed(input.categoryTerms);
  const brandKeywords = normalizeAllowed(input.brandTerms);
  const candidates = [...input.candidates]
    .filter((candidate) => isAllowed(candidate.term))
    .sort((a, b) => b.score - a.score);

  const tagsFor = (platform: OrganicPlatform, limit: number): string[] => {
    const candidateTerms = candidates
      .filter((candidate) => candidate.platforms.includes(platform))
      .map((candidate) => normalizeTerm(candidate.term));
    return unique([
      ...localKeywords,
      ...candidateTerms,
      ...categoryKeywords,
      ...brandKeywords,
    ]).slice(0, limit).map((term) => `#${term}`);
  };

  const evidence = unique([
    ...(input.candidates.length === 0 ? ['verified fallback terms'] : []),
    ...candidates.map((candidate) => candidate.evidence ?? 'account hashtag evidence'),
  ]);

  return {
    localKeywords,
    facebookTags: tagsFor('facebook', FACEBOOK_HASHTAG_LIMIT),
    instagramTags: tagsFor('instagram', INSTAGRAM_HASHTAG_LIMIT),
    excluded: unique(excluded),
    evidence,
  };
}
