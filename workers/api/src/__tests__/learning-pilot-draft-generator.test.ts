import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { CriticContext } from '../lib/learning/critic-context';
import {
  generateRecordOnlyPilotDraft,
  type PilotDraftGeneratorDeps,
} from '../lib/learning/pilot-draft-generator';
import { normalizeWorkspaceIdentity } from '../lib/learning/types';

const identity = normalizeWorkspaceIdentity(
  'owner-1',
  null,
  'user',
  'owner-1',
);

const context: CriticContext = {
  profile: {
    description: 'Custom software and workflow automation for Australian small businesses.',
    targetAudience: 'Small business owners with repetitive admin workflows.',
  },
  verifiedFacts: [{
    ownerKind: 'user',
    ownerId: 'owner-1',
    clientId: null,
    factType: 'business_profile',
    content: 'The business builds custom software and workflow automation.',
    verifiedAt: '2026-07-20T00:00:00.000Z',
  }],
  recentPosts: [{
    id: 'recent-1',
    ownerKind: 'user',
    ownerId: 'owner-1',
    clientId: null,
    content: 'A website should make the next customer action obvious.',
    platform: 'facebook',
  }],
  forbiddenSubjects: ['gambling'],
};

function safeResponse() {
  return JSON.stringify({
    content: 'A smoother workflow starts by mapping one repeated handoff before choosing software. Which task creates the most friction in your week?',
    hashtags: ['#WorkflowPlanning', '#SmallBusiness'],
    imagePrompt: 'Bright natural-light photograph of a small business owner mapping a repeated workflow with blank sticky notes on a desk, no readable text, no logos',
  });
}

function depsFor(...responses: string[]): PilotDraftGeneratorDeps {
  const queue = [...responses];
  return {
    callJson: vi.fn(async () => ({
      text: queue.shift() ?? safeResponse(),
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    })),
  };
}

describe('record-only pilot draft generator', () => {
  it('returns bounded genuine output only after deterministic safety checks pass', async () => {
    const deps = depsFor(safeResponse());

    const result = await generateRecordOnlyPilotDraft(
      {} as Env,
      identity,
      context,
      'pilot-generated-1',
      deps,
    );

    expect(result).toMatchObject({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      attemptCount: 1,
      hashtags: ['#WorkflowPlanning', '#SmallBusiness'],
    });
    const call = vi.mocked(deps.callJson).mock.calls[0];
    expect(call[2]).toContain('<<UNTRUSTED_FROM_BUSINESS_PROFILE>>');
    expect(call[2]).toContain('<<UNTRUSTED_FROM_VERIFIED_FACTS>>');
    expect(call[2]).toContain('This is an isolated staging record only');
    expect(call[3]).toEqual({
      operation: 'learning_pilot_draft_generation',
      userId: 'owner-1',
      clientId: null,
      postId: 'pilot-generated-1',
    });
  });

  it('retries once when deterministic guards reject fabricated claims', async () => {
    const fabricated = JSON.stringify({
      content: 'Our automation boosts results by 45% and saves five hours every week for every business.',
      hashtags: ['#Automation'],
      imagePrompt: 'Bright photograph of an automation workflow mapped on blank cards, no readable text',
    });
    const deps = depsFor(fabricated, safeResponse());

    const result = await generateRecordOnlyPilotDraft(
      {} as Env,
      identity,
      context,
      'pilot-generated-2',
      deps,
    );

    expect(result.attemptCount).toBe(2);
    expect(deps.callJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.callJson).mock.calls[1][2]).toContain(
      'prior attempt was rejected by deterministic guards',
    );
  });

  it('retries unsupported first-person customer evidence before creating a receipt', async () => {
    const unsupported = JSON.stringify({
      content: 'Most small businesses we work with find at least one handoff where the same information gets entered twice.',
      hashtags: ['#WorkflowAutomation'],
      imagePrompt: 'Bright photograph of a small business owner mapping one repeated handoff with blank cards on a desk, no readable text',
    });
    const deps = depsFor(unsupported, safeResponse());

    const result = await generateRecordOnlyPilotDraft(
      {} as Env,
      identity,
      context,
      'pilot-generated-customer-evidence',
      deps,
    );

    expect(result.attemptCount).toBe(2);
    expect(deps.callJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.callJson).mock.calls[1][2]).toContain(
      'unsupported generalized customer-experience claim',
    );
  });

  it.each([
    ['forbidden subject', JSON.stringify({
      content: 'A gambling workflow needs the same careful process mapping as any repeated task.',
      hashtags: ['#Workflow'],
      imagePrompt: 'Bright photograph of a gambling workflow mapped on blank cards, no readable text',
    })],
    ['irrelevant generic technology image', JSON.stringify({
      content: 'A smoother workflow starts by mapping the repeated handoff that causes friction.',
      hashtags: ['#Workflow'],
      imagePrompt: 'Close-up photograph of a glowing circuit board and floating digital network icons',
    })],
    ['unexpected response field', JSON.stringify({
      content: 'A smoother workflow starts by mapping the repeated handoff that causes friction.',
      hashtags: ['#Workflow'],
      imagePrompt: 'Bright photograph of a repeated workflow mapped on blank cards, no readable text',
      approved: true,
    })],
  ])('fails closed after two attempts for %s', async (_label, response) => {
    const deps = depsFor(response, response);

    await expect(generateRecordOnlyPilotDraft(
      {} as Env,
      identity,
      context,
      'pilot-generated-unsafe',
      deps,
    )).rejects.toThrow('Pilot draft generation failed closed');
    expect(deps.callJson).toHaveBeenCalledTimes(2);
  });
});
