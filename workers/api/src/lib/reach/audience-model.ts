import type { Env } from '../../env';
import { callIndependentJson } from '../learning/independent-json';
import { loadCriticContext } from '../learning/critic-context';
import { UNTRUSTED_CONTENT_DIRECTIVE, wrapUntrusted } from '../prompt-safety';
import { assertConfirmedReachProfile, type ReachProfile } from './types';

export interface AudienceSegmentProposal {
  label: string;
  needs: string[];
  messageAngles: string[];
  suitableOffers: string[];
  evidence: string[];
  confidence: number;
}

export interface AudienceSegment extends AudienceSegmentProposal {
  id: string;
  status: 'predicted' | 'confirmed' | 'disabled';
}

interface AudienceModelDeps {
  callJson: typeof callIndependentJson;
  loadContext: typeof loadCriticContext;
  randomId: () => string;
}

const defaultDeps: AudienceModelDeps = {
  callJson: callIndependentJson,
  loadContext: loadCriticContext,
  randomId: () => crypto.randomUUID(),
};

const PROTECTED_PATTERNS = [
  /\b(?:religion|religious|christian|muslim|jewish|hindu|buddhist)\b/i,
  /\b(?:race|racial|ethnicity|ethnic|aboriginal|torres strait islander)\b/i,
  /\b(?:disability|disabled|autis(?:m|tic)|wheelchair)\b/i,
  /\b(?:medical|diabet(?:es|ic)|cancer|depression|mental health|health condition)\b/i,
  /\b(?:sexual orientation|gay|lesbian|bisexual|transgender)\b/i,
  /\b(?:political|party voters?|labor voters?|liberal voters?|greens voters?)\b/i,
  /\b(?:financial hardship|low income|in debt|bankrupt|financially vulnerable)\b/i,
  /\b(?:aged?|ages?)\s*(?:between\s*)?\d{1,3}\b/i,
  /\b(?:under|over)\s+\d{1,3}\s*(?:years? old)?\b/i,
  /\b\d{1,3}\s*(?:-|to)\s*\d{1,3}\s*(?:year[- ]olds?|years? old)\b/i,
];

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Audience segment ${field} must be an array`);
  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  if (strings.length !== value.length) {
    throw new Error(`Audience segment ${field} contains invalid values`);
  }
  return strings;
}

export function validateAudienceSegments(
  input: AudienceSegmentProposal[],
): AudienceSegmentProposal[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Audience proposal requires commercial segments');
  }

  const validated = input.slice(0, 5).map((raw) => {
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    const needs = requireStringArray(raw.needs, 'needs');
    const messageAngles = requireStringArray(raw.messageAngles, 'messageAngles');
    const suitableOffers = requireStringArray(raw.suitableOffers, 'suitableOffers');
    const evidence = requireStringArray(raw.evidence, 'evidence');
    const confidence = Number(raw.confidence);
    if (!label || needs.length === 0 || (messageAngles.length === 0 && suitableOffers.length === 0)) {
      throw new Error('Audience segment requires a broad commercial need and buying context');
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error('Audience segment confidence must be between zero and one');
    }

    const text = [label, ...needs, ...messageAngles, ...suitableOffers, ...evidence]
      .join(' ');
    if (PROTECTED_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new Error('Audience segment contains protected targeting');
    }

    return {
      label,
      needs,
      messageAngles,
      suitableOffers,
      evidence,
      confidence,
    };
  });

  return validated;
}

export async function proposeAudienceSegments(
  env: Env,
  reachProfile: ReachProfile,
  deps: AudienceModelDeps = defaultDeps,
): Promise<AudienceSegment[]> {
  assertConfirmedReachProfile(reachProfile);
  const context = await deps.loadContext(
    env,
    reachProfile.userId,
    reachProfile.clientId,
    reachProfile.ownerKind,
    reachProfile.ownerId,
  );
  const systemPrompt = [
    'You are a commercial audience planner for organic Facebook and Instagram posts.',
    'Return JSON only with a segments array containing three to five broad buying contexts.',
    'Never infer or target protected traits, precise ages, health, politics, or hardship.',
    'Every segment must be supported by the confirmed geography or supplied verified facts.',
    UNTRUSTED_CONTENT_DIRECTIVE,
  ].join('\n');
  const verifiedFacts = context.verifiedFacts.map((fact) => ({
    factType: fact.factType,
    content: fact.content,
    verifiedAt: fact.verifiedAt,
  }));
  const prompt = [
    `CONFIRMED_GEOGRAPHY=${JSON.stringify({
      timezone: reachProfile.timezone,
      baseLocation: reachProfile.baseLocation,
      serviceArea: reachProfile.serviceArea,
      excludedLocations: reachProfile.excludedLocations,
    })}`,
    wrapUntrusted(JSON.stringify(context.profile), 'business_profile', { maxLen: 5000 }),
    wrapUntrusted(JSON.stringify(verifiedFacts), 'verified_facts', { maxLen: 12000 }),
    'Schema per segment: label, needs[], messageAngles[], suitableOffers[], evidence[], confidence.',
  ].join('\n\n');
  const result = await deps.callJson(env, systemPrompt, prompt, {
    operation: 'reach_audience_proposal',
    userId: reachProfile.userId,
    clientId: reachProfile.clientId,
    postId: null,
  });
  const parsed = JSON.parse(result.text) as {
    segments?: AudienceSegmentProposal[];
  };
  const rawSegments = parsed.segments ?? [];
  if (rawSegments.length < 3 || rawSegments.length > 5) {
    throw new Error('AI audience proposal must contain three to five segments');
  }
  const proposals = validateAudienceSegments(rawSegments);
  const segments = proposals.map((proposal) => ({
    ...proposal,
    id: deps.randomId(),
    status: 'predicted' as const,
  }));
  const statements = segments.map((segment) => env.DB.prepare(`
    INSERT INTO audience_segments (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,
      reach_profile_id,label,needs_json,evidence_json,confidence,status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    segment.id,
    reachProfile.userId,
    reachProfile.workspaceKey,
    reachProfile.clientId,
    reachProfile.ownerKind,
    reachProfile.ownerId,
    reachProfile.id,
    segment.label,
    JSON.stringify({
      needs: segment.needs,
      messageAngles: segment.messageAngles,
      suitableOffers: segment.suitableOffers,
    }),
    JSON.stringify(segment.evidence),
    segment.confidence,
    segment.status,
  ));
  if (statements.length > 0) await env.DB.batch(statements);
  return segments;
}
