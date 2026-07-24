/**
 * src/services/db.ts
 * Client-side API helper for the Cloudflare Worker D1 database.
 * Replaces all direct Firestore SDK calls.
 */
import type { SocialPost } from '../types';
import { CRITIQUE_ACCEPT_THRESHOLD } from '../../shared/critique-thresholds';

const BASE = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

type GetToken = () => Promise<string | null>;
type AuthMode = 'clerk' | 'portal' | 'embed';

// ── Fetch wrapper ─────────────────────────────────────────────────────────────

/** Structured API error carrying the HTTP status and the parsed JSON body
 *  (when the server sent one). Callers in App.tsx interrogate `status` +
 *  `body.code` to render specific UX — most commonly the 409 NOT_CONNECTED
 *  thrown by POST /api/posts + /api/postproxy/publish-now to drive the
 *  inline "Connect Facebook/Instagram" CTA. Falls back to a plain Error
 *  message for callers that just want to `toast(e.message)`. */
export class ApiError extends Error {
  status: number;
  body: { error?: string; code?: string; platform?: 'facebook' | 'instagram'; [k: string]: unknown } | null;
  constructor(message: string, status: number, body: ApiError['body']) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** True when the error is the worker's standard NOT_CONNECTED 409 shape.
 *  Used by App.tsx createPost call sites to route the user to Settings
 *  instead of toasting a raw error blob. */
export function isNotConnectedError(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409 && e.body?.code === 'NOT_CONNECTED';
}

async function apiFetch(
  getToken: GetToken,
  path: string,
  options: RequestInit = {},
  authMode: AuthMode = 'clerk',
): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = authMode === 'portal' ? `Portal ${token}` : authMode === 'embed' ? `Embed ${token}` : `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let body: ApiError['body'] = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON body — keep raw text in message */ }
    const msg = body?.error
      ? `API ${options.method || 'GET'} ${path} failed (${res.status}): ${body.error}`
      : `API ${options.method || 'GET'} ${path} failed (${res.status}): ${text}`;
    throw new ApiError(msg, res.status, body);
  }
  return res;
}

// ── Shared types ──────────────────────────────────────────────────────────────

export interface DbUserData {
  id?: string;
  email?: string | null;
  plan?: string | null;
  setup_status?: string | null;
  is_admin?: number;
  onboarding_done?: number;
  intake_form_done?: number;
  agency_billing_url?: string | null;
  fal_api_key?: string | null;
  paypal_subscription_id?: string | null;
  profile?: string | object;
  stats?: string | object;
  insight_report?: string | object | null;
  /** v5 — single reel credits balance. Plan grants + purchased credits both
   *  accrue here. Reel generation decrements by 1. Never expires. */
  reel_credits?: number;
  /** v13 — per-user feature overrides (admin grants/revokes that override
   *  plan tier defaults). JSON string from D1 — parse before reading.
   *  Shape: `{"posters": true}` grants, `{"posters": false}` revokes,
   *  missing keys fall through to CLIENT.plans[].includes defaults. */
  addon_features?: string | null;
  /** v13 — admin-gifted/purchased poster credits. Lifetime balance,
   *  additive on top of plan monthly quota. Same model as reel_credits. */
  poster_credits?: number;
  /** v6 — 'monthly' | 'yearly'. Drives the renewal-grant multiplier (×1 or ×12)
   *  in the PayPal PAYMENT.SALE.COMPLETED webhook handler. */
  billing_cycle?: string | null;
}

export interface DbPost {
  id: string;
  user_id?: string;
  client_id?: string | null;
  content: string;
  platform?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
  hashtags?: string[] | string;
  image_url?: string | null;
  topic?: string | null;
  pillar?: string | null;
  late_post_id?: string | null;
  image_prompt?: string | null;
  reasoning?: string | null;
  post_type?: string | null;
  video_script?: string | null;
  video_shots?: string | null;
  video_mood?: string | null;
  // v5 — scheduled reels pipeline. video_url populated by prewarm cron; the
  // rest track lifecycle so polling resumes across cron ticks.
  video_url?: string | null;
  video_status?: 'pending' | 'generating' | 'ready' | 'failed' | null;
  video_request_id?: string | null;
  video_started_at?: string | null;
  video_error?: string | null;
  r2_video_key?: string | null;
  audio_mixed_url?: string | null;
  // v8 — vision-critique result populated by prewarm cron + manual critique
  image_critique_score?: number | null;
  image_critique_reasoning?: string | null;
  image_critique_at?: string | null;
  // v36 - customer QA feedback from PostModal.
  qa_feedback_target?: 'post' | 'image' | 'caption' | null;
  qa_feedback_reason?: 'off_brand' | 'bad_image' | 'bad_caption' | 'other' | null;
  qa_feedback_note?: string | null;
  qa_feedback_at?: string | null;
}

export interface LearningCriticVerdict {
  id: string;
  decision_id: string;
  critic_kind: string;
  verdict: 'pass' | 'warn_repairable' | 'block' | 'unavailable';
  severity: 'advisory' | 'release_critical';
  confidence: number;
  evidence: string[];
  repairs: string[];
  provider: string | null;
  model: string | null;
  attempt: number;
}

export interface LearningDecision {
  id: string;
  post_id: string;
  mode: 'off' | 'shadow' | 'approval' | 'protected_autopilot';
  stage: 'snapshot' | 'text_preflight' | 'media_preflight' | 'release';
  release_state: 'pending' | 'pass_green' | 'hold_amber' | 'block_red' | 'shadow_only';
  content_hash: string;
  summary: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  verdicts: LearningCriticVerdict[];
}

export type LearningMode = 'off' | 'shadow' | 'approval' | 'protected_autopilot';

export interface LearningProfile {
  version: number;
  approved: boolean;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface LearningSignal {
  variableKey: string;
  variableValue: string;
  objective: string;
  sampleCount: number;
  effect: number;
  confidence: number;
  freshnessAt: string;
  status: string;
  evidenceKind: 'association' | 'experiment';
}

export interface LearningOutcome {
  id: string;
  postId: string;
  platform: string;
  postType: string | null;
  content: string | null;
  windowHours: number;
  rawSignals: Record<string, unknown>;
  normalizedScore: number | null;
  completeness: string;
  sourceStatus: string;
  publishedAt: string;
  measuredAt: string;
}

export interface LearningSummary {
  profile: LearningProfile | null;
  signals: LearningSignal[];
  outcomes: LearningOutcome[];
}

export interface LearningSettings {
  mode: LearningMode;
  autopublishConsentAt: string | null;
  autopublishPolicyVersion: string | null;
  experimentRate: number;
  monthlyAiBudgetUsdCents: number | null;
  disabledReason: string | null;
  exists: boolean;
}

export interface LearningSettingsResponse {
  settings: LearningSettings;
  effectiveMode: LearningMode;
}

export interface LearningSettingsUpdate {
  clientId?: string | null;
  mode: 'approval' | 'protected_autopilot';
  consent?: boolean;
  experimentRate?: number;
  monthlyAiBudgetUsdCents?: number | null;
}

export interface LearningReadinessChecks {
  pilot?: boolean;
  pilotCohort?: boolean;
  adjudications?: boolean;
  severeFalsePasses?: boolean;
  falseHolds?: boolean;
  availability?: boolean;
  releaseJudgeAvailability?: boolean;
  releaseJudgeTelemetry?: boolean;
  receipts?: boolean;
  predictionCoverage?: boolean;
  predictionLift?: boolean;
  rankCorrelation?: boolean;
  criticalBypasses?: boolean;
  publishingRegressions?: boolean;
  cost?: boolean;
  killSwitch?: boolean;
  replayRedTeam?: boolean;
  publishRegression?: boolean;
  tenancyProofs?: Partial<Record<'user' | 'client' | 'shop', boolean>>;
}

export interface LearningReadinessMetrics {
  pilotDecisions?: number;
  pilotWorkspaceCount?: number;
  pilotUserDecisions?: number;
  pilotClientDecisions?: number;
  adjudicatedDecisions?: number;
  severeFalsePasses?: number;
  falseHoldRate?: number;
  requiredAvailability?: number;
  releaseJudgeAvailability?: number;
  releaseJudgeTelemetryCoverage?: number;
  releaseJudgeInvocations?: number;
  decisionReceiptCoverage?: number;
  predictionSampleCount?: number;
  predictionWorkspaceCount?: number;
  predictionMinWorkspaceSamples?: number;
  predictionLift?: number;
  rankCorrelation?: number;
  criticalBypasses?: number;
  publishingRegressions?: number;
  costWithinBudget?: boolean;
  killSwitchTested?: boolean;
}

export interface LearningGlobalSwitches {
  learningBrain: boolean;
  releaseEnforcement: boolean;
  protectedAutopilot: boolean;
}

export interface LearningReadinessResponse {
  policyVersion: string;
  ready: boolean;
  stale: boolean;
  effectiveMode: LearningMode;
  evaluatedAt: string | null;
  checks: LearningReadinessChecks;
  metrics: LearningReadinessMetrics;
  cost: {
    monthlyAiSpendUsdCents: number | null;
    telemetryCount: number;
    monthlyAiBudgetUsdCents: number | null;
    withinBudget: boolean;
  };
  globalSwitches: LearningGlobalSwitches;
}

export interface LearningConversionFeedback {
  clientId?: string | null;
  calls?: number;
  messages?: number;
  leads?: number;
  bookings?: number;
  sales?: number;
  orderValueCents?: number;
}

export interface LearningAdjudicationInput {
  expectedState: 'pass_green' | 'hold_amber' | 'block_red';
  severity: 'advisory' | 'release_critical';
  note: string;
}

export interface LearningAdjudicationEvidence {
  content: string;
  platform: string;
  hashtags: string[];
  mediaKind: 'none' | 'image' | 'video';
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  videoScript: string | null;
  videoShots: string[];
  contentHash: string;
}

export interface AdminLearningWorkspace {
  userId: string;
  workspaceKey: string;
  clientId: string | null;
  ownerKind: 'user' | 'client' | 'shop';
  ownerId: string;
  mode: LearningMode;
  consentAt: string | null;
  consentPolicyVersion: string | null;
  active: boolean;
  onHold: boolean;
  decisionCount: number;
  holdRate: number | null;
  sampledFalseHoldRate: number | null;
  criticAvailability: number | null;
  judgeAvailability: number | null;
  judgeTelemetryCoverage: number | null;
  severeFalsePasses: number;
  adjudicationCoverage: number | null;
  globalKillSwitchEnabled: boolean;
  updatedAt: string;
  sampleDecisionId?: string | null;
  samplePostId?: string | null;
  sampleEvidenceStatus?: 'verified' | 'missing' | 'stale' | null;
  sampleEvidence?: LearningAdjudicationEvidence | null;
}

export interface AdminLearningOperations {
  policyVersion: string;
  globalSwitches: LearningGlobalSwitches;
  releaseEvidence?: {
    validCount: number;
    requiredCount: number;
    invalidOrMissingCount: number;
    expiredCount: number;
    complete: boolean;
    nextExpiryAt: string | null;
  };
  readiness: Omit<LearningReadinessResponse, 'policyVersion' | 'effectiveMode' | 'cost' | 'globalSwitches'>;
  workspaces: AdminLearningWorkspace[];
}

export interface LearningPilotCandidate {
  clientId: string | null;
  ownerKind: 'user' | 'client';
  ownerId: string;
  workspaceKey: string;
  label: string;
  eligibleDraftCount: number;
  samplePostId: string;
  enrolled: boolean;
  monthlyAiBudgetUsdCents: number | null;
  contextReady: boolean;
  contextReason: 'business_profile' | 'verified_facts' | 'missing_business_context';
  meaningfulProfileFieldCount: number;
  verifiedFactCount: number;
  sampleDraft?: {
    postId: string;
    content: string;
    platform: string;
    hashtags: string | null;
    imageUrl: string | null;
    postType: string | null;
    videoUrl: string | null;
    contentHash: string;
  } | null;
}

export interface LearningPilotQueue {
  recordOnly: true;
  enrollments?: LearningPilotActiveEnrollment[];
  candidates: LearningPilotCandidate[];
}

export interface LearningPilotActiveEnrollment {
  enrollmentId: string;
  clientId: string | null;
  ownerKind: 'user' | 'client';
  ownerId: string;
  workspaceKey: string;
  policyVersion: string;
  enrolledAt: string;
  label: string;
  recordOnly: true;
}

export interface LearningPilotCustomerConsent {
  confirmed: true;
  note: string;
}

export interface LearningPilotEnrollment {
  workspaceKey: string;
  ownerKind: 'user' | 'client';
  ownerId: string;
  mode: 'approval';
  monthlyAiBudgetUsdCents: number;
  autopublishConsentAt: null;
  recordOnly: true;
  pilotEnrollmentId: string;
  pilotPolicyVersion: string;
  enrolledAt: string;
}

export interface LearningPilotSampleAttestation {
  sampleId: string;
  postId: string;
  contentHash: string;
  attestationBasis: 'owner_real_post' | 'customer_real_post';
  attestedAt: string;
  created: boolean;
  postMutated: false;
}

export interface LearningPilotValidation {
  decisionId: string;
  releaseState: 'pass_green' | 'hold_amber' | 'block_red';
  postId: string;
  sourceStatus: 'Draft';
  postMutated: false;
}

export interface LearningPilotWithdrawal {
  withdrawn: boolean;
  alreadyWithdrawn: boolean;
  enrollmentId: string | null;
  policyVersion: string;
  workspaceKey: string;
  ownerKind: 'user' | 'client';
  ownerId: string;
  mode: 'shadow';
  decisionsRemoved: number;
  samplesRemoved: number;
  sourcePostsDeleted: 0;
  publishingRecordsDeleted: 0;
  originalDraftsRetained: true;
  copiedStagingDataRequiresArtifactWithdrawal: true;
}

export type OrganicReachPlatform = 'facebook' | 'instagram';

export interface ReachProfile {
  id: string;
  version: number;
  confirmationStatus: 'proposed' | 'confirmed';
  timezone: string;
  baseLocation: { country: string; region: string; locality: string };
  serviceArea: { radiusKm: number | null; included: string[] };
  excludedLocations: string[];
  platforms: OrganicReachPlatform[];
  cadence?: Record<string, unknown>;
  confirmedAt?: string | null;
}

export interface ReachProfileDraft {
  timezone: string;
  baseLocation: ReachProfile['baseLocation'];
  serviceArea: ReachProfile['serviceArea'];
  excludedLocations?: string[];
  platforms?: OrganicReachPlatform[];
  cadence?: Record<string, unknown>;
}

export interface ReachAudienceSegment {
  id: string;
  label: string;
  needs: string[];
  messageAngles: string[];
  suitableOffers: string[];
  evidence: string[];
  confidence: number;
  status: 'predicted' | 'confirmed' | 'disabled';
}

export interface ReachTimingWindow {
  weekday: number;
  startHour: number;
  endHour: number;
  platform: OrganicReachPlatform;
  mediaType: string;
  expectedScore: number;
  confidence: number;
  sampleSize: number;
  source: 'account' | 'archetype';
}

export interface ReachPlan {
  id: string;
  postId: string;
  reachProfileId: string | null;
  reachProfileVersion: number | null;
  objective: string | null;
  audienceSegmentId: string | null;
  audience: { label: string; needs: string[] } | null;
  status: 'shadow' | 'selected' | 'invalidated';
  createdAt: string | null;
  geographicFocus: string[];
  platformPlan: Partial<Record<OrganicReachPlatform, {
    caption?: string;
    hashtags?: string[];
  }>>;
  timing: ReachTimingWindow[];
  language: Record<string, unknown>;
  hashtags: {
    localKeywords?: string[];
    facebookTags?: string[];
    instagramTags?: string[];
    evidence?: string[];
  };
  media: Partial<Record<OrganicReachPlatform, {
    source?: 'approved_asset' | 'generated';
    assetId?: string | null;
    format?: string;
    generate?: boolean;
  }>> & { generatedUrl?: string | null };
  experiment: Record<string, unknown>;
}

/** Maps a `DbPost` row (snake_case from D1) to the front-end `SocialPost`
 *  (camelCase). Three near-identical inline copies of this shape used to
 *  live in App.tsx — extracted here so any new field added to `posts` is a
 *  one-site change. Keep in sync with src/types.ts and DbPost above. */
export function mapDbPostToSocialPost(p: DbPost): import('../types').SocialPost {
  return {
    id: p.id,
    clientId: p.client_id ?? null,
    content: p.content,
    platform: p.platform as import('../types').SocialPost['platform'],
    status: p.status as import('../types').SocialPost['status'],
    scheduledFor: p.scheduled_for ?? '',
    hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
    image: p.image_url ?? undefined,
    topic: p.topic ?? undefined,
    pillar: p.pillar as import('../types').SocialPost['pillar'] | undefined,
    imagePrompt: p.image_prompt ?? undefined,
    reasoning: p.reasoning ?? undefined,
    postType: (p.post_type as import('../types').SocialPost['postType']) ?? undefined,
    videoScript: p.video_script ?? undefined,
    videoShots: p.video_shots ?? undefined,
    videoMood: p.video_mood ?? undefined,
    videoUrl: p.video_url ?? undefined,
    videoStatus: p.video_status ?? undefined,
    videoRequestId: p.video_request_id ?? undefined,
    videoStartedAt: p.video_started_at ?? undefined,
    videoError: p.video_error ?? undefined,
    r2VideoKey: p.r2_video_key ?? undefined,
    audioMixedUrl: p.audio_mixed_url ?? undefined,
    imageCritiqueScore: p.image_critique_score ?? undefined,
    imageCritiqueReasoning: p.image_critique_reasoning ?? undefined,
    imageCritiqueAt: p.image_critique_at ?? undefined,
    qaFeedbackTarget: p.qa_feedback_target ?? undefined,
    qaFeedbackReason: p.qa_feedback_reason ?? undefined,
    qaFeedbackNote: p.qa_feedback_note ?? undefined,
    qaFeedbackAt: p.qa_feedback_at ?? undefined,
  };
}

export interface DbClient {
  id: string;
  user_id?: string;
  name: string;
  business_type?: string | null;
  created_at?: string;
  plan?: string | null;
  profile?: object;
  stats?: object;
  insightReport?: object | null;
  client_slug?: string | null;
  /** v5 — per-client reel credits (Agency workspaces). Same semantics as users.reel_credits. */
  reel_credits?: number;
}

/** API shape for a campaign row — matches the worker's rowToApi output
 *  exactly, so callers can drop the result straight into `Campaign` state.
 *  As of schema_v12 includes the agentic-research brief fields. */
export interface DbCampaign {
  id: string;
  clientId?: string | null;
  name: string;
  type?: string;
  startDate?: string | null;
  endDate?: string | null;
  rules?: string;
  imageNotes?: string;
  postsPerDay?: number;
  enabled?: boolean;
  createdAt?: string;
  // Agentic research (schema_v12).
  brief?: string;
  briefSummary?: string;
  briefStatus?: 'idle' | 'researching' | 'ready' | 'failed';
  briefUpdatedAt?: string;
  briefSources?: Array<{ url: string; ok: boolean; title?: string; status?: number; error?: string }>;
}

/** Per-user add-on overrides + credit balances (admin GET shape, schema_v13). */
export interface AdminUserAddons {
  id: string;
  email: string | null;
  plan: string | null;
  /** `{ posters: true }` = grant, `{ posters: false }` = revoke, missing = plan default. */
  addonFeatures: Record<string, boolean>;
  posterCredits: number;
  reelCredits: number;
}

/** Patch shape for admin add-on edit. Pass either absolute SET or relative DELTA
 *  for each credit balance — never both. addonFeatures is a partial: pass `null`
 *  for a key to REMOVE the override (fall through to plan default). */
export interface AdminUserAddonsPatch {
  addonFeatures?: Record<string, boolean | null>;
  posterCredits?: number;
  reelCredits?: number;
  posterCreditsDelta?: number;
  reelCreditsDelta?: number;
}

// ── DB factory ────────────────────────────────────────────────────────────────

export function createDb(getToken: GetToken, authMode: AuthMode = 'clerk') {
  const f = (path: string, opts: RequestInit = {}) => apiFetch(getToken, path, opts, authMode);
  const j = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
  const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });
  const del = () => ({ method: 'DELETE' });

  return {
    // ── User ──────────────────────────────────────────────────────────────────
    async getUser(): Promise<DbUserData | null> {
      const res = await f('/api/db/user');
      const data = await res.json() as { user: DbUserData | null };
      return data.user;
    },

    async upsertUser(fields: Record<string, unknown>): Promise<void> {
      await f('/api/db/user', put(fields));
    },

    // ── Posts ─────────────────────────────────────────────────────────────────
    async getPosts(clientId?: string | null): Promise<DbPost[]> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/db/posts${qs}`);
      const data = await res.json() as { posts: DbPost[] };
      return data.posts ?? [];
    },

    async getLearningDecisions(
      postId: string,
      clientId?: string | null,
    ): Promise<LearningDecision[]> {
      const query = clientId
        ? `?clientId=${encodeURIComponent(clientId)}`
        : '';
      const res = await f(
        `/api/learning/decisions/${encodeURIComponent(postId)}${query}`,
      );
      const data = await res.json() as { decisions: LearningDecision[] };
      return data.decisions ?? [];
    },

    async getLearningSummary(clientId?: string | null): Promise<LearningSummary> {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/learning/profile${query}`);
      const data = await res.json() as LearningSummary;
      return {
        profile: data.profile ?? null,
        signals: data.signals ?? [],
        outcomes: data.outcomes ?? [],
      };
    },

    async getLearningSettings(clientId?: string | null): Promise<LearningSettingsResponse> {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/learning/settings${query}`);
      return res.json() as Promise<LearningSettingsResponse>;
    },

    async getLearningReadiness(clientId?: string | null): Promise<LearningReadinessResponse> {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/learning/readiness${query}`);
      return res.json() as Promise<LearningReadinessResponse>;
    },

    async updateLearningSettings(
      input: LearningSettingsUpdate,
    ): Promise<LearningSettingsResponse> {
      const body: Record<string, unknown> = {
        clientId: input.clientId ?? null,
        mode: input.mode,
      };
      if (input.consent !== undefined) body.consent = input.consent;
      if (input.experimentRate !== undefined) body.experimentRate = input.experimentRate;
      if (input.monthlyAiBudgetUsdCents !== undefined) {
        body.monthlyAiBudgetUsdCents = input.monthlyAiBudgetUsdCents;
      }
      const res = await f('/api/learning/settings', put(body));
      return res.json() as Promise<LearningSettingsResponse>;
    },

    async recordConversionFeedback(
      postId: string,
      input: LearningConversionFeedback,
    ): Promise<{ ok: boolean; feedbackId: string }> {
      const body: Record<string, unknown> = { clientId: input.clientId ?? null };
      const fields = [
        'calls', 'messages', 'leads', 'bookings', 'sales', 'orderValueCents',
      ] as const;
      for (const field of fields) {
        if (input[field] !== undefined) body[field] = input[field];
      }
      const res = await f(
        `/api/learning/outcomes/${encodeURIComponent(postId)}/feedback`,
        j(body),
      );
      return res.json() as Promise<{ ok: boolean; feedbackId: string }>;
    },

    async getAdminLearningOperations(limit = 100): Promise<AdminLearningOperations> {
      const res = await f(`/api/learning/admin/operations?limit=${encodeURIComponent(limit)}`);
      return res.json() as Promise<AdminLearningOperations>;
    },

    async getLearningPilotCandidates(): Promise<LearningPilotQueue> {
      const res = await f('/api/learning/pilot/candidates');
      const data = await res.json() as LearningPilotQueue;
      return {
        recordOnly: true,
        enrollments: data.enrollments ?? [],
        candidates: data.candidates ?? [],
      };
    },

    async enrollLearningPilotWorkspace(
      clientId: string | null,
      monthlyAiBudgetUsdCents: number,
      customerConsent?: LearningPilotCustomerConsent,
    ): Promise<LearningPilotEnrollment> {
      const res = await f('/api/learning/pilot/enroll', j({
        clientId,
        monthlyAiBudgetUsdCents,
        customerConsentConfirmed: customerConsent?.confirmed,
        customerConsentNote: customerConsent?.note,
      }));
      return res.json() as Promise<LearningPilotEnrollment>;
    },

    async withdrawLearningPilotWorkspace(
      clientId: string | null,
      withdrawalNote: string,
    ): Promise<LearningPilotWithdrawal> {
      const res = await f('/api/learning/pilot/enrollment', {
        method: 'DELETE',
        body: JSON.stringify({
          clientId,
          withdrawalConfirmed: true,
          withdrawalNote,
        }),
      });
      return res.json() as Promise<LearningPilotWithdrawal>;
    },

    async attestLearningPilotDraft(
      postId: string,
      expectedContentHash: string,
      note: string,
    ): Promise<LearningPilotSampleAttestation> {
      const res = await f(
        `/api/learning/pilot/attest/${encodeURIComponent(postId)}`,
        j({ realPostConfirmed: true, expectedContentHash, note }),
      );
      return res.json() as Promise<LearningPilotSampleAttestation>;
    },

    async validateLearningPilotDraft(postId: string): Promise<LearningPilotValidation> {
      const res = await f(
        `/api/learning/pilot/validate/${encodeURIComponent(postId)}`,
        j({}),
      );
      return res.json() as Promise<LearningPilotValidation>;
    },

    async adjudicateLearningDecision(
      decisionId: string,
      input: LearningAdjudicationInput,
    ): Promise<{ adjudicationId: string }> {
      const body: LearningAdjudicationInput = {
        expectedState: input.expectedState,
        severity: input.severity,
        note: input.note,
      };
      const res = await f(
        `/api/learning/decisions/${encodeURIComponent(decisionId)}/adjudicate`,
        j(body),
      );
      return res.json() as Promise<{ adjudicationId: string }>;
    },

    async getReachProfile(clientId?: string | null): Promise<{
      profile: ReachProfile | null;
      segments: ReachAudienceSegment[];
    }> {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/reach/profile${query}`);
      const data = await res.json() as {
        profile: ReachProfile | null;
        segments: ReachAudienceSegment[];
      };
      return { profile: data.profile ?? null, segments: data.segments ?? [] };
    },

    async proposeReachProfile(
      input: ReachProfileDraft & { clientId?: string | null },
    ): Promise<ReachProfile> {
      const res = await f('/api/reach/profile/propose', j({
        ...input,
        clientId: input.clientId ?? null,
      }));
      const data = await res.json() as { profile: ReachProfile };
      return data.profile;
    },

    async confirmReachProfile(
      profileId: string,
      clientId?: string | null,
    ): Promise<ReachProfile> {
      const res = await f('/api/reach/profile/confirm', put({
        profileId,
        clientId: clientId ?? null,
      }));
      const data = await res.json() as { profile: ReachProfile };
      return data.profile;
    },

    async proposeReachSegments(
      clientId?: string | null,
    ): Promise<ReachAudienceSegment[]> {
      const res = await f('/api/reach/segments/propose', j({
        clientId: clientId ?? null,
      }));
      const data = await res.json() as { segments: ReachAudienceSegment[] };
      return data.segments ?? [];
    },

    async confirmReachSegment(
      segmentId: string,
      clientId?: string | null,
    ): Promise<void> {
      await f('/api/reach/segments/confirm', put({
        segmentId,
        clientId: clientId ?? null,
      }));
    },

    async getReachPlans(
      postId: string,
      clientId?: string | null,
    ): Promise<ReachPlan[]> {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(
        `/api/reach/plans/${encodeURIComponent(postId)}${query}`,
      );
      const data = await res.json() as { plans: ReachPlan[] };
      return data.plans ?? [];
    },

    async createPost(post: Omit<DbPost, 'id'> & { clientId?: string | null }): Promise<string> {
      const res = await f('/api/db/posts', j(post));
      const data = await res.json() as { id: string };
      return data.id;
    },

    async updatePost(id: string, fields: Partial<DbPost>): Promise<void> {
      await f(`/api/db/posts/${id}`, put(fields));
    },

    async markPostFeedback(input: {
      postId: string;
      target: 'post' | 'image' | 'caption';
      reason: 'off_brand' | 'bad_image' | 'bad_caption' | 'other';
      note?: string | null;
    }): Promise<void> {
      await f(`/api/db/posts/${input.postId}`, put({
        qaFeedbackTarget: input.target,
        qaFeedbackReason: input.reason,
        qaFeedbackNote: input.note ?? null,
      }));
    },

    async deletePost(id: string): Promise<void> {
      await f(`/api/db/posts/${id}`, del());
    },

    async deleteAllPosts(clientId?: string | null): Promise<void> {
      await f('/api/db/posts/delete-all', j({ clientId: clientId || null }));
    },

    async bulkUpdatePostStatus(ids: string[], status: string): Promise<void> {
      await f('/api/db/posts/bulk-status', j({ ids, status }));
    },

    async getClientPostHealth(clientId: string): Promise<Pick<DbPost, 'id' | 'scheduled_for' | 'status'>[]> {
      const res = await f(`/api/db/posts/client-health?clientId=${encodeURIComponent(clientId)}`);
      const data = await res.json() as { posts: Pick<DbPost, 'id' | 'scheduled_for' | 'status'>[] };
      return data.posts ?? [];
    },

    // ── Clients ───────────────────────────────────────────────────────────────
    async getClients(): Promise<DbClient[]> {
      const res = await f('/api/db/clients');
      const data = await res.json() as { clients: DbClient[] };
      return data.clients ?? [];
    },

    async getClient(id: string): Promise<DbClient | null> {
      const res = await f(`/api/db/clients/${id}`);
      const data = await res.json() as { client: DbClient | null };
      return data.client;
    },

    async createClient(client: { name: string; businessType?: string; createdAt?: string; plan?: string | null }): Promise<string> {
      const res = await f('/api/db/clients', j(client));
      const data = await res.json() as { id: string };
      return data.id;
    },

    async updateClient(id: string, fields: Record<string, unknown>): Promise<void> {
      await f(`/api/db/clients/${id}`, put(fields));
    },

    async deleteClient(id: string): Promise<void> {
      await f(`/api/db/clients/${id}`, del());
    },

    /**
     * Atomic reel-credit debit (audit P0-3, 2026-05-22). Replaces the
     * client-side read-modify-write that two concurrent tabs would both
     * stomp. Throws ApiError with status 402 + code 'INSUFFICIENT_CREDITS'
     * when the workspace doesn't have enough credits — caller should toast
     * and bail rather than retry. Returns the new server-side balance.
     *
     * clientId=null debits the user's own workspace (users.reel_credits);
     * otherwise debits clients.reel_credits for the specified client.
     */
    async debitReelCredits(params: { clientId: string | null; count: number }): Promise<{ balance: number }> {
      const res = await f('/api/db/reel-credits/debit', j(params));
      const data = await res.json() as { balance: number };
      return { balance: Number(data.balance ?? 0) };
    },

    // ── Campaigns ────────────────────────────────────────────────────────────
    async getCampaigns(clientId?: string | null): Promise<DbCampaign[]> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/db/campaigns${qs}`);
      const data = await res.json() as { campaigns: DbCampaign[] };
      return data.campaigns ?? [];
    },

    async createCampaign(campaign: { name: string; type?: string; startDate?: string; endDate?: string; rules?: string; imageNotes?: string; postsPerDay?: number; enabled?: boolean; clientId?: string | null }): Promise<string> {
      const res = await f('/api/db/campaigns', j(campaign));
      const data = await res.json() as { id: string };
      return data.id;
    },

    async updateCampaign(id: string, fields: Partial<{ name: string; type: string; startDate: string; endDate: string; rules: string; imageNotes: string; postsPerDay: number; enabled: boolean }>): Promise<void> {
      await f(`/api/db/campaigns/${id}`, put(fields));
    },

    async deleteCampaign(id: string): Promise<void> {
      await f(`/api/db/campaigns/${id}`, del());
    },

    /** Run/re-run the agentic research pass on a campaign. Synchronous —
     *  the worker fetches any URLs in the rules text, calls Haiku in JSON
     *  mode, persists { brief, summary, sources, status } to the row, then
     *  returns the updated DbCampaign. ~5–10s round-trip; UI should show a
     *  spinner. Throws on transport / 4xx / 5xx — caller catches to show
     *  the failure state. */
    async researchCampaign(id: string): Promise<DbCampaign> {
      const res = await f(`/api/db/campaigns/${id}/research`, j({}));
      return await res.json() as DbCampaign;
    },

    // ── Portal ────────────────────────────────────────────────────────────────
    async getPortal(slug: string): Promise<{ email: string; password: string } | null> {
      try {
        const res = await fetch(`${BASE}/api/db/portal/${encodeURIComponent(slug.toLowerCase())}`);
        if (!res.ok) return null;
        const data = await res.json() as { portal: { email: string; password: string } | null };
        return data.portal;
      } catch {
        return null;
      }
    },

    async setPortal(slug: string, email: string, password: string): Promise<void> {
      await f(`/api/db/portal/${encodeURIComponent(slug.toLowerCase())}`, put({ email, password }));
    },

    async getPortalContent(slug: string): Promise<{ hero_title: string; hero_subtitle: string; hero_cta_text: string }> {
      try {
        const res = await fetch(`${BASE}/api/db/portal/${encodeURIComponent(slug.toLowerCase())}/content`);
        if (!res.ok) return { hero_title: '', hero_subtitle: '', hero_cta_text: '' };
        const data = await res.json() as { content: { hero_title: string; hero_subtitle: string; hero_cta_text: string } };
        return data.content;
      } catch { return { hero_title: '', hero_subtitle: '', hero_cta_text: '' }; }
    },

    async setPortalContent(slug: string, content: { hero_title?: string; hero_subtitle?: string; hero_cta_text?: string }): Promise<void> {
      await f(`/api/db/portal/${encodeURIComponent(slug.toLowerCase())}/content`, put(content));
    },

    // ── Activations / Cancellations ───────────────────────────────────────────
    async getActivation(email?: string | null): Promise<Record<string, unknown> | null> {
      const qs = email ? `?email=${encodeURIComponent(email)}` : '';
      const res = await f(`/api/db/activations${qs}`);
      const data = await res.json() as { activation: Record<string, unknown> | null };
      return data.activation;
    },

    async consumeActivation(id: string): Promise<void> {
      await f(`/api/db/activations/${id}/consume`, put({}));
    },

    async getCancellation(email?: string | null): Promise<Record<string, unknown> | null> {
      const qs = email ? `?email=${encodeURIComponent(email)}` : '';
      const res = await f(`/api/db/cancellations${qs}`);
      const data = await res.json() as { cancellation: Record<string, unknown> | null };
      return data.cancellation;
    },

    async consumeCancellation(id: string): Promise<void> {
      await f(`/api/db/cancellations/${id}/consume`, put({}));
    },

    async deleteUser(): Promise<void> {
      await f('/api/db/user', del());
    },

    // ── Social Tokens ─────────────────────────────────────────────────────────
    // Stored in dedicated D1 column — never cached in localStorage
    async getSocialTokens(clientId?: string | null): Promise<Record<string, unknown>> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/db/social-tokens${qs}`);
      const data = await res.json() as { tokens: Record<string, unknown> };
      return data.tokens ?? {};
    },

    async setSocialTokens(tokens: Record<string, unknown>, clientId?: string | null): Promise<void> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      await f(`/api/db/social-tokens${qs}`, put(tokens));
    },

    // ── Admin: Customers dashboard ────────────────────────────────────────────
    // All endpoints below require users.is_admin=1 in D1. Calls fail with 403
    // for non-admin signed-in users.

    async getAdminStats(): Promise<AdminStats> {
      const res = await f('/api/admin/stats');
      return res.json() as Promise<AdminStats>;
    },

    async getAdminCustomers(
      filter: 'all' | 'trial' | 'paid' | 'cancelled' = 'all',
      limit = 50,
      offset = 0,
    ): Promise<{ customers: AdminCustomer[]; total: number; limit: number; offset: number; filter: string }> {
      const qs = `?filter=${filter}&limit=${limit}&offset=${offset}`;
      const res = await f(`/api/admin/customers${qs}`);
      return res.json() as Promise<{ customers: AdminCustomer[]; total: number; limit: number; offset: number; filter: string }>;
    },

    async getAdminPayments(email?: string, limit = 20): Promise<{ payments: PaymentEvent[] }> {
      const parts: string[] = [];
      if (email) parts.push(`email=${encodeURIComponent(email)}`);
      parts.push(`limit=${limit}`);
      const res = await f(`/api/admin/payments?${parts.join('&')}`);
      return res.json() as Promise<{ payments: PaymentEvent[] }>;
    },

    async getAdminPrewarmReadiness(hours = 24, limit = 50): Promise<AdminPrewarmReadiness> {
      const res = await f(`/api/admin/prewarm-readiness?hours=${hours}&limit=${limit}`);
      return res.json() as Promise<AdminPrewarmReadiness>;
    },

    async getAdminPostFeedback(limit = 25): Promise<{ feedback: AdminPostFeedback[]; limit: number }> {
      const res = await f(`/api/admin/post-feedback?limit=${limit}`);
      return res.json() as Promise<{ feedback: AdminPostFeedback[]; limit: number }>;
    },

    // Shopify Stores — admin-only tenant view (schema_v17/v18). Each row is
    // one Shopify merchant who's ever installed our app. `bucket` is a
    // derived filter category (active/trial/pending/cancelled/uninstalled).
    async getShopifyStores(): Promise<ShopifyStoresResponse> {
      const res = await f('/api/admin/shopify-stores');
      return res.json() as Promise<ShopifyStoresResponse>;
    },

    async getShopifyStore(domain: string): Promise<{ store: ShopifyStore; events: ShopifyBillingEvent[] }> {
      const res = await f(`/api/admin/shopify-stores/${encodeURIComponent(domain)}`);
      return res.json() as Promise<{ store: ShopifyStore; events: ShopifyBillingEvent[] }>;
    },

    /** Per-user add-on overrides + credit balances (schema_v13). Admin-gated.
     *  GET returns the current state so the admin UI can render it before
     *  editing. PATCH supports both absolute SET and relative DELTA on credit
     *  balances (admin "gift 5 more" workflow). */
    async getAdminUserAddons(userId: string): Promise<AdminUserAddons> {
      const res = await f(`/api/admin/users/${encodeURIComponent(userId)}/addons`);
      return res.json() as Promise<AdminUserAddons>;
    },

    async setAdminUserAddons(userId: string, body: AdminUserAddonsPatch): Promise<AdminUserAddons> {
      const res = await f(`/api/admin/users/${encodeURIComponent(userId)}/addons`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      return res.json() as Promise<AdminUserAddons>;
    },

    /**
     * Admin AI-quality scan — returns Scheduled posts whose content trips the
     * server-side fabrication / cadence / trope detector. Mirrors the client
     * detectFabrication used at generation time. 2026-05 audit follow-up: lets
     * admins find pre-deployment posts that need regenerating before publish.
     */
    async getFlaggedPosts(
      status: SocialPost['status'] = 'Scheduled',
      limit = 500,
    ): Promise<{ scanned: number; flagged: FlaggedPost[] }> {
      const res = await f(`/api/admin/scan-flagged-posts?status=${status}&limit=${limit}`);
      return res.json() as Promise<{ scanned: number; flagged: FlaggedPost[] }>;
    },

    /**
     * Retroactively run Haiku 4.5 vision critique against every post the
     * caller owns that has an image_url but no critique score yet. Surfaces
     * the "AI quality" badge on historical posts (not just freshly generated
     * ones). Caps at 50 per call — re-run until `remaining_estimate: 'done'`.
     */
    async backfillCritiqueScores(limit = 50): Promise<{
      found: number;
      scored: number;
      failed: number;
      low_scores: number;
      remaining_estimate: string;
    }> {
      const res = await f('/api/admin/backfill-critique-scores', {
        method: 'POST',
        body: JSON.stringify({ limit }),
      });
      return res.json() as any;
    },

    /**
     * Bulk regenerate images for posts whose critique score is ≤ threshold
     * (default 4). Forces the curated archetype fallback scene so the new
     * image is guaranteed on-archetype. Re-critiques and persists the new
     * score in one round-trip. Caps at 20 per call.
     */
    async bulkRegenLowScoreImages(threshold = CRITIQUE_ACCEPT_THRESHOLD - 1, limit = 20): Promise<{
      found: number;
      regenerated: number;
      failed: number;
      threshold: number;
      errors: string[];
    }> {
      const res = await f('/api/admin/bulk-regen-low-score-images', {
        method: 'POST',
        body: JSON.stringify({ threshold, limit }),
      });
      return res.json() as any;
    },

    // ── Customer: Billing screen ──────────────────────────────────────────────
    // Returns the SIGNED-IN user's plan + their own payment history.

    async getBilling(): Promise<BillingInfo> {
      const res = await f('/api/billing');
      return res.json() as Promise<BillingInfo>;
    },

    /**
     * Business Archetype Classifier (2026-05 Phase 1).
     *
     * getBusinessArchetype(): fetch the cached archetype for the signed-in
     *   user. Returns null when the user hasn't been classified yet (caller
     *   should then call classifyBusiness).
     *
     * classifyBusiness({...}): run the Haiku classifier. Caches on the user
     *   row server-side. Pass force=true to bypass the cache.
     *
     * Both endpoints replace the runtime keyword switch that used to live in
     * gemini.ts getImagePromptExamples. The archetype object returned here
     * is the single source of truth for image examples, voice cues, and
     * content pillars used by the AI generation pipeline.
     */
    async getBusinessArchetype(): Promise<ArchetypeResponse | null> {
      try {
        const res = await f('/api/business-archetype');
        return res.json() as Promise<ArchetypeResponse>;
      } catch (e: any) {
        // 404 means not yet classified — caller should kick off classification
        if (/\(404\)/.test(e?.message || '')) return null;
        throw e;
      }
    },

    async classifyBusiness(input: ClassifyBusinessInput): Promise<ArchetypeResponse> {
      const res = await f('/api/classify-business', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return res.json() as Promise<ArchetypeResponse>;
    },

    /** Per-client classifier (schema v9). Persists on clients.archetype_slug
     *  so the image-gen guardrails + vision critique use the CLIENT's
     *  archetype, not the agency owner's, when generating for a client
     *  workspace. Call this when switching into a client workspace. */
    async classifyClientBusiness(clientId: string, input: ClassifyBusinessInput): Promise<ArchetypeResponse> {
      const res = await f(`/api/clients/${encodeURIComponent(clientId)}/classify-business`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return res.json() as Promise<ArchetypeResponse>;
    },

    /**
     * Vision-grounded image+caption critique (2026-05 image-stack upgrade).
     *
     * After generating an image, pass [image_url, caption, archetype] back
     * to Haiku 4.5 vision and ask: does this image actually match the post?
     * Returns a score 0-10, a verdict, reasoning, and a regenerate signal.
     *
     * Catches the failure mode the user screenshotted today — food image
     * on a SaaS post — BEFORE it gets published. ~$0.003/image, ~500ms.
     *
     * Scores below the shared acceptance threshold require regeneration;
     * accepted images are specific matches and can proceed unattended.
     */
    async critiqueImageCaption(input: CritiqueImageInput): Promise<ImageCritique> {
      const res = await f('/api/critique-image-caption', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return res.json() as Promise<ImageCritique>;
    },

    /**
     * Virality Score — pre-publish engagement prediction trained on the
     * workspace's OWN past Facebook/Instagram posts. Returns a 0-100 score
     * relative to THIS workspace's historical engagement distribution, plus
     * a tier (low/mid/high/viral), reasoning, and 1-3 improvement suggestions.
     *
     * The model anchors on the workspace's top-5 and bottom-3 past posts
     * (from client_facts, populated nightly by the refresh-facts cron). New
     * accounts (< 3 historical posts) get a neutral 50 with a "connect FB
     * and run refresh-facts" hint — the real model unlocks after data lands.
     *
     * Call this when the user is editing a draft. Debounce ~1s client-side
     * so a typing user doesn't hammer the endpoint. Cached server-side via
     * Anthropic 1h prompt cache on the workspace's history block, so repeat
     * scores during one editing session are cheap.
     */
    async scorePost(input: ScorePostInput): Promise<ViralityScore> {
      const res = await f('/api/score-post', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return res.json() as Promise<ViralityScore>;
    },

    /**
     * Auto-fix a `view-checklist` recommendation.
     *
     * Classifies each item server-side via one LLM call, then dispatches to a
     * per-kind handler that either audits state (read-only) or applies a SAFE
     * D1 fix (e.g. shift Scheduled posts into Mon-Fri 9am-5pm). The five
     * handler kinds — AUDIT_FB_PAGE, AUDIT_DB, AUTO_FIX_SCHEDULE,
     * SUGGEST_REWRITE, MANUAL_ONLY — map to the `kind`/`status` fields below.
     *
     * Suggested rewrites are NEVER pushed to Facebook automatically — the
     * `payload.current` + `payload.proposed` strings are returned for the
     * user to review and apply manually.
     *
     * Rate-limited 10/min per user. Agency callers must pass `clientId` to
     * scope reads/writes to the right workspace.
     */
    async autoFixChecklist(input: { items: string[]; clientId?: string | null }): Promise<{
      results: Array<{
        item: string;
        kind: 'audit' | 'auto_fix' | 'suggest' | 'manual';
        status: 'ok' | 'finding' | 'fixed' | 'suggested' | 'failed';
        details: string;
        payload?: Record<string, unknown>;
      }>;
    }> {
      const res = await f('/api/recommendations/auto-fix-checklist', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return res.json() as any;
    },

    /**
     * 90-second Magic Onboarding (Tier 3 wow feature).
     *
     * After FB Page is connected, call this once to:
     *   1. Scrape the page (about + last 30 posts + last 30 photos)
     *   2. Classify the business archetype from real scraped content
     *   3. Build a "Brand DNA Card" with voice samples + reference photos +
     *      common topics for the wizard to display
     *
     * Persists archetype on the users row so downstream gens use it
     * immediately. Returns everything the wizard needs to render the
     * "here's what we learned about your business" card.
     */
    async magicOnboarding(): Promise<MagicOnboardingResponse> {
      const res = await f('/api/onboarding-magic', { method: 'POST', body: '{}' });
      return res.json() as Promise<MagicOnboardingResponse>;
    },
  };
}

export interface MagicOnboardingResponse {
  ok: boolean;
  archetype: {
    slug: string;
    name: string;
    confidence: number;
    reasoning: string;
    content_pillars: string[];
    voice_cues: string | null;
  };
  brand_dna: {
    voice_samples: Array<{ content: string; engagement: number }>;
    reference_photos: string[];
    common_topics: string[];
    about: string | null;
  };
  stats: {
    posts_scraped: number;
    photos_available: number;
    total_facts: number;
  };
}

export interface ScorePostInput {
  content: string;
  platform?: 'Facebook' | 'Instagram';
  pillar?: string;
  hashtags?: string[];
  clientId?: string | null;
}

export interface ViralityScore {
  score: number;                                              // 0-100
  tier: 'low' | 'mid' | 'high' | 'viral';
  reasoning: string;
  suggestions: string[];
  data_status: 'ok' | 'insufficient';
  historical_posts: number;
  workspace_p50?: number;
  workspace_p95?: number;
}

export interface CritiqueImageInput {
  imageUrl: string;
  caption: string;
  businessType?: string;
  /** Optional archetype slug — gives the vision model the right context
   *  (e.g. it knows a food image on a tech-saas-agency archetype is wrong). */
  archetype?: string;
  /** Optional post ID — when set, the worker persists the critique result
   *  onto the post (image_critique_score/reasoning/at) so PostModal can show
   *  the "AI quality ✓ N/10" badge on subsequent renders. Best-effort. */
  postId?: string;
}

export interface ImageCritique {
  score: number;          // 0-10
  match: 'yes' | 'partial' | 'no';
  reasoning: string;
  regenerate: boolean;
}

// ── Business Archetype types ──────────────────────────────────────────────────

export interface ClassifyBusinessInput {
  businessType?: string;
  description?: string;
  productsServices?: string;
  contentTopics?: string;
  /** Bypass the cache and re-classify even if archetype_slug is set. */
  force?: boolean;
}

export interface ArchetypeData {
  slug: string;
  name: string;
  description: string;
  image_examples: string[];
  image_avoid_notes: string | null;
  voice_cues: string | null;
  content_pillars: string[];
  banned_trope_extras: string[] | null;
}

export interface ArchetypeResponse {
  classified: true;
  cached?: boolean;
  archetype_slug?: string;
  confidence: number | null;
  reasoning: string | null;
  classified_at?: string | null;
  archetype: ArchetypeData;
}

// ── Admin / billing types ─────────────────────────────────────────────────────

export interface AdminStats {
  signups_total: number;
  signups_7d: number;
  signups_30d: number;
  active_subs: number;
  mrr_cents: number;
  revenue_30d_cents: number;
  churn_30d: number;
  trial_users: number;
}

export interface AdminCustomer {
  id: string;
  email: string | null;
  plan: string | null;
  setup_status: string | null;
  is_admin: number;
  paypal_subscription_id: string | null;
  created_at: string | null;
  onboarding_done: number;
  last_post_at: string | null;
  post_count: number;
  total_paid_cents: number;
  total_refunded_cents: number;
  /** Raw addon_features JSON string — presence of explicit grants/revokes
   *  shown as a chip on the customer row without needing to expand it. */
  addon_features?: string | null;
}

export interface FlaggedPost {
  id: string;
  scheduled_for: string | null;
  platform: string | null;
  workspace: string;
  content_preview: string;
  image_prompt_preview: string | null;
  reasons: string[];
}

export interface AdminPostFeedback {
  id: string;
  user_id: string | null;
  client_id: string | null;
  email: string | null;
  client_name: string | null;
  platform: string | null;
  status: string | null;
  scheduled_for: string | null;
  image_url: string | null;
  qa_feedback_target: 'post' | 'image' | 'caption' | null;
  qa_feedback_reason: 'off_brand' | 'bad_image' | 'bad_caption' | 'other' | null;
  qa_feedback_note: string | null;
  qa_feedback_at: string | null;
  content_preview: string;
}

export interface AdminPrewarmReadinessPost {
  id: string;
  user_id: string | null;
  client_id: string | null;
  email: string | null;
  client_name: string | null;
  workspace: string;
  scheduled_for: string | null;
  platform: string | null;
  post_type: string | null;
  video_status: string | null;
  video_error: string | null;
  issue: 'missing_image' | 'video_pending' | 'video_failed' | 'video_missing';
  content_preview: string;
}

export interface AdminPrewarmReadiness {
  window_hours: number;
  due_before: string;
  total: number;
  counts: {
    missing_images: number;
    video_pending: number;
    video_failed: number;
    video_missing: number;
  };
  posts: AdminPrewarmReadinessPost[];
}

export interface PaymentEvent {
  id?: string;
  email?: string | null;
  event_type: string;
  amount_cents: number | null;
  currency: string | null;
  status: 'completed' | 'cancelled' | 'refunded' | 'failed' | string;
  plan: string | null;
  paypal_subscription_id?: string | null;
  paypal_capture_id?: string | null;
  created_at: string;
}

export type ShopifyStoreBucket = 'active' | 'trial' | 'pending' | 'cancelled' | 'uninstalled' | 'none';

export interface ShopifyStore {
  shop_domain: string;
  shop_name: string | null;
  shop_email: string | null;
  country_code: string | null;
  currency: string | null;
  plan_name: string | null;
  scopes: string;
  installed_at: string;
  uninstalled_at: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  price_amount: string | null;
  price_currency: string | null;
  is_test: boolean;
  bucket: ShopifyStoreBucket;
}

export interface ShopifyBillingEvent {
  id: number;
  event_type: string;
  subscription_id: string | null;
  status_from: string | null;
  status_to: string | null;
  payload: string | null;
  created_at: string;
}

export interface ShopifyStoresResponse {
  plan: {
    name: string;
    price: number;
    currency: string;
    trialDays: number;
    interval: string;
  };
  counts: {
    total: number;
    active: number;
    trial: number;
    pending: number;
    cancelled: number;
    uninstalled: number;
  };
  stores: ShopifyStore[];
}

export interface BillingInfo {
  email: string | null;
  plan: string | null;
  plan_price_aud: number | null;
  subscription_id: string | null;
  member_since: string | null;
  payments: PaymentEvent[];
}

export type DbClient_ = ReturnType<typeof createDb>;
