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
    id: 'shadow_receipt_no_mutation',
    suite: 'src/__tests__/learning-shadow.test.ts',
    assertion: 'learning shadow evaluation creates snapshot receipts without mutating posts',
  },
  {
    id: 'macca_surreal_bbq',
    suite: 'src/__tests__/learning-release-pipeline.test.ts',
    assertion: 'runMediaCritic blocks the Macca surreal-BBQ anatomy regression before release',
  },
  {
    id: 'bounded_self_repair',
    suite: 'src/__tests__/learning-release-pipeline.test.ts',
    assertion: 'runReleasePipeline caps repairs at two and then holds',
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
    id: 'release_judge_input_independence',
    suite: 'src/__tests__/learning-release-pipeline.test.ts',
    assertion: 'runReleasePipeline never sends generator reasoning to the Release Judge',
  },
  {
    id: 'release_judge_no_override',
    suite: 'src/__tests__/learning-release-pipeline.test.ts',
    assertion: 'runReleasePipeline does not let the Release Judge override a critical content block',
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
    id: 'pilot_two_workspace_cohort',
    suite: 'src/__tests__/learning-pilot-collector.test.ts',
    assertion: 'record-only pilot collector evaluates at most one draft from each of two consented workspaces',
  },
  {
    id: 'pilot_routes_staging_isolation',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning receipt routes keeps every approval-pilot operation isolated to staging',
  },
  {
    id: 'pilot_context_before_enrollment',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes refuses pilot enrollment before recording consent when business context is incomplete',
  },
  {
    id: 'pilot_context_candidate_diagnostics',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes returns a server-selected queue of eligible non-held drafts and their enrollment state',
  },
  {
    id: 'pilot_synthetic_exclusion_schema',
    suite: 'src/__tests__/learning-pilot-disqualification-schema.test.ts',
    assertion: 'learning pilot disqualification schema creates immutable tenant-scoped synthetic QA receipts only',
  },
  {
    id: 'pilot_synthetic_exclusion_route',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes appends a staging-only synthetic QA disqualification without mutating evidence',
  },
  {
    id: 'pilot_synthetic_exclusion_idempotent',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes returns the existing immutable disqualification idempotently',
  },
  {
    id: 'pilot_synthetic_exclusion_fail_closed',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes rejects non-admin, non-staging, malformed, and unsafe disqualifications',
  },
  {
    id: 'pilot_synthetic_exclusion_readiness',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'learning release readiness collects a strict consecutive pilot window and current evidence from D1',
  },
  {
    id: 'pilot_positive_sample_schema',
    suite: 'src/__tests__/learning-pilot-sample-schema.test.ts',
    assertion: 'learning pilot sample schema creates immutable positive evidence for exact real pilot post versions',
  },
  {
    id: 'pilot_positive_sample_attestation',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes appends a positive real-post attestation without mutating the draft',
  },
  {
    id: 'pilot_positive_sample_hash_binding',
    suite: 'src/__tests__/learning-pilot-collector.test.ts',
    assertion: 'record-only pilot evaluation lease rejects a pilot evaluation when the positive sample hash no longer matches',
  },
  {
    id: 'pilot_positive_sample_quarantine_route',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes refuses to attest a post quarantined as synthetic QA',
  },
  {
    id: 'pilot_positive_sample_quarantine_collector',
    suite: 'src/__tests__/learning-pilot-collector.test.ts',
    assertion: 'record-only pilot evaluation lease rejects a known synthetic-QA post before receipt lookup, lease, or critic work',
  },
  {
    id: 'pilot_cost_attribution_schema',
    suite: 'src/__tests__/learning-ai-usage-attribution-schema.test.ts',
    assertion: 'learning AI usage attribution schema adds immutable tenant-and-post scoped decision attribution',
  },
  {
    id: 'pilot_cost_staging_metering',
    suite: 'src/lib/__tests__/ai-cost.test.ts',
    assertion: 'AI-cost regression — logAiUsage writes in staging so release cost evidence can be proven',
  },
  {
    id: 'pilot_cost_decision_scope',
    suite: 'src/lib/__tests__/ai-cost.test.ts',
    assertion: 'AI-cost regression — logAiUsage attributes a scoped call without leaking the decision to the parent env',
  },
  {
    id: 'pilot_cost_fail_closed',
    suite: 'src/lib/__tests__/ai-cost.test.ts',
    assertion: 'AI-cost regression — logAiUsage fails a scoped pilot closed when its attribution row cannot persist',
  },
  {
    id: 'pilot_cost_no_partial_completion',
    suite: 'src/__tests__/learning-release-preflight.test.ts',
    assertion: 'runAndPersistReleasePipeline refuses to mark a scoped decision complete after any metering write fails',
  },
  {
    id: 'pilot_cost_claim_identity',
    suite: 'src/__tests__/learning-pilot-collector.test.ts',
    assertion: 'record-only pilot evaluation lease fails closed if the completed receipt differs from the claimed metering scope',
  },
  {
    id: 'pilot_cost_readiness_coverage',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'learning release readiness fails cost readiness when generic usage is not attributed to every pilot decision',
  },
  {
    id: 'pilot_cost_estimate_integrity',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'learning release readiness fails cost readiness when any workspace or pilot estimate is missing or negative',
  },
  {
    id: 'readiness_pilot_thresholds',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'learning release readiness requires enough adjudicated pilot evidence and every safety threshold',
  },
  {
    id: 'readiness_monitoring_alert',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'readiness cron receipts persists every evaluation and alerts once when readiness turns green to red',
  },
  {
    id: 'readiness_failure_stale',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'readiness cron receipts writes no replacement receipt when evidence collection fails',
  },
  {
    id: 'protected_consent_gate',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'protected autopilot mode gates downgrades without current consent, fresh readiness, or an owner-kind proof',
  },
  {
    id: 'on_hold_zero_processing',
    suite: 'src/__tests__/learning-permanent-preflight.test.ts',
    assertion: 'permanent release preflight makes zero critic and network calls for malformed or on-hold workspaces',
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
  {
    id: 'egress_manual_path',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publish egress source contracts routes manual Postproxy publishing through the orchestrator',
  },
  {
    id: 'egress_cron_path',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publish egress source contracts routes cron Postproxy and final Graph publishing through the orchestrator',
  },
  {
    id: 'publish_reel_finish_preflight',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publishPersistedPost runs a fresh preflight before the final Facebook reel publish phase',
  },
  {
    id: 'publish_reel_finish_hold_zero_egress',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publishPersistedPost makes zero final Facebook reel calls when the fresh preflight holds',
  },
  {
    id: 'publish_reel_finish_inactive_zero_egress',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publishPersistedPost makes zero final Facebook reel calls for an inactive workspace',
  },
  {
    id: 'egress_delayed_reel_finish',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publish egress source contracts routes the delayed Facebook reel finish phase through a fresh orchestrator preflight',
  },
  {
    id: 'egress_frontend_worker_only',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publish egress source contracts routes Quick Post and Calendar publishing through the Worker only',
  },
  {
    id: 'egress_direct_helpers_removed',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publish egress source contracts removes every frontend direct-publish helper and banned Facebook scheduling path',
  },
  {
    id: 'egress_global_chokepoint',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publish egress source contracts rejects provider publication calls outside the centralized orchestrator',
  },
  {
    id: 'reach_platform_treatments',
    suite: 'src/__tests__/reach-plan.test.ts',
    assertion: 'reach plan determinism creates Facebook and Instagram treatments separately',
  },
  {
    id: 'reach_single_variable_experiment',
    suite: 'src/__tests__/reach-plan.test.ts',
    assertion: 'reach plan determinism rejects experiments that change more than one variable',
  },
  {
    id: 'reach_shadow_non_mutating',
    suite: 'src/__tests__/reach-plan.test.ts',
    assertion: 'reach plan orchestration persists shadow rationale without generating or applying media',
  },
  {
    id: 'reach_apply_guardrails',
    suite: 'src/__tests__/reach-plan.test.ts',
    assertion: 'reach plan orchestration runs generated apply media through guardrails and critic preflight',
  },
  {
    id: 'outcome_frozen_windows',
    suite: 'src/__tests__/learning-outcome-collector.test.ts',
    assertion: 'immutable outcome windows exposes only frozen 24, 72, and 168 hour windows',
  },
  {
    id: 'outcome_immutable_once',
    suite: 'src/__tests__/learning-outcome-collector.test.ts',
    assertion: 'immutable outcome windows collects each canonical window once in canonical order',
  },
  {
    id: 'outcome_tenant_scope',
    suite: 'src/__tests__/learning-outcome-collector.test.ts',
    assertion: 'due-window repository and tenant signal collection scopes user facts, tracking, and conversion reads to one canonical tenant',
  },
  {
    id: 'strategy_bounded_weekly',
    suite: 'src/__tests__/learning-strategy.test.ts',
    assertion: 'confidence-weighted strategy learning caps upward and downward weekly changes at 0.10 after decay',
  },
  {
    id: 'strategy_private_profile',
    suite: 'src/__tests__/learning-strategy.test.ts',
    assertion: 'weekly strategy learner learns only canonical final-window outcomes and writes a private versioned profile',
  },
  {
    id: 'aggregate_workspace_threshold',
    suite: 'src/__tests__/learning-archetype-aggregates.test.ts',
    assertion: 'privacy-gated archetype aggregates emits nothing below ten distinct workspaces',
  },
  {
    id: 'aggregate_post_threshold',
    suite: 'src/__tests__/learning-archetype-aggregates.test.ts',
    assertion: 'privacy-gated archetype aggregates emits nothing below one hundred distinct posts',
  },
  {
    id: 'aggregate_coarse_only',
    suite: 'src/__tests__/learning-archetype-aggregates.test.ts',
    assertion: 'privacy-gated archetype aggregates emits only coarse fields after both privacy thresholds pass',
  },
  {
    id: 'aggregate_deletion_invalidation',
    suite: 'src/__tests__/learning-archetype-aggregates.test.ts',
    assertion: 'privacy-gated archetype aggregates falls below threshold immediately when a deleted workspace is removed',
  },
  {
    id: 'production_flags_dormant',
    suite: 'src/__tests__/learning-config.test.ts',
    assertion: 'learning release configuration enables shadow learning but keeps enforcement disabled in production and staging',
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
