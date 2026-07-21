import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_USER_ID,
  POLICY_VERSION,
  PRODUCTION_DATABASE,
  STAGING_DATABASE,
  assertStagingWriteProcess,
  buildStagingWriteArgs,
  type SourceDraft,
} from './learning-pilot-staging-copy';
import {
  assertReadOnlySql,
  buildWranglerInvocation,
  validateReadOnlyD1Results,
} from './learning-rollout-state';

export const OWNER_WORKSPACE_KEY = '__owner__';
export const EXPECTED_OWNER_COPY_STATEMENT =
  'I consent to SocialAI Studio copying one server-selected unpublished Penny Wise I.T Draft into isolated staging for record-only safety evaluation. No other post content may be copied, nothing may be scheduled or published, and consent may be withdrawn.';
export const EXPECTED_GLADSTONE_ATTESTATION =
  'I attest pilot-copy-be692c0a252f57aa0bf77f89 is a genuine Gladstone SocialAI output for record-only evaluation. It is rejected for publishing because the image is irrelevant.';
export const EXPECTED_GLADSTONE_POST_ID = 'pilot-copy-be692c0a252f57aa0bf77f89';
export const EXPECTED_AUTHORIZATION_RECEIPT_ID =
  'pilot-authorization-penny-owner-gladstone-gradient-20260720';
export const FOLLOWUP_AUTHORIZATION_RECEIPT_ID =
  'pilot-authorization-penny-owner-followup-20260721';
export const EXPECTED_AUTHORIZATION_THREAD_ID =
  '019ed317-7f47-7b22-ae5e-0fab6b0218c6';
export const FOLLOWUP_AUTHORIZATION_CAPTURED_AT = '2026-07-21T00:44:01.994Z';
const AUTHORIZATION_BINDINGS = [
  {
    receiptId: EXPECTED_AUTHORIZATION_RECEIPT_ID,
    capturedAt: '2026-07-20T01:47:33.413Z',
    threadId: EXPECTED_AUTHORIZATION_THREAD_ID,
  },
  {
    receiptId: FOLLOWUP_AUTHORIZATION_RECEIPT_ID,
    capturedAt: FOLLOWUP_AUTHORIZATION_CAPTURED_AT,
    threadId: EXPECTED_AUTHORIZATION_THREAD_ID,
  },
] as const;
export const AUTHORIZATION_USE_TABLE = 'learning_pilot_authorization_uses';
const AUTHORIZATION_USE_DELETE_TRIGGER = 'prevent_learning_pilot_authorization_use_delete';
const AUTHORIZATION_USE_UPDATE_TRIGGER = 'restrict_learning_pilot_authorization_use_update';
const AUTHORIZATION_SOURCE_INDEX = 'uq_learning_pilot_authorization_source';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workerRoot = resolve(repoRoot, 'workers', 'api');
const defaultAuthorizationPath = resolve(
  repoRoot,
  'docs',
  'superpowers',
  'evidence',
  'consents',
  '2026-07-20-gladstone-gradient-and-penny-owner-draft-record-only.json',
);
const defaultArtifactDirectory = 'D:\\GitHubBackup\\SocialAi\\release-evidence';
const SECRET_SHAPED_KEY = /(?:api.?key|token|secret|password|credential|private.?key|auth)/i;
const EXTERNAL_PUBLISH_FIELDS = [
  'late_post_id',
  'video_url',
  'video_request_id',
  'audio_mixed_url',
  'claim_id',
  'claim_at',
  'fb_video_id',
  'fb_publish_state',
  'postproxy_post_id',
  'postproxy_status',
  'postproxy_permalink',
  'postproxy_sent_at',
  'postproxy_finished_at',
] as const;
const QA_FIELDS = [
  'qa_feedback_target',
  'qa_feedback_reason',
  'qa_feedback_note',
  'qa_feedback_at',
] as const;

export interface DualPilotAuthorizationReceipt {
  schemaVersion: 1;
  receiptId: string;
  capturedAt: string;
  source: {
    kind: 'user_provided_attestation';
    threadId: string;
  };
  statements: {
    gladstoneExactDraft: string;
    pennyWiseOwnerDraftCopy: string;
  };
  grants: {
    gladstoneExactDraft: {
      postId: string;
      clientId: 'gladstonebbq-001';
      recordOnly: true;
      genuineSocialAiOutput: true;
      publishDisposition: 'rejected';
      rejectionReason: 'irrelevant_image';
      scheduleAllowed: false;
      publishAllowed: false;
      learningApplyAllowed: false;
    };
    pennyWiseOwnerDraftCopy: {
      userId: string;
      workspaceKey: '__owner__';
      maxDrafts: 1;
      serverSelected: true;
      requiresUnpublished: true;
      copyProfileAllowed: false;
      isolatedStaging: true;
      recordOnly: true;
      scheduleAllowed: false;
      publishAllowed: false;
      learningApplyAllowed: false;
    };
  };
  withdrawal: {
    allowed: true;
    effect: string;
  };
}

export interface OwnerSourceDraft extends SourceDraft {
  publication_event_count: number | string | null;
  delivery_receipt_count: number | string | null;
}

interface D1StatementResult {
  results?: Array<Record<string, unknown>>;
  success?: boolean;
  error?: string;
  meta?: {
    changes?: number;
    changed_db?: boolean;
    rows_written?: number;
  };
}

interface OwnerCopyArtifact {
  schemaVersion: 1 | 2;
  action: 'dry_run' | 'applied' | 'withdrawn' | 'failed_and_rolled_back'
    | 'authorization_consumption_backfilled';
  generatedAt: string;
  gitCommit: string;
  gitClean: boolean;
  authorization: {
    receiptId: string;
    sha256: string;
    statement: string;
    capturedAt: string;
    maxDrafts: 1;
    withdrawalAllowed: true;
    singleUseLedger?: {
      table: typeof AUTHORIZATION_USE_TABLE;
      state: 'not_recorded' | 'consumed' | 'withdrawn';
      verified: boolean;
    };
  };
  source: {
    environment: 'production';
    database: string;
    readOnly: boolean;
    eligibleDraftCount: number;
    excludedDraftCount: number;
    previouslyCopiedExcludedCount?: number;
    selectedSourceIdSha256: string;
    sourceSnapshotSha256: string;
    productionRecheckSha256: string | null;
    contentSha256: string;
    mediaUrlSha256: string;
    sourceScheduleCleared: boolean;
    hugheseysQueOnHold: boolean;
  };
  target: {
    environment: 'staging';
    database: string;
    copiedPostId: string;
    workspaceKey: '__owner__';
    recordOnly: true;
    mode: 'approval';
    experimentRate: 0;
    autopublishConsentAt: null;
    scheduledRows: 0;
    publishableRows: 0;
    derivedRowsAtCopy: 0;
    verified: boolean;
  };
  notes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  if (parsed > Date.now() + 60_000) throw new Error(`${label} cannot be in the future`);
  return new Date(parsed).toISOString();
}

export function validateDualPilotAuthorization(
  value: DualPilotAuthorizationReceipt,
): DualPilotAuthorizationReceipt {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Authorization receipt schemaVersion must be 1');
  }
  const binding = AUTHORIZATION_BINDINGS.find((candidate) => (
    candidate.receiptId === value.receiptId
  ));
  if (!binding) {
    throw new Error('Authorization receipt ID does not match the exact consent event');
  }
  if (isoTimestamp(value.capturedAt, 'capturedAt') !== binding.capturedAt) {
    throw new Error('Authorization capture time does not match the exact consent event');
  }
  if (
    value.source.kind !== 'user_provided_attestation'
    || value.source.threadId !== binding.threadId
  ) {
    throw new Error('Authorization source is invalid');
  }
  if (value.statements.gladstoneExactDraft !== EXPECTED_GLADSTONE_ATTESTATION) {
    throw new Error('Gladstone attestation must match the exact user statement');
  }
  if (value.statements.pennyWiseOwnerDraftCopy !== EXPECTED_OWNER_COPY_STATEMENT) {
    throw new Error('Penny Wise owner-copy consent must match the exact user statement');
  }
  const gladstone = value.grants.gladstoneExactDraft;
  if (
    gladstone.postId !== EXPECTED_GLADSTONE_POST_ID
    || gladstone.clientId !== 'gladstonebbq-001'
    || gladstone.recordOnly !== true
    || gladstone.genuineSocialAiOutput !== true
    || gladstone.publishDisposition !== 'rejected'
    || gladstone.rejectionReason !== 'irrelevant_image'
    || gladstone.scheduleAllowed !== false
    || gladstone.publishAllowed !== false
    || gladstone.learningApplyAllowed !== false
  ) {
    throw new Error('Gladstone grant must remain record-only and rejected for publishing');
  }
  const owner = value.grants.pennyWiseOwnerDraftCopy;
  if (
    owner.userId !== EXPECTED_USER_ID
    || owner.workspaceKey !== OWNER_WORKSPACE_KEY
    || owner.maxDrafts !== 1
    || owner.serverSelected !== true
    || owner.requiresUnpublished !== true
    || owner.copyProfileAllowed !== false
    || owner.isolatedStaging !== true
    || owner.recordOnly !== true
    || owner.scheduleAllowed !== false
    || owner.publishAllowed !== false
    || owner.learningApplyAllowed !== false
  ) {
    throw new Error('Owner-copy grant must permit exactly one record-only unpublished Draft');
  }
  if (value.withdrawal.allowed !== true || !value.withdrawal.effect.trim()) {
    throw new Error('Authorization must remain withdrawable');
  }
  return value;
}

function markerPresent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return value !== 0;
  return value !== null && value !== undefined && value !== false;
}

function validMediaUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return [...url.searchParams.keys()].every((key) => !SECRET_SHAPED_KEY.test(key));
  } catch {
    return false;
  }
}

function validHashtags(value: string | null): boolean {
  if (value === null || value.trim() === '') return true;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      && parsed.length <= 20
      && parsed.every((item) => typeof item === 'string' && item.length <= 100);
  } catch {
    return false;
  }
}

export function classifyOwnerDraft(row: OwnerSourceDraft): string[] {
  const reasons: string[] = [];
  if (!row.id?.trim()) reasons.push('missing_id');
  if (row.user_id !== EXPECTED_USER_ID || row.client_id !== null) {
    reasons.push('wrong_workspace');
  }
  if (row.status?.trim().toLowerCase() !== 'draft') reasons.push('not_draft');
  if (!['user', null].includes(row.owner_kind)) reasons.push('wrong_owner_kind');
  if (![EXPECTED_USER_ID, null].includes(row.owner_id)) reasons.push('wrong_owner_id');
  const content = row.content?.trim() ?? '';
  if (!content || content.length > 5_000) reasons.push('invalid_content');
  if (!['facebook', 'instagram'].includes(row.platform?.trim().toLowerCase() ?? '')) {
    reasons.push('unsupported_platform');
  }
  if (row.post_type?.trim().toLowerCase() !== 'image') reasons.push('not_image_draft');
  if (!validMediaUrl(row.image_url)) reasons.push('unsafe_or_missing_image_url');
  if (!validHashtags(row.hashtags)) reasons.push('invalid_hashtags');
  for (const field of EXTERNAL_PUBLISH_FIELDS) {
    if (markerPresent(row[field])) reasons.push(`external_publish_marker:${field}`);
  }
  if (Number(row.publish_attempts ?? 0) !== 0) reasons.push('publish_attempts_present');
  if (QA_FIELDS.some((field) => markerPresent(row[field]))) reasons.push('existing_qa_feedback');
  if (Number(row.publication_event_count ?? -1) !== 0) reasons.push('publication_event_present');
  if (Number(row.delivery_receipt_count ?? -1) !== 0) reasons.push('delivery_receipt_present');
  return reasons;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function payloadHash(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)));
}

function validSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export function authorizationSha256(
  authorization: DualPilotAuthorizationReceipt,
): string {
  return payloadHash(validateDualPilotAuthorization(authorization));
}

function authorizationUseId(authorizationHash: string): string {
  if (!validSha256(authorizationHash)) throw new Error('Authorization hash is invalid');
  return `pilot-authorization-use-${authorizationHash.slice(0, 24)}`;
}

export function buildAuthorizationUseSchemaSql(): string {
  return `CREATE TABLE IF NOT EXISTS ${AUTHORIZATION_USE_TABLE} (
  id TEXT PRIMARY KEY,
  authorization_sha256 TEXT NOT NULL UNIQUE CHECK (
    LENGTH(authorization_sha256) = 64
    AND authorization_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  receipt_id_sha256 TEXT NOT NULL UNIQUE CHECK (
    LENGTH(receipt_id_sha256) = 64
    AND receipt_id_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_thread_id_sha256 TEXT NOT NULL CHECK (
    LENGTH(source_thread_id_sha256) = 64
    AND source_thread_id_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  statement_sha256 TEXT NOT NULL CHECK (
    LENGTH(statement_sha256) = 64
    AND statement_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  selected_source_id_sha256 TEXT NOT NULL CHECK (
    LENGTH(selected_source_id_sha256) = 64
    AND selected_source_id_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  copied_post_id TEXT NOT NULL UNIQUE CHECK (
    copied_post_id GLOB 'pilot-owner-copy-[0-9a-f]*'
  ),
  max_drafts INTEGER NOT NULL CHECK (max_drafts = 1),
  record_only INTEGER NOT NULL CHECK (record_only = 1),
  consumed_at TEXT NOT NULL,
  withdrawn_at TEXT
);
CREATE TRIGGER IF NOT EXISTS ${AUTHORIZATION_USE_DELETE_TRIGGER}
BEFORE DELETE ON ${AUTHORIZATION_USE_TABLE}
BEGIN
  SELECT RAISE(ABORT, 'pilot authorization use receipts cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS ${AUTHORIZATION_USE_UPDATE_TRIGGER}
BEFORE UPDATE ON ${AUTHORIZATION_USE_TABLE}
WHEN NOT (
  NEW.id = OLD.id
  AND NEW.authorization_sha256 = OLD.authorization_sha256
  AND NEW.receipt_id_sha256 = OLD.receipt_id_sha256
  AND NEW.source_thread_id_sha256 = OLD.source_thread_id_sha256
  AND NEW.statement_sha256 = OLD.statement_sha256
  AND NEW.selected_source_id_sha256 = OLD.selected_source_id_sha256
  AND NEW.copied_post_id = OLD.copied_post_id
  AND NEW.max_drafts = OLD.max_drafts
  AND NEW.record_only = OLD.record_only
  AND NEW.consumed_at = OLD.consumed_at
  AND OLD.withdrawn_at IS NULL
  AND NEW.withdrawn_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'pilot authorization use receipts are immutable');
END;
CREATE UNIQUE INDEX IF NOT EXISTS ${AUTHORIZATION_SOURCE_INDEX}
  ON ${AUTHORIZATION_USE_TABLE}(selected_source_id_sha256);`;
}

export function buildAuthorizationUseSql(
  authorization: DualPilotAuthorizationReceipt,
  selectedSourceIdSha256: string,
  copiedId: string,
  consumedAt: string,
): string {
  const authorizationHash = authorizationSha256(authorization);
  if (!validSha256(selectedSourceIdSha256)) {
    throw new Error('Selected source ID hash is invalid');
  }
  if (!/^pilot-owner-copy-[a-f0-9]{24}$/.test(copiedId)) {
    throw new Error('Authorization use requires a valid copied owner post ID');
  }
  const timestamp = isoTimestamp(consumedAt, 'consumedAt');
  return `${buildAuthorizationUseSchemaSql()}
INSERT OR ABORT INTO ${AUTHORIZATION_USE_TABLE} (
  id,authorization_sha256,receipt_id_sha256,source_thread_id_sha256,
  statement_sha256,selected_source_id_sha256,copied_post_id,max_drafts,
  record_only,consumed_at,withdrawn_at
) VALUES (
  ${sqlText(authorizationUseId(authorizationHash))},${sqlText(authorizationHash)},
  ${sqlText(sha256(authorization.receiptId))},${sqlText(sha256(authorization.source.threadId))},
  ${sqlText(sha256(authorization.statements.pennyWiseOwnerDraftCopy))},
  ${sqlText(selectedSourceIdSha256)},${sqlText(copiedId)},1,1,${sqlText(timestamp)},NULL
);`;
}

export function serverSelectOwnerDraft(
  rows: OwnerSourceDraft[],
  receiptId: string,
  previouslyUsedSourceHashes: ReadonlySet<string> = new Set(),
): {
  selected: OwnerSourceDraft;
  eligibleCount: number;
  excludedCount: number;
  previouslyCopiedExcludedCount: number;
} {
  if (!receiptId.trim()) throw new Error('Server selection requires an authorization receipt ID');
  for (const sourceHash of previouslyUsedSourceHashes) {
    if (!validSha256(sourceHash)) throw new Error('Previously used source hash is invalid');
  }
  const safe = rows.filter((row) => classifyOwnerDraft(row).length === 0);
  const eligible = safe.filter((row) => !previouslyUsedSourceHashes.has(sha256(row.id)));
  const previouslyCopiedExcludedCount = safe.length - eligible.length;
  if (eligible.length === 0) {
    throw new Error('No previously unused production owner Draft is safely eligible');
  }
  const ranked = eligible.map((row) => ({
    row,
    rank: sha256(`${receiptId}:${row.id}`),
  })).sort((left, right) => left.rank.localeCompare(right.rank)
    || left.row.id.localeCompare(right.row.id));
  return {
    selected: ranked[0].row,
    eligibleCount: eligible.length,
    excludedCount: rows.length - eligible.length,
    previouslyCopiedExcludedCount,
  };
}

export function copiedOwnerPostId(sourceId: string): string {
  if (!sourceId.trim()) throw new Error('Copied owner post requires a source ID');
  return `pilot-owner-copy-${sha256(`${OWNER_WORKSPACE_KEY}:${sourceId}`).slice(0, 24)}`;
}

function sqlText(value: string): string {
  if (value.includes('\0')) throw new Error('SQL text cannot contain a NUL byte');
  return `'${value.split("'").join("''")}'`;
}

function sqlNullable(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'NULL' : sqlText(value);
}

export function buildOwnerApplySql(
  row: OwnerSourceDraft,
  authorization: DualPilotAuthorizationReceipt,
  appliedAt: string,
): string {
  const reasons = classifyOwnerDraft(row);
  if (reasons.length > 0) {
    throw new Error(`Owner Draft is not eligible: ${reasons.join(', ')}`);
  }
  const copiedId = copiedOwnerPostId(row.id);
  const createdAt = isoTimestamp(appliedAt, 'appliedAt');
  return `-- Staging-only owner Draft copy. This SQL must never run against production.
${buildAuthorizationUseSql(authorization, sha256(row.id), copiedId, createdAt)}
INSERT OR ABORT INTO posts (
  id,user_id,client_id,content,platform,status,scheduled_for,hashtags,
  image_url,topic,pillar,created_at,post_type,owner_kind,owner_id,publish_attempts
) VALUES (
  ${sqlText(copiedId)},${sqlText(EXPECTED_USER_ID)},NULL,
  ${sqlText(row.content.trim())},${sqlNullable(row.platform)},'Draft',NULL,
  ${sqlText(row.hashtags?.trim() || '[]')},${sqlText(row.image_url!)},
  ${sqlNullable(row.topic)},${sqlNullable(row.pillar)},${sqlText(createdAt)},
  'image','user',${sqlText(EXPECTED_USER_ID)},0
);
`;
}

export function buildOwnerRollbackSql(copiedId: string): string {
  if (!/^pilot-owner-copy-[a-f0-9]{24}$/.test(copiedId)) {
    throw new Error('Rollback refused an unexpected owner-copy post ID');
  }
  return `-- Staging-only rollback for one unprocessed copied owner Draft.
DELETE FROM posts
 WHERE id = ${sqlText(copiedId)}
   AND user_id = ${sqlText(EXPECTED_USER_ID)}
   AND client_id IS NULL
   AND owner_kind = 'user'
   AND owner_id = ${sqlText(EXPECTED_USER_ID)}
   AND status = 'Draft'
   AND COALESCE(publish_attempts, 0) = 0
   AND NOT EXISTS (SELECT 1 FROM learning_decisions d WHERE d.post_id = posts.id)
   AND NOT EXISTS (SELECT 1 FROM learning_pilot_samples s WHERE s.post_id = posts.id)
   AND NOT EXISTS (SELECT 1 FROM publication_events e WHERE e.post_id = posts.id)
   AND NOT EXISTS (SELECT 1 FROM publish_delivery_receipts r WHERE r.post_id = posts.id);
`;
}

export function buildOwnerWithdrawalSql(
  copiedId: string,
  authorization: DualPilotAuthorizationReceipt,
  withdrawnAt: string,
): string {
  if (!/^pilot-owner-copy-[a-f0-9]{24}$/.test(copiedId)) {
    throw new Error('Withdrawal refused an unexpected owner-copy post ID');
  }
  const authorizationHash = authorizationSha256(authorization);
  const withdrawalTimestamp = isoTimestamp(withdrawnAt, 'withdrawnAt');
  const user = sqlText(EXPECTED_USER_ID);
  const workspace = sqlText(OWNER_WORKSPACE_KEY);
  const post = sqlText(copiedId);
  const decisions = `SELECT id FROM learning_decisions
      WHERE user_id = ${user} AND workspace_key = ${workspace} AND post_id = ${post}`;
  return `-- Withdraw one consented owner Draft and only its derived staging evidence.
UPDATE ${AUTHORIZATION_USE_TABLE}
   SET withdrawn_at = ${sqlText(withdrawalTimestamp)}
 WHERE authorization_sha256 = ${sqlText(authorizationHash)}
   AND copied_post_id = ${post}
   AND withdrawn_at IS NULL;
UPDATE ai_usage SET learning_decision_id = NULL
 WHERE learning_decision_id IN (${decisions});
DELETE FROM learning_calibration_audits WHERE decision_id IN (${decisions});
DELETE FROM learning_adjudications WHERE decision_id IN (${decisions});
DELETE FROM learning_decision_disqualifications WHERE decision_id IN (${decisions});
DELETE FROM learning_critic_verdicts WHERE decision_id IN (${decisions});
DELETE FROM learning_pilot_samples
 WHERE user_id = ${user} AND workspace_key = ${workspace} AND post_id = ${post};
DELETE FROM learning_decisions
 WHERE user_id = ${user} AND workspace_key = ${workspace} AND post_id = ${post};
DELETE FROM posts
 WHERE id = ${post} AND user_id = ${user} AND client_id IS NULL
   AND owner_kind = 'user' AND owner_id = ${user};
`;
}

const SOURCE_SQL = `
SELECT p.id,p.user_id,p.client_id,p.content,p.platform,p.status,p.scheduled_for,
       p.hashtags,p.image_url,p.topic,p.pillar,p.created_at,p.post_type,
       p.owner_kind,p.owner_id,p.late_post_id,p.video_url,p.video_request_id,
       p.audio_mixed_url,p.claim_id,p.claim_at,p.fb_video_id,p.fb_publish_state,
       p.postproxy_post_id,p.postproxy_status,p.postproxy_permalink,
       p.postproxy_sent_at,p.postproxy_finished_at,p.publish_attempts,
       p.qa_feedback_target,p.qa_feedback_reason,p.qa_feedback_note,p.qa_feedback_at,
       (SELECT COUNT(*) FROM publication_events e
         WHERE e.user_id = p.user_id AND e.post_id = p.id) AS publication_event_count,
       (SELECT COUNT(*) FROM publish_delivery_receipts r
         WHERE r.user_id = p.user_id AND r.post_id = p.id) AS delivery_receipt_count
  FROM posts p
 WHERE p.user_id = '${EXPECTED_USER_ID}' AND p.client_id IS NULL
   AND LOWER(TRIM(COALESCE(p.status, ''))) = 'draft'
 ORDER BY p.created_at ASC,p.id ASC;
SELECT id,status FROM clients
 WHERE id = 'hughesq-001' AND user_id = '${EXPECTED_USER_ID}';
`;

function stagingPreflightSql(copiedId: string): string {
  return `
SELECT COUNT(*) AS count FROM users
 WHERE id = '${EXPECTED_USER_ID}' AND is_admin = 1;
SELECT COUNT(*) AS count FROM posts WHERE id = ${sqlText(copiedId)};
SELECT COUNT(*) AS count FROM learning_pilot_enrollments
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${OWNER_WORKSPACE_KEY}'
   AND client_id IS NULL AND owner_kind = 'user' AND owner_id = '${EXPECTED_USER_ID}'
   AND policy_version = '${POLICY_VERSION}' AND record_only = 1
   AND consent_basis = 'owner_self';
SELECT COUNT(*) AS count FROM workspace_learning_settings
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${OWNER_WORKSPACE_KEY}'
   AND client_id IS NULL AND owner_kind = 'user' AND owner_id = '${EXPECTED_USER_ID}'
   AND mode = 'approval' AND autopublish_consent_at IS NULL
   AND autopublish_policy_version IS NULL AND experiment_rate = 0
   AND monthly_ai_budget_usd_cents > 0 AND disabled_reason IS NULL;
SELECT COUNT(*) AS count FROM sqlite_master
 WHERE type = 'table' AND name = 'social_tokens';
SELECT COUNT(*) AS count FROM workspace_learning_settings
 WHERE mode = 'protected_autopilot';
`;
}

function stagingVerificationSql(
  copiedId: string,
  authorization: DualPilotAuthorizationReceipt,
): string {
  const authorizationHash = authorizationSha256(authorization);
  return `
SELECT COUNT(*) AS copied_count,
       COALESCE(SUM(CASE
         WHEN user_id = '${EXPECTED_USER_ID}' AND client_id IS NULL
          AND status = 'Draft' AND scheduled_for IS NULL
          AND post_type = 'image' AND owner_kind = 'user'
          AND owner_id = '${EXPECTED_USER_ID}' AND image_url IS NOT NULL
          AND late_post_id IS NULL AND video_url IS NULL AND video_request_id IS NULL
          AND audio_mixed_url IS NULL AND claim_id IS NULL AND claim_at IS NULL
          AND fb_video_id IS NULL AND fb_publish_state IS NULL
          AND postproxy_post_id IS NULL AND postproxy_status IS NULL
          AND postproxy_permalink IS NULL AND postproxy_sent_at IS NULL
          AND postproxy_finished_at IS NULL AND COALESCE(publish_attempts, 0) = 0
          AND qa_feedback_target IS NULL AND qa_feedback_reason IS NULL
          AND qa_feedback_note IS NULL AND qa_feedback_at IS NULL
         THEN 1 ELSE 0 END), 0) AS safe_count,
       COALESCE(SUM(CASE WHEN scheduled_for IS NOT NULL THEN 1 ELSE 0 END), 0)
         AS scheduled_count,
       COALESCE(SUM(CASE WHEN status != 'Draft' THEN 1 ELSE 0 END), 0)
         AS publishable_count
  FROM posts WHERE id = ${sqlText(copiedId)};
SELECT COUNT(*) AS count FROM learning_decisions
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${OWNER_WORKSPACE_KEY}'
   AND post_id = ${sqlText(copiedId)};
SELECT COUNT(*) AS count FROM learning_pilot_samples
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${OWNER_WORKSPACE_KEY}'
   AND post_id = ${sqlText(copiedId)};
SELECT COUNT(*) AS count FROM publication_events
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${OWNER_WORKSPACE_KEY}'
   AND post_id = ${sqlText(copiedId)};
SELECT COUNT(*) AS count FROM publish_delivery_receipts
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${OWNER_WORKSPACE_KEY}'
   AND post_id = ${sqlText(copiedId)};
SELECT COUNT(*) AS count FROM workspace_learning_settings
 WHERE mode = 'protected_autopilot';
SELECT COUNT(*) AS count FROM ${AUTHORIZATION_USE_TABLE}
 WHERE authorization_sha256 = ${sqlText(authorizationHash)}
   AND copied_post_id = ${sqlText(copiedId)} AND withdrawn_at IS NULL;
`;
}

function withdrawalVerificationSql(
  copiedId: string,
  authorization: DualPilotAuthorizationReceipt,
): string {
  const authorizationHash = authorizationSha256(authorization);
  return `
SELECT COUNT(*) AS count FROM posts WHERE id = ${sqlText(copiedId)};
SELECT COUNT(*) AS count FROM learning_decisions
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${OWNER_WORKSPACE_KEY}'
   AND post_id = ${sqlText(copiedId)};
SELECT COUNT(*) AS count FROM learning_pilot_samples
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${OWNER_WORKSPACE_KEY}'
   AND post_id = ${sqlText(copiedId)};
SELECT COUNT(*) AS count FROM workspace_learning_settings
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${OWNER_WORKSPACE_KEY}'
   AND mode = 'approval';
SELECT COUNT(*) AS count FROM ${AUTHORIZATION_USE_TABLE}
 WHERE authorization_sha256 = ${sqlText(authorizationHash)}
   AND copied_post_id = ${sqlText(copiedId)} AND withdrawn_at IS NOT NULL;
`;
}

function runWranglerJson(args: string[]): unknown {
  const invocation = buildWranglerInvocation(args);
  if (!existsSync(invocation.args[0])) {
    throw new Error(`Local Wrangler CLI not found at ${invocation.args[0]}`);
  }
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = [result.error?.message, result.stderr?.trim(), result.stdout?.trim()]
      .filter(Boolean)
      .join('; ') || `exit status ${String(result.status)}`;
    throw new Error(`wrangler ${args.join(' ')} failed: ${detail}`);
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error(`wrangler ${args.join(' ')} returned invalid JSON`);
  }
}

function executeReadOnlyD1(
  database: string,
  sql: string,
  environment?: 'staging',
): D1StatementResult[] {
  assertReadOnlySql(sql);
  const raw = runWranglerJson([
    'd1',
    'execute',
    database,
    '--remote',
    ...(environment ? ['--env', environment] : []),
    '--config',
    'wrangler.toml',
    '--command',
    sql,
  ]);
  const statementCount = sql.split(';').map((item) => item.trim()).filter(Boolean).length;
  if (!validateReadOnlyD1Results(raw, statementCount)) {
    throw new Error(`${database} read was not proven read-only`);
  }
  return raw as D1StatementResult[];
}

function executeStagingSql(sql: string): void {
  const tempDirectory = mkdtempSync(resolve(tmpdir(), 'socialai-owner-pilot-'));
  const sqlFile = resolve(tempDirectory, 'staging.sql');
  try {
    writeFileSync(sqlFile, sql, { encoding: 'utf8', flag: 'wx' });
    const invocation = buildWranglerInvocation(buildStagingWriteArgs(sqlFile));
    if (!existsSync(invocation.args[0])) {
      throw new Error(`Local Wrangler CLI not found at ${invocation.args[0]}`);
    }
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: workerRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    assertStagingWriteProcess(result);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function firstRows(results: D1StatementResult[]): Array<Record<string, unknown> | null> {
  return results.map((result) => result.results?.[0] ?? null);
}

function count(row: Record<string, unknown> | null, key = 'count'): number {
  const value = Number(row?.[key]);
  return Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

type AuthorizationUseState = 'absent' | 'unused' | 'consumed' | 'withdrawn';

function authorizationUseState(
  authorization: DualPilotAuthorizationReceipt,
  requireSourceIndex = false,
): AuthorizationUseState {
  const metadata = executeReadOnlyD1(
    STAGING_DATABASE,
    `SELECT type,name,sql FROM sqlite_master
      WHERE name IN (
        '${AUTHORIZATION_USE_TABLE}',
        '${AUTHORIZATION_USE_DELETE_TRIGGER}',
        '${AUTHORIZATION_USE_UPDATE_TRIGGER}',
        '${AUTHORIZATION_SOURCE_INDEX}'
      ) ORDER BY name;`,
    'staging',
  )[0].results ?? [];
  if (metadata.length === 0) return 'absent';

  const byName = new Map(metadata.map((row) => [String(row.name ?? ''), row]));
  const table = byName.get(AUTHORIZATION_USE_TABLE);
  const deleteTrigger = byName.get(AUTHORIZATION_USE_DELETE_TRIGGER);
  const updateTrigger = byName.get(AUTHORIZATION_USE_UPDATE_TRIGGER);
  const sourceIndex = byName.get(AUTHORIZATION_SOURCE_INDEX);
  if (
    !table
    || !deleteTrigger
    || !updateTrigger
    || ![3, 4].includes(metadata.length)
    || (requireSourceIndex && !sourceIndex)
  ) {
    throw new Error('Authorization-use ledger schema is incomplete');
  }
  const tableSql = String(table.sql ?? '').toLowerCase();
  const deleteSql = String(deleteTrigger.sql ?? '').toLowerCase();
  const updateSql = String(updateTrigger.sql ?? '').toLowerCase();
  const sourceIndexSql = String(sourceIndex?.sql ?? '').toLowerCase();
  const requiredTableFragments = [
    'authorization_sha256 text not null unique',
    'receipt_id_sha256 text not null unique',
    'selected_source_id_sha256 text not null',
    'copied_post_id text not null unique',
    'check (max_drafts = 1)',
    'check (record_only = 1)',
    'withdrawn_at text',
  ];
  if (
    requiredTableFragments.some((fragment) => !tableSql.includes(fragment))
    || !deleteSql.includes('cannot be deleted')
    || !updateSql.includes('old.withdrawn_at is null')
    || !updateSql.includes('new.withdrawn_at is not null')
    || (sourceIndex && (
      !sourceIndexSql.includes('create unique index')
      || !sourceIndexSql.includes('(selected_source_id_sha256)')
    ))
  ) {
    throw new Error('Authorization-use ledger schema does not match the fail-closed contract');
  }

  const authorizationHash = authorizationSha256(authorization);
  const receiptHash = sha256(authorization.receiptId);
  const [usage] = firstRows(executeReadOnlyD1(
    STAGING_DATABASE,
    `SELECT
       COALESCE(SUM(CASE WHEN authorization_sha256 = ${sqlText(authorizationHash)}
         THEN 1 ELSE 0 END), 0) AS authorization_count,
       COALESCE(SUM(CASE WHEN receipt_id_sha256 = ${sqlText(receiptHash)}
         THEN 1 ELSE 0 END), 0) AS receipt_count,
       COALESCE(SUM(CASE WHEN authorization_sha256 = ${sqlText(authorizationHash)}
          AND withdrawn_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS withdrawn_count
     FROM ${AUTHORIZATION_USE_TABLE};`,
    'staging',
  ));
  const authorizationCount = count(usage, 'authorization_count');
  const receiptCount = count(usage, 'receipt_count');
  const withdrawnCount = count(usage, 'withdrawn_count');
  if ([authorizationCount, receiptCount, withdrawnCount]
    .some((value) => value < 0 || value > 1)) {
    throw new Error('Authorization-use ledger contains ambiguous receipt state');
  }
  if (authorizationCount === 0 && receiptCount === 0) {
    return 'unused';
  }
  if (authorizationCount !== 1 || receiptCount !== 1) {
    throw new Error('Authorization-use ledger contains a conflicting receipt identity');
  }
  return withdrawnCount === 1 ? 'withdrawn' : 'consumed';
}

function assertAuthorizationUnused(authorization: DualPilotAuthorizationReceipt): void {
  const state = authorizationUseState(authorization);
  if (state === 'consumed' || state === 'withdrawn') {
    throw new Error(`Owner-copy authorization is already ${state} and cannot be replayed`);
  }
}

function usedOwnerSourceHashes(): Set<string> {
  const [table] = firstRows(executeReadOnlyD1(
    STAGING_DATABASE,
    `SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = '${AUTHORIZATION_USE_TABLE}';`,
    'staging',
  ));
  if (count(table) === 0) return new Set();
  if (count(table) !== 1) throw new Error('Authorization-use ledger table is ambiguous');
  const rows = executeReadOnlyD1(
    STAGING_DATABASE,
    `SELECT selected_source_id_sha256 FROM ${AUTHORIZATION_USE_TABLE}
      ORDER BY selected_source_id_sha256;`,
    'staging',
  )[0].results ?? [];
  const hashes = rows.map((row) => String(row.selected_source_id_sha256 ?? ''));
  if (hashes.some((value) => !validSha256(value)) || new Set(hashes).size !== hashes.length) {
    throw new Error('Authorization-use ledger contains invalid or duplicate source hashes');
  }
  return new Set(hashes);
}

function verifyAuthorizationUse(
  authorization: DualPilotAuthorizationReceipt,
  copiedId: string,
  expectedState: 'consumed' | 'withdrawn',
): void {
  const state = authorizationUseState(authorization, true);
  if (state !== expectedState) {
    throw new Error(`Authorization-use ledger expected ${expectedState} but found ${state}`);
  }
  const [row] = firstRows(executeReadOnlyD1(
    STAGING_DATABASE,
    `SELECT COUNT(*) AS count FROM ${AUTHORIZATION_USE_TABLE}
      WHERE authorization_sha256 = ${sqlText(authorizationSha256(authorization))}
        AND copied_post_id = ${sqlText(copiedId)}
        AND withdrawn_at IS ${expectedState === 'withdrawn' ? 'NOT ' : ''}NULL;`,
    'staging',
  ));
  if (count(row) !== 1) throw new Error('Authorization-use ledger post binding is invalid');
}

function sourceSnapshot(): {
  rows: D1StatementResult[];
  drafts: OwnerSourceDraft[];
  hash: string;
  hugheseysQueOnHold: boolean;
} {
  const rows = executeReadOnlyD1(PRODUCTION_DATABASE, SOURCE_SQL);
  const drafts = (rows[0].results ?? []) as unknown as OwnerSourceDraft[];
  const holdRows = rows[1].results ?? [];
  const hugheseysQueOnHold = holdRows.length === 1
    && String(holdRows[0].status ?? '').trim().toLowerCase() === 'on_hold';
  if (!hugheseysQueOnHold) throw new Error('Hugheseys Que is not proven on hold');
  return {
    rows,
    drafts,
    hash: payloadHash({ drafts, holdRows }),
    hugheseysQueOnHold,
  };
}

function assertStagingPreflight(
  copiedId: string,
  authorization: DualPilotAuthorizationReceipt,
): void {
  assertAuthorizationUnused(authorization);
  const values = firstRows(executeReadOnlyD1(
    STAGING_DATABASE,
    stagingPreflightSql(copiedId),
    'staging',
  )).map((row) => count(row));
  const [admin, existingCopy, enrollment, settings, tokenTables, protectedWorkspaces] = values;
  if (admin !== 1) throw new Error('Staging admin identity is missing or ambiguous');
  if (existingCopy !== 0) throw new Error('The selected owner Draft is already copied');
  if (enrollment !== 1) throw new Error('Staging owner pilot enrollment is missing or ambiguous');
  if (settings !== 1) throw new Error('Staging owner approval settings are missing or unsafe');
  if (tokenTables !== 0) throw new Error('Staging token isolation assumptions changed');
  if (protectedWorkspaces !== 0) throw new Error('Protected Autopilot is unexpectedly enabled');
}

function verifyApplied(
  copiedId: string,
  authorization: DualPilotAuthorizationReceipt,
): {
  scheduledRows: 0;
  publishableRows: 0;
  derivedRowsAtCopy: 0;
} {
  const rows = firstRows(executeReadOnlyD1(
    STAGING_DATABASE,
    stagingVerificationSql(copiedId, authorization),
    'staging',
  ));
  const [post, decisions, samples, events, receipts, protectedWorkspaces, authorizationUse] = rows;
  if (count(post, 'copied_count') !== 1 || count(post, 'safe_count') !== 1) {
    throw new Error('Copied staging owner Draft failed the safety check');
  }
  const scheduledRows = count(post, 'scheduled_count');
  const publishableRows = count(post, 'publishable_count');
  const derivedRowsAtCopy = [decisions, samples, events, receipts]
    .reduce((total, row) => total + count(row), 0);
  if (scheduledRows !== 0 || publishableRows !== 0 || derivedRowsAtCopy !== 0) {
    throw new Error('Owner copy created schedulable, publishable, or derived state');
  }
  if (count(protectedWorkspaces) !== 0) {
    throw new Error('Protected Autopilot must remain disabled');
  }
  if (count(authorizationUse) !== 1) {
    throw new Error('Owner copy did not consume exactly one authorization receipt');
  }
  verifyAuthorizationUse(authorization, copiedId, 'consumed');
  return { scheduledRows: 0, publishableRows: 0, derivedRowsAtCopy: 0 };
}

function verifyWithdrawn(
  copiedId: string,
  authorization: DualPilotAuthorizationReceipt,
): void {
  const [post, decisions, samples, settings, authorizationUse] = firstRows(executeReadOnlyD1(
    STAGING_DATABASE,
    withdrawalVerificationSql(copiedId, authorization),
    'staging',
  ));
  if (count(post) !== 0 || count(decisions) !== 0 || count(samples) !== 0) {
    throw new Error('Withdrawal left owner-copy or derived evidence rows behind');
  }
  if (count(settings) !== 1) {
    throw new Error('Withdrawal altered the pre-existing owner approval settings');
  }
  if (count(authorizationUse) !== 1) {
    throw new Error('Withdrawal did not retain a single-use authorization tombstone');
  }
  verifyAuthorizationUse(authorization, copiedId, 'withdrawn');
}

function gitState(): { commit: string; clean: boolean } {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (commit.status !== 0 || status.status !== 0) {
    throw new Error('Unable to capture Git state for the owner-copy receipt');
  }
  return { commit: commit.stdout.trim(), clean: status.stdout.trim() === '' };
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function hasOption(name: string): boolean {
  return process.argv.includes(name);
}

function readAuthorization(path: string): DualPilotAuthorizationReceipt {
  return validateDualPilotAuthorization(
    JSON.parse(readFileSync(path, 'utf8')) as DualPilotAuthorizationReceipt,
  );
}

function writeArtifact(artifact: OwnerCopyArtifact, outputDirectory: string): string {
  const artifactRoot = resolve('D:\\GitHubBackup\\SocialAi');
  const resolvedOutput = resolve(outputDirectory);
  const relativeOutput = relative(artifactRoot, resolvedOutput);
  if (relativeOutput.startsWith('..') || isAbsolute(relativeOutput)) {
    throw new Error('Owner pilot artifacts must remain under D:\\GitHubBackup\\SocialAi');
  }
  mkdirSync(resolvedOutput, { recursive: true });
  const timestamp = artifact.generatedAt.replace(/[:.]/g, '-');
  const path = resolve(resolvedOutput, `learning-owner-pilot-staging-copy-${timestamp}.json`);
  const contents = `${JSON.stringify(artifact, null, 2)}\n`;
  writeFileSync(path, contents, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(`${path}.sha256`, `${sha256(contents)}  ${path}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return path;
}

function loadAppliedArtifact(path: string): OwnerCopyArtifact {
  const artifact = JSON.parse(readFileSync(path, 'utf8')) as OwnerCopyArtifact;
  if (
    ![1, 2].includes(artifact.schemaVersion)
    || !['applied', 'authorization_consumption_backfilled'].includes(artifact.action)
    || artifact.source.database !== PRODUCTION_DATABASE
    || artifact.source.readOnly !== true
    || artifact.target.database !== STAGING_DATABASE
    || artifact.target.workspaceKey !== OWNER_WORKSPACE_KEY
    || artifact.target.recordOnly !== true
    || artifact.target.mode !== 'approval'
    || artifact.target.experimentRate !== 0
    || artifact.target.autopublishConsentAt !== null
    || artifact.target.scheduledRows !== 0
    || artifact.target.publishableRows !== 0
    || !/^pilot-owner-copy-[a-f0-9]{24}$/.test(artifact.target.copiedPostId)
    || !validSha256(artifact.authorization.sha256)
    || !validSha256(artifact.source.selectedSourceIdSha256)
    || !validSha256(artifact.source.contentSha256)
    || !validSha256(artifact.source.mediaUrlSha256)
  ) {
    throw new Error('Operation requires a valid applied owner-copy artifact');
  }
  return artifact;
}

function verifyExistingCopyForBackfill(applied: OwnerCopyArtifact): void {
  const copiedId = applied.target.copiedPostId;
  const rows = executeReadOnlyD1(
    STAGING_DATABASE,
    `SELECT p.*,
       (SELECT COUNT(*) FROM publication_events e WHERE e.post_id = p.id)
         AS publication_event_count,
       (SELECT COUNT(*) FROM publish_delivery_receipts r WHERE r.post_id = p.id)
         AS delivery_receipt_count
     FROM posts p WHERE p.id = ${sqlText(copiedId)};
     SELECT COUNT(*) AS count FROM workspace_learning_settings
      WHERE mode = 'protected_autopilot';`,
    'staging',
  );
  const postRows = rows[0].results ?? [];
  const protectedRows = rows[1].results?.[0] ?? null;
  if (postRows.length !== 1 || count(protectedRows) !== 0) {
    throw new Error('Existing owner copy or staging mode is unsafe for ledger backfill');
  }
  const post = postRows[0] as unknown as OwnerSourceDraft;
  if (
    post.user_id !== EXPECTED_USER_ID
    || post.client_id !== null
    || post.owner_kind !== 'user'
    || post.owner_id !== EXPECTED_USER_ID
    || post.status?.trim().toLowerCase() !== 'draft'
    || post.scheduled_for !== null
    || Number(post.publish_attempts ?? 0) !== 0
    || Number(post.publication_event_count ?? -1) !== 0
    || Number(post.delivery_receipt_count ?? -1) !== 0
    || EXTERNAL_PUBLISH_FIELDS.some((field) => markerPresent(post[field]))
  ) {
    throw new Error('Existing owner copy is schedulable, publishable, or externally delivered');
  }
  if (
    sha256(post.content ?? '') !== applied.source.contentSha256
    || sha256(post.image_url ?? '') !== applied.source.mediaUrlSha256
  ) {
    throw new Error('Existing owner copy no longer matches the applied receipt hashes');
  }
}

async function backfillAuthorizationConsumption(
  authorization: DualPilotAuthorizationReceipt,
  outputDirectory: string,
): Promise<void> {
  if (!hasOption('--apply') || option('--confirm-owner') !== EXPECTED_USER_ID) {
    throw new Error(`Backfill requires --apply --confirm-owner ${EXPECTED_USER_ID}`);
  }
  const artifactPath = option('--artifact');
  if (!artifactPath) throw new Error('Backfill requires the original applied owner-copy artifact');
  const applied = loadAppliedArtifact(resolve(artifactPath));
  if (
    applied.authorization.receiptId !== authorization.receiptId
    || applied.authorization.sha256 !== authorizationSha256(authorization)
  ) {
    throw new Error('Applied artifact does not match the exact authorization receipt');
  }
  const git = gitState();
  if (!git.clean) throw new Error('Backfill requires a clean committed worktree');
  assertAuthorizationUnused(authorization);
  verifyExistingCopyForBackfill(applied);
  executeStagingSql(buildAuthorizationUseSql(
    authorization,
    applied.source.selectedSourceIdSha256,
    applied.target.copiedPostId,
    applied.generatedAt,
  ));
  verifyAuthorizationUse(authorization, applied.target.copiedPostId, 'consumed');

  const generatedAt = new Date().toISOString();
  const artifact = {
    ...applied,
    schemaVersion: 2 as const,
    action: 'authorization_consumption_backfilled' as const,
    generatedAt,
    gitCommit: git.commit,
    gitClean: git.clean,
    authorization: {
      ...applied.authorization,
      singleUseLedger: {
        table: AUTHORIZATION_USE_TABLE,
        state: 'consumed' as const,
        verified: true,
      },
    },
    notes: [
      ...applied.notes,
      'Backfilled one hash-only immutable staging receipt for the authorization already consumed by this copy.',
      'The ledger stores no post content, image URL, profile, token, schedule, or publishing credential.',
      'Withdrawal removes copied content and retains only a non-reversible single-use tombstone.',
    ],
  } satisfies OwnerCopyArtifact;
  const receiptPath = writeArtifact(artifact, outputDirectory);
  process.stdout.write(`Authorization consumption backfilled and verified. Artifact: ${receiptPath}\n`);
}

async function withdraw(
  authorization: DualPilotAuthorizationReceipt,
  outputDirectory: string,
): Promise<void> {
  if (!hasOption('--apply') || option('--confirm-withdraw-owner') !== EXPECTED_USER_ID) {
    throw new Error(`Withdrawal requires --apply --confirm-withdraw-owner ${EXPECTED_USER_ID}`);
  }
  const artifactPath = option('--artifact');
  if (!artifactPath) throw new Error('Withdrawal requires the applied owner-copy artifact');
  const applied = loadAppliedArtifact(resolve(artifactPath));
  const copiedId = applied.target.copiedPostId;
  if (
    applied.authorization.receiptId !== authorization.receiptId
    || applied.authorization.sha256 !== authorizationSha256(authorization)
  ) {
    throw new Error('Withdrawal artifact does not match the exact authorization receipt');
  }
  const [post, events, receipts] = firstRows(executeReadOnlyD1(
    STAGING_DATABASE,
    `SELECT COUNT(*) AS count FROM posts
       WHERE id = ${sqlText(copiedId)} AND status = 'Draft'
         AND COALESCE(publish_attempts, 0) = 0;
     SELECT COUNT(*) AS count FROM publication_events WHERE post_id = ${sqlText(copiedId)};
     SELECT COUNT(*) AS count FROM publish_delivery_receipts WHERE post_id = ${sqlText(copiedId)};`,
    'staging',
  ));
  if (count(post) !== 1 || count(events) !== 0 || count(receipts) !== 0) {
    throw new Error('Withdrawal refused because the staging Draft is not safely unpublished');
  }
  const generatedAt = new Date().toISOString();
  executeStagingSql(buildOwnerWithdrawalSql(copiedId, authorization, generatedAt));
  verifyWithdrawn(copiedId, authorization);
  const git = gitState();
  const receiptPath = writeArtifact({
    ...applied,
    schemaVersion: 2,
    action: 'withdrawn',
    generatedAt,
    gitCommit: git.commit,
    gitClean: git.clean,
    authorization: {
      ...applied.authorization,
      sha256: payloadHash(authorization),
      singleUseLedger: {
        table: AUTHORIZATION_USE_TABLE,
        state: 'withdrawn',
        verified: true,
      },
    },
    target: { ...applied.target, verified: true },
    notes: [
      ...applied.notes,
      'Consent withdrawal removed only the copied owner Draft and its derived learning evidence.',
    ],
  }, outputDirectory);
  process.stdout.write(`Withdrawal verified. Artifact: ${receiptPath}\n`);
}

async function main(): Promise<void> {
  const authorizationPath = resolve(option('--authorization-file') ?? defaultAuthorizationPath);
  const outputDirectory = resolve(option('--output-dir') ?? defaultArtifactDirectory);
  const authorization = readAuthorization(authorizationPath);
  if (hasOption('--backfill-consumption')) {
    await backfillAuthorizationConsumption(authorization, outputDirectory);
    return;
  }
  if (hasOption('--withdraw')) {
    await withdraw(authorization, outputDirectory);
    return;
  }

  assertAuthorizationUnused(authorization);
  const sourceBefore = sourceSnapshot();
  const selection = serverSelectOwnerDraft(
    sourceBefore.drafts,
    authorization.receiptId,
    usedOwnerSourceHashes(),
  );
  const selected = selection.selected;
  const copiedId = copiedOwnerPostId(selected.id);
  assertStagingPreflight(copiedId, authorization);

  const apply = hasOption('--apply');
  if (apply && option('--confirm-owner') !== EXPECTED_USER_ID) {
    throw new Error(`Apply requires --confirm-owner ${EXPECTED_USER_ID}`);
  }
  const generatedAt = new Date().toISOString();
  const git = gitState();
  if (apply && !git.clean) {
    throw new Error('Apply requires a clean committed worktree');
  }

  let sourceAfterHash: string | null = null;
  let action: OwnerCopyArtifact['action'] = 'dry_run';
  let verification = {
    scheduledRows: 0 as const,
    publishableRows: 0 as const,
    derivedRowsAtCopy: 0 as const,
  };
  if (apply) {
    try {
      executeStagingSql(buildOwnerApplySql(selected, authorization, generatedAt));
      verification = verifyApplied(copiedId, authorization);
      const sourceAfter = sourceSnapshot();
      sourceAfterHash = sourceAfter.hash;
      if (sourceAfter.hash !== sourceBefore.hash) {
        throw new Error('Production source changed during the owner staging copy');
      }
      action = 'applied';
    } catch (error) {
      try {
        executeStagingSql(buildOwnerRollbackSql(copiedId));
        const [remaining] = firstRows(executeReadOnlyD1(
          STAGING_DATABASE,
          `SELECT COUNT(*) AS count FROM posts WHERE id = ${sqlText(copiedId)};`,
          'staging',
        ));
        if (count(remaining) !== 0) throw new Error('Copied row still exists');
      } catch (rollbackError) {
        throw new Error(
          `Owner copy failed and rollback could not be verified: ${String(error)}; rollback: ${String(rollbackError)}`,
        );
      }
      throw new Error(`Owner copy failed and was rolled back: ${String(error)}`);
    }
  }

  const artifact: OwnerCopyArtifact = {
    schemaVersion: 2,
    action,
    generatedAt,
    gitCommit: git.commit,
    gitClean: git.clean,
    authorization: {
      receiptId: authorization.receiptId,
      sha256: payloadHash(authorization),
      statement: authorization.statements.pennyWiseOwnerDraftCopy,
      capturedAt: authorization.capturedAt,
      maxDrafts: 1,
      withdrawalAllowed: true,
      singleUseLedger: {
        table: AUTHORIZATION_USE_TABLE,
        state: apply ? 'consumed' : 'not_recorded',
        verified: apply,
      },
    },
    source: {
      environment: 'production',
      database: PRODUCTION_DATABASE,
      readOnly: sourceBefore.rows.every((row) => (
        row.meta?.changed_db === false && row.meta?.rows_written === 0
      )),
      eligibleDraftCount: selection.eligibleCount,
      excludedDraftCount: selection.excludedCount,
      previouslyCopiedExcludedCount: selection.previouslyCopiedExcludedCount,
      selectedSourceIdSha256: sha256(selected.id),
      sourceSnapshotSha256: sourceBefore.hash,
      productionRecheckSha256: sourceAfterHash,
      contentSha256: sha256(selected.content),
      mediaUrlSha256: sha256(selected.image_url!),
      sourceScheduleCleared: Boolean(selected.scheduled_for),
      hugheseysQueOnHold: sourceBefore.hugheseysQueOnHold,
    },
    target: {
      environment: 'staging',
      database: STAGING_DATABASE,
      copiedPostId: copiedId,
      workspaceKey: OWNER_WORKSPACE_KEY,
      recordOnly: true,
      mode: 'approval',
      experimentRate: 0,
      autopublishConsentAt: null,
      scheduledRows: verification.scheduledRows,
      publishableRows: verification.publishableRows,
      derivedRowsAtCopy: verification.derivedRowsAtCopy,
      verified: apply,
    },
    notes: [
      apply
        ? 'Copied exactly one deterministic eligible owner Draft into isolated staging.'
        : 'Dry run only; no database writes were requested.',
      'No profile, enrollment, settings, tokens, schedules, provider IDs, claims, QA state, or publish metadata were copied.',
      'Exact-post attestation remains separate and is not inferred from copy consent.',
      'The source post ID and content are omitted from this receipt; only scoped hashes are retained.',
    ],
  };
  const artifactPath = writeArtifact(artifact, outputDirectory);
  process.stdout.write([
    `Action: ${action}`,
    'Selected Drafts: 1',
    `Eligible Drafts: ${selection.eligibleCount}`,
    `Excluded Drafts: ${selection.excludedCount}`,
    `Copied post ID: ${copiedId}`,
    `Staging scheduled rows: ${verification.scheduledRows}`,
    `Staging publishable rows: ${verification.publishableRows}`,
    `Artifact: ${artifactPath}`,
  ].join('\n') + '\n');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
