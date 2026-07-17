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
    },
  },
  workspaces: [{
    userId: 'owner_1', workspaceKey: 'client_1', clientId: 'client_1',
    ownerKind: 'client', ownerId: 'client_1', mode: 'approval',
    consentAt: null, consentPolicyVersion: null, active: false, onHold: true,
    decisionCount: 20, holdRate: 0.2, sampledFalseHoldRate: 0.1,
    criticAvailability: 0.99, judgeAvailability: 1,
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
    },
    {
      clientId: 'client_2', ownerKind: 'client', ownerId: 'client_2',
      workspaceKey: 'client_2', label: 'Active Client', eligibleDraftCount: 4,
      samplePostId: 'draft_client', enrolled: false, monthlyAiBudgetUsdCents: null,
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
    expect(html).toContain('Judge receipt availability');
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
    expect(html).toContain('Validate next real draft');
    expect(html).toContain('Draft content, status, schedule, and publishing stay unchanged');
    expect(html).toContain('No autopublish consent is recorded');
    expect(html).toContain('Customer pilot consent attestation: Active Client');
    expect(html).toContain('aria-label="Confirm record-only consent for Active Client"');
    expect(html).toContain('aria-label="Consent evidence note for Active Client"');
    expect(html).toContain('Active Client enrollment stays disabled until both are complete');
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
});
