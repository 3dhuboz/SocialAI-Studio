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
    id: 'bounded_repair_publish_boundary',
    suite: 'src/__tests__/learning-release-pipeline.test.ts',
    assertion: 'runReleasePipeline holds when a repair mutates any publish-critical field',
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
    id: 'software_hardware_media_mismatch',
    suite: 'src/__tests__/critique.test.ts',
    assertion: 'buildCritiqueSystemPrompt hard-fails electronics hardware imagery for software and custom-app captions',
  },
  {
    id: 'release_judge_telemetry',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'learning release readiness fails closed on unavailable or ambiguous Release Judge telemetry',
  },
  {
    id: 'release_judge_pipeline_failure',
    suite: 'src/__tests__/learning-release-pipeline.test.ts',
    assertion: 'runReleasePipeline fails closed with unavailable telemetry when the Release Judge throws',
  },
  {
    id: 'release_judge_status_binding',
    suite: 'src/__tests__/learning-release-pipeline.test.ts',
    assertion: 'runReleasePipeline never accepts a green state with unavailable judge telemetry',
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
    id: 'pilot_generator_generalized_customer_claim',
    suite: 'src/__tests__/learning-pilot-draft-generator.test.ts',
    assertion: 'record-only pilot draft generator retries unsupported first-person customer evidence before creating a receipt',
  },
  {
    id: 'pilot_media_schema_and_egress',
    suite: 'src/__tests__/learning-pilot-media-job-schema.test.ts',
    assertion: 'learning pilot media job schema executes in SQLite and blocks a ready image candidate from every mutation path',
  },
  {
    id: 'pilot_media_bounded_generation',
    suite: 'src/__tests__/learning-pilot-media-jobs.test.ts',
    assertion: 'record-only pilot media jobs allows one lease-expired retry and never a third provider attempt',
  },
  {
    id: 'pilot_media_single_active_lease',
    suite: 'src/__tests__/learning-pilot-media-jobs.test.ts',
    assertion: 'record-only pilot media jobs permits only one active media generation lease per workspace',
  },
  {
    id: 'pilot_media_provider_poll_contract',
    suite: 'src/__tests__/learning-pilot-media-jobs.test.ts',
    assertion: 'record-only pilot media jobs uses the full fal model path for video status and result polling',
  },
  {
    id: 'pilot_media_image_usage_attribution',
    suite: 'src/__tests__/image-gen.test.ts',
    assertion: 'generateImageWithGuardrails — error handling attributes a pilot media image attempt to its immutable job operation and post id',
  },
  {
    id: 'pilot_media_video_post_boundary',
    suite: 'src/__tests__/learning-pilot-media-jobs.test.ts',
    assertion: 'record-only pilot media jobs keeps a video out of posts until the provider result is ready',
  },
  {
    id: 'pilot_media_route_gates',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes starts a bounded record-only pilot image job only after consent, context, and budget checks',
  },
  {
    id: 'pilot_media_route_malformed_zero_spend',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes rejects malformed pilot media requests before reading consent or spending provider credit',
  },
  {
    id: 'pilot_media_withdrawal_fail_closed',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes fails withdrawal closed when a generated media job or post state is unsafe',
  },
  {
    id: 'pilot_media_account_deletion_post_first',
    suite: 'src/__tests__/learning-outcome-deletion.test.ts',
    assertion: 'learning outcome deletion invalidates the archetype and deletes the exact pilot media post before its immutable job',
  },
  {
    id: 'pilot_cron_staging_isolation',
    suite: 'src/__tests__/learning-pilot-cron-telemetry.test.ts',
    assertion: 'learning pilot cron telemetry restricts record-only pilot and calibration scheduling to staging',
  },
  {
    id: 'pilot_production_zero_d1',
    suite: 'src/__tests__/learning-pilot-collector.test.ts',
    assertion: 'record-only pilot collector performs zero D1 work in production even when dormant pilot flags are set',
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
    id: 'pilot_positive_sample_preview_required',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes rejects a blind attestation without an exact preview hash before reading the draft',
  },
  {
    id: 'pilot_positive_sample_preview_stale',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes rejects a real-post attestation when the draft changed after preview',
  },
  {
    id: 'pilot_positive_sample_content_bounds',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes rejects empty or oversized draft content before creating pilot evidence',
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
    id: 'readiness_deferred_schema_receipt',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'readiness cron receipts persists a complete red receipt without touching deferred pilot tables',
  },
  {
    id: 'readiness_failure_stale',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'readiness cron receipts writes no replacement receipt when evidence collection fails',
  },
  {
    id: 'severe_false_pass_quarantine_repository',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'severe false-pass quarantine repository downgrades only protected workspaces with a tenant-matched severe false pass',
  },
  {
    id: 'severe_false_pass_quarantine_fail_closed',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'readiness cron receipts fails closed before persisting readiness when severe false-pass quarantine fails',
  },
  {
    id: 'severe_false_pass_quarantine_persistent',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'protected autopilot mode gates does not let routine settings updates clear an operator-review quarantine',
  },
  {
    id: 'calibration_ledger_schema',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit ships a bounded tenant-scoped calibration ledger separate from human adjudication',
  },
  {
    id: 'calibration_production_zero_d1',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit performs zero candidate or D1 work outside staging',
  },
  {
    id: 'calibration_bounded_selection',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit selects unchanged green release decisions fairly and excludes unsafe workspaces',
  },
  {
    id: 'calibration_idempotent_claim',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit claims and completes only the exact tenant decision',
  },
  {
    id: 'calibration_stale_source_hold',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit records stale source evidence without calling the independent evaluator',
  },
  {
    id: 'calibration_cost_ceiling',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit performs zero claim or critic work without healthy tenant cost telemetry',
  },
  {
    id: 'calibration_cost_integrity',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit rejects invalid spend telemetry and rounds provider cost upward',
  },
  {
    id: 'calibration_severe_false_pass_quarantine',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit records independent results and immediately quarantines a severe false pass',
  },
  {
    id: 'calibration_repair_false_pass',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit treats a repaired recheck as an advisory false pass of the original green decision',
  },
  {
    id: 'calibration_tenant_failure_isolation',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit isolates tenant telemetry failures and still quarantines completed false passes',
  },
  {
    id: 'calibration_outage_not_label',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit records unavailable critic telemetry without treating it as an adjudication',
  },
  {
    id: 'calibration_degraded_alert_resolution',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit resolves a degraded-run alert after a clean weekly no-op',
  },
  {
    id: 'calibration_freshness_monitor_activation',
    suite: 'src/__tests__/health-sweep.test.ts',
    assertion: 'checkLearningCalibrationFreshness stays neutral before the first successful weekly receipt establishes monitoring',
  },
  {
    id: 'calibration_freshness_monitor_recovery',
    suite: 'src/__tests__/health-sweep.test.ts',
    assertion: 'checkLearningCalibrationFreshness resolves the stale-receipt alert while the latest success is within the weekly window',
  },
  {
    id: 'calibration_freshness_monitor_stale',
    suite: 'src/__tests__/health-sweep.test.ts',
    assertion: 'checkLearningCalibrationFreshness fires critical after one weekly interval plus the one-hour grace period',
  },
  {
    id: 'calibration_freshness_monitor_fail_closed',
    suite: 'src/__tests__/health-sweep.test.ts',
    assertion: 'checkLearningCalibrationFreshness fails closed for invalid or future receipt timestamp not-a-timestamp',
  },
  {
    id: 'alert_schema_health_sentinel',
    suite: 'src/__tests__/health-sweep.test.ts',
    assertion: 'checkAlertPersistenceSchema accepts the alert table only when both operational indexes exist',
  },
  {
    id: 'readiness_schema_health_sentinel',
    suite: 'src/__tests__/health-sweep.test.ts',
    assertion: 'checkLearningReadinessReceiptSchema fails closed for a truncated readiness payload',
  },
  {
    id: 'readiness_schema_health_hold_receipt',
    suite: 'src/__tests__/health-sweep.test.ts',
    assertion: 'checkLearningReadinessReceiptSchema accepts a complete hold receipt with red readiness gates',
  },
  {
    id: 'health_sweep_failure_receipt',
    suite: 'src/__tests__/health-sweep.test.ts',
    assertion: 'cronHealthSweep continues remaining checks then fails the cron receipt when one check throws',
  },
  {
    id: 'calibration_malformed_telemetry_fail_closed',
    suite: 'src/__tests__/learning-pilot-cron-telemetry.test.ts',
    assertion: 'learning pilot cron telemetry records a failed receipt when learning calibration emits malformed counters',
  },
  {
    id: 'calibration_weekly_order',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit wires calibration before learning and weekly customer review',
  },
  {
    id: 'calibration_fresh_non_mutating',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit reruns fresh preflight without mutating posts, decisions, or human adjudications',
  },
  {
    id: 'calibration_error_privacy',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit marks unavailable audit rows through complete tenant identity without persisting raw errors',
  },
  {
    id: 'calibration_deletion',
    suite: 'src/__tests__/learning-calibration-audit.test.ts',
    assertion: 'weekly learning calibration audit deletes calibration receipts before parent decisions for every tenant erasure',
  },
  {
    id: 'deferred_schema_deletion_compatibility',
    suite: 'src/__tests__/learning-deletion.test.ts',
    assertion: 'learning data deletion deletes every available production row when deferred tables are absent',
  },
  {
    id: 'protected_consent_gate',
    suite: 'src/__tests__/learning-readiness.test.ts',
    assertion: 'protected autopilot mode gates downgrades without current consent, fresh readiness, or an owner-kind proof',
  },
  {
    id: 'protected_readiness_schema_complete',
    suite: 'src/__tests__/learning-permanent-preflight.test.ts',
    assertion: 'permanent release preflight downgrades protected autopilot when a ready receipt has truncated checks',
  },
  {
    id: 'protected_consent_activation_gate_main',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes does not bank protected consent before every activation gate passes',
  },
  {
    id: 'protected_consent_activation_gate_shopify',
    suite: 'src/__tests__/shopify-learning-routes.test.ts',
    assertion: 'Shopify learning settings and readiness does not bank shop consent before every activation gate passes',
  },
  {
    id: 'protected_experiment_transition_policy',
    suite: 'src/__tests__/learning-workspace-mode.test.ts',
    assertion: 'learning workspace mode enforces the zero, 0.10, 0.15 protected experiment sequence with rollback',
  },
  {
    id: 'protected_experiment_activation_main',
    suite: 'src/__tests__/learning-routes.test.ts',
    assertion: 'learning settings and release evidence routes does not skip the protected experiment ramp on first activation',
  },
  {
    id: 'protected_experiment_activation_shopify',
    suite: 'src/__tests__/shopify-learning-routes.test.ts',
    assertion: 'Shopify learning settings and readiness does not skip the shop experiment ramp on first activation',
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
    id: 'egress_synthetic_qa_permanent_block',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publishPersistedPost permanently blocks synthetic QA before critics or provider egress',
  },
  {
    id: 'egress_record_only_pilot_permanent_block',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publishPersistedPost blocks copied record-only pilot media before critics or provider egress',
  },
  {
    id: 'egress_record_only_media_job_permanent_block',
    suite: 'src/__tests__/publish-egress-preflight.test.ts',
    assertion: 'publishPersistedPost blocks ready pilot media jobs before critics or provider egress',
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
