import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_RELEASE_PROOF_CHECKS,
  buildReleaseProofArtifact,
  hashReleaseProofPayload,
  type ReleaseProofInput,
} from '../../shared/learningReleaseProof';

function passingChecks() {
  return REQUIRED_RELEASE_PROOF_CHECKS.map((check) => ({
    ...check,
    passed: true,
  }));
}

const baseInput: ReleaseProofInput = {
  generatedAt: '2026-07-17T03:00:00.000Z',
  git: {
    commit: 'a'.repeat(40),
    branch: 'codex/release-proof',
    clean: true,
  },
  checks: passingChecks(),
  command: {
    executable: 'npx',
    args: ['vitest', 'run'],
    exitCode: 0,
    reportSha256: 'b'.repeat(64),
    summary: {
      totalTests: REQUIRED_RELEASE_PROOF_CHECKS.length,
      passedTests: REQUIRED_RELEASE_PROOF_CHECKS.length,
      failedTests: 0,
    },
  },
};

describe('buildReleaseProofArtifact', () => {
  it('requires every major Customer Learning Brain safety subsystem', () => {
    expect(REQUIRED_RELEASE_PROOF_CHECKS.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        'shadow_receipt_no_mutation',
        'bounded_self_repair',
        'critic_lane_independence',
        'deterministic_block_path',
        'selected_media_critic',
        'release_judge_telemetry',
        'release_judge_input_independence',
        'release_judge_no_override',
        'pilot_two_workspace_cohort',
        'pilot_context_before_enrollment',
        'pilot_context_candidate_diagnostics',
        'pilot_synthetic_exclusion_schema',
        'pilot_synthetic_exclusion_route',
        'pilot_synthetic_exclusion_idempotent',
        'pilot_synthetic_exclusion_fail_closed',
        'pilot_synthetic_exclusion_readiness',
        'pilot_cost_attribution_schema',
        'pilot_cost_staging_metering',
        'pilot_cost_decision_scope',
        'pilot_cost_fail_closed',
        'pilot_cost_no_partial_completion',
        'pilot_cost_claim_identity',
        'pilot_cost_readiness_coverage',
        'pilot_cost_estimate_integrity',
        'readiness_pilot_thresholds',
        'readiness_monitoring_alert',
        'readiness_failure_stale',
        'protected_consent_gate',
        'on_hold_zero_processing',
        'egress_manual_path',
        'egress_cron_path',
        'egress_frontend_worker_only',
        'egress_direct_helpers_removed',
        'reach_platform_treatments',
        'reach_single_variable_experiment',
        'reach_shadow_non_mutating',
        'reach_apply_guardrails',
        'outcome_frozen_windows',
        'outcome_immutable_once',
        'outcome_tenant_scope',
        'strategy_bounded_weekly',
        'strategy_private_profile',
        'aggregate_workspace_threshold',
        'aggregate_post_threshold',
        'aggregate_coarse_only',
        'aggregate_deletion_invalidation',
        'production_flags_dormant',
      ]),
    );
    expect(new Set(REQUIRED_RELEASE_PROOF_CHECKS.map((check) => check.id)).size)
      .toBe(REQUIRED_RELEASE_PROOF_CHECKS.length);
  });

  it('produces a deterministic SHA-256 envelope for a complete offline pass', async () => {
    const first = await buildReleaseProofArtifact(baseInput);
    const second = await buildReleaseProofArtifact(baseInput);

    expect(first).toEqual(second);
    expect(first.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.artifactSha256).toBe(await hashReleaseProofPayload(first.payload));
    expect(first.payload.result).toBe('offline_pass');
    expect(first.payload.replayRedTeamCandidate).toBe(true);
  });

  it('labels the payload hash separately from the artifact file checksum', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/learning-release-proof.ts'),
      'utf8',
    );

    expect(source).toContain('const artifactFileSha256 = sha256File(artifactPath);');
    expect(source).toContain('`${artifactFileSha256}  ${artifactPath}\\n`');
    expect(source).toContain('`Payload SHA-256: ${artifact.artifactSha256}`');
    expect(source).toContain('`Artifact file SHA-256: ${artifactFileSha256}`');
  });

  it('cannot claim live staging, authenticated submission, or production mutation', async () => {
    const artifact = await buildReleaseProofArtifact(baseInput);

    expect(artifact.payload.scope).toBe('offline_replay_preflight');
    expect(artifact.payload.liveStagingProven).toBe(false);
    expect(artifact.payload.authenticatedEvidenceSubmitted).toBe(false);
    expect(artifact.payload.productionMutationPerformed).toBe(false);
    expect(artifact.payload.releaseFlagsChanged).toBe(false);
    expect(artifact.payload.hugheseysQueHoldRequired).toBe(true);
  });

  it.each([
    ['a failed check', { checks: [{ ...passingChecks()[0], passed: false }] }],
    ['a missing check', { checks: passingChecks().slice(1) }],
    ['a dirty tree', { git: { ...baseInput.git, clean: false } }],
    ['a failed command', { command: { ...baseInput.command, exitCode: 1 } }],
    ['a missing raw report hash', {
      command: { ...baseInput.command, reportSha256: null },
    }],
  ])('fails closed for %s', async (_label, patch) => {
    const artifact = await buildReleaseProofArtifact({ ...baseInput, ...patch });

    expect(artifact.payload.result).toBe('failed_or_unreviewed');
    expect(artifact.payload.replayRedTeamCandidate).toBe(false);
  });

  it('rejects duplicate, unknown, or malformed check rows', async () => {
    const duplicate = [...passingChecks(), passingChecks()[0]];
    const unknown = [...passingChecks(), {
      id: 'made_up_gate', suite: 'x', assertion: 'x', passed: true,
    }];
    const wrongAssertion = passingChecks().map((check, index) => (
      index === 0 ? { ...check, assertion: 'some other passing test' } : check
    ));
    const malformed = passingChecks().map((check, index) => (
      index === 0 ? { ...check, passed: 'yes' } : check
    ));

    await expect(buildReleaseProofArtifact({ ...baseInput, checks: duplicate }))
      .rejects.toThrow('duplicate release proof check');
    await expect(buildReleaseProofArtifact({ ...baseInput, checks: unknown }))
      .rejects.toThrow('unknown release proof check');
    await expect(buildReleaseProofArtifact({
      ...baseInput,
      checks: wrongAssertion as ReleaseProofInput['checks'],
    })).rejects.toThrow('unknown release proof check');
    await expect(buildReleaseProofArtifact({
      ...baseInput,
      checks: malformed as ReleaseProofInput['checks'],
    })).rejects.toThrow('invalid release proof check');
  });
});
