import type {
  PublishablePost,
} from './release-preflight';
import { AUTOPILOT_POLICY_VERSION } from './readiness';
import {
  normalizeWorkspaceIdentity,
  type LearningMode,
  type WorkspaceOwnerKind,
} from './types';
import type { ReleaseJudgeExecutionStatus } from './release-pipeline';

export const WEEKLY_CALIBRATION_SAMPLE_LIMIT = 10;
const CALIBRATION_MAX_ATTEMPTS = 2;

export interface CalibrationCandidate {
  decisionId: string;
  userId: string;
  workspaceKey: string;
  clientId: string | null;
  ownerKind: WorkspaceOwnerKind;
  ownerId: string;
  mode: Extract<LearningMode, 'approval' | 'protected_autopilot'>;
  contentHash: string;
  monthlyAiBudgetUsdCents: number | null;
  post: PublishablePost;
}

type CalibrationCandidateRow = {
  decision_id: string;
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: string;
  owner_id: string;
  mode: string;
  content_hash: string;
  monthly_ai_budget_usd_cents: number | null;
  post_id: string;
  content: string | null;
  platform: string | null;
  hashtags: string | null;
  image_url: string | null;
  post_type: string | null;
  video_url: string | null;
  video_status: string | null;
  video_script: string | null;
  video_shots: string | null;
  archetype_slug: string | null;
};

export interface CalibrationClaim {
  id: string;
  attempt: number;
}

export type CalibrationSourceFailure = 'missing' | 'stale' | 'pipeline_unavailable';

export interface CalibrationCompletion {
  expectedState: 'pass_green' | 'hold_amber' | 'block_red';
  severity: 'advisory' | 'release_critical';
  judgeStatus: ReleaseJudgeExecutionStatus;
  summary: Record<string, unknown>;
}

function validTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`);
}

function validatedIdentity(candidate: CalibrationCandidate) {
  const identity = normalizeWorkspaceIdentity(
    candidate.userId,
    candidate.clientId,
    candidate.ownerKind,
    candidate.ownerId,
  );
  if (identity.workspaceKey !== candidate.workspaceKey) {
    throw new Error('Calibration candidate workspace identity is inconsistent');
  }
  return identity;
}

function ownerKind(value: string): WorkspaceOwnerKind {
  if (value === 'user' || value === 'client' || value === 'shop') return value;
  throw new Error('Calibration candidate owner kind is invalid');
}

function learningMode(value: string): CalibrationCandidate['mode'] {
  if (value === 'approval' || value === 'protected_autopilot') return value;
  throw new Error('Calibration candidate mode is invalid');
}

export async function listCalibrationCandidates(
  db: D1Database,
  now: string,
  limit: number = WEEKLY_CALIBRATION_SAMPLE_LIMIT,
): Promise<CalibrationCandidate[]> {
  validTimestamp(now, 'Calibration timestamp');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > WEEKLY_CALIBRATION_SAMPLE_LIMIT) {
    throw new Error('Calibration sample limit is invalid');
  }
  const rows = await db.prepare(`
    WITH ranked_candidates AS (
      SELECT
        d.id AS decision_id,
        d.user_id,
        d.workspace_key,
        d.client_id,
        d.owner_kind,
        d.owner_id,
        d.mode,
        d.content_hash,
        settings.monthly_ai_budget_usd_cents,
        d.post_id,
        p.content,
        COALESCE(p.platform, 'facebook') AS platform,
        p.hashtags,
        p.image_url,
        p.post_type,
        p.video_url,
        p.video_status,
        p.video_script,
        p.video_shots,
        COALESCE(client.archetype_slug, owner.archetype_slug) AS archetype_slug,
        unixepoch(d.created_at) AS decision_created_epoch,
        ROW_NUMBER() OVER (
          PARTITION BY d.user_id, d.workspace_key, d.client_id, d.owner_kind, d.owner_id
          ORDER BY unixepoch(d.created_at) DESC, d.id DESC
        ) AS workspace_rank
      FROM learning_decisions d
      LEFT JOIN learning_calibration_audits audit
        ON audit.decision_id = d.id
       AND audit.policy_version = ?
      INNER JOIN workspace_learning_settings settings
        ON settings.user_id = d.user_id
       AND settings.workspace_key = d.workspace_key
       AND settings.client_id IS d.client_id
       AND settings.owner_kind = d.owner_kind
       AND settings.owner_id = d.owner_id
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
      LEFT JOIN clients client
        ON d.owner_kind = 'client'
       AND client.id = d.client_id
       AND client.user_id = d.user_id
       LEFT JOIN users owner
         ON owner.id = d.user_id
      LEFT JOIN shopify_stores s
        ON d.owner_kind = 'shop'
       AND LOWER(s.shop_domain) = LOWER(d.owner_id)
      WHERE d.stage = 'release'
        AND d.release_state = 'pass_green'
        AND d.mode IN ('approval','protected_autopilot')
        AND settings.mode IN ('approval','protected_autopilot')
        AND NULLIF(TRIM(COALESCE(settings.disabled_reason, '')), '') IS NULL
        AND LENGTH(d.content_hash) = 64
        AND d.content_hash NOT GLOB '*[^0-9a-f]*'
        AND (
          unixepoch(d.created_at) >= unixepoch(?, '-8 days')
          OR audit.id IS NOT NULL
        )
        AND (
          (d.owner_kind = 'user' AND owner.id IS NOT NULL)
          OR (
            d.owner_kind = 'client'
            AND LOWER(TRIM(COALESCE(client.status, 'active'))) = 'active'
          )
          OR (
            d.owner_kind = 'shop'
            AND s.shop_domain IS NOT NULL
            AND s.uninstalled_at IS NULL
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM learning_decision_disqualifications q
          WHERE q.decision_id = d.id
            AND q.user_id = d.user_id
            AND q.workspace_key = d.workspace_key
            AND q.client_id IS d.client_id
            AND q.owner_kind = d.owner_kind
            AND q.owner_id = d.owner_id
            AND q.reason = 'synthetic_qa'
        )
        AND (
          audit.id IS NULL
          OR (
            audit.attempt_count < ?
            AND audit.audit_status IN ('claimed','unavailable')
            AND audit.lease_expires_at <= ?
          )
        )
    )
    SELECT *
    FROM ranked_candidates
    WHERE workspace_rank = 1
    ORDER BY decision_created_epoch ASC, decision_id ASC
    LIMIT ?
  `).bind(
    AUTOPILOT_POLICY_VERSION,
    now,
    CALIBRATION_MAX_ATTEMPTS,
    now,
    limit,
  ).all<CalibrationCandidateRow>();

  return (rows.results ?? []).map((row) => {
    const kind = ownerKind(row.owner_kind);
    const identity = normalizeWorkspaceIdentity(
      row.user_id,
      row.client_id,
      kind,
      row.owner_id,
    );
    if (identity.workspaceKey !== row.workspace_key) {
      throw new Error('Calibration row workspace identity is inconsistent');
    }
    return {
      decisionId: row.decision_id,
      ...identity,
      mode: learningMode(row.mode),
      contentHash: row.content_hash,
      monthlyAiBudgetUsdCents: row.monthly_ai_budget_usd_cents == null
        ? null
        : Number(row.monthly_ai_budget_usd_cents),
      post: {
        id: row.post_id,
        user_id: identity.userId,
        client_id: identity.clientId,
        owner_kind: identity.ownerKind,
        owner_id: identity.ownerId,
        content: row.content ?? '',
        platform: row.platform?.trim() || 'facebook',
        hashtags: row.hashtags,
        image_url: row.image_url,
        post_type: row.post_type,
        video_url: row.video_url,
        video_status: row.video_status,
        video_script: row.video_script,
        video_shots: row.video_shots,
        archetype_slug: row.archetype_slug,
      },
    };
  });
}

export async function claimCalibrationAudit(
  db: D1Database,
  candidate: CalibrationCandidate,
  now: string,
  leaseExpiresAt: string,
): Promise<CalibrationClaim | null> {
  validTimestamp(now, 'Calibration claim timestamp');
  validTimestamp(leaseExpiresAt, 'Calibration lease timestamp');
  if (Date.parse(leaseExpiresAt) <= Date.parse(now)) {
    throw new Error('Calibration lease must expire after its claim');
  }
  const identity = validatedIdentity(candidate);
  const id = crypto.randomUUID();
  const row = await db.prepare(`
    INSERT INTO learning_calibration_audits (
      id,decision_id,policy_version,user_id,workspace_key,client_id,owner_kind,owner_id,
      original_state,audit_status,source_status,content_hash,attempt_count,
      lease_expires_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,'claimed','pending',?,1,?,?,?)
    ON CONFLICT(decision_id,policy_version) DO UPDATE SET
      audit_status = 'claimed',
      source_status = 'pending',
      expected_state = NULL,
      severity = NULL,
      judge_status = NULL,
      summary_json = '{}',
      attempt_count = learning_calibration_audits.attempt_count + 1,
      lease_expires_at = excluded.lease_expires_at,
      error = NULL,
      updated_at = excluded.updated_at,
      completed_at = NULL
    WHERE learning_calibration_audits.user_id = excluded.user_id
      AND learning_calibration_audits.workspace_key = excluded.workspace_key
      AND learning_calibration_audits.client_id IS excluded.client_id
      AND learning_calibration_audits.owner_kind = excluded.owner_kind
      AND learning_calibration_audits.owner_id = excluded.owner_id
      AND learning_calibration_audits.content_hash = excluded.content_hash
      AND learning_calibration_audits.attempt_count < 2
      AND learning_calibration_audits.audit_status IN ('claimed','unavailable')
      AND learning_calibration_audits.lease_expires_at <= excluded.created_at
    RETURNING id, attempt_count
  `).bind(
    id,
    candidate.decisionId,
    AUTOPILOT_POLICY_VERSION,
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    'pass_green',
    candidate.contentHash,
    leaseExpiresAt,
    now,
    now,
  ).first<{ id: string; attempt_count: number }>();
  if (!row) return null;
  return { id: row.id, attempt: Number(row.attempt_count) };
}

function assertSingleWrite(result: D1Result, operation: string): void {
  const changes = result.meta?.changes;
  if (typeof changes === 'number' && changes !== 1) {
    throw new Error(`${operation} lost its tenant-scoped claim`);
  }
}

export async function completeCalibrationAudit(
  db: D1Database,
  candidate: CalibrationCandidate,
  auditId: string,
  completion: CalibrationCompletion,
  now: string,
): Promise<void> {
  validTimestamp(now, 'Calibration completion timestamp');
  const identity = validatedIdentity(candidate);
  const result = await db.prepare(`
    UPDATE learning_calibration_audits
       SET audit_status = 'completed',
           source_status = 'verified',
           expected_state = ?,
           severity = ?,
           judge_status = ?,
           summary_json = ?,
           lease_expires_at = NULL,
           error = NULL,
           updated_at = ?,
           completed_at = ?
     WHERE id = ?
       AND decision_id = ?
       AND user_id = ?
       AND workspace_key = ?
       AND client_id IS ?
       AND owner_kind = ?
       AND owner_id = ?
       AND audit_status = 'claimed'
  `).bind(
    completion.expectedState,
    completion.severity,
    completion.judgeStatus,
    JSON.stringify(completion.summary),
    now,
    now,
    auditId,
    candidate.decisionId,
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
  ).run();
  assertSingleWrite(result, 'Calibration completion');
}

export async function markCalibrationUnavailable(
  db: D1Database,
  candidate: CalibrationCandidate,
  auditId: string,
  sourceStatus: CalibrationSourceFailure,
  _detail: string,
  now: string,
): Promise<void> {
  validTimestamp(now, 'Calibration unavailable timestamp');
  const identity = validatedIdentity(candidate);
  const safeError = sourceStatus === 'missing'
    ? 'Calibration source unavailable'
    : sourceStatus === 'stale'
      ? 'Calibration source changed after original decision'
      : 'Independent calibration pipeline unavailable';
  const nextRetryAt = new Date(Date.parse(now) + 6 * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.prepare(`
    UPDATE learning_calibration_audits
       SET audit_status = 'unavailable',
           source_status = ?,
           expected_state = NULL,
           severity = 'release_critical',
           judge_status = 'unavailable',
           summary_json = '{}',
           lease_expires_at = ?,
           error = ?,
           updated_at = ?,
           completed_at = NULL
     WHERE id = ?
       AND decision_id = ?
       AND user_id = ?
       AND workspace_key = ?
       AND client_id IS ?
       AND owner_kind = ?
       AND owner_id = ?
       AND audit_status = 'claimed'
  `).bind(
    sourceStatus,
    nextRetryAt,
    safeError,
    now,
    auditId,
    candidate.decisionId,
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
  ).run();
  assertSingleWrite(result, 'Calibration unavailable update');
}
