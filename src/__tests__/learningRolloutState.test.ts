import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_ROLLOUT_SQL,
  STAGING_ROLLOUT_SQL,
  assertReadOnlySql,
  buildWranglerInvocation,
  evaluateRolloutState,
  validateReadOnlyD1Results,
  type RolloutObservation,
} from '../../scripts/learning-rollout-state';

const NOW = '2026-07-19T09:20:00.000Z';
const REQUIRED_FLAGS = {
  LEARNING_BRAIN_ENABLED: 'true',
  LEARNING_RELEASE_ENFORCEMENT: 'false',
  LEARNING_AUTOPILOT_ENABLED: 'false',
  ORGANIC_REACH_ENABLED: 'true',
  ORGANIC_REACH_APPLY_ENABLED: 'false',
} as const;

function greenReadiness() {
  return {
    policyVersion: '2026-07-14-v1',
    ready: true,
    evaluatedAt: '2026-07-19T09:15:16.811Z',
    checks: {
      pilot: true,
      pilotCohort: true,
      adjudications: true,
      availability: true,
      releaseJudgeAvailability: true,
      releaseJudgeTelemetry: true,
      receipts: true,
      predictionCoverage: true,
      predictionLift: true,
      rankCorrelation: true,
      cost: true,
      tenancyProofs: { user: true, client: true, shop: true },
    },
  };
}

function observation(): RolloutObservation {
  return {
    generatedAt: NOW,
    maxAgeMinutes: 20,
    offlineProof: {
      valid: true,
      currentCommit: 'a'.repeat(40),
      proofCommit: 'a'.repeat(40),
      gitClean: true,
    },
    staging: {
      healthOk: true,
      versionId: 'staging-version',
      expectedVersionId: 'staging-version',
      environmentBinding: 'staging',
      databaseBindingId: 'staging-db',
      expectedDatabaseBindingId: 'staging-db',
      flags: { ...REQUIRED_FLAGS },
      d1ReadOnly: true,
      protectedWorkspaces: 0,
      pilotSamples: 30,
      ownerSamples: 15,
      clientSamples: 15,
      customerEnrollments: 1,
      latestPilotCron: {
        success: true,
        error: null,
        runAt: '2026-07-19T09:15:16.000Z',
      },
      latestReadinessCron: {
        success: true,
        error: null,
        runAt: '2026-07-19T09:15:17.000Z',
      },
      readiness: greenReadiness(),
    },
    production: {
      healthOk: true,
      versionId: 'production-version',
      expectedVersionId: 'production-version',
      environmentBinding: 'production',
      databaseBindingId: 'production-db',
      expectedDatabaseBindingId: 'production-db',
      flags: { ...REQUIRED_FLAGS },
      d1ReadOnly: true,
      protectedWorkspaces: 0,
      hugheseysQueStatus: 'on_hold',
      pilotSampleTablePresent: true,
      readiness: greenReadiness(),
    },
  };
}

describe('learning live rollout state', () => {
  it('returns promotion_ready only when every safety and live evidence gate passes', () => {
    const result = evaluateRolloutState(observation());

    expect(result.result).toBe('promotion_ready');
    expect(result.safeHold).toBe(true);
    expect(result.promotionReady).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('returns safe_hold for a healthy dormant rollout that still lacks real evidence', () => {
    const input = observation();
    input.staging.expectedVersionId = null;
    input.production.expectedVersionId = null;
    input.staging.pilotSamples = 0;
    input.staging.ownerSamples = 0;
    input.staging.clientSamples = 0;
    input.staging.customerEnrollments = 0;
    input.staging.readiness = {
      ...greenReadiness(),
      ready: false,
      checks: { pilot: false },
    };
    input.production.pilotSampleTablePresent = false;
    input.production.readiness = null;

    const result = evaluateRolloutState(input);

    expect(result.result).toBe('safe_hold');
    expect(result.safeHold).toBe(true);
    expect(result.promotionReady).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'staging_version_attested',
      'production_version_attested',
      'positive_pilot_samples',
      'customer_pilot_consent',
      'production_positive_sample_schema',
    ]));
  });

  it.each([
    ['Hugheseys Que is not on hold', (input: RolloutObservation) => {
      input.production.hugheseysQueStatus = 'active';
    }],
    ['a deployed behavior flag is enabled', (input: RolloutObservation) => {
      input.production.flags.LEARNING_AUTOPILOT_ENABLED = 'true';
    }],
    ['a D1 result cannot prove zero writes', (input: RolloutObservation) => {
      input.staging.d1ReadOnly = false;
    }],
    ['a protected workspace exists before promotion', (input: RolloutObservation) => {
      input.production.protectedWorkspaces = 1;
    }],
    ['the offline proof does not match HEAD', (input: RolloutObservation) => {
      input.offlineProof.proofCommit = 'b'.repeat(40);
    }],
  ])('returns unsafe_or_unverified when %s', (_label, mutate) => {
    const input = observation();
    mutate(input);

    const result = evaluateRolloutState(input);

    expect(result.result).toBe('unsafe_or_unverified');
    expect(result.safeHold).toBe(false);
    expect(result.promotionReady).toBe(false);
  });

  it('fails safe-hold verification when natural monitoring receipts are stale', () => {
    const input = observation();
    input.staging.latestPilotCron!.runAt = '2026-07-19T08:00:00.000Z';

    const result = evaluateRolloutState(input);

    expect(result.result).toBe('unsafe_or_unverified');
    expect(result.failedSafetyChecks).toContain('staging_scheduler_fresh');
  });

  it('rejects every mutating SQL statement before Wrangler can execute it', () => {
    expect(() => assertReadOnlySql('SELECT 1; SELECT 2;')).not.toThrow();
    for (const sql of [
      'UPDATE posts SET status = \'Posted\'',
      'WITH row AS (SELECT 1) DELETE FROM posts',
      'PRAGMA table_info(posts)',
      'CREATE TABLE unsafe(id TEXT)',
    ]) {
      expect(() => assertReadOnlySql(sql)).toThrow('read-only SELECT');
    }
  });

  it('accepts D1 evidence only when every statement proves zero writes', () => {
    const safe = [{
      success: true,
      results: [{ count: 0 }],
      meta: { changes: 0, changed_db: false, rows_written: 0 },
    }];
    expect(validateReadOnlyD1Results(safe, 1)).toBe(true);
    expect(validateReadOnlyD1Results([
      { ...safe[0], meta: { ...safe[0].meta, rows_written: 1 } },
    ], 1)).toBe(false);
    expect(validateReadOnlyD1Results(safe, 2)).toBe(false);
  });

  it('keeps all built-in remote D1 statements read-only', () => {
    expect(() => assertReadOnlySql(STAGING_ROLLOUT_SQL)).not.toThrow();
    expect(() => assertReadOnlySql(PRODUCTION_ROLLOUT_SQL)).not.toThrow();
  });

  it('launches the local Wrangler CLI through Node without a Windows command shim', () => {
    const invocation = buildWranglerInvocation(['deployments', 'list']);

    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args[0].replace(/\\/g, '/'))
      .toMatch(/\/workers\/api\/node_modules\/wrangler\/bin\/wrangler\.js$/);
    expect(invocation.args.slice(1)).toEqual(['deployments', 'list', '--json']);
  });

  it('exposes one package command and cannot claim mutation or flag changes', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/learning-rollout-state.ts'),
      'utf8',
    );

    expect(packageJson.scripts['verify:learning-rollout'])
      .toBe('tsx scripts/learning-rollout-state.ts');
    expect(source).toContain('productionMutationPerformed: false');
    expect(source).toContain('releaseFlagsChanged: false');
    expect(source).toContain("'--json'");
    expect(source).not.toMatch(/secret_text[\s\S]{0,120}(artifact|payload)/i);
  });
});
