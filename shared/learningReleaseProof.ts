export interface ReleaseProofRequirement {
  id: string;
  suite: string;
  assertion: string;
}

export interface ReleaseProofCheck extends ReleaseProofRequirement {
  passed: boolean;
}

export interface ReleaseProofInput {
  generatedAt: string;
  git: {
    commit: string;
    branch: string;
    clean: boolean;
  };
  checks: readonly ReleaseProofCheck[];
  command: {
    executable: string;
    args: readonly string[];
    exitCode: number;
    reportSha256: string | null;
    summary: {
      totalTests: number;
      passedTests: number;
      failedTests: number;
    };
  };
}

export const REQUIRED_RELEASE_PROOF_CHECKS = [
  {
    id: 'macca_surreal_bbq',
    suite: 'src/__tests__/learning-release-pipeline.test.ts',
    assertion: 'runMediaCritic blocks the Macca surreal-BBQ anatomy regression before release',
  },
  {
    id: 'wrong_geography',
    suite: 'src/__tests__/reach-plan.test.ts',
    assertion: 'reach plan orchestration rejects an out-of-area geographic focus',
  },
  {
    id: 'old_price',
    suite: 'src/__tests__/learning-text-critics.test.ts',
    assertion: 'runDeterministicCritics requests repair for unsupported concrete commercial claims',
  },
  {
    id: 'invented_offer',
    suite: 'src/__tests__/learning-text-critics.test.ts',
    assertion: 'runDeterministicCritics requests repair for an invented free offer',
  },
  {
    id: 'bad_media',
    suite: 'src/__tests__/media-ai-usage.test.ts',
    assertion: 'media routes ai_usage telemetry rejects the generated image when both critic attempts score below the release threshold',
  },
  {
    id: 'prompt_injection',
    suite: 'src/__tests__/learning-text-critics.test.ts',
    assertion: 'runDeterministicCritics blocks prompt-injection text as release critical',
  },
  {
    id: 'critic_outage',
    suite: 'src/__tests__/learning-critic-reducer.test.ts',
    assertion: 'reduceCriticResults holds when a required critic remains unavailable',
  },
  {
    id: 'critic_lane_independence',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'learning release readiness does not let a deterministic pass mask an unavailable independent critic',
  },
  {
    id: 'deterministic_block_path',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'learning release readiness does not count critics intentionally skipped after a deterministic hard block',
  },
  {
    id: 'selected_media_critic',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'learning release readiness requires the selected media critic for availability and receipt coverage',
  },
  {
    id: 'release_judge_telemetry',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'learning release readiness fails closed on unavailable or ambiguous Release Judge telemetry',
  },
  {
    id: 'advisory_warning',
    suite: 'src/__tests__/learning-critic-reducer.test.ts',
    assertion: 'reduceCriticResults passes when every required critic passes',
  },
  {
    id: 'tenancy_user',
    suite: 'src/__tests__/learning-critic-context.test.ts',
    assertion: 'loadCriticContext keeps the owner workspace separate from every client workspace',
  },
  {
    id: 'tenancy_client',
    suite: 'src/__tests__/learning-critic-context.test.ts',
    assertion: 'loadCriticContext loads facts, posts, and denylist only for the requested client',
  },
  {
    id: 'tenancy_portal',
    suite: 'src/__tests__/portal-auth.test.ts',
    assertion: 'portal token scope does not allow portal tokens through the admin gate',
  },
  {
    id: 'tenancy_shopify',
    suite: 'src/__tests__/learning-critic-context.test.ts',
    assertion: 'loadCriticContext loads Shopify context only from the canonical shop domain',
  },
  {
    id: 'kill_switch',
    suite: 'src/__tests__/learning-permanent-preflight.test.ts',
    assertion: 'permanent release preflight downgrades protected autopilot to approval when the emergency switch is off',
  },
  {
    id: 'publish_hold_zero_egress',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publishPersistedPost makes zero Postproxy or Graph calls when preflight holds',
  },
  {
    id: 'publish_pass_preserved',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publishPersistedPost preserves Postproxy and Graph delivery when preflight allows it',
  },
] as const satisfies readonly ReleaseProofRequirement[];

export interface ReleaseProofPayload {
  schemaVersion: 1;
  policyVersion: '2026-07-14-release-4';
  generatedAt: string;
  scope: 'offline_replay_preflight';
  result: 'offline_pass' | 'failed_or_unreviewed';
  replayRedTeamCandidate: boolean;
  liveStagingProven: false;
  authenticatedEvidenceSubmitted: false;
  productionMutationPerformed: false;
  releaseFlagsChanged: false;
  hugheseysQueHoldRequired: true;
  git: ReleaseProofInput['git'];
  command: ReleaseProofInput['command'];
  checks: ReleaseProofCheck[];
  missingCheckIds: string[];
  failedCheckIds: string[];
  limitations: string[];
}

export interface ReleaseProofArtifact {
  artifactSha256: string;
  payload: ReleaseProofPayload;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function validateInput(input: ReleaseProofInput): void {
  if (!Number.isFinite(Date.parse(input.generatedAt))) {
    throw new Error('invalid release proof timestamp');
  }
  if (!/^[a-f0-9]{40}$/i.test(input.git.commit) || !input.git.branch.trim()) {
    throw new Error('invalid release proof git identity');
  }
  if (!input.command.executable.trim() || !Number.isInteger(input.command.exitCode)) {
    throw new Error('invalid release proof command');
  }
  if (input.command.reportSha256 !== null
    && !/^[a-f0-9]{64}$/i.test(input.command.reportSha256)) {
    throw new Error('invalid release proof report hash');
  }
  const { totalTests, passedTests, failedTests } = input.command.summary;
  if (![totalTests, passedTests, failedTests].every(
    (value) => Number.isInteger(value) && value >= 0,
  ) || passedTests + failedTests > totalTests) {
    throw new Error('invalid release proof summary');
  }

  const expected = new Map<string, ReleaseProofRequirement>(
    REQUIRED_RELEASE_PROOF_CHECKS.map((check) => [check.id, check]),
  );
  const seen = new Set<string>();
  for (const check of input.checks) {
    if (!check || typeof check.id !== 'string' || typeof check.suite !== 'string'
      || typeof check.assertion !== 'string'
      || typeof check.passed !== 'boolean') {
      throw new Error('invalid release proof check');
    }
    if (seen.has(check.id)) throw new Error(`duplicate release proof check: ${check.id}`);
    seen.add(check.id);

    const requirement = expected.get(check.id);
    if (!requirement || requirement.suite !== check.suite
      || requirement.assertion !== check.assertion) {
      throw new Error(`unknown release proof check: ${check.id}`);
    }
  }
}

export async function hashReleaseProofPayload(payload: ReleaseProofPayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(payload)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildReleaseProofArtifact(
  input: ReleaseProofInput,
): Promise<ReleaseProofArtifact> {
  validateInput(input);

  const provided = new Map(input.checks.map((check) => [check.id, check]));
  const checks = REQUIRED_RELEASE_PROOF_CHECKS
    .filter((requirement) => provided.has(requirement.id))
    .map((requirement) => ({
      ...requirement,
      passed: provided.get(requirement.id)!.passed,
    }));
  const missingCheckIds = REQUIRED_RELEASE_PROOF_CHECKS
    .filter((requirement) => !provided.has(requirement.id))
    .map((requirement) => requirement.id);
  const failedCheckIds = checks.filter((check) => !check.passed).map((check) => check.id);
  const replayRedTeamCandidate = input.git.clean
    && input.command.exitCode === 0
    && input.command.reportSha256 !== null
    && input.command.summary.totalTests > 0
    && input.command.summary.failedTests === 0
    && missingCheckIds.length === 0
    && failedCheckIds.length === 0;

  const payload: ReleaseProofPayload = {
    schemaVersion: 1,
    policyVersion: '2026-07-14-release-4',
    generatedAt: input.generatedAt,
    scope: 'offline_replay_preflight',
    result: replayRedTeamCandidate ? 'offline_pass' : 'failed_or_unreviewed',
    replayRedTeamCandidate,
    liveStagingProven: false,
    authenticatedEvidenceSubmitted: false,
    productionMutationPerformed: false,
    releaseFlagsChanged: false,
    hugheseysQueHoldRequired: true,
    git: {
      commit: input.git.commit.toLowerCase(),
      branch: input.git.branch,
      clean: input.git.clean,
    },
    command: {
      executable: input.command.executable,
      args: [...input.command.args],
      exitCode: input.command.exitCode,
      reportSha256: input.command.reportSha256?.toLowerCase() ?? null,
      summary: { ...input.command.summary },
    },
    checks,
    missingCheckIds,
    failedCheckIds,
    limitations: [
      'This artifact proves deterministic offline replay and preflight checks only.',
      'It is not live staging evidence for user, client, portal, or Shopify ownership.',
      'It does not submit authenticated release evidence or change production state.',
      'Kill-switch and publish checks still require a separate live staging exercise.',
    ],
  };

  return {
    artifactSha256: await hashReleaseProofPayload(payload),
    payload,
  };
}
