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
  readiness: {
    ready: false, stale: false, evaluatedAt: '2026-07-14T08:00:00.000Z',
    checks: { pilot: false }, metrics: { pilotDecisions: 12 },
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
    sampleReleaseState: 'hold_amber',
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

  it('allows only an audit label on a server-selected unadjudicated receipt', () => {
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
    expect(html).toContain('Observed hold amber');
    expect(html).toContain('Expected release state');
    expect(html).toContain('Audit severity');
    expect(html).toContain('Required audit note');
    expect(html).toContain('Save audit label');
    expect(html).toContain('cannot approve, schedule, or publish');
    expect(html).not.toContain('Approve post');
    expect(html).not.toContain('Schedule post');
    expect(html).not.toContain('Publish post');
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
    expect(html).toContain('Customer pilot consent attestation');
    expect(html).toContain('Consent evidence note');
    expect(html).toContain('Client enrollment stays disabled until both are complete');
  });
});
