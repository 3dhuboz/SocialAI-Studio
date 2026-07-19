import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_ROLLOUT_SQL,
  STAGING_CALIBRATION_ROLLOUT_SQL,
  STAGING_ROLLOUT_SQL,
  assertReadOnlySql,
  buildWranglerInvocation,
  evaluateRolloutState,
  parseCron,
  shouldFailRolloutCommand,
  summarizePilotIntake,
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
      severeFalsePasses: true,
      falseHolds: true,
      availability: true,
      releaseJudgeAvailability: true,
      releaseJudgeTelemetry: true,
      receipts: true,
      predictionCoverage: true,
      predictionLift: true,
      rankCorrelation: true,
      criticalBypasses: true,
      publishingRegressions: true,
      cost: true,
      killSwitch: true,
      replayRedTeam: true,
      publishRegression: true,
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
      ownerEnrollments: 1,
      customerEnrollments: 1,
      activeCustomerWorkspaces: 1,
      ownerAttestedSamples: 15,
      clientAttestedSamples: 15,
      ownerCandidateDrafts: 2,
      clientCandidateDrafts: 2,
      ownerSyntheticExcludedDrafts: 0,
      clientSyntheticExcludedDrafts: 0,
      latestPilotCron: {
        success: true,
        error: null,
        runAt: '2026-07-19T09:15:16.000Z',
        details: null,
      },
      latestReadinessCron: {
        success: true,
        error: null,
        runAt: '2026-07-19T09:15:17.000Z',
        details: null,
      },
      latestHealthSweepCron: {
        success: true,
        error: null,
        runAt: '2026-07-19T09:15:18.000Z',
        details: null,
      },
      calibrationTablePresent: true,
      alertSchemaReady: true,
      latestCalibrationCron: {
        success: true,
        error: null,
        runAt: '2026-07-13T21:00:00.000Z',
        details: {
          posts_processed: 1,
          candidates_considered: 1,
          completed: 1,
          unavailable: 0,
          claimed_elsewhere: 0,
          budget_skipped: 0,
          severe_false_passes: 0,
          workspaces_disabled: 0,
          errors: 0,
        },
      },
      calibrationRows: 1,
      verifiedCalibrations: 1,
      unavailableCalibrations: 0,
      severeCalibrationFalsePasses: 0,
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
      calibrationTablePresent: true,
      alertSchemaReady: true,
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
    input.staging.latestCalibrationCron = null;
    input.staging.calibrationRows = 0;
    input.staging.verifiedCalibrations = 0;
    input.staging.readiness = {
      ...greenReadiness(),
      ready: false,
      checks: { pilot: false },
    };
    input.production.pilotSampleTablePresent = false;
    input.production.calibrationTablePresent = false;
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
      'staging_calibration_cron_fresh',
      'staging_calibration_evidence',
      'production_calibration_schema',
    ]));
  });

  it('reports the exact privacy-safe pilot intake precondition that is still missing', () => {
    const staging = observation().staging;
    staging.pilotSamples = 0;
    staging.ownerSamples = 0;
    staging.clientSamples = 0;
    staging.ownerEnrollments = 1;
    staging.customerEnrollments = 0;
    staging.activeCustomerWorkspaces = 0;
    staging.ownerAttestedSamples = 0;
    staging.clientAttestedSamples = 0;
    staging.ownerCandidateDrafts = 0;
    staging.clientCandidateDrafts = 0;
    staging.ownerSyntheticExcludedDrafts = 6;
    staging.clientSyntheticExcludedDrafts = 0;

    expect(summarizePilotIntake(staging)).toEqual({
      countsOnly: true,
      owner: {
        enrollmentReceipts: 1,
        candidateDrafts: 0,
        syntheticExcludedDrafts: 6,
        attestedSamples: 0,
        validatedSamples: 0,
        readyForOperatorAttestation: false,
        nextRequired: 'create_genuine_owner_draft',
      },
      customer: {
        activeWorkspaces: 0,
        enrollmentReceipts: 0,
        candidateDrafts: 0,
        syntheticExcludedDrafts: 0,
        attestedSamples: 0,
        validatedSamples: 0,
        readyForOperatorAttestation: false,
        nextRequired: 'obtain_separately_consenting_active_customer',
      },
    });
  });

  it('moves intake guidance from exact review to validation without counting attestation as proof', () => {
    const staging = observation().staging;
    staging.ownerSamples = 0;
    staging.pilotSamples = staging.clientSamples;
    staging.ownerAttestedSamples = 0;
    staging.ownerCandidateDrafts = 1;
    expect(summarizePilotIntake(staging).owner).toMatchObject({
      readyForOperatorAttestation: true,
      nextRequired: 'review_exact_owner_draft',
    });

    staging.ownerAttestedSamples = 1;
    expect(summarizePilotIntake(staging).owner).toMatchObject({
      readyForOperatorAttestation: true,
      nextRequired: 'validate_attested_owner_sample',
      validatedSamples: 0,
    });
  });

  it('makes --require-ready fail closed while a rollout remains on safe_hold', () => {
    const input = observation();
    input.staging.pilotSamples = 0;
    input.staging.ownerSamples = 0;
    input.staging.clientSamples = 0;
    input.staging.ownerAttestedSamples = 0;
    input.staging.clientAttestedSamples = 0;
    const evaluation = evaluateRolloutState(input);

    expect(evaluation.result).toBe('safe_hold');
    expect(shouldFailRolloutCommand(evaluation, false)).toBe(false);
    expect(shouldFailRolloutCommand(evaluation, true)).toBe(true);
  });

  it('fails the rollout command for unsafe evidence with or without --require-ready', () => {
    const input = observation();
    input.production.flags.LEARNING_AUTOPILOT_ENABLED = 'true';
    const evaluation = evaluateRolloutState(input);

    expect(evaluation.result).toBe('unsafe_or_unverified');
    expect(shouldFailRolloutCommand(evaluation, false)).toBe(true);
    expect(shouldFailRolloutCommand(evaluation, true)).toBe(true);
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
    ['the staging calibration schema is missing', (input: RolloutObservation) => {
      input.staging.calibrationTablePresent = false;
    }],
    ['the staging alert persistence schema is incomplete', (input: RolloutObservation) => {
      input.staging.alertSchemaReady = false;
    }],
    ['the production alert persistence schema is incomplete', (input: RolloutObservation) => {
      input.production.alertSchemaReady = false;
    }],
    ['a pilot intake counter is missing', (input: RolloutObservation) => {
      input.staging.ownerCandidateDrafts = -1;
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

  it.each([
    ['missing', (input: RolloutObservation) => {
      input.staging.latestHealthSweepCron = null;
    }],
    ['failed', (input: RolloutObservation) => {
      input.staging.latestHealthSweepCron!.success = false;
      input.staging.latestHealthSweepCron!.error = 'alert schema drift';
    }],
    ['stale', (input: RolloutObservation) => {
      input.staging.latestHealthSweepCron!.runAt = '2026-07-19T08:00:00.000Z';
    }],
  ])('fails safe-hold verification when the health sweep receipt is %s', (_label, mutate) => {
    const input = observation();
    mutate(input);

    const result = evaluateRolloutState(input);

    expect(result.result).toBe('unsafe_or_unverified');
    expect(result.failedSafetyChecks).toContain('staging_health_sweep_fresh');
  });

  it('keeps a dormant rollout safe but blocks promotion when the weekly calibration is stale', () => {
    const input = observation();
    input.staging.latestCalibrationCron!.runAt = '2026-07-10T20:59:59.000Z';

    const result = evaluateRolloutState(input);

    expect(result.result).toBe('safe_hold');
    expect(result.failedSafetyChecks).toEqual([]);
    expect(result.blockers).toContain('staging_calibration_cron_fresh');
  });

  it('blocks promotion when a ready receipt has a truncated checks schema', () => {
    const input = observation();
    input.staging.readiness = {
      ...greenReadiness(),
      checks: {
        pilot: true,
        tenancyProofs: { user: true, client: true, shop: true },
      },
    };

    const result = evaluateRolloutState(input);

    expect(result.result).toBe('safe_hold');
    expect(result.failedSafetyChecks).toEqual([]);
    expect(result.blockers).toContain('staging_readiness_green');
  });

  it.each([
    ['missing privacy-safe details', (input: RolloutObservation) => {
      input.staging.latestCalibrationCron!.details = null;
    }],
    ['an unavailable independent recheck', (input: RolloutObservation) => {
      input.staging.latestCalibrationCron!.details!.unavailable = 1;
      input.staging.unavailableCalibrations = 1;
      input.staging.calibrationRows = 2;
    }],
    ['a severe false pass', (input: RolloutObservation) => {
      input.staging.latestCalibrationCron!.details!.severe_false_passes = 1;
      input.staging.severeCalibrationFalsePasses = 1;
    }],
    ['a calibration execution error', (input: RolloutObservation) => {
      input.staging.latestCalibrationCron!.details!.errors = 1;
    }],
  ])('blocks promotion without breaking the dormant hold for %s', (_label, mutate) => {
    const input = observation();
    mutate(input);

    const result = evaluateRolloutState(input);

    expect(result.result).toBe('safe_hold');
    expect(result.failedSafetyChecks).toEqual([]);
    expect(result.blockers).toContain('staging_calibration_cron_fresh');
  });

  it('requires completed verified calibration rows even after a clean weekly no-op', () => {
    const input = observation();
    input.staging.latestCalibrationCron!.details!.posts_processed = 0;
    input.staging.latestCalibrationCron!.details!.candidates_considered = 0;
    input.staging.latestCalibrationCron!.details!.completed = 0;
    input.staging.calibrationRows = 0;
    input.staging.verifiedCalibrations = 0;

    const result = evaluateRolloutState(input);

    expect(result.result).toBe('safe_hold');
    expect(result.blockers).not.toContain('staging_calibration_cron_fresh');
    expect(result.blockers).toContain('staging_calibration_evidence');
  });

  it('parses only object-shaped privacy-safe cron details', () => {
    const valid = parseCron([{
      cron_type: 'learning_calibration',
      success: 1,
      error: null,
      run_at: '2026-07-13 21:00:00',
      details_json: '{"errors":0}',
    }], 'learning_calibration');
    const malformed = parseCron([{
      cron_type: 'learning_calibration',
      success: 1,
      error: null,
      run_at: '2026-07-13 21:00:00',
      details_json: '[0]',
    }], 'learning_calibration');

    expect(valid).toMatchObject({
      runAt: '2026-07-13T21:00:00Z',
      details: { errors: 0 },
    });
    expect(malformed?.details).toBeNull();
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
    expect(() => assertReadOnlySql(STAGING_CALIBRATION_ROLLOUT_SQL)).not.toThrow();
    expect(() => assertReadOnlySql(PRODUCTION_ROLLOUT_SQL)).not.toThrow();
  });

  it('counts only current-policy pilot samples backed by an eligible exact-hash decision', () => {
    const [sampleEvidenceSql] = STAGING_ROLLOUT_SQL
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(sampleEvidenceSql).toContain('FROM learning_pilot_samples sample');
    expect(sampleEvidenceSql).toContain('INNER JOIN learning_pilot_enrollments pen');
    expect(sampleEvidenceSql).toContain("pen.policy_version = '2026-07-14-v1'");
    expect(sampleEvidenceSql).toContain('INNER JOIN workspace_learning_settings w');
    expect(sampleEvidenceSql).toContain("w.mode = 'approval'");
    expect(sampleEvidenceSql).toContain(
      'unixepoch(pen.consent_confirmed_at) <= unixepoch(sample.attested_at)',
    );
    expect(sampleEvidenceSql).toContain("sample.attestation_basis = 'customer_real_post'");
    expect(sampleEvidenceSql).toContain("COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'");
    expect(sampleEvidenceSql).toContain('FROM learning_decisions d');
    expect(sampleEvidenceSql).toContain('d.content_hash = sample.content_hash');
    expect(sampleEvidenceSql).toContain("d.stage = 'release'");
    expect(sampleEvidenceSql).toContain("d.mode = 'approval'");
    expect(sampleEvidenceSql).toContain('FROM learning_decision_disqualifications disq');
  });

  it('reports only current-policy, canonical, non-held pilot intake preconditions', () => {
    const statements = STAGING_ROLLOUT_SQL
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const customerConsentSql = statements[4];

    expect(customerConsentSql).toContain('FROM learning_pilot_enrollments pen');
    expect(customerConsentSql).toContain('INNER JOIN workspace_learning_settings w');
    expect(customerConsentSql).toContain('LEFT JOIN clients c');
    expect(customerConsentSql).toContain("w.mode = 'approval'");
    expect(customerConsentSql).toContain('w.monthly_ai_budget_usd_cents > 0');
    expect(customerConsentSql).toContain(
      "unixepoch(pen.consent_confirmed_at) <= unixepoch('now')",
    );
    expect(customerConsentSql).toContain("COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'");
    expect(customerConsentSql).toContain('FROM learning_pilot_samples sample');
    expect(customerConsentSql).toContain('FROM eligible_enrollments enrolled');
    expect(customerConsentSql).toContain('enrolled.client_id IS p.client_id');
    expect(customerConsentSql).toContain('enrolled_workspace = 1');
    expect(customerConsentSql).toContain(
      'INNER JOIN learning_decision_disqualifications disq',
    );
    expect(customerConsentSql).toContain("LOWER(TRIM(COALESCE(p.status, ''))) = 'draft'");
    expect(customerConsentSql).toContain(
      "LENGTH(TRIM(COALESCE(p.content, ''))) BETWEEN 1 AND 5000",
    );
    expect(customerConsentSql).toContain('owner_candidate_drafts');
    expect(customerConsentSql).toContain('client_candidate_drafts');
    expect(customerConsentSql).toContain('owner_synthetic_excluded_drafts');
    expect(customerConsentSql).toContain('client_synthetic_excluded_drafts');
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
