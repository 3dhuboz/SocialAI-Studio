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
  it('requires lane-aware critic, media, path, and Release Judge readiness proofs', () => {
    expect(REQUIRED_RELEASE_PROOF_CHECKS.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        'critic_lane_independence',
        'deterministic_block_path',
        'selected_media_critic',
        'release_judge_telemetry',
      ]),
    );
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
