import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminLearningOperations, LearningPilotQueue } from '../services/db';
import { LearningOperationsCard } from './AdminCustomers';

const operations: AdminLearningOperations = {
  policyVersion: '2026-07-14-v1',
  globalSwitches: {
    learningBrain: true, releaseEnforcement: false, protectedAutopilot: false,
  },
  releaseEvidence: {
    validCount: 9, requiredCount: 9, invalidOrMissingCount: 0,
    expiredCount: 0, complete: true, nextExpiryAt: '2099-07-21T08:00:00.000Z',
  },
  readiness: {
    ready: false, stale: false, evaluatedAt: '2026-07-14T08:00:00.000Z',
    checks: { pilot: false },
    metrics: {
      pilotDecisions: 12, pilotWorkspaceCount: 2,
      pilotUserDecisions: 5, pilotClientDecisions: 7, adjudicatedDecisions: 8,
      predictionSampleCount: 6, predictionWorkspaceCount: 2,
      predictionMinWorkspaceSamples: 2,
    },
  },
  workspaces: [{
    userId: 'owner_1', workspaceKey: 'client_1', clientId: 'client_1',
    ownerKind: 'client', ownerId: 'client_1', mode: 'approval',
    consentAt: null, consentPolicyVersion: null, active: false, onHold: true,
    decisionCount: 20, holdRate: 0.2, sampledFalseHoldRate: 0.1,
    criticAvailability: 0.99, judgeAvailability: 1, judgeTelemetryCoverage: 1,
    severeFalsePasses: 0, adjudicationCoverage: 0.5,
    globalKillSwitchEnabled: false, updatedAt: '2026-07-14T08:00:00.000Z',
    sampleDecisionId: 'decision_1', samplePostId: 'post_1',
    sampleEvidenceStatus: 'verified',
    sampleEvidence: {
      content: 'Fresh brisket, smoked low and slow in Gladstone.',
      platform: 'facebook',
      hashtags: ['#GladstoneEats', '#LowAndSlow'],
      mediaKind: 'image',
      mediaUrl: 'https://cdn.example.test/brisket.jpg',
      thumbnailUrl: null,
      videoScript: null,
      videoShots: [],
      contentHash: 'a'.repeat(64),
    },
  }],
};

const pilotQueue: LearningPilotQueue = {
  recordOnly: true,
  candidates: [
    {
      clientId: null, ownerKind: 'user', ownerId: 'owner_1',
      workspaceKey: '__owner__', label: 'My workspace', eligibleDraftCount: 5,
      samplePostId: 'draft_owner', enrolled: true, monthlyAiBudgetUsdCents: 500,
      contextReady: true, contextReason: 'business_profile',
      meaningfulProfileFieldCount: 2, verifiedFactCount: 0,
      sampleDraft: {
        postId: 'draft_owner',
        content: 'A real owner post about a completed workflow automation project.',
        platform: 'facebook', hashtags: '["#Automation"]',
        imageUrl: 'https://cdn.example.test/owner-project.jpg',
        postType: 'image', videoUrl: null, contentHash: 'a'.repeat(64),
      },
    },
    {
      clientId: 'client_2', ownerKind: 'client', ownerId: 'client_2',
      workspaceKey: 'client_2', label: 'Active Client', eligibleDraftCount: 4,
      samplePostId: 'draft_client', enrolled: false, monthlyAiBudgetUsdCents: null,
      contextReady: true, contextReason: 'verified_facts',
      meaningfulProfileFieldCount: 0, verifiedFactCount: 3,
    },
  ],
};

describe('LearningOperationsCard', () => {
  it('shows all protected-autopilot operational evidence and on-hold state', () => {
    const html = renderToStaticMarkup(
      <LearningOperationsCard
        operations={operations}
        loading={false}
        savingDecisionId={null}
        onAdjudicate={async () => undefined}
      />,
    );

    expect(html).toContain('Learning and Protected Autopilot operations');
    expect(html).toContain('Release readiness pending');
    expect(html).toContain('Kill switch engaged');
    expect(html).toContain('12 / 30 decisions');
    expect(html).toContain('18 remaining');
    expect(html).toContain('Workspaces');
    expect(html).toContain('2 / 2');
    expect(html).toContain('User decisions');
    expect(html).toContain('Client decisions');
    expect(html).toContain('Adjudicated');
    expect(html).toContain('8 / 30');
    expect(html).toContain('7-day outcomes');
    expect(html).toContain('6 / 20');
    expect(html).toContain('Outcome workspaces');
    expect(html).toContain('Minimum per workspace');
    expect(html).toContain('2 / 8');
    expect(html).toContain('9 / 9 valid receipts');
    expect(html).toContain('Read-only status: this panel cannot enable autopilot, schedule, or publish posts');
    expect(html).toContain('On hold');
    expect(html).toContain('Approval');
    expect(html).toContain('No current-policy consent');
    expect(html).toContain('Hold rate');
    expect(html).toContain('20.0%');
    expect(html).toContain('Sampled false holds');
    expect(html).toContain('10.0%');
    expect(html).toContain('Critic availability');
    expect(html).toContain('99.0%');
    expect(html).toContain('Judge availability');
    expect(html).toContain('Judge telemetry coverage');
    expect(html).toContain('100.0%');
    expect(html).toContain('Severe false passes');
    expect(html).toContain('Adjudication coverage');
    expect(html).toContain('50.0%');
  });

  it('keeps the server-selected receipt blind until an independent audit label is chosen', () => {
    const html = renderToStaticMarkup(
      <LearningOperationsCard
        operations={operations}
        loading={false}
        savingDecisionId={null}
        onAdjudicate={async () => undefined}
      />,
    );

    expect(html).toContain('Sample receipt decision_1');
    expect(html).toContain('Post post_1');
    expect(html).not.toContain('Observed hold amber');
    expect(html).toContain('Observed release state is hidden until this label is saved');
    expect(html).toContain('Receipt source verified');
    expect(html).toContain('Fresh brisket, smoked low and slow in Gladstone.');
    expect(html).toContain('#GladstoneEats');
    expect(html).toContain('https://cdn.example.test/brisket.jpg');
    expect(html).toContain('Expected release state');
    expect(html).toContain('<option value="" disabled="" selected="">Choose independently</option>');
    expect(html).toContain('Audit severity');
    expect(html).toContain('Required audit note');
    expect(html).toContain('Save audit label');
    expect(html).toContain('cannot approve, schedule, or publish');
    expect(html).not.toContain('Approve post');
    expect(html).not.toContain('Schedule post');
    expect(html).not.toContain('Publish post');
  });

  it('warns when current-policy release evidence is incomplete or expired', () => {
    const incompleteOperations: AdminLearningOperations = {
      ...operations,
      releaseEvidence: {
        validCount: 6, requiredCount: 9, invalidOrMissingCount: 3,
        expiredCount: 2, complete: false, nextExpiryAt: null,
      },
    };
    const html = renderToStaticMarkup(
      <LearningOperationsCard
        operations={incompleteOperations}
        loading={false}
        savingDecisionId={null}
        onAdjudicate={async () => undefined}
      />,
    );

    expect(html).toContain('6 / 9 valid receipts');
    expect(html).toContain('No valid receipt expiry available');
    expect(html).toContain('3 current-policy receipts missing or invalid');
    expect(html).toContain('2 expired');
  });

  it('stays usable when the frontend deploys before the operations endpoint update', () => {
    const legacyOperations: AdminLearningOperations = {
      ...operations,
      releaseEvidence: undefined,
    };
    const html = renderToStaticMarkup(
      <LearningOperationsCard
        operations={legacyOperations}
        loading={false}
        savingDecisionId={null}
        onAdjudicate={async () => undefined}
      />,
    );

    expect(html).toContain('0 / 9 valid receipts');
    expect(html).toContain('9 current-policy receipts missing or invalid');
    expect(html).toContain('Read-only status');
  });

  it('does not offer an audit label when receipt source evidence is stale', () => {
    const staleOperations: AdminLearningOperations = {
      ...operations,
      workspaces: operations.workspaces.map((workspace) => ({
        ...workspace,
        sampleEvidenceStatus: 'stale',
        sampleEvidence: null,
      })),
    };
    const html = renderToStaticMarkup(
      <LearningOperationsCard
        operations={staleOperations}
        loading={false}
        savingDecisionId={null}
        onAdjudicate={async () => undefined}
      />,
    );

    expect(html).toContain('Source evidence changed or is unavailable');
    expect(html).toContain('Create a fresh receipt before independent review');
    expect(html).not.toContain('Expected release state');
    expect(html).not.toContain('Save audit label');
  });

  it('shows a record-only pilot queue with explicit enrollment and single-draft validation actions', () => {
    const html = renderToStaticMarkup(
      <LearningOperationsCard
        operations={operations}
        pilotQueue={pilotQueue}
        pilotActionKey={null}
        loading={false}
        savingDecisionId={null}
        onAdjudicate={async () => undefined}
        onPilotEnroll={async () => undefined}
        onPilotValidate={async () => undefined}
      />,
    );

    expect(html).toContain('Approval pilot queue');
    expect(html).toContain('My workspace');
    expect(html).toContain('Active Client');
    expect(html).toContain('5 eligible real drafts');
    expect(html).toContain('4 eligible real drafts');
    expect(html).toContain('Enroll with $5.00 cap');
    expect(html).toContain('Exact server-selected draft');
    expect(html).toContain('A real owner post about a completed workflow automation project.');
    expect(html).toContain('fingerprint aaaaaaaaaaaaaaaa');
    expect(html).toContain('Confirm and validate exact draft');
    expect(html).toContain('I reviewed the exact draft shown above');
    expect(html).toContain('This creates an immutable pilot receipt for this exact draft version');
    expect(html).toContain('It does not approve, schedule, or publish the post');
    expect(html).toContain('aria-label="Confirm exact real draft for My workspace"');
    expect(html).toContain('Context ready');
    expect(html).toContain('Critic context ready: 2 business profile fields');
    expect(html).toContain('Critic context ready: 3 verified facts');
    expect(html).toContain('profile contents and verified facts stay private');
    expect(html).toContain('Draft content, status, schedule, and publishing stay unchanged');
    expect(html).toContain('No autopublish consent is recorded');
    expect(html).toContain('Customer pilot consent attestation: Active Client');
    expect(html).toContain('aria-label="Confirm record-only consent for Active Client"');
    expect(html).toContain('aria-label="Consent evidence note for Active Client"');
    expect(html).toContain('Active Client enrollment stays disabled until both are complete');
  });

  it('fails closed when an enrolled workspace has no exact draft preview', () => {
    const missingPreviewQueue: LearningPilotQueue = {
      recordOnly: true,
      candidates: [{ ...pilotQueue.candidates[0], sampleDraft: null }],
    };
    const html = renderToStaticMarkup(
      <LearningOperationsCard
        operations={operations}
        pilotQueue={missingPreviewQueue}
        pilotActionKey={null}
        loading={false}
        savingDecisionId={null}
        onAdjudicate={async () => undefined}
        onPilotEnroll={async () => undefined}
        onPilotValidate={async () => undefined}
      />,
    );

    expect(html).toContain('Exact draft evidence is unavailable');
    expect(html).toContain('Exact draft preview required');
    const labelIndex = html.indexOf('Exact draft preview required');
    const buttonStart = html.lastIndexOf('<button', labelIndex);
    const buttonTag = html.slice(buttonStart, html.indexOf('>', buttonStart) + 1);
    expect(buttonTag).toContain('disabled=""');
  });

  it('binds consent controls to each exact client workspace instead of sharing one attestation', () => {
    const queueWithTwoClients: LearningPilotQueue = {
      ...pilotQueue,
      candidates: [
        ...pilotQueue.candidates,
        {
          clientId: 'client_two', ownerKind: 'client', ownerId: 'client_two',
          workspaceKey: 'client_two', label: 'Second Client', eligibleDraftCount: 2,
          samplePostId: 'draft_client_two', enrolled: false,
          monthlyAiBudgetUsdCents: null,
          contextReady: true, contextReason: 'business_profile',
          meaningfulProfileFieldCount: 1, verifiedFactCount: 0,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <LearningOperationsCard
        operations={operations}
        pilotQueue={queueWithTwoClients}
        pilotActionKey={null}
        loading={false}
        savingDecisionId={null}
        onAdjudicate={async () => undefined}
        onPilotEnroll={async () => undefined}
        onPilotValidate={async () => undefined}
      />,
    );

    expect(html).toContain('Customer pilot consent attestation: Active Client');
    expect(html).toContain('Customer pilot consent attestation: Second Client');
    expect(html).toContain('aria-label="Confirm record-only consent for Active Client"');
    expect(html).toContain('aria-label="Confirm record-only consent for Second Client"');
    expect(html).toContain('aria-label="Consent evidence note for Active Client"');
    expect(html).toContain('aria-label="Consent evidence note for Second Client"');
  });

  it('blocks pilot actions before spend when canonical business context is incomplete', () => {
    const contextBlockedQueue: LearningPilotQueue = {
      recordOnly: true,
      candidates: [{
        ...pilotQueue.candidates[0],
        contextReady: false,
        contextReason: 'missing_business_context',
        meaningfulProfileFieldCount: 0,
        verifiedFactCount: 0,
      }],
    };
    const html = renderToStaticMarkup(
      <LearningOperationsCard
        operations={operations}
        pilotQueue={contextBlockedQueue}
        pilotActionKey={null}
        loading={false}
        savingDecisionId={null}
        onAdjudicate={async () => undefined}
        onPilotEnroll={async () => undefined}
        onPilotValidate={async () => undefined}
      />,
    );

    expect(html).toContain('Context required');
    expect(html).toContain('Business context is incomplete');
    expect(html).toContain('Critics and AI spend remain blocked');
    expect(html).toContain('<button type="button" disabled=""');
    expect(html).toContain('Business context required</button>');
    expect(html).not.toContain('Confirm and validate real draft');
  });
});
