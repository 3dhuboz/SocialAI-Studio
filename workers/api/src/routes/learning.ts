import type { Hono } from 'hono';
import type { Env } from '../env';
import {
  BASE_REQUIRED_CRITICS,
  DETERMINISTIC_REQUIRED_CRITICS,
} from '../lib/learning/critic-types';
import {
  assessCriticContextReadiness,
  loadCriticContext,
} from '../lib/learning/critic-context';
import { listDecisionReceipts } from '../lib/learning/decision-repository';
import {
  normalizeWorkspaceIdentity,
  type LearningMode,
  type WorkspaceIdentity,
  type WorkspaceOwnerKind,
} from '../lib/learning/types';
import {
  AUTOPILOT_POLICY_VERSION,
  RELEASE_EVIDENCE_MAX_TTL_MS,
  type ReleaseEvidenceKind,
} from '../lib/learning/readiness';
import { getWorkspaceLearningSummary } from '../lib/learning/read-model';
import {
  buildReleaseContentHash,
  type PublishablePost,
} from '../lib/learning/release-preflight';
import {
  getRecordOnlyPilotBudgetStatus,
  isSyntheticQaPilotPost,
  runClaimedPilotEvaluation,
  withdrawRecordOnlyPilot,
} from '../lib/learning/pilot-evaluation';
import {
  getWorkspaceLearningSettings,
  getWorkspaceMonthlyAiSpend,
  isProtectedAutopilotEligible,
  isProtectedExperimentRateTransitionAllowed,
  loadWorkspaceLearningMode,
  saveWorkspaceLearningSettings,
  type StoredWorkspaceLearningSettings,
} from '../lib/learning/workspace-mode';
import { ensureWorkspaceLearningSettings } from '../lib/provisioning';
import { requireAuth } from '../middleware/auth';
import { createTrackingLink } from './tracking';

type OwnedPostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: string | null;
  owner_id: string | null;
};

type PilotDraftRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: string | null;
  owner_id: string | null;
  status: string | null;
  content: string;
  platform: string | null;
  hashtags: string | null;
  image_url: string | null;
  post_type: string | null;
  video_url: string | null;
  video_status: string | null;
  video_script: string | null;
  video_shots: string | null;
  archetype_slug: string | null;
  client_status: string | null;
};

type PilotCandidateRow = {
  user_id: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind;
  owner_id: string;
  workspace_key: string;
  label: string;
  eligible_draft_count: number | string | null;
  sample_post_id: string;
  enrolled: number | string | null;
  monthly_ai_budget_usd_cents: number | string | null;
  profile_json: string | null;
  verified_fact_contents_json: string | null;
};

type PilotEnrollmentRow = {
  id: string;
  enrolled_at: string;
};

type PilotActiveEnrollmentRow = {
  id: string;
  client_id: string | null;
  owner_kind: 'user' | 'client';
  owner_id: string;
  workspace_key: string;
  policy_version: string;
  enrolled_at: string;
  label: string;
};

type PilotValidationEnrollmentRow = {
  id: string;
  monthly_ai_budget_usd_cents: number | string | null;
  pilot_sample_content_hash: string | null;
  pilot_sample_basis: string | null;
  pilot_sample_attested_at: string | null;
};

type PilotSampleRow = {
  id: string;
  post_id: string;
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind;
  owner_id: string;
  content_hash: string;
  attestation_basis: 'owner_real_post' | 'customer_real_post';
  note: string;
  attested_by: string;
  attested_at: string;
};

type PilotDisqualificationRow = {
  id: string;
  decision_id: string;
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind;
  owner_id: string;
  reason: 'synthetic_qa';
  note: string;
  excluded_by: string;
  created_at: string;
};

type DecisionRow = Record<string, unknown> & {
  id: string;
  summary_json?: string | null;
};

type VerdictRow = Record<string, unknown> & {
  decision_id: string;
  evidence_json?: string | null;
  repair_json?: string | null;
};

type BackfillWorkspaceRow = {
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind;
  owner_id: string;
};

type AdjudicationEvidenceSourceRow = {
  user_id: string;
  client_id: string | null;
  owner_kind: string;
  owner_id: string;
  sample_post_id: string | null;
  review_content_hash: string | null;
  review_content: string | null;
  review_platform: string | null;
  review_hashtags: string | null;
  review_image_url: string | null;
  review_post_type: string | null;
  review_video_url: string | null;
  review_video_status: string | null;
  review_video_script: string | null;
  review_video_shots: string | null;
  review_archetype_slug: string | null;
};

type AdminOperationsRow = AdjudicationEvidenceSourceRow & {
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind;
  owner_id: string;
  mode: LearningMode;
  autopublish_consent_at: string | null;
  autopublish_policy_version: string | null;
  updated_at: string;
  user_exists: string | null;
  client_id_found: string | null;
  client_status: string | null;
  shop_domain: string | null;
  shop_uninstalled_at: string | null;
  decision_count: number | string | null;
  hold_count: number | string | null;
  adjudicated_count: number | string | null;
  false_hold_count: number | string | null;
  severe_false_passes: number | string | null;
  critic_total: number | string | null;
  critic_available: number | string | null;
  judge_total: number | string | null;
  judge_available: number | string | null;
  judge_telemetry_count: number | string | null;
  sample_decision_id: string | null;
};

type AdminReleaseEvidenceRow = {
  evidence_kind: ReleaseEvidenceKind;
  owner_kind: WorkspaceOwnerKind | null;
  passed: number | string | null;
  recorded_at: string;
  expires_at: string | null;
};

const ADMIN_RELEASE_EVIDENCE_REQUIREMENTS: ReadonlyArray<{
  evidenceKind: ReleaseEvidenceKind;
  ownerKind: WorkspaceOwnerKind | null;
}> = [
  { evidenceKind: 'replay_red_team', ownerKind: null },
  { evidenceKind: 'kill_switch', ownerKind: null },
  { evidenceKind: 'publish_regression', ownerKind: null },
  { evidenceKind: 'staging_green', ownerKind: 'user' },
  { evidenceKind: 'staging_block', ownerKind: 'user' },
  { evidenceKind: 'staging_green', ownerKind: 'client' },
  { evidenceKind: 'staging_block', ownerKind: 'client' },
  { evidenceKind: 'staging_green', ownerKind: 'shop' },
  { evidenceKind: 'staging_block', ownerKind: 'shop' },
];

function summarizeAdminReleaseEvidence(
  rows: AdminReleaseEvidenceRow[],
  now: Date = new Date(),
) {
  const key = (
    evidenceKind: ReleaseEvidenceKind,
    ownerKind: WorkspaceOwnerKind | null,
  ) => `${evidenceKind}:${ownerKind ?? '*'}`;
  const latest = new Map<string, AdminReleaseEvidenceRow>();
  for (const row of rows) {
    const rowKey = key(row.evidence_kind, row.owner_kind);
    const existing = latest.get(rowKey);
    if (!existing || Date.parse(row.recorded_at) > Date.parse(existing.recorded_at)) {
      latest.set(rowKey, row);
    }
  }

  const nowMs = now.getTime();
  let expiredCount = 0;
  const validExpiryTimes: number[] = [];
  for (const requirement of ADMIN_RELEASE_EVIDENCE_REQUIREMENTS) {
    const row = latest.get(key(requirement.evidenceKind, requirement.ownerKind));
    if (!row) continue;
    const recordedAt = Date.parse(row.recorded_at);
    const expiresAt = row.expires_at ? Date.parse(row.expires_at) : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= nowMs) expiredCount += 1;
    const valid = Number(row.passed) === 1
      && Number.isFinite(recordedAt)
      && Number.isFinite(expiresAt)
      && recordedAt <= nowMs
      && expiresAt > nowMs
      && expiresAt > recordedAt
      && expiresAt - recordedAt <= RELEASE_EVIDENCE_MAX_TTL_MS;
    if (valid) validExpiryTimes.push(expiresAt);
  }

  const validCount = validExpiryTimes.length;
  const requiredCount = ADMIN_RELEASE_EVIDENCE_REQUIREMENTS.length;
  const nextExpiryMs = validCount > 0 ? Math.min(...validExpiryTimes) : null;
  return {
    validCount,
    requiredCount,
    invalidOrMissingCount: requiredCount - validCount,
    expiredCount,
    complete: validCount === requiredCount,
    nextExpiryAt: nextExpiryMs == null ? null : new Date(nextExpiryMs).toISOString(),
  };
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonStrings(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function pilotCandidateContextReadiness(row: PilotCandidateRow) {
  const verifiedFacts = parseJsonStrings(row.verified_fact_contents_json).map((content) => ({
    ownerKind: row.owner_kind,
    ownerId: row.owner_id,
    clientId: row.client_id,
    factType: 'candidate_readiness',
    content,
    verifiedAt: null,
  }));
  return assessCriticContextReadiness({
    profile: parseJsonObject(row.profile_json),
    verifiedFacts,
  });
}

function publishablePilotDraft(
  row: PilotDraftRow,
  identity: WorkspaceIdentity,
): PublishablePost {
  return {
    id: row.id,
    user_id: identity.userId,
    client_id: identity.clientId,
    owner_kind: identity.ownerKind,
    owner_id: identity.ownerId,
    content: row.content,
    platform: row.platform?.trim() || 'facebook',
    hashtags: row.hashtags,
    image_url: row.image_url,
    post_type: row.post_type,
    video_url: row.video_url,
    video_status: row.video_status,
    video_script: row.video_script,
    video_shots: row.video_shots,
    archetype_slug: row.archetype_slug,
  };
}

type AdjudicationEvidence = {
  content: string;
  platform: string;
  hashtags: string[];
  mediaKind: 'none' | 'image' | 'video';
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  videoScript: string | null;
  videoShots: string[];
  contentHash: string;
};

type AdjudicationEvidenceResult = {
  status: 'verified' | 'missing' | 'stale';
  evidence: AdjudicationEvidence | null;
};

async function verifyAdjudicationEvidence(
  row: AdjudicationEvidenceSourceRow,
): Promise<AdjudicationEvidenceResult> {
  const ownerKind = releaseOwnerKind(row.owner_kind);
  if (
    !ownerKind
    || !row.sample_post_id
    || !row.review_content_hash
    || row.review_content == null
  ) {
    return { status: 'missing', evidence: null };
  }
  const post: PublishablePost = {
    id: row.sample_post_id,
    user_id: row.user_id,
    client_id: row.client_id,
    owner_kind: ownerKind,
    owner_id: row.owner_id,
    content: row.review_content,
    platform: row.review_platform?.trim() || 'facebook',
    hashtags: row.review_hashtags,
    image_url: row.review_image_url,
    post_type: row.review_post_type,
    video_url: row.review_video_url,
    video_status: row.review_video_status,
    video_script: row.review_video_script,
    video_shots: row.review_video_shots,
    archetype_slug: row.review_archetype_slug,
  };
  try {
    const currentHash = await buildReleaseContentHash(post);
    if (currentHash !== row.review_content_hash) {
      return { status: 'stale', evidence: null };
    }
  } catch {
    return { status: 'missing', evidence: null };
  }
  const mediaKind = post.video_url ? 'video' : post.image_url ? 'image' : 'none';
  return {
    status: 'verified',
    evidence: {
      content: post.content,
      platform: post.platform,
      hashtags: parseJsonStrings(post.hashtags),
      mediaKind,
      mediaUrl: post.video_url ?? post.image_url,
      thumbnailUrl: post.video_url ? post.image_url : null,
      videoScript: post.video_script ?? null,
      videoShots: parseJsonStrings(post.video_shots),
      contentHash: row.review_content_hash,
    },
  };
}

const CURRENT_POLICY_PILOT_COHORT_SQL = `
  SELECT d.*
  FROM learning_decisions d
  INNER JOIN learning_pilot_enrollments pen
    ON pen.user_id = d.user_id
   AND pen.workspace_key = d.workspace_key
   AND pen.client_id IS d.client_id
   AND pen.owner_kind = d.owner_kind
   AND pen.owner_id = d.owner_id
   AND pen.policy_version = ?
   AND pen.record_only = 1
   AND unixepoch(d.created_at) >= unixepoch(pen.enrolled_at)
   AND unixepoch(pen.consent_confirmed_at) <= unixepoch(d.created_at)
   AND (
     (d.owner_kind = 'user' AND pen.consent_basis = 'owner_self')
     OR (d.owner_kind = 'client' AND pen.consent_basis = 'customer_attested')
   )
  INNER JOIN learning_pilot_samples sample
    ON sample.user_id = d.user_id
   AND sample.workspace_key = d.workspace_key
   AND sample.client_id IS d.client_id
   AND sample.owner_kind = d.owner_kind
   AND sample.owner_id = d.owner_id
   AND sample.post_id = d.post_id
   AND sample.content_hash = d.content_hash
   AND unixepoch(sample.attested_at) >= unixepoch(pen.consent_confirmed_at)
   AND unixepoch(sample.attested_at) <= unixepoch(d.created_at)
   AND (
     (d.owner_kind = 'user' AND sample.attestation_basis = 'owner_real_post')
     OR (d.owner_kind = 'client' AND sample.attestation_basis = 'customer_real_post')
   )
  LEFT JOIN users pilot_user
    ON d.owner_kind = 'user' AND pilot_user.id = d.user_id
  LEFT JOIN clients pilot_client
    ON d.owner_kind = 'client'
   AND pilot_client.id = d.client_id
   AND pilot_client.user_id = d.user_id
  LEFT JOIN learning_decision_disqualifications disq
    ON disq.decision_id = d.id
   AND disq.user_id = d.user_id
   AND disq.workspace_key = d.workspace_key
   AND disq.client_id IS d.client_id
   AND disq.owner_kind = d.owner_kind
   AND disq.owner_id = d.owner_id
  WHERE d.stage = 'release'
    AND d.mode = 'approval'
    AND d.owner_kind IN ('user','client')
    AND disq.id IS NULL
    AND (
      (d.owner_kind = 'user' AND pilot_user.id IS NOT NULL)
      OR (
        d.owner_kind = 'client'
        AND pilot_client.id IS NOT NULL
        AND COALESCE(LOWER(TRIM(pilot_client.status)), 'active') <> 'on_hold'
      )
    )
  ORDER BY d.created_at DESC, d.id DESC
  LIMIT 30
`;

const DETERMINISTIC_REQUIRED_CRITICS_SQL = DETERMINISTIC_REQUIRED_CRITICS
  .map((kind) => `'${kind}'`)
  .join(', ');
const ALL_REQUIRED_CRITICS_SQL = [...BASE_REQUIRED_CRITICS, 'image', 'video_manifest']
  .map((kind) => `'${kind}'`)
  .join(', ');

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Request body must be an object');
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body must be an object') throw error;
    throw new Error('Invalid JSON body');
  }
}

function requestedClientId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function canonicalPostIdentity(
  post: OwnedPostRow,
  authenticatedUserId: string,
  clientId: string | null,
  allowShop = false,
): WorkspaceIdentity | null {
  const postClientId = post.client_id?.trim() || null;
  if (post.user_id !== authenticatedUserId || postClientId !== clientId) return null;
  const kind: WorkspaceOwnerKind = post.owner_kind === 'shop'
    ? 'shop'
    : postClientId === null ? 'user' : 'client';
  if ((!allowShop && kind === 'shop') || (post.owner_kind && post.owner_kind !== kind)) return null;
  try {
    return normalizeWorkspaceIdentity(
      authenticatedUserId,
      postClientId,
      kind,
      post.owner_id?.trim() || postClientId || authenticatedUserId,
    );
  } catch {
    return null;
  }
}

async function ownedPost(
  db: D1Database,
  postId: string,
  userId: string,
): Promise<OwnedPostRow | null> {
  return db.prepare(`
    SELECT id, user_id, client_id, owner_kind, owner_id
    FROM posts
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).bind(postId, userId).first<OwnedPostRow>();
}

const FEEDBACK_FIELDS = [
  'calls', 'messages', 'leads', 'bookings', 'sales', 'orderValueCents',
] as const;
type FeedbackField = typeof FEEDBACK_FIELDS[number];

function readMetric(body: Record<string, unknown>, key: FeedbackField): number | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  if (value < 0) throw new Error(`${key} must be non-negative`);
  return value;
}

async function ownedSettingsIdentity(
  db: D1Database,
  userId: string,
  clientId: string | null,
): Promise<WorkspaceIdentity | null> {
  const identity = normalizeWorkspaceIdentity(
    userId,
    clientId,
    clientId === null ? 'user' : 'client',
    clientId ?? userId,
  );
  if (identity.ownerKind === 'client') {
    const client = await db.prepare(
      'SELECT status FROM clients WHERE id = ? AND user_id = ?',
    ).bind(identity.ownerId, identity.userId).first<{ status: string | null }>();
    if (!client) return null;
  }
  return identity;
}

async function clientWorkspaceCannotRequestProtected(
  db: D1Database,
  identity: WorkspaceIdentity,
): Promise<boolean> {
  if (identity.ownerKind !== 'client') return false;
  const client = await db.prepare(
    'SELECT status FROM clients WHERE id = ? AND user_id = ?',
  ).bind(identity.ownerId, identity.userId).first<{ status: string | null }>();
  return !client || client.status?.trim().toLowerCase() === 'on_hold';
}

function publicSettings(
  settings: StoredWorkspaceLearningSettings,
  fallbackMode: LearningMode,
): Record<string, unknown> {
  return {
    mode: typeof settings.mode === 'string' ? settings.mode : fallbackMode,
    autopublishConsentAt: settings.autopublishConsentAt ?? null,
    autopublishPolicyVersion: settings.autopublishPolicyVersion ?? null,
    experimentRate: Number.isFinite(settings.experimentRate) ? settings.experimentRate : 0,
    monthlyAiBudgetUsdCents: settings.monthlyAiBudgetUsdCents ?? null,
    disabledReason: settings.disabledReason ?? null,
    exists: settings.exists,
  };
}

function experimentRate(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 0.2) {
    throw new Error('experimentRate must be between 0 and 0.2');
  }
  return value;
}

function budgetCents(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('monthlyAiBudgetUsdCents must be a non-negative integer or null');
  }
  return value;
}

function pilotBudgetCents(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1
    || value > 10_000
  ) {
    throw new Error('monthlyAiBudgetUsdCents must be an integer between 1 and 10000');
  }
  return value;
}

async function learningAdmin(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT email, is_admin FROM users WHERE id = ?',
  ).bind(userId).first<{ email: string | null; is_admin: number }>();
  return row?.is_admin === 1;
}

function releaseOwnerKind(value: string): WorkspaceOwnerKind | null {
  return value === 'user' || value === 'client' || value === 'shop' ? value : null;
}

function countValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function dormantPilotEnabled(env: Env): boolean {
  return env.LEARNING_BRAIN_ENABLED === 'true'
    && env.LEARNING_RELEASE_ENFORCEMENT !== 'true'
    && env.LEARNING_AUTOPILOT_ENABLED !== 'true';
}

function stagingEnvironment(env: Env): boolean {
  return env.ENVIRONMENT?.trim().toLowerCase() === 'staging';
}

function pilotStagingError(env: Env): {
  error: string;
  code: 'pilot_staging_only';
} | null {
  return stagingEnvironment(env) ? null : {
    error: 'Approval-pilot operations are available only in isolated staging',
    code: 'pilot_staging_only',
  };
}

function existingPilotDisqualification(
  db: D1Database,
  decisionId: string,
): Promise<PilotDisqualificationRow | null> {
  return db.prepare(`
    SELECT
      id,decision_id,user_id,workspace_key,client_id,owner_kind,owner_id,
      reason,note,excluded_by,created_at
    FROM learning_decision_disqualifications
    WHERE decision_id = ?
    LIMIT 1
  `).bind(decisionId).first<PilotDisqualificationRow>();
}

function existingPilotSample(
  db: D1Database,
  identity: WorkspaceIdentity,
  postId: string,
  contentHash: string,
): Promise<PilotSampleRow | null> {
  return db.prepare(`
    SELECT
      id,post_id,user_id,workspace_key,client_id,owner_kind,owner_id,
      content_hash,attestation_basis,note,attested_by,attested_at
    FROM learning_pilot_samples
    WHERE user_id = ? AND workspace_key = ? AND client_id IS ?
      AND owner_kind = ? AND owner_id = ? AND post_id = ? AND content_hash = ?
    LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    postId,
    contentHash,
  ).first<PilotSampleRow>();
}

async function loadPilotCandidatePreviews(
  db: D1Database,
  userId: string,
  postIds: string[],
): Promise<PilotDraftRow[]> {
  const uniquePostIds = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
  if (uniquePostIds.length === 0) return [];
  const placeholders = uniquePostIds.map(() => '?').join(',');
  const result = await db.prepare(`
    /* pilot_candidate_previews */
    SELECT
      p.id,p.user_id,p.client_id,p.owner_kind,p.owner_id,p.status,
      p.content,p.platform,p.hashtags,p.image_url,p.post_type,
      p.video_url,p.video_status,p.video_script,p.video_shots,
      COALESCE(c.archetype_slug, u.archetype_slug) AS archetype_slug,
      c.status AS client_status
    FROM posts p
    LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = p.user_id
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ? AND p.id IN (${placeholders})
      AND LOWER(TRIM(COALESCE(p.status, ''))) = 'draft'
      AND LENGTH(TRIM(COALESCE(p.content, ''))) BETWEEN 1 AND 5000
      AND (
        (p.client_id IS NULL AND (p.owner_kind IS NULL OR p.owner_kind = 'user'))
        OR (
          p.client_id IS NOT NULL
          AND c.id IS NOT NULL
          AND (p.owner_kind IS NULL OR p.owner_kind = 'client')
          AND COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'
        )
      )
  `).bind(userId, ...uniquePostIds).all<PilotDraftRow>();
  return result.results ?? [];
}

function latestReadiness(db: D1Database) {
  return db.prepare(`
    SELECT id, ready, metrics_json, checks_json, evaluated_by, evaluated_at
    FROM learning_release_readiness
    WHERE policy_version = ?
    ORDER BY evaluated_at DESC, id DESC
    LIMIT 1
  `).bind(AUTOPILOT_POLICY_VERSION).first<{
    id: string;
    ready: number;
    metrics_json: string;
    checks_json: string;
    evaluated_by: string;
    evaluated_at: string;
  }>();
}

export function registerLearningRoutes(app: Hono<{ Bindings: Env }>): void {
  app.use('/api/learning/*', requireAuth);

  app.get('/api/learning/profile', async (c) => {
    const userId = c.get('uid') as string;
    const clientId = c.req.query('clientId')?.trim() || null;
    const identity = await ownedSettingsIdentity(c.env.DB, userId, clientId);
    if (!identity) return c.json({ error: 'Not found' }, 404);
    return c.json(await getWorkspaceLearningSummary(c.env.DB, identity));
  });

  app.get('/api/learning/settings', async (c) => {
    const userId = c.get('uid') as string;
    const clientId = c.req.query('clientId')?.trim() || null;
    const identity = await ownedSettingsIdentity(c.env.DB, userId, clientId);
    if (!identity) return c.json({ error: 'Not found' }, 404);
    const settings = await getWorkspaceLearningSettings(c.env.DB, identity);
    const effectiveMode = await loadWorkspaceLearningMode(
      c.env,
      identity.userId,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
    );
    const fallbackMode: LearningMode = c.env.LEARNING_RELEASE_ENFORCEMENT === 'true'
      ? 'approval'
      : c.env.LEARNING_BRAIN_ENABLED === 'true' ? 'shadow' : 'off';
    return c.json({ settings: publicSettings(settings, fallbackMode), effectiveMode });
  });

  app.put('/api/learning/settings', async (c) => {
    const userId = c.get('uid') as string;
    try {
      const body = await jsonBody(c.req.raw);
      const clientId = requestedClientId(body.clientId);
      const identity = await ownedSettingsIdentity(c.env.DB, userId, clientId);
      if (!identity) return c.json({ error: 'Not found' }, 404);
      if (body.mode !== 'approval' && body.mode !== 'protected_autopilot') {
        return c.json({ error: 'mode must be approval or protected_autopilot' }, 400);
      }
      if (
        body.mode === 'protected_autopilot'
        && await clientWorkspaceCannotRequestProtected(c.env.DB, identity)
      ) {
        return c.json({
          error: 'Protected Autopilot cannot be requested while this client is on hold',
        }, 409);
      }
      const current = await getWorkspaceLearningSettings(c.env.DB, identity);
      const disabledReason = current.disabledReason?.trim() ? current.disabledReason : null;
      const rate = experimentRate(body.experimentRate, Number(current.experimentRate ?? 0));
      const budget = budgetCents(
        body.monthlyAiBudgetUsdCents,
        current.monthlyAiBudgetUsdCents ?? null,
      );
      const requestedAt = new Date();
      const now = requestedAt.toISOString();
      let mode: LearningMode;
      let consentAt: string | null;
      let policyVersion: string | null;
      if (body.mode === 'protected_autopilot') {
        const alreadyConsented = current.autopublishConsentAt != null
          && current.autopublishPolicyVersion === AUTOPILOT_POLICY_VERSION;
        if (body.consent !== true && !alreadyConsented) {
          return c.json({ error: 'Explicit current-policy consent is required' }, 400);
        }
        if (!Number.isSafeInteger(budget) || Number(budget) <= 0) {
          return c.json({ error: 'Protected Autopilot requires a positive monthly AI budget' }, 400);
        }
        if (!isProtectedExperimentRateTransitionAllowed(current, rate)) {
          return c.json({
            error: 'Protected Autopilot experiments must start at 0 and advance only to 0.10 then 0.15',
            code: 'protected_autopilot_experiment_ramp',
          }, 409);
        }
        const requestedConsentAt = alreadyConsented ? current.autopublishConsentAt! : now;
        if (!await isProtectedAutopilotEligible(c.env, identity, {
          mode: 'protected_autopilot',
          autopublishConsentAt: requestedConsentAt,
          autopublishPolicyVersion: AUTOPILOT_POLICY_VERSION,
          experimentRate: rate,
          monthlyAiBudgetUsdCents: budget,
          disabledReason,
        }, requestedAt)) {
          return c.json({
            error: 'Protected Autopilot is unavailable until every activation gate passes',
            code: 'protected_autopilot_not_ready',
          }, 409);
        }
        mode = 'protected_autopilot';
        consentAt = requestedConsentAt;
        policyVersion = AUTOPILOT_POLICY_VERSION;
      } else {
        mode = c.env.LEARNING_RELEASE_ENFORCEMENT === 'true' ? 'approval' : 'shadow';
        consentAt = null;
        policyVersion = null;
      }
      await saveWorkspaceLearningSettings(c.env.DB, identity, {
        mode,
        autopublishConsentAt: consentAt,
        autopublishPolicyVersion: policyVersion,
        experimentRate: rate,
        monthlyAiBudgetUsdCents: budget,
      }, now);
      const settings: StoredWorkspaceLearningSettings = {
        exists: true,
        mode,
        autopublishConsentAt: consentAt,
        autopublishPolicyVersion: policyVersion,
        experimentRate: disabledReason ? 0 : rate,
        monthlyAiBudgetUsdCents: budget,
        disabledReason,
      };
      const effectiveMode = await loadWorkspaceLearningMode(
        c.env,
        identity.userId,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
      );
      return c.json({ settings: publicSettings(settings, mode), effectiveMode });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });

  app.post('/api/learning/pilot/enroll', async (c) => {
    const adminId = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adminId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const stagingError = pilotStagingError(c.env);
    if (stagingError) return c.json(stagingError, 409);
    if (!dormantPilotEnabled(c.env)) {
      return c.json({
        error: 'Pilot enrollment is available only while learning enforcement and autopilot are disabled',
      }, 409);
    }

    try {
      const body = await jsonBody(c.req.raw);
      const clientId = requestedClientId(body.clientId);
      const budget = pilotBudgetCents(body.monthlyAiBudgetUsdCents);
      const identity = normalizeWorkspaceIdentity(
        adminId,
        clientId,
        clientId === null ? 'user' : 'client',
        clientId ?? adminId,
      );

      if (identity.ownerKind === 'client') {
        const client = await c.env.DB.prepare(
          'SELECT status FROM clients WHERE id = ? AND user_id = ?',
        ).bind(identity.ownerId, identity.userId).first<{ status: string | null }>();
        if (!client) return c.json({ error: 'Not found' }, 404);
        if (client.status?.trim().toLowerCase() === 'on_hold') {
          return c.json({ error: 'Pilot enrollment cannot include an on-hold client' }, 409);
        }
      }

      let consentBasis: 'owner_self' | 'customer_attested' = 'owner_self';
      let consentNote = 'Authenticated owner enrolled their own record-only pilot workspace.';
      if (identity.ownerKind === 'client') {
        const customerConsentNote = typeof body.customerConsentNote === 'string'
          ? body.customerConsentNote.trim()
          : '';
        if (
          body.customerConsentConfirmed !== true
          || customerConsentNote.length < 10
          || customerConsentNote.length > 500
        ) {
          return c.json({
            error: 'Client pilot enrollment requires a customer consent attestation and note',
          }, 400);
        }
        consentBasis = 'customer_attested';
        consentNote = customerConsentNote;
      }

      const drafts = await c.env.DB.prepare(`
        SELECT COUNT(*) AS draft_count
        FROM posts
        WHERE user_id = ? AND client_id IS ? AND status = 'Draft'
          AND (owner_kind IS NULL OR owner_kind = ?)
      `).bind(
        identity.userId,
        identity.clientId,
        identity.ownerKind,
      ).first<{ draft_count: number | string | null }>();
      if (countValue(drafts?.draft_count) === 0) {
        return c.json({ error: 'Workspace has no eligible Draft posts for pilot validation' }, 409);
      }

      let contextReadiness;
      try {
        const criticContext = await loadCriticContext(
          c.env,
          identity.userId,
          identity.clientId,
          identity.ownerKind,
          identity.ownerId,
        );
        contextReadiness = assessCriticContextReadiness(criticContext);
      } catch (error) {
        console.warn('[learning-pilot] enrollment context unavailable', {
          workspaceKey: identity.workspaceKey,
          reason: error instanceof Error ? error.message : 'unknown error',
        });
        return c.json({
          error: 'Pilot business context could not be loaded; enrollment was not recorded',
          code: 'pilot_context_unavailable',
        }, 503);
      }
      if (!contextReadiness.ready) {
        return c.json({
          error: 'Pilot business context is incomplete; complete the business profile or add a verified fact before enrollment',
          code: 'pilot_context_not_ready',
          readiness: {
            meaningfulProfileFieldCount: contextReadiness.meaningfulProfileFields.length,
            verifiedFactCount: contextReadiness.verifiedFactCount,
          },
        }, 409);
      }

      const existing = await c.env.DB.prepare(`
        SELECT COUNT(*) AS approval_count
        FROM learning_pilot_enrollments
        WHERE policy_version = ? AND owner_kind = ?
          AND NOT (user_id = ? AND workspace_key = ?)
      `).bind(
        AUTOPILOT_POLICY_VERSION,
        identity.ownerKind,
        identity.userId,
        identity.workspaceKey,
      ).first<{ approval_count: number | string | null }>();
      if (countValue(existing?.approval_count) > 0) {
        return c.json({
          error: `Only one ${identity.ownerKind} workspace may be enrolled in the approval pilot`,
        }, 409);
      }

      const now = new Date().toISOString();
      const enrollmentId = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO learning_pilot_enrollments (
          id,user_id,workspace_key,client_id,owner_kind,owner_id,
          policy_version,enrolled_by,enrolled_at,record_only,
          consent_basis,consent_confirmed_at,consent_note
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        enrollmentId,
        identity.userId,
        identity.workspaceKey,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
        AUTOPILOT_POLICY_VERSION,
        adminId,
        now,
        1,
        consentBasis,
        now,
        consentNote,
      ).run();
      const enrollment = await c.env.DB.prepare(`
        SELECT id, enrolled_at
        FROM learning_pilot_enrollments
        WHERE user_id = ? AND workspace_key = ?
          AND client_id IS ? AND owner_kind = ? AND owner_id = ?
          AND policy_version = ? AND record_only = 1
        LIMIT 1
      `).bind(
        identity.userId,
        identity.workspaceKey,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
        AUTOPILOT_POLICY_VERSION,
      ).first<PilotEnrollmentRow>();
      if (!enrollment) {
        return c.json({
          error: `Only one ${identity.ownerKind} workspace may be enrolled in the approval pilot`,
        }, 409);
      }
      // The unique policy+owner-kind index is the final cohort lock. Only
      // create approval settings after this exact workspace owns the immutable
      // enrollment receipt, so a concurrent losing request leaves no stray mode.
      await saveWorkspaceLearningSettings(c.env.DB, identity, {
        mode: 'approval',
        autopublishConsentAt: null,
        autopublishPolicyVersion: null,
        experimentRate: 0,
        monthlyAiBudgetUsdCents: budget,
      }, now);
      return c.json({
        workspaceKey: identity.workspaceKey,
        ownerKind: identity.ownerKind,
        ownerId: identity.ownerId,
        mode: 'approval',
        monthlyAiBudgetUsdCents: budget,
        autopublishConsentAt: null,
        recordOnly: true,
        pilotEnrollmentId: enrollment.id,
        pilotPolicyVersion: AUTOPILOT_POLICY_VERSION,
        enrolledAt: enrollment.enrolled_at,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });

  app.delete('/api/learning/pilot/enrollment', async (c) => {
    const adminId = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adminId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const stagingError = pilotStagingError(c.env);
    if (stagingError) return c.json(stagingError, 409);
    if (!dormantPilotEnabled(c.env)) {
      return c.json({
        error: 'Pilot withdrawal is available only while learning enforcement and autopilot are disabled',
      }, 409);
    }

    try {
      const body = await jsonBody(c.req.raw);
      const withdrawalNote = typeof body.withdrawalNote === 'string'
        ? body.withdrawalNote.trim()
        : '';
      if (
        body.withdrawalConfirmed !== true
        || withdrawalNote.length < 10
        || withdrawalNote.length > 500
      ) {
        return c.json({
          error: 'Pilot withdrawal requires explicit confirmation and a 10-500 character note',
        }, 400);
      }
      const clientId = requestedClientId(body.clientId);
      const identity = normalizeWorkspaceIdentity(
        adminId,
        clientId,
        clientId === null ? 'user' : 'client',
        clientId ?? adminId,
      );
      const result = await withdrawRecordOnlyPilot(
        c.env.DB,
        identity,
        AUTOPILOT_POLICY_VERSION,
      );
      console.info('[learning-pilot] record-only consent withdrawal completed', {
        workspaceKey: identity.workspaceKey,
        ownerKind: identity.ownerKind,
        withdrawn: result.withdrawn,
        alreadyWithdrawn: result.alreadyWithdrawn,
        decisionsRemoved: result.decisionsRemoved,
        samplesRemoved: result.samplesRemoved,
        withdrawalNoteLength: withdrawalNote.length,
        sourcePostsDeleted: result.sourcePostsDeleted,
        publishingRecordsDeleted: result.publishingRecordsDeleted,
      });
      return c.json({
        ...result,
        workspaceKey: identity.workspaceKey,
        ownerKind: identity.ownerKind,
        ownerId: identity.ownerId,
        mode: 'shadow',
        originalDraftsRetained: true,
        copiedStagingDataRequiresArtifactWithdrawal: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pilot withdrawal failed';
      console.warn('[learning-pilot] consent withdrawal failed closed', {
        reason: message,
      });
      if (message.includes('publication record')) {
        return c.json({
          error: message,
          code: 'pilot_withdrawal_publication_conflict',
        }, 409);
      }
      return c.json({
        error: 'Pilot withdrawal failed closed; no source posts or publishing records were changed',
      }, 503);
    }
  });

  app.get('/api/learning/pilot/candidates', async (c) => {
    const adminId = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adminId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const stagingError = pilotStagingError(c.env);
    if (stagingError) return c.json(stagingError, 409);
    if (!dormantPilotEnabled(c.env)) {
      return c.json({
        error: 'Pilot candidates are available only while learning enforcement and autopilot are disabled',
      }, 409);
    }

    const rows = await c.env.DB.prepare(`
      SELECT
        p.user_id,
        p.client_id,
        CASE WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END AS owner_kind,
        CASE WHEN p.client_id IS NULL THEN p.user_id ELSE p.client_id END AS owner_id,
        CASE WHEN p.client_id IS NULL THEN '__owner__' ELSE p.client_id END AS workspace_key,
        CASE WHEN p.client_id IS NULL THEN 'My workspace'
             ELSE COALESCE(NULLIF(TRIM(c.name), ''), 'Client workspace') END AS label,
        COUNT(*) AS eligible_draft_count,
        MIN(p.id) AS sample_post_id,
        MAX(CASE WHEN pen.id IS NOT NULL AND w.mode = 'approval' THEN 1 ELSE 0 END) AS enrolled,
        MAX(w.monthly_ai_budget_usd_cents) AS monthly_ai_budget_usd_cents,
        CASE WHEN p.client_id IS NULL THEN u.profile ELSE c.profile END AS profile_json,
        (
          SELECT json_group_array(f.content)
          FROM (
            SELECT cf.content
            FROM client_facts cf
            WHERE cf.user_id = p.user_id
              AND cf.client_id IS p.client_id
            ORDER BY cf.verified_at DESC
            LIMIT 80
          ) f
        ) AS verified_fact_contents_json
      FROM posts p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = p.user_id
      LEFT JOIN workspace_learning_settings w
        ON w.user_id = p.user_id
       AND w.workspace_key = CASE
         WHEN p.client_id IS NULL THEN '__owner__' ELSE p.client_id END
       AND w.client_id IS p.client_id
       AND w.owner_kind = CASE WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
       AND w.owner_id = CASE WHEN p.client_id IS NULL THEN p.user_id ELSE p.client_id END
      LEFT JOIN learning_pilot_enrollments pen
        ON pen.user_id = p.user_id
       AND pen.workspace_key = CASE
         WHEN p.client_id IS NULL THEN '__owner__' ELSE p.client_id END
       AND pen.client_id IS p.client_id
       AND pen.owner_kind = CASE WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
       AND pen.owner_id = CASE WHEN p.client_id IS NULL THEN p.user_id ELSE p.client_id END
       AND pen.policy_version = ?
       AND pen.record_only = 1
      WHERE p.user_id = ?
        AND p.status = 'Draft'
        AND LENGTH(TRIM(COALESCE(p.content, ''))) BETWEEN 1 AND 5000
        AND (
          (p.client_id IS NULL AND (p.owner_kind IS NULL OR p.owner_kind = 'user'))
          OR (
            p.client_id IS NOT NULL
            AND c.id IS NOT NULL
            AND (p.owner_kind IS NULL OR p.owner_kind = 'client')
            AND LOWER(TRIM(COALESCE(c.status, 'active'))) != 'on_hold'
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM learning_decisions d
          WHERE d.user_id = p.user_id
            AND d.workspace_key = CASE
              WHEN p.client_id IS NULL THEN '__owner__' ELSE p.client_id END
            AND d.post_id = p.id
            AND d.stage = 'release'
            AND d.release_state IN ('pass_green','hold_amber','block_red')
            AND CAST(
              COALESCE(json_extract(d.summary_json, '$.verdictCount'), -1)
              AS INTEGER
            ) = (
              SELECT COUNT(*)
              FROM learning_critic_verdicts v
              WHERE v.decision_id = d.id
            )
            AND CAST(
              COALESCE(json_extract(d.summary_json, '$.verdictCount'), 0)
              AS INTEGER
            ) > 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM learning_decisions synthetic_decision
          INNER JOIN learning_decision_disqualifications synthetic_disq
            ON synthetic_disq.decision_id = synthetic_decision.id
           AND synthetic_disq.user_id = synthetic_decision.user_id
           AND synthetic_disq.workspace_key = synthetic_decision.workspace_key
           AND synthetic_disq.client_id IS synthetic_decision.client_id
           AND synthetic_disq.owner_kind = synthetic_decision.owner_kind
           AND synthetic_disq.owner_id = synthetic_decision.owner_id
          WHERE synthetic_decision.user_id = p.user_id
            AND synthetic_decision.workspace_key = CASE
              WHEN p.client_id IS NULL THEN '__owner__' ELSE p.client_id END
            AND synthetic_decision.client_id IS p.client_id
            AND synthetic_decision.owner_kind = CASE
              WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
            AND synthetic_decision.owner_id = CASE
              WHEN p.client_id IS NULL THEN p.user_id ELSE p.client_id END
            AND synthetic_decision.post_id = p.id
            AND synthetic_disq.reason = 'synthetic_qa'
        )
      GROUP BY p.user_id,p.client_id
      ORDER BY CASE WHEN p.client_id IS NULL THEN 0 ELSE 1 END, label
      LIMIT 50
    `).bind(AUTOPILOT_POLICY_VERSION, adminId).all<PilotCandidateRow>();
    const candidateRows = rows.results ?? [];
    const enrollmentRows = await c.env.DB.prepare(`
      SELECT
        pen.id,
        pen.client_id,
        pen.owner_kind,
        pen.owner_id,
        pen.workspace_key,
        pen.policy_version,
        pen.enrolled_at,
        CASE
          WHEN pen.owner_kind = 'user' THEN 'My workspace'
          ELSE COALESCE(NULLIF(TRIM(client.name), ''), 'Client workspace')
        END AS label
      FROM learning_pilot_enrollments pen
      LEFT JOIN clients client
        ON client.id = pen.client_id
       AND client.user_id = pen.user_id
      WHERE pen.user_id = ?
        AND pen.policy_version = ?
        AND pen.record_only = 1
        AND pen.owner_kind IN ('user','client')
      ORDER BY CASE pen.owner_kind WHEN 'user' THEN 0 ELSE 1 END, label
      LIMIT 10
    `).bind(adminId, AUTOPILOT_POLICY_VERSION).all<PilotActiveEnrollmentRow>();
    const previewRows = await loadPilotCandidatePreviews(
      c.env.DB,
      adminId,
      candidateRows
        .filter((row) => countValue(row.enrolled) > 0)
        .map((row) => row.sample_post_id),
    );
    const previewsById = new Map(previewRows.map((row) => [row.id, row]));
    const candidates = (await Promise.all(candidateRows.map(async (row) => {
      const enrolled = countValue(row.enrolled) > 0;
      const contextReadiness = pilotCandidateContextReadiness(row);
      const candidate = {
        clientId: row.client_id,
        ownerKind: row.owner_kind,
        ownerId: row.owner_id,
        workspaceKey: row.workspace_key,
        label: row.label,
        eligibleDraftCount: countValue(row.eligible_draft_count),
        samplePostId: row.sample_post_id,
        enrolled,
        monthlyAiBudgetUsdCents: row.monthly_ai_budget_usd_cents == null
          ? null
          : countValue(row.monthly_ai_budget_usd_cents),
        contextReady: contextReadiness.ready,
        contextReason: contextReadiness.reason,
        meaningfulProfileFieldCount: contextReadiness.meaningfulProfileFields.length,
        verifiedFactCount: contextReadiness.verifiedFactCount,
      };
      if (!enrolled) return { ...candidate, sampleDraft: null };
      const preview = previewsById.get(row.sample_post_id);
      if (!preview) return { ...candidate, sampleDraft: null };
      const previewClientId = preview.client_id?.trim() || null;
      const previewOwnerKind: WorkspaceOwnerKind = previewClientId === null ? 'user' : 'client';
      const previewOwnerId = preview.owner_id?.trim()
        || previewClientId
        || preview.user_id;
      if (
        preview.user_id !== row.user_id
        || previewClientId !== row.client_id
        || previewOwnerKind !== row.owner_kind
        || previewOwnerId !== row.owner_id
      ) return { ...candidate, sampleDraft: null };
      const identity = normalizeWorkspaceIdentity(
        preview.user_id,
        previewClientId,
        previewOwnerKind,
        previewOwnerId,
      );
      const post = publishablePilotDraft(preview, identity);
      return {
        ...candidate,
        sampleDraft: {
          postId: post.id,
          content: post.content,
          platform: post.platform,
          hashtags: post.hashtags,
          imageUrl: post.image_url,
          postType: post.post_type,
          videoUrl: post.video_url,
          contentHash: await buildReleaseContentHash(post),
        },
      };
    })));
    return c.json({
      recordOnly: true,
      enrollments: (enrollmentRows.results ?? []).map((row) => ({
        enrollmentId: row.id,
        clientId: row.client_id,
        ownerKind: row.owner_kind,
        ownerId: row.owner_id,
        workspaceKey: row.workspace_key,
        policyVersion: row.policy_version,
        enrolledAt: row.enrolled_at,
        label: row.label,
        recordOnly: true,
      })),
      candidates,
    });
  });

  app.post('/api/learning/pilot/attest/:postId', async (c) => {
    const adminId = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adminId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const stagingError = pilotStagingError(c.env);
    if (stagingError) return c.json(stagingError, 409);
    if (!dormantPilotEnabled(c.env)) {
      return c.json({
        error: 'Pilot attestation is available only while learning enforcement and autopilot are disabled',
      }, 409);
    }

    let body: Record<string, unknown>;
    try {
      body = await jsonBody(c.req.raw);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, 400);
    }
    const unexpected = Object.keys(body).filter(
      (key) => !['realPostConfirmed', 'expectedContentHash', 'note'].includes(key),
    );
    const expectedContentHash = typeof body.expectedContentHash === 'string'
      ? body.expectedContentHash.trim().toLowerCase()
      : '';
    if (
      unexpected.length > 0
      || body.realPostConfirmed !== true
      || !/^[a-f0-9]{64}$/.test(expectedContentHash)
    ) {
      return c.json({
        error: 'Attestation requires only realPostConfirmed=true, expectedContentHash, and note',
      }, 400);
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length < 10 || note.length > 2000) {
      return c.json({ error: 'note must be between 10 and 2000 characters' }, 400);
    }

    const postId = c.req.param('postId').trim();
    if (!postId) return c.json({ error: 'Not found' }, 404);
    const row = await c.env.DB.prepare(`
      SELECT
        p.id,p.user_id,p.client_id,p.owner_kind,p.owner_id,p.status,
        p.content,p.platform,p.hashtags,p.image_url,p.post_type,
        p.video_url,p.video_status,p.video_script,p.video_shots,
        COALESCE(c.archetype_slug, u.archetype_slug) AS archetype_slug,
        c.status AS client_status
      FROM posts p
      LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = p.user_id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ? AND p.user_id = ?
      LIMIT 1
    `).bind(postId, adminId).first<PilotDraftRow>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.status?.trim().toLowerCase() !== 'draft') {
      return c.json({ error: 'Pilot attestation accepts Draft posts only' }, 409);
    }
    const contentLength = row.content?.trim().length ?? 0;
    if (contentLength < 1 || contentLength > 5000) {
      return c.json({
        error: 'Pilot attestation requires draft content between 1 and 5000 characters',
      }, 409);
    }

    const clientId = row.client_id?.trim() || null;
    const ownerKind: WorkspaceOwnerKind = clientId === null ? 'user' : 'client';
    if (row.owner_kind && row.owner_kind !== ownerKind) {
      return c.json({ error: 'Pilot attestation supports canonical user and client drafts only' }, 409);
    }
    if (clientId && row.client_status?.trim().toLowerCase() === 'on_hold') {
      return c.json({ error: 'Pilot attestation cannot include an on-hold client' }, 409);
    }
    if (clientId && row.client_status == null) return c.json({ error: 'Not found' }, 404);

    const identity = normalizeWorkspaceIdentity(
      row.user_id,
      clientId,
      ownerKind,
      row.owner_id?.trim() || clientId || row.user_id,
    );
    const post = publishablePilotDraft(row, identity);
    const contentHash = await buildReleaseContentHash(post);
    if (contentHash !== expectedContentHash) {
      return c.json({
        error: 'Draft changed after preview; refresh before attesting',
        code: 'pilot_sample_preview_stale',
      }, 409);
    }
    if (await isSyntheticQaPilotPost(c.env.DB, identity, postId)) {
      return c.json({
        error: 'Known synthetic-QA posts cannot enter real pilot evidence',
        code: 'pilot_sample_synthetic_qa',
      }, 409);
    }
    const existing = await existingPilotSample(c.env.DB, identity, postId, contentHash);
    if (existing) {
      return c.json({
        sampleId: existing.id,
        postId: existing.post_id,
        contentHash: existing.content_hash,
        attestationBasis: existing.attestation_basis,
        attestedAt: existing.attested_at,
        created: false,
        postMutated: false,
      });
    }

    const sampleId = crypto.randomUUID();
    const attestedAt = new Date().toISOString();
    const attestationBasis = identity.ownerKind === 'user'
      ? 'owner_real_post'
      : 'customer_real_post';
    const sample = await c.env.DB.prepare(`
      INSERT OR IGNORE INTO learning_pilot_samples (
        id,post_id,user_id,workspace_key,client_id,owner_kind,owner_id,
        content_hash,attestation_basis,note,attested_by,attested_at
      )
      SELECT
        ?,p.id,pen.user_id,pen.workspace_key,pen.client_id,pen.owner_kind,pen.owner_id,
        ?,?,?,?,?
      FROM posts p
      INNER JOIN learning_pilot_enrollments pen
        ON pen.user_id = p.user_id
       AND pen.client_id IS p.client_id
       AND pen.workspace_key = ?
       AND pen.owner_kind = ?
       AND pen.owner_id = ?
       AND pen.policy_version = ?
       AND pen.record_only = 1
       AND pen.consent_confirmed_at IS NOT NULL
       AND unixepoch(pen.enrolled_at) <= unixepoch(?)
       AND unixepoch(pen.consent_confirmed_at) <= unixepoch(?)
      INNER JOIN workspace_learning_settings w
        ON w.user_id = pen.user_id
       AND w.workspace_key = pen.workspace_key
       AND w.client_id IS pen.client_id
       AND w.owner_kind = pen.owner_kind
       AND w.owner_id = pen.owner_id
       AND w.mode = 'approval'
       AND w.monthly_ai_budget_usd_cents > 0
       AND NULLIF(TRIM(COALESCE(w.disabled_reason, '')), '') IS NULL
      LEFT JOIN clients c
        ON c.id = pen.client_id AND c.user_id = pen.user_id
      LEFT JOIN users u
        ON u.id = pen.user_id
      WHERE p.id = ? AND p.user_id = ? AND p.client_id IS ?
        AND LOWER(TRIM(COALESCE(p.status, ''))) = 'draft'
        AND COALESCE(p.content, '') = ?
        AND COALESCE(NULLIF(TRIM(p.platform), ''), 'facebook') = ?
        AND p.hashtags IS ? AND p.image_url IS ?
        AND p.post_type IS ? AND p.video_url IS ? AND p.video_status IS ?
        AND p.video_script IS ? AND p.video_shots IS ?
        AND (
          NULLIF(TRIM(COALESCE(p.owner_kind, '')), '') IS NULL
          OR p.owner_kind = ?
        )
        AND (
          NULLIF(TRIM(COALESCE(p.owner_id, '')), '') IS NULL
          OR p.owner_id = ?
        )
        AND COALESCE(c.archetype_slug, u.archetype_slug) IS ?
        AND NOT EXISTS (
          SELECT 1
          FROM learning_decisions synthetic_decision
          INNER JOIN learning_decision_disqualifications synthetic_disq
            ON synthetic_disq.decision_id = synthetic_decision.id
           AND synthetic_disq.user_id = synthetic_decision.user_id
           AND synthetic_disq.workspace_key = synthetic_decision.workspace_key
           AND synthetic_disq.client_id IS synthetic_decision.client_id
           AND synthetic_disq.owner_kind = synthetic_decision.owner_kind
           AND synthetic_disq.owner_id = synthetic_decision.owner_id
          WHERE synthetic_decision.user_id = pen.user_id
            AND synthetic_decision.workspace_key = pen.workspace_key
            AND synthetic_decision.client_id IS pen.client_id
            AND synthetic_decision.owner_kind = pen.owner_kind
            AND synthetic_decision.owner_id = pen.owner_id
            AND synthetic_decision.post_id = p.id
            AND synthetic_disq.reason = 'synthetic_qa'
        )
        AND (
          (
            pen.owner_kind = 'user'
            AND pen.consent_basis = 'owner_self'
            AND pen.client_id IS NULL
            AND pen.workspace_key = '__owner__'
            AND pen.owner_id = pen.user_id
            AND ? = 'owner_real_post'
          )
          OR (
            pen.owner_kind = 'client'
            AND pen.consent_basis = 'customer_attested'
            AND NULLIF(TRIM(COALESCE(pen.consent_note, '')), '') IS NOT NULL
            AND pen.client_id IS NOT NULL
            AND pen.workspace_key = pen.client_id
            AND pen.owner_id = pen.client_id
            AND COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'
            AND ? = 'customer_real_post'
          )
        )
      RETURNING
        id,post_id,user_id,workspace_key,client_id,owner_kind,owner_id,
        content_hash,attestation_basis,note,attested_by,attested_at
    `).bind(
      sampleId,
      contentHash,
      attestationBasis,
      note,
      adminId,
      attestedAt,
      identity.workspaceKey,
      identity.ownerKind,
      identity.ownerId,
      AUTOPILOT_POLICY_VERSION,
      attestedAt,
      attestedAt,
      postId,
      identity.userId,
      identity.clientId,
      row.content,
      row.platform,
      row.hashtags,
      row.image_url,
      row.post_type,
      row.video_url,
      row.video_status,
      row.video_script,
      row.video_shots,
      identity.ownerKind,
      identity.ownerId,
      row.archetype_slug,
      attestationBasis,
      attestationBasis,
    ).first<PilotSampleRow>();
    const receipt = sample
      ?? await existingPilotSample(c.env.DB, identity, postId, contentHash);
    if (!receipt) {
      return c.json({
        error: 'Pilot attestation failed closed because the draft or consent changed',
      }, 409);
    }
    return c.json({
      sampleId: receipt.id,
      postId: receipt.post_id,
      contentHash: receipt.content_hash,
      attestationBasis: receipt.attestation_basis,
      attestedAt: receipt.attested_at,
      created: sample != null,
      postMutated: false,
    });
  });

  app.post('/api/learning/pilot/validate/:postId', async (c) => {
    const adminId = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adminId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const stagingError = pilotStagingError(c.env);
    if (stagingError) return c.json(stagingError, 409);
    if (!dormantPilotEnabled(c.env)) {
      return c.json({
        error: 'Pilot validation is available only while learning enforcement and autopilot are disabled',
      }, 409);
    }

    const postId = c.req.param('postId').trim();
    if (!postId) return c.json({ error: 'Not found' }, 404);
    const row = await c.env.DB.prepare(`
      SELECT
        p.id,p.user_id,p.client_id,p.owner_kind,p.owner_id,p.status,
        p.content,p.platform,p.hashtags,p.image_url,p.post_type,
        p.video_url,p.video_status,p.video_script,p.video_shots,
        COALESCE(c.archetype_slug, u.archetype_slug) AS archetype_slug,
        c.status AS client_status
      FROM posts p
      LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = p.user_id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ? AND p.user_id = ?
      LIMIT 1
    `).bind(postId, adminId).first<PilotDraftRow>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.status?.trim().toLowerCase() !== 'draft') {
      return c.json({ error: 'Pilot validation accepts Draft posts only' }, 409);
    }

    const clientId = row.client_id?.trim() || null;
    const ownerKind: WorkspaceOwnerKind = row.owner_kind === 'shop'
      ? 'shop'
      : clientId === null ? 'user' : 'client';
    if (ownerKind === 'shop' || (row.owner_kind && row.owner_kind !== ownerKind)) {
      return c.json({ error: 'Pilot validation supports canonical user and client drafts only' }, 409);
    }
    if (clientId && row.client_status?.trim().toLowerCase() === 'on_hold') {
      return c.json({ error: 'Pilot validation cannot include an on-hold client' }, 409);
    }
    if (clientId && row.client_status == null) return c.json({ error: 'Not found' }, 404);

    const identity = normalizeWorkspaceIdentity(
      row.user_id,
      clientId,
      ownerKind,
      row.owner_id?.trim() || clientId || row.user_id,
    );
    const mode = await loadWorkspaceLearningMode(
      c.env,
      identity.userId,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
    );
    if (mode !== 'approval') {
      return c.json({ error: 'Workspace must be enrolled in approval-mode pilot validation' }, 409);
    }
    const validationNow = new Date();
    const enrollment = await c.env.DB.prepare(`
      SELECT
        pen.id,w.monthly_ai_budget_usd_cents,
        sample.content_hash AS pilot_sample_content_hash,
        sample.attestation_basis AS pilot_sample_basis,
        sample.attested_at AS pilot_sample_attested_at
      FROM learning_pilot_enrollments pen
      INNER JOIN workspace_learning_settings w
        ON w.user_id = pen.user_id
       AND w.workspace_key = pen.workspace_key
       AND w.client_id IS pen.client_id
       AND w.owner_kind = pen.owner_kind
       AND w.owner_id = pen.owner_id
      LEFT JOIN learning_pilot_samples sample
        ON sample.user_id = pen.user_id
       AND sample.workspace_key = pen.workspace_key
       AND sample.client_id IS pen.client_id
       AND sample.owner_kind = pen.owner_kind
       AND sample.owner_id = pen.owner_id
       AND sample.post_id = ?
       AND unixepoch(sample.attested_at) >= unixepoch(pen.consent_confirmed_at)
       AND unixepoch(sample.attested_at) <= unixepoch(?)
       AND sample.attestation_basis = CASE pen.owner_kind
         WHEN 'user' THEN 'owner_real_post'
         ELSE 'customer_real_post'
       END
       AND sample.id = (
         SELECT latest_sample.id
         FROM learning_pilot_samples latest_sample
         WHERE latest_sample.user_id = pen.user_id
           AND latest_sample.workspace_key = pen.workspace_key
           AND latest_sample.client_id IS pen.client_id
           AND latest_sample.owner_kind = pen.owner_kind
           AND latest_sample.owner_id = pen.owner_id
           AND latest_sample.post_id = sample.post_id
         ORDER BY latest_sample.attested_at DESC, latest_sample.id DESC
         LIMIT 1
       )
      WHERE pen.user_id = ? AND pen.workspace_key = ?
        AND pen.client_id IS ? AND pen.owner_kind = ? AND pen.owner_id = ?
        AND pen.policy_version = ? AND pen.record_only = 1
        AND pen.consent_confirmed_at IS NOT NULL
        AND unixepoch(pen.consent_confirmed_at) <= unixepoch(?)
        AND w.mode = 'approval'
        AND w.monthly_ai_budget_usd_cents > 0
        AND NULLIF(TRIM(COALESCE(w.disabled_reason, '')), '') IS NULL
        AND (
          (pen.owner_kind = 'user' AND pen.consent_basis = 'owner_self')
          OR (
            pen.owner_kind = 'client'
            AND pen.consent_basis = 'customer_attested'
            AND NULLIF(TRIM(COALESCE(pen.consent_note, '')), '') IS NOT NULL
          )
        )
      LIMIT 1
    `).bind(
      postId,
      validationNow.toISOString(),
      identity.userId,
      identity.workspaceKey,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
      AUTOPILOT_POLICY_VERSION,
      validationNow.toISOString(),
    ).first<PilotValidationEnrollmentRow>();
    if (!enrollment) {
      return c.json({ error: 'Workspace has no current-policy pilot enrollment receipt' }, 409);
    }
    const expectedContentHash = enrollment.pilot_sample_content_hash?.trim() ?? '';
    if (!/^[0-9a-f]{64}$/.test(expectedContentHash)) {
      return c.json({
        error: 'Exact draft version has no positive real-post pilot attestation',
        code: 'pilot_sample_not_attested',
      }, 409);
    }
    const expectedBasis = identity.ownerKind === 'user'
      ? 'owner_real_post'
      : 'customer_real_post';
    if (
      enrollment.pilot_sample_basis !== expectedBasis
      || !Number.isFinite(Date.parse(enrollment.pilot_sample_attested_at ?? ''))
    ) {
      return c.json({
        error: 'Pilot sample attestation is invalid for this workspace',
        code: 'pilot_sample_invalid',
      }, 409);
    }
    const post: PublishablePost = {
      id: row.id,
      user_id: identity.userId,
      client_id: identity.clientId,
      owner_kind: identity.ownerKind,
      owner_id: identity.ownerId,
      content: row.content,
      platform: row.platform?.trim() || 'facebook',
      hashtags: row.hashtags,
      image_url: row.image_url,
      post_type: row.post_type,
      video_url: row.video_url,
      video_status: row.video_status,
      video_script: row.video_script,
      video_shots: row.video_shots,
      archetype_slug: row.archetype_slug,
    };
    if (await buildReleaseContentHash(post) !== expectedContentHash) {
      return c.json({
        error: 'Draft changed after its real-post pilot attestation',
        code: 'pilot_sample_stale',
      }, 409);
    }
    if (await isSyntheticQaPilotPost(c.env.DB, identity, postId)) {
      return c.json({
        error: 'Known synthetic-QA posts cannot enter real pilot evidence',
        code: 'pilot_sample_synthetic_qa',
      }, 409);
    }
    let contextReadiness;
    try {
      const criticContext = await loadCriticContext(
        c.env,
        identity.userId,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
      );
      contextReadiness = assessCriticContextReadiness(criticContext);
    } catch (error) {
      console.warn('[learning-pilot] critic context unavailable', {
        postId: row.id,
        workspaceKey: identity.workspaceKey,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      return c.json({
        error: 'Pilot business context could not be loaded; no critics ran',
        code: 'pilot_context_unavailable',
      }, 503);
    }
    if (!contextReadiness.ready) {
      return c.json({
        error: 'Pilot business context is incomplete; complete the business profile or add a verified fact before running critics',
        code: 'pilot_context_not_ready',
        readiness: {
          meaningfulProfileFieldCount: contextReadiness.meaningfulProfileFields.length,
          verifiedFactCount: contextReadiness.verifiedFactCount,
        },
      }, 409);
    }
    const budgetUsdCents = Number(enrollment.monthly_ai_budget_usd_cents);
    const budget = await getRecordOnlyPilotBudgetStatus(
      c.env.DB,
      identity,
      budgetUsdCents,
      validationNow,
    );
    if (!budget.allowed) {
      const telemetryUnavailable = budget.reason === 'telemetry_unavailable';
      return c.json({
        error: telemetryUnavailable
          ? 'Pilot cost telemetry is unavailable; no critics ran'
          : 'Pilot AI budget reserve is unavailable; no critics ran',
      }, telemetryUnavailable ? 503 : 409);
    }

    try {
      const result = await runClaimedPilotEvaluation(
        c.env,
        post,
        undefined,
        validationNow,
        expectedContentHash,
        {
          enrollmentId: enrollment.id,
          policyVersion: AUTOPILOT_POLICY_VERSION,
        },
      );
      if (
        result.status === 'busy'
        || result.decisionId == null
        || result.releaseState == null
      ) {
        return c.json({
          error: 'Pilot validation is already running; no duplicate critic spend was started',
        }, 409);
      }
      return c.json({
        decisionId: result.decisionId,
        releaseState: result.releaseState,
        postId: row.id,
        sourceStatus: 'Draft',
        postMutated: false,
      });
    } catch (error) {
      console.warn('[learning-pilot] validation failed closed', {
        postId: row.id,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      return c.json({
        error: 'Pilot validation failed closed; no post changes were made',
      }, 503);
    }
  });

  app.post('/api/learning/pilot/disqualify/:decisionId', async (c) => {
    const adminId = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adminId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const stagingError = pilotStagingError(c.env);
    if (stagingError) return c.json(stagingError, 409);
    if (!dormantPilotEnabled(c.env)) {
      return c.json({
        error: 'Pilot disqualification is available only while enforcement and autopilot are disabled',
      }, 409);
    }

    try {
      const body = await jsonBody(c.req.raw);
      const unexpected = Object.keys(body).filter(
        (key) => key !== 'reason' && key !== 'note',
      );
      if (unexpected.length > 0) {
        return c.json({ error: 'Disqualification accepts only reason and note' }, 400);
      }
      if (body.reason !== 'synthetic_qa') {
        return c.json({ error: 'reason must be synthetic_qa' }, 400);
      }
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (note.length < 10 || note.length > 2000) {
        return c.json({ error: 'note must be between 10 and 2000 characters' }, 400);
      }
      const decisionId = c.req.param('decisionId').trim();
      if (!decisionId) return c.json({ error: 'Not found' }, 404);

      const existing = await existingPilotDisqualification(c.env.DB, decisionId);
      if (existing) {
        return c.json({
          disqualificationId: existing.id,
          decisionId: existing.decision_id,
          reason: existing.reason,
          createdAt: existing.created_at,
          created: false,
          postMutated: false,
        });
      }

      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const receipt = await c.env.DB.prepare(`
        INSERT INTO learning_decision_disqualifications (
          id,decision_id,user_id,workspace_key,client_id,owner_kind,owner_id,
          reason,note,excluded_by,created_at
        )
        SELECT
          ?,d.id,d.user_id,d.workspace_key,d.client_id,d.owner_kind,d.owner_id,
          ?,?,?,?
        FROM learning_decisions d
        INNER JOIN learning_pilot_enrollments pen
          ON pen.user_id = d.user_id
         AND pen.workspace_key = d.workspace_key
         AND pen.client_id IS d.client_id
         AND pen.owner_kind = d.owner_kind
         AND pen.owner_id = d.owner_id
         AND pen.policy_version = ?
         AND pen.record_only = 1
         AND unixepoch(d.created_at) >= unixepoch(pen.enrolled_at)
         AND unixepoch(pen.consent_confirmed_at) <= unixepoch(d.created_at)
         AND (
           (d.owner_kind = 'user' AND pen.consent_basis = 'owner_self')
           OR (d.owner_kind = 'client' AND pen.consent_basis = 'customer_attested')
         )
        INNER JOIN posts p
          ON p.id = d.post_id
         AND TRIM(p.user_id) = d.user_id
         AND p.client_id IS d.client_id
         AND COALESCE(
           NULLIF(TRIM(p.owner_kind), ''),
           CASE WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
         ) = d.owner_kind
         AND CASE
           WHEN d.owner_kind = 'client' THEN TRIM(COALESCE(p.owner_id, p.client_id))
           ELSE TRIM(COALESCE(p.owner_id, p.user_id))
         END = d.owner_id
         AND LOWER(TRIM(COALESCE(p.status, ''))) = 'draft'
         AND NULLIF(TRIM(COALESCE(p.scheduled_for, '')), '') IS NULL
        LEFT JOIN users pilot_user
          ON d.owner_kind = 'user' AND pilot_user.id = d.user_id
        LEFT JOIN clients pilot_client
          ON d.owner_kind = 'client'
         AND pilot_client.id = d.client_id
         AND pilot_client.user_id = d.user_id
        WHERE d.id = ?
          AND d.stage = 'release'
          AND d.mode = 'approval'
          AND d.owner_kind IN ('user','client')
          AND (
            (d.owner_kind = 'user' AND pilot_user.id IS NOT NULL)
            OR (
              d.owner_kind = 'client'
              AND pilot_client.id IS NOT NULL
              AND COALESCE(LOWER(TRIM(pilot_client.status)), 'active') <> 'on_hold'
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM learning_adjudications a
            WHERE a.decision_id = d.id
              AND a.user_id = d.user_id
              AND a.workspace_key = d.workspace_key
              AND a.client_id IS d.client_id
              AND a.owner_kind = d.owner_kind
              AND a.owner_id = d.owner_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM publication_events pe
            WHERE pe.decision_id = d.id
              AND pe.user_id = d.user_id
              AND pe.workspace_key = d.workspace_key
              AND pe.client_id IS d.client_id
              AND pe.owner_kind = d.owner_kind
              AND pe.owner_id = d.owner_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM learning_decision_disqualifications disq
            WHERE disq.decision_id = d.id
          )
        RETURNING
          id,decision_id,user_id,workspace_key,client_id,owner_kind,owner_id,
          reason,note,excluded_by,created_at
      `).bind(
        id,
        body.reason,
        note,
        adminId,
        createdAt,
        AUTOPILOT_POLICY_VERSION,
        decisionId,
      ).first<PilotDisqualificationRow>();

      if (!receipt) {
        return c.json({
          error: 'Only an unpublished, unadjudicated, unscheduled current-pilot Draft can be disqualified',
        }, 409);
      }
      return c.json({
        disqualificationId: receipt.id,
        decisionId: receipt.decision_id,
        reason: receipt.reason,
        createdAt: receipt.created_at,
        created: true,
        postMutated: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/unique/i.test(message)) {
        const decisionId = c.req.param('decisionId').trim();
        const existing = await existingPilotDisqualification(c.env.DB, decisionId);
        if (existing) {
          return c.json({
            disqualificationId: existing.id,
            decisionId: existing.decision_id,
            reason: existing.reason,
            createdAt: existing.created_at,
            created: false,
            postMutated: false,
          });
        }
      }
      console.warn('[learning-pilot] disqualification failed closed', {
        decisionId: c.req.param('decisionId'),
        reason: message || 'unknown error',
      });
      return c.json({ error: 'Pilot disqualification failed closed' }, 503);
    }
  });

  app.post('/api/learning/settings/backfill', async (c) => {
    const adminId = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adminId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    try {
      const body = await jsonBody(c.req.raw);
      const unexpected = Object.keys(body).filter(
        (key) => key !== 'apply' && key !== 'limit',
      );
      if (unexpected.length > 0) {
        return c.json({
          error: 'Backfill accepts only apply and limit; consent is never migrated here',
        }, 400);
      }
      if (body.apply !== undefined && typeof body.apply !== 'boolean') {
        return c.json({ error: 'apply must be boolean' }, 400);
      }
      const limit = body.limit === undefined ? 50 : body.limit;
      if (
        typeof limit !== 'number'
        || !Number.isSafeInteger(limit)
        || limit < 1
        || limit > 200
      ) {
        return c.json({ error: 'limit must be an integer between 1 and 200' }, 400);
      }

      const rows = await c.env.DB.prepare(`
        SELECT user_id, workspace_key, client_id, owner_kind, owner_id
          FROM (
            SELECT u.id AS user_id, '__owner__' AS workspace_key,
                   NULL AS client_id, 'user' AS owner_kind, u.id AS owner_id
              FROM users u
             WHERE NOT EXISTS (
               SELECT 1 FROM workspace_learning_settings w
                WHERE w.user_id = u.id AND w.workspace_key = '__owner__'
             )
            UNION ALL
            SELECT c.user_id, c.id AS workspace_key, c.id AS client_id,
                   'client' AS owner_kind, c.id AS owner_id
              FROM clients c
             WHERE COALESCE(LOWER(TRIM(c.status)), 'active') <> 'on_hold'
               AND NOT EXISTS (
                 SELECT 1 FROM workspace_learning_settings w
                  WHERE w.user_id = c.user_id AND w.workspace_key = c.id
               )
            UNION ALL
            SELECT LOWER(s.shop_domain) AS user_id,
                   'shop:' || LOWER(s.shop_domain) AS workspace_key,
                   NULL AS client_id, 'shop' AS owner_kind,
                   LOWER(s.shop_domain) AS owner_id
              FROM shopify_stores s
             WHERE s.uninstalled_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM workspace_learning_settings w
                  WHERE w.user_id = LOWER(s.shop_domain)
                    AND w.workspace_key = 'shop:' || LOWER(s.shop_domain)
               )
          ) missing
         ORDER BY owner_kind, user_id, workspace_key
         LIMIT ?
      `).bind(limit).all<BackfillWorkspaceRow>();

      const workspaces = rows.results ?? [];
      for (const row of workspaces) {
        const identity = normalizeWorkspaceIdentity(
          row.user_id,
          row.client_id,
          row.owner_kind,
          row.owner_id,
        );
        if (identity.workspaceKey !== row.workspace_key) {
          throw new Error(`Non-canonical backfill candidate: ${row.owner_kind}:${row.owner_id}`);
        }
      }

      let applied = 0;
      if (body.apply === true) {
        const now = new Date().toISOString();
        for (const row of workspaces) {
          if (await ensureWorkspaceLearningSettings(
            c.env.DB,
            row.user_id,
            row.client_id,
            row.owner_kind,
            row.owner_id,
            now,
          )) applied += 1;
        }
      }
      return c.json({
        dryRun: body.apply !== true,
        found: workspaces.length,
        applied,
        workspaces,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Backfill failed' }, 400);
    }
  });

  app.get('/api/learning/readiness', async (c) => {
    const userId = c.get('uid') as string;
    const clientId = c.req.query('clientId')?.trim() || null;
    const identity = await ownedSettingsIdentity(c.env.DB, userId, clientId);
    if (!identity) return c.json({ error: 'Not found' }, 404);
    const settings = await getWorkspaceLearningSettings(c.env.DB, identity);
    const cost = await getWorkspaceMonthlyAiSpend(c.env.DB, identity);
    const row = await latestReadiness(c.env.DB);
    const effectiveMode = await loadWorkspaceLearningMode(
      c.env,
      identity.userId,
      identity.clientId,
      identity.ownerKind,
      identity.ownerId,
    );
    const ageMs = row ? Date.now() - Date.parse(row.evaluated_at) : Number.POSITIVE_INFINITY;
    return c.json({
      policyVersion: AUTOPILOT_POLICY_VERSION,
      ready: row?.ready === 1 && ageMs >= 0 && ageMs <= 20 * 60 * 1000,
      stale: !row || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 20 * 60 * 1000,
      effectiveMode,
      evaluatedAt: row?.evaluated_at ?? null,
      checks: row ? parseJsonObject(row.checks_json) : {},
      metrics: row ? parseJsonObject(row.metrics_json) : {},
      cost: {
        ...cost,
        monthlyAiBudgetUsdCents: settings.monthlyAiBudgetUsdCents ?? null,
        withinBudget: cost.monthlyAiSpendUsdCents != null
          && Number.isSafeInteger(settings.monthlyAiBudgetUsdCents)
          && Number(settings.monthlyAiBudgetUsdCents) > 0
          && cost.monthlyAiSpendUsdCents < Number(settings.monthlyAiBudgetUsdCents),
      },
      globalSwitches: {
        learningBrain: c.env.LEARNING_BRAIN_ENABLED === 'true',
        releaseEnforcement: c.env.LEARNING_RELEASE_ENFORCEMENT === 'true',
        protectedAutopilot: c.env.LEARNING_AUTOPILOT_ENABLED === 'true',
      },
    });
  });

  app.post('/api/learning/decisions/:decisionId/adjudicate', async (c) => {
    const adjudicator = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adjudicator))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const stagingError = pilotStagingError(c.env);
    if (stagingError) return c.json(stagingError, 409);
    try {
      const body = await jsonBody(c.req.raw);
      if (!['pass_green', 'hold_amber', 'block_red'].includes(String(body.expectedState))) {
        return c.json({ error: 'Invalid expectedState' }, 400);
      }
      if (body.severity !== 'advisory' && body.severity !== 'release_critical') {
        return c.json({ error: 'Invalid severity' }, 400);
      }
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!note || note.length > 2000) return c.json({ error: 'note is required' }, 400);
      const decisionId = c.req.param('decisionId');
      const decision = await c.env.DB.prepare(`
        WITH pilot_cohort AS (${CURRENT_POLICY_PILOT_COHORT_SQL})
        SELECT
          d.id,d.user_id,d.workspace_key,d.client_id,d.owner_kind,d.owner_id,
          d.post_id AS sample_post_id,d.content_hash AS review_content_hash,
          p.content AS review_content,
          COALESCE(p.platform, 'facebook') AS review_platform,
          p.hashtags AS review_hashtags,p.image_url AS review_image_url,
          p.post_type AS review_post_type,p.video_url AS review_video_url,
          p.video_status AS review_video_status,p.video_script AS review_video_script,
          p.video_shots AS review_video_shots,
          COALESCE(sample_client.archetype_slug, sample_user.archetype_slug)
            AS review_archetype_slug
        FROM pilot_cohort d
        LEFT JOIN posts p
          ON p.id = d.post_id
         AND TRIM(p.user_id) = d.user_id
         AND p.client_id IS d.client_id
         AND COALESCE(
           NULLIF(TRIM(p.owner_kind), ''),
           CASE WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
         ) = d.owner_kind
         AND CASE
           WHEN d.owner_kind = 'client' THEN TRIM(COALESCE(p.owner_id, p.client_id))
           ELSE TRIM(COALESCE(p.owner_id, p.user_id))
         END = d.owner_id
        LEFT JOIN clients sample_client
          ON d.owner_kind = 'client'
         AND sample_client.id = d.client_id
         AND sample_client.user_id = d.user_id
        LEFT JOIN users sample_user
          ON d.owner_kind = 'user' AND sample_user.id = d.user_id
        WHERE d.id = ?
        LIMIT 1
      `).bind(AUTOPILOT_POLICY_VERSION, decisionId).first<AdjudicationEvidenceSourceRow & {
        id: string;
        workspace_key: string;
      }>();
      const kind = decision && releaseOwnerKind(decision.owner_kind);
      if (!decision || !kind) return c.json({ error: 'Not found' }, 404);
      const identity = normalizeWorkspaceIdentity(
        decision.user_id,
        decision.client_id,
        kind,
        decision.owner_id,
      );
      if (identity.workspaceKey !== decision.workspace_key) {
        return c.json({ error: 'Not found' }, 404);
      }
      const source = await verifyAdjudicationEvidence(decision);
      if (source.status !== 'verified') {
        return c.json({
          error: 'Decision source evidence is unavailable or has changed; create a fresh receipt before adjudication',
        }, 409);
      }
      const id = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO learning_adjudications (
          id,decision_id,user_id,workspace_key,client_id,owner_kind,owner_id,
          expected_state,severity,note,adjudicated_by,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,
        decision.id,
        identity.userId,
        identity.workspaceKey,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
        body.expectedState,
        body.severity,
        note,
        adjudicator,
        new Date().toISOString(),
      ).run();
      return c.json({ adjudicationId: id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request';
      return c.json({ error: message }, /unique/i.test(message) ? 409 : 400);
    }
  });

  app.post('/api/learning/readiness/evidence', async (c) => {
    const recorder = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, recorder))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    try {
      const body = await jsonBody(c.req.raw);
      if ('ready' in body || 'overallReady' in body) {
        return c.json({ error: 'Overall readiness is calculated server-side' }, 400);
      }
      const evidenceKinds = new Set([
        'replay_red_team', 'staging_green', 'staging_block', 'kill_switch', 'publish_regression',
      ]);
      const kind = typeof body.evidenceKind === 'string' ? body.evidenceKind : '';
      if (!evidenceKinds.has(kind)) return c.json({ error: 'Invalid evidenceKind' }, 400);
      if (typeof body.passed !== 'boolean') return c.json({ error: 'passed must be boolean' }, 400);
      const staging = kind === 'staging_green' || kind === 'staging_block';
      const ownerKind = typeof body.ownerKind === 'string'
        ? releaseOwnerKind(body.ownerKind)
        : null;
      if ((staging && !ownerKind) || (!staging && body.ownerKind != null)) {
        return c.json({ error: 'ownerKind is required only for staging evidence' }, 400);
      }
      const artifactHash = typeof body.artifactHash === 'string'
        ? body.artifactHash.trim().toLowerCase()
        : '';
      if (!/^[a-f0-9]{64}$/.test(artifactHash)) {
        return c.json({ error: 'artifactHash must be a SHA-256 hex digest' }, 400);
      }
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!note || note.length > 2000) return c.json({ error: 'note is required' }, 400);
      const now = new Date();
      const defaultExpiry = new Date(now.getTime() + RELEASE_EVIDENCE_MAX_TTL_MS);
      const expiresAt = body.expiresAt === undefined
        ? defaultExpiry
        : new Date(String(body.expiresAt));
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
        return c.json({ error: 'expiresAt must be in the future' }, 400);
      }
      if (expiresAt.getTime() - now.getTime() > RELEASE_EVIDENCE_MAX_TTL_MS) {
        return c.json({
          error: 'expiresAt cannot be more than seven days in the future',
        }, 400);
      }
      const id = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO learning_release_evidence (
          id,policy_version,evidence_kind,owner_kind,passed,artifact_hash,note,
          recorded_by,recorded_at,expires_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,
        AUTOPILOT_POLICY_VERSION,
        kind,
        ownerKind,
        body.passed ? 1 : 0,
        artifactHash,
        note,
        recorder,
        now.toISOString(),
        expiresAt.toISOString(),
      ).run();
      return c.json({ evidenceId: id, policyVersion: AUTOPILOT_POLICY_VERSION });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });

  app.get('/api/learning/admin/operations', async (c) => {
    const adminId = c.get('uid') as string;
    if (!(await learningAdmin(c.env.DB, adminId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const stagingError = pilotStagingError(c.env);
    if (stagingError) return c.json(stagingError, 409);
    const rawLimit = c.req.query('limit');
    const limit = rawLimit == null || rawLimit === '' ? 100 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      return c.json({ error: 'limit must be an integer between 1 and 200' }, 400);
    }
    const rows = await c.env.DB.prepare(`
      WITH pilot_cohort AS (
        ${CURRENT_POLICY_PILOT_COHORT_SQL}
      ), verdict_sources AS (
        SELECT v.decision_id,
               CASE
                 WHEN v.critic_kind IN ('image','video_manifest') THEN 'media'
                 WHEN v.provider = 'deterministic'
                  AND v.critic_kind IN (${DETERMINISTIC_REQUIRED_CRITICS_SQL})
                 THEN 'deterministic'
                 ELSE 'independent'
               END AS critic_lane,
               v.critic_kind, v.verdict, v.attempt
          FROM learning_critic_verdicts v
          INNER JOIN pilot_cohort r ON r.id = v.decision_id
         WHERE v.critic_kind IN (${ALL_REQUIRED_CRITICS_SQL})
      ), verdict_attempts AS (
        SELECT v.decision_id, v.critic_lane, v.critic_kind, v.verdict, v.attempt,
               MAX(v.attempt) OVER (
                 PARTITION BY v.decision_id, v.critic_lane, v.critic_kind
               ) AS latest_attempt
          FROM verdict_sources v
      ), verdict_slots AS (
        SELECT v.decision_id, v.critic_lane, v.critic_kind,
               MAX(CASE WHEN v.verdict != 'unavailable' THEN 1 ELSE 0 END) AS available,
               MAX(CASE WHEN v.verdict = 'block' THEN 1 ELSE 0 END) AS blocked
          FROM verdict_attempts v
         WHERE v.attempt = v.latest_attempt
         GROUP BY v.decision_id, v.critic_lane, v.critic_kind
      ), decision_metrics AS (
        SELECT r.user_id, r.workspace_key,
               COUNT(*) AS decision_count,
               SUM(CASE WHEN r.release_state IN ('hold_amber','block_red') THEN 1 ELSE 0 END) AS hold_count,
               COUNT(a.id) AS adjudicated_count,
               SUM(CASE
                 WHEN a.expected_state = 'pass_green'
                  AND r.release_state IN ('hold_amber','block_red') THEN 1 ELSE 0 END
               ) AS false_hold_count,
               SUM(CASE
                 WHEN a.expected_state = 'block_red'
                  AND a.severity = 'release_critical'
                  AND r.release_state = 'pass_green' THEN 1 ELSE 0 END
               ) AS severe_false_passes,
               SUM(CASE
                 WHEN json_extract(r.summary_json, '$.judgeStatus')
                      IN ('available','unavailable')
                 THEN 1 ELSE 0 END
               ) AS judge_total,
               SUM(CASE
                 WHEN json_extract(r.summary_json, '$.judgeStatus') = 'available'
                 THEN 1 ELSE 0 END
               ) AS judge_available,
               SUM(CASE
                 WHEN json_extract(r.summary_json, '$.judgeStatus')
                      IN ('available','unavailable','not_run')
                 THEN 1 ELSE 0 END
               ) AS judge_telemetry_count
          FROM pilot_cohort r
          LEFT JOIN learning_adjudications a ON a.decision_id = r.id
           AND a.user_id = r.user_id AND a.workspace_key = r.workspace_key
           AND a.owner_kind = r.owner_kind AND a.owner_id = r.owner_id
         GROUP BY r.user_id, r.workspace_key
      ), decision_critic_paths AS (
        SELECT r.id, r.user_id, r.workspace_key, r.summary_json,
               MAX(CASE
                 WHEN v.critic_lane = 'deterministic' AND v.blocked = 1
                 THEN 1 ELSE 0 END
               ) AS deterministic_block
          FROM pilot_cohort r
          LEFT JOIN verdict_slots v ON v.decision_id = r.id
         GROUP BY r.id, r.user_id, r.workspace_key, r.summary_json
      ), expected_critic_metrics AS (
        SELECT p.user_id, p.workspace_key,
               SUM(CASE
                 WHEN p.deterministic_block = 1
                 THEN ${DETERMINISTIC_REQUIRED_CRITICS.length}
                 ELSE ${
                   BASE_REQUIRED_CRITICS.length + DETERMINISTIC_REQUIRED_CRITICS.length
                 } + CASE
                   WHEN json_extract(p.summary_json, '$.mediaKind') IN ('image','video')
                   THEN 1 ELSE 0 END
                 END
               ) AS critic_total
          FROM decision_critic_paths p
         GROUP BY p.user_id, p.workspace_key
      ), verdict_metrics AS (
        SELECT p.user_id, p.workspace_key,
               SUM(CASE
                 WHEN v.critic_lane = 'deterministic'
                   OR (p.deterministic_block = 0 AND v.critic_lane = 'independent')
                   OR (
                     p.deterministic_block = 0
                     AND json_extract(p.summary_json, '$.mediaKind') = 'image'
                     AND v.critic_kind = 'image'
                   )
                   OR (
                     p.deterministic_block = 0
                     AND json_extract(p.summary_json, '$.mediaKind') = 'video'
                     AND v.critic_kind = 'video_manifest'
                   )
                 THEN v.available ELSE 0 END
               ) AS critic_available
          FROM decision_critic_paths p
          LEFT JOIN verdict_slots v ON v.decision_id = p.id
         GROUP BY p.user_id, p.workspace_key
      ), sample_candidates AS (
        SELECT r.user_id, r.workspace_key, r.owner_kind, r.owner_id,
               r.id AS sample_decision_id, r.post_id AS sample_post_id,
               r.content_hash AS review_content_hash,
               p.content AS review_content,
               COALESCE(p.platform, 'facebook') AS review_platform,
               p.hashtags AS review_hashtags,p.image_url AS review_image_url,
               p.post_type AS review_post_type,p.video_url AS review_video_url,
               p.video_status AS review_video_status,
               p.video_script AS review_video_script,
               p.video_shots AS review_video_shots,
               COALESCE(sample_client.archetype_slug, sample_user.archetype_slug)
                 AS review_archetype_slug,
               ROW_NUMBER() OVER (
                 PARTITION BY r.user_id, r.workspace_key, r.owner_kind, r.owner_id
                 ORDER BY r.updated_at DESC, r.id DESC
               ) AS sample_rank
          FROM pilot_cohort r
          LEFT JOIN learning_adjudications a ON a.decision_id = r.id
           AND a.user_id = r.user_id AND a.workspace_key = r.workspace_key
           AND a.owner_kind = r.owner_kind AND a.owner_id = r.owner_id
          LEFT JOIN posts p
            ON p.id = r.post_id
           AND TRIM(p.user_id) = r.user_id
           AND p.client_id IS r.client_id
           AND COALESCE(
             NULLIF(TRIM(p.owner_kind), ''),
             CASE WHEN p.client_id IS NULL THEN 'user' ELSE 'client' END
           ) = r.owner_kind
           AND CASE
             WHEN r.owner_kind = 'client' THEN TRIM(COALESCE(p.owner_id, p.client_id))
             ELSE TRIM(COALESCE(p.owner_id, p.user_id))
           END = r.owner_id
          LEFT JOIN clients sample_client
            ON r.owner_kind = 'client'
           AND sample_client.id = r.client_id
           AND sample_client.user_id = r.user_id
          LEFT JOIN users sample_user
            ON r.owner_kind = 'user' AND sample_user.id = r.user_id
         WHERE a.id IS NULL
      )
      SELECT w.user_id, w.workspace_key, w.client_id, w.owner_kind, w.owner_id,
             w.mode, w.autopublish_consent_at, w.autopublish_policy_version,
             w.updated_at, u.id AS user_exists, c.id AS client_id_found,
             c.status AS client_status, s.shop_domain,
             s.uninstalled_at AS shop_uninstalled_at,
             dm.decision_count, dm.hold_count, dm.adjudicated_count,
              dm.false_hold_count, dm.severe_false_passes,
              em.critic_total, vm.critic_available,
              dm.judge_total, dm.judge_available, dm.judge_telemetry_count,
              sc.sample_decision_id, sc.sample_post_id,
              sc.review_content_hash,sc.review_content,sc.review_platform,
              sc.review_hashtags,sc.review_image_url,sc.review_post_type,
              sc.review_video_url,sc.review_video_status,sc.review_video_script,
              sc.review_video_shots,sc.review_archetype_slug
        FROM workspace_learning_settings w
        LEFT JOIN users u ON w.owner_kind = 'user' AND u.id = w.user_id
        LEFT JOIN clients c ON w.owner_kind = 'client'
         AND c.id = w.client_id AND c.user_id = w.user_id
        LEFT JOIN shopify_stores s ON w.owner_kind = 'shop'
         AND LOWER(s.shop_domain) = w.owner_id
        LEFT JOIN decision_metrics dm ON dm.user_id = w.user_id
         AND dm.workspace_key = w.workspace_key
        LEFT JOIN expected_critic_metrics em ON em.user_id = w.user_id
         AND em.workspace_key = w.workspace_key
        LEFT JOIN verdict_metrics vm ON vm.user_id = w.user_id
         AND vm.workspace_key = w.workspace_key
        LEFT JOIN sample_candidates sc ON sc.user_id = w.user_id
         AND sc.workspace_key = w.workspace_key
         AND sc.owner_kind = w.owner_kind AND sc.owner_id = w.owner_id
         AND sc.sample_rank = 1
       ORDER BY w.updated_at DESC, w.user_id, w.workspace_key
       LIMIT ?
    `).bind(AUTOPILOT_POLICY_VERSION, limit).all<AdminOperationsRow>();
    const readinessRow = await latestReadiness(c.env.DB);
    const evidenceRows = await c.env.DB.prepare(`
      WITH latest_evidence AS (
        SELECT evidence_kind, owner_kind, passed, recorded_at, expires_at,
               ROW_NUMBER() OVER (
                 PARTITION BY evidence_kind, COALESCE(owner_kind, '')
                 ORDER BY recorded_at DESC, id DESC
               ) AS evidence_rank
          FROM learning_release_evidence
         WHERE policy_version = ?
      )
      SELECT evidence_kind, owner_kind, passed, recorded_at, expires_at
        FROM latest_evidence
       WHERE evidence_rank = 1
       ORDER BY evidence_kind, owner_kind
       LIMIT ?
    `).bind(
      AUTOPILOT_POLICY_VERSION,
      ADMIN_RELEASE_EVIDENCE_REQUIREMENTS.length,
    ).all<AdminReleaseEvidenceRow>();
    const releaseEvidence = summarizeAdminReleaseEvidence(evidenceRows.results ?? []);
    const readinessAgeMs = readinessRow
      ? Date.now() - Date.parse(readinessRow.evaluated_at)
      : Number.POSITIVE_INFINITY;
    const globalSwitches = {
      learningBrain: c.env.LEARNING_BRAIN_ENABLED === 'true',
      releaseEnforcement: c.env.LEARNING_RELEASE_ENFORCEMENT === 'true',
      protectedAutopilot: c.env.LEARNING_AUTOPILOT_ENABLED === 'true',
    };
    const workspaces = await Promise.all((rows.results ?? []).map(async (row) => {
      const decisionCount = countValue(row.decision_count);
      const holdCount = countValue(row.hold_count);
      const adjudicatedCount = countValue(row.adjudicated_count);
      const falseHoldCount = countValue(row.false_hold_count);
      const criticTotal = countValue(row.critic_total);
      const criticAvailable = countValue(row.critic_available);
      const judgeTotal = countValue(row.judge_total);
      const judgeAvailable = countValue(row.judge_available);
      const judgeTelemetryCount = countValue(row.judge_telemetry_count);
      const onHold = row.owner_kind === 'client'
        && row.client_status?.trim().toLowerCase() === 'on_hold';
      const active = row.owner_kind === 'user' ? row.user_exists != null
        : row.owner_kind === 'client' ? row.client_id_found != null && !onHold
          : row.shop_domain != null && row.shop_uninstalled_at == null;
      const sample = row.sample_decision_id
        ? await verifyAdjudicationEvidence(row)
        : null;
      return {
        userId: row.user_id,
        workspaceKey: row.workspace_key,
        clientId: row.client_id,
        ownerKind: row.owner_kind,
        ownerId: row.owner_id,
        mode: row.mode,
        consentAt: row.autopublish_consent_at,
        consentPolicyVersion: row.autopublish_policy_version,
        active,
        onHold,
        decisionCount,
        holdRate: ratio(holdCount, decisionCount),
        sampledFalseHoldRate: ratio(falseHoldCount, adjudicatedCount),
        criticAvailability: ratio(criticAvailable, criticTotal),
        judgeAvailability: ratio(judgeAvailable, judgeTotal),
        judgeTelemetryCoverage: ratio(judgeTelemetryCount, decisionCount),
        severeFalsePasses: countValue(row.severe_false_passes),
        adjudicationCoverage: ratio(adjudicatedCount, decisionCount),
        globalKillSwitchEnabled: globalSwitches.protectedAutopilot,
        sampleDecisionId: row.sample_decision_id ?? null,
        samplePostId: row.sample_post_id ?? null,
        sampleEvidenceStatus: sample?.status ?? null,
        sampleEvidence: sample?.evidence ?? null,
        updatedAt: row.updated_at,
      };
    }));
    return c.json({
      policyVersion: AUTOPILOT_POLICY_VERSION,
      globalSwitches,
      releaseEvidence,
      readiness: {
        ready: readinessRow?.ready === 1
          && readinessAgeMs >= 0
          && readinessAgeMs <= 20 * 60 * 1000,
        stale: !readinessRow
          || !Number.isFinite(readinessAgeMs)
          || readinessAgeMs < 0
          || readinessAgeMs > 20 * 60 * 1000,
        evaluatedAt: readinessRow?.evaluated_at ?? null,
        checks: readinessRow ? parseJsonObject(readinessRow.checks_json) : {},
        metrics: readinessRow ? parseJsonObject(readinessRow.metrics_json) : {},
      },
      workspaces,
    });
  });

  app.get('/api/learning/decisions/:postId', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    const requestedClientId = c.req.query('clientId')?.trim() || null;
    const post = await c.env.DB.prepare(`
      SELECT id, user_id, client_id, owner_kind, owner_id
      FROM posts
      WHERE id = ? AND user_id = ?
    `).bind(postId, userId).first<OwnedPostRow>();

    if (!post) {
      return c.json({ error: 'Not found' }, 404);
    }

    const clientId = post.client_id?.trim() || null;
    if (requestedClientId !== clientId) {
      return c.json({ error: 'Not found' }, 404);
    }

    const ownerKind: WorkspaceOwnerKind = post.owner_kind === 'shop'
      ? 'shop'
      : clientId === null ? 'user' : 'client';
    if (post.owner_kind && post.owner_kind !== ownerKind) {
      return c.json({ error: 'Not found' }, 404);
    }
    const ownerId = post.owner_id?.trim() || clientId || userId;

    try {
      const decisions = await listDecisionReceipts(
        c.env.DB,
        userId,
        clientId,
        postId,
        20,
        ownerKind,
        ownerId,
      ) as DecisionRow[];
      if (decisions.length === 0) return c.json({ decisions: [] });

      // Decision ids come only from the tenant-scoped parent query above.
      // Verdict rows therefore cannot be fetched by an arbitrary id supplied
      // by the browser.
      const decisionIds = decisions.map((decision) => decision.id);
      const placeholders = decisionIds.map(() => '?').join(',');
      const verdictResult = await c.env.DB.prepare(`
        SELECT * FROM learning_critic_verdicts
        WHERE decision_id IN (${placeholders})
        ORDER BY decision_id, attempt ASC, critic_kind ASC
      `).bind(...decisionIds).all<VerdictRow>();
      const verdictsByDecision = new Map<string, Array<Record<string, unknown>>>();
      for (const verdict of verdictResult.results ?? []) {
        const normalized = {
          ...verdict,
          evidence: parseJsonStrings(verdict.evidence_json),
          repairs: parseJsonStrings(verdict.repair_json),
        };
        const rows = verdictsByDecision.get(verdict.decision_id) ?? [];
        rows.push(normalized);
        verdictsByDecision.set(verdict.decision_id, rows);
      }

      return c.json({
        decisions: decisions.map((decision) => ({
          ...decision,
          summary: parseJsonObject(decision.summary_json),
          verdicts: verdictsByDecision.get(decision.id) ?? [],
        })),
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  app.post('/api/learning/posts/:postId/tracking-link', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    try {
      const body = await jsonBody(c.req.raw);
      const clientId = requestedClientId(body.clientId);
      const post = await ownedPost(c.env.DB, postId, userId);
      const identity = post && canonicalPostIdentity(post, userId, clientId);
      if (!identity) return c.json({ error: 'Not found' }, 404);
      if (typeof body.destinationUrl !== 'string') {
        return c.json({ error: 'destinationUrl is required' }, 400);
      }
      const expiresAt = body.expiresAt === undefined || body.expiresAt === null
        ? null
        : typeof body.expiresAt === 'string' ? body.expiresAt : '__invalid__';
      const link = await createTrackingLink(c.env.DB, {
        identity,
        postId,
        destinationUrl: body.destinationUrl,
        expiresAt,
      });
      return c.json({ link });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });

  app.post('/api/learning/outcomes/:postId/feedback', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    try {
      const body = await jsonBody(c.req.raw);
      const metrics = Object.fromEntries(
        FEEDBACK_FIELDS.map((key) => [key, readMetric(body, key)]),
      ) as Record<FeedbackField, number | null>;
      if (FEEDBACK_FIELDS.every((key) => metrics[key] === null)) {
        return c.json({ error: 'At least one feedback metric is required' }, 400);
      }
      const clientId = requestedClientId(body.clientId);
      const post = await ownedPost(c.env.DB, postId, userId);
      const identity = post && canonicalPostIdentity(post, userId, clientId);
      if (!identity) return c.json({ error: 'Not found' }, 404);
      const id = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO conversion_feedback (
          id,user_id,workspace_key,client_id,owner_kind,owner_id,post_id,
          calls,messages,leads,bookings,sales,order_value_cents,source,recorded_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,
        identity.userId,
        identity.workspaceKey,
        identity.clientId,
        identity.ownerKind,
        identity.ownerId,
        postId,
        metrics.calls,
        metrics.messages,
        metrics.leads,
        metrics.bookings,
        metrics.sales,
        metrics.orderValueCents,
        'owner',
        new Date().toISOString(),
      ).run();
      return c.json({ ok: true, feedbackId: id });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
  });
}
