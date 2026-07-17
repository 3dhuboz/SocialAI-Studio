import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LearningReadinessResponse, LearningSettingsResponse } from '../services/db';
import { ProtectedAutopilotControl } from './ProtectedAutopilotPanel';

const settings: LearningSettingsResponse = {
  settings: {
    mode: 'approval', autopublishConsentAt: null, autopublishPolicyVersion: null,
    experimentRate: 0, monthlyAiBudgetUsdCents: 2000,
    disabledReason: null, exists: true,
  },
  effectiveMode: 'approval',
};

const readiness: LearningReadinessResponse = {
  policyVersion: '2026-07-14-v1', ready: false, stale: false,
  effectiveMode: 'approval', evaluatedAt: '2026-07-14T08:00:00.000Z',
  checks: {
    pilot: false, pilotCohort: false, adjudications: false, severeFalsePasses: true,
    falseHolds: true, availability: true,
    releaseJudgeAvailability: true, releaseJudgeTelemetry: true, receipts: true,
    predictionLift: false, rankCorrelation: false, criticalBypasses: true,
    publishingRegressions: true, cost: true, killSwitch: true,
    replayRedTeam: true, publishRegression: true,
    tenancyProofs: { user: true, client: true, shop: true },
  },
  metrics: {
    pilotDecisions: 5, pilotWorkspaceCount: 1,
    pilotUserDecisions: 5, pilotClientDecisions: 0,
    adjudicatedDecisions: 0, severeFalsePasses: 0,
    falseHoldRate: 0, requiredAvailability: 1,
    releaseJudgeAvailability: 1, releaseJudgeTelemetryCoverage: 1,
    releaseJudgeInvocations: 12, decisionReceiptCoverage: 1,
    predictionLift: 0, rankCorrelation: 0, criticalBypasses: 0,
    publishingRegressions: 0, costWithinBudget: true, killSwitchTested: true,
  },
  cost: {
    monthlyAiSpendUsdCents: 120, telemetryCount: 4,
    monthlyAiBudgetUsdCents: 2000, withinBudget: true,
  },
  globalSwitches: {
    learningBrain: true, releaseEnforcement: false, protectedAutopilot: false,
  },
};

describe('ProtectedAutopilotControl', () => {
  it('shows every gate, exact pending reasons, spend, ceiling, and one consent action', () => {
    const html = renderToStaticMarkup(
      <ProtectedAutopilotControl
        settings={settings}
        readiness={readiness}
        budgetDollars="20.00"
        saving={false}
        onBudgetChange={() => undefined}
        onRequestProtected={() => undefined}
        onUseApproval={() => undefined}
      />,
    );

    expect(html).toContain('Approval mode');
    expect(html).toContain('Protected Autopilot is globally disabled');
    expect(html).toContain('Release enforcement is not enabled');
    expect(html).toContain('Pilot decisions');
    expect(html).toContain('5 of 30');
    expect(html).toContain('Owner + client pilot cohort');
    expect(html).toContain('1 of 2 workspaces; owner 5 / client 0');
    expect(html).toContain('Adjudicated decisions');
    expect(html).toContain('Required critic and media availability');
    expect(html).toContain('Release Judge availability');
    expect(html).toContain('Release Judge telemetry coverage');
    expect(html).toContain('12 calls');
    expect(html).toContain('Prediction lift');
    expect(html).toContain('Tenant isolation proofs');
    expect(html).toContain('$1.20');
    expect(html).toContain('$20.00');
    expect(html).toContain('Consent and request Protected Autopilot');
    expect((html.match(/Consent and request Protected Autopilot/g) ?? [])).toHaveLength(1);
    expect(html).toContain('will not activate until every release gate passes');
    expect(html).not.toContain('Approve post');
    expect(html).not.toContain('Review every post');
  });

  it('shows unattended green mode only when the effective mode and all gates are active', () => {
    const greenReadiness: LearningReadinessResponse = {
      ...readiness,
      ready: true,
      effectiveMode: 'protected_autopilot',
      globalSwitches: {
        learningBrain: true, releaseEnforcement: true, protectedAutopilot: true,
      },
    };
    const greenSettings: LearningSettingsResponse = {
      settings: {
        ...settings.settings,
        mode: 'protected_autopilot',
        autopublishConsentAt: '2026-07-14T08:00:00.000Z',
        autopublishPolicyVersion: '2026-07-14-v1',
      },
      effectiveMode: 'protected_autopilot',
    };
    const html = renderToStaticMarkup(
      <ProtectedAutopilotControl
        settings={greenSettings}
        readiness={greenReadiness}
        budgetDollars="20.00"
        saving={false}
        onBudgetChange={() => undefined}
        onRequestProtected={() => undefined}
        onUseApproval={() => undefined}
      />,
    );

    expect(html).toContain('Protected Autopilot active');
    expect(html).toContain('Safe posts can publish unattended');
    expect(html).toContain('Switch to Approval mode');
    expect(html).not.toContain('Consent and request Protected Autopilot');
  });

  it('fails closed when spend telemetry is unavailable', () => {
    const html = renderToStaticMarkup(
      <ProtectedAutopilotControl
        settings={settings}
        readiness={{
          ...readiness,
          cost: {
            ...readiness.cost,
            monthlyAiSpendUsdCents: null,
            telemetryCount: 0,
            withinBudget: false,
          },
        }}
        budgetDollars="20.00"
        saving={false}
        onBudgetChange={() => undefined}
        onRequestProtected={() => undefined}
        onUseApproval={() => undefined}
      />,
    );

    expect(html).toContain('Spend telemetry unavailable');
    expect(html).toContain('cannot activate');
  });

  it('reports an ineligible workspace as off instead of approval mode', () => {
    const html = renderToStaticMarkup(
      <ProtectedAutopilotControl
        settings={{ ...settings, effectiveMode: 'off' }}
        readiness={{ ...readiness, effectiveMode: 'off' }}
        budgetDollars="20.00"
        saving={false}
        onBudgetChange={() => undefined}
        onRequestProtected={() => undefined}
        onUseApproval={() => undefined}
      />,
    );

    expect(html).toContain('Learning safety mode off');
    expect(html).toContain('This workspace is not eligible for learning release mode');
    expect(html).not.toContain('>Approval mode<');
  });

  it('disables consent when the dollar ceiling exceeds safe integer precision', () => {
    const html = renderToStaticMarkup(
      <ProtectedAutopilotControl
        settings={settings}
        readiness={readiness}
        budgetDollars="999999999999999999999999"
        saving={false}
        onBudgetChange={() => undefined}
        onRequestProtected={() => undefined}
        onUseApproval={() => undefined}
      />,
    );

    expect(html).toContain('A positive monthly AI ceiling is required');
    expect(html).toContain('<button type="button" disabled=""');
  });

  it('labels missing publish-regression proof without claiming a real incident', () => {
    const html = renderToStaticMarkup(
      <ProtectedAutopilotControl
        settings={settings}
        readiness={{
          ...readiness,
          checks: {
            ...readiness.checks,
            publishingRegressions: false,
            publishRegression: false,
          },
          metrics: { ...readiness.metrics, publishingRegressions: 1 },
        }}
        budgetDollars="20.00"
        saving={false}
        onBudgetChange={() => undefined}
        onRequestProtected={() => undefined}
        onUseApproval={() => undefined}
      />,
    );

    expect(html).toContain('Validated regression proof pending or failed');
    expect(html).not.toContain('1 recorded');
  });
});

describe('Shopify Protected Autopilot parity', () => {
  it('types and displays both independent Release Judge readiness gates', () => {
    const api = readFileSync(resolve(
      process.cwd(),
      'shopify-app/src/api.ts',
    ), 'utf8');
    const settings = readFileSync(resolve(
      process.cwd(),
      'shopify-app/src/pages/Settings.tsx',
    ), 'utf8');

    for (const field of [
      'pilotCohort',
      'releaseJudgeAvailability',
      'releaseJudgeTelemetry',
    ]) {
      expect(api).toContain(`${field}: boolean`);
      expect(settings).toContain(`readiness.checks.${field} === true`);
    }
    for (const metric of [
      'pilotWorkspaceCount',
      'pilotUserDecisions',
      'pilotClientDecisions',
    ]) {
      expect(api).toContain(`${metric}: number`);
    }
    expect(settings).toContain("['Owner + client pilot cohort'");
    expect(settings).toContain("['Release Judge availability'");
    expect(settings).toContain("['Release Judge telemetry coverage'");
  });
});
