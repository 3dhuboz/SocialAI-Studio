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
  assertReadOnlySql,
  buildWranglerInvocation,
  validateReadOnlyD1Results,
} from './learning-rollout-state';

export const EXPECTED_USER_ID = 'user_3B9YKodZsIQjLdGW8wtwd7mmBMQ';
export const EXPECTED_CLIENT_ID = 'gladstonebbq-001';
export const EXPECTED_CUSTOMER_NAME = 'Gladstone BBQ Festival';
export const POLICY_VERSION = '2026-07-14-v1';
export const PRODUCTION_DATABASE = 'socialai-db';
export const STAGING_DATABASE = 'socialai-db-staging';
export const MAX_CONSENTED_DRAFTS = 4;
export const DEFAULT_MONTHLY_BUDGET_CENTS = 500;
export const EXPECTED_CONSENT_STATEMENT =
  'I consent to SocialAI Studio copying Gladstone BBQ Festival\u2019s non-secret business profile and up to four unpublished drafts into isolated staging for record-only safety evaluation. Nothing may be scheduled or published, and consent may be withdrawn.';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workerRoot = resolve(repoRoot, 'workers', 'api');
const defaultConsentPath = resolve(
  repoRoot,
  'docs',
  'superpowers',
  'evidence',
  'consents',
  '2026-07-20-gladstone-bbq-festival-record-only-staging.json',
);
const defaultArtifactDirectory = 'D:\\GitHubBackup\\SocialAi\\release-evidence';

const ALLOWED_PROFILE_FIELDS = [
  'name',
  'type',
  'description',
  'tone',
  'location',
  'targetAudience',
  'uniqueValue',
  'productsServices',
  'socialGoal',
  'contentTopics',
  'videoEnabled',
] as const;
const KNOWN_DISCARDED_PROFILE_FIELDS = new Set(['facebookAppId', 'logoUrl']);
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

export interface ConsentReceipt {
  schemaVersion: 1;
  receiptId: string;
  capturedAt: string;
  source: {
    kind: 'user_provided_attestation';
    threadId: string;
  };
  customer: {
    name: string;
    clientId: string;
    userId: string;
  };
  statement: string;
  scope: {
    maxDrafts: number;
    requiresUnpublished: boolean;
    isolatedStaging: boolean;
    recordOnly: boolean;
    scheduleAllowed: boolean;
    publishAllowed: boolean;
  };
  withdrawal: {
    allowed: boolean;
    effect: string;
  };
}

export interface SourceClient {
  id: string;
  user_id: string;
  name: string;
  business_type: string | null;
  profile?: string | Record<string, unknown>;
  status: string | null;
  archetype_slug: string | null;
}

export interface SourceDraft {
  id: string;
  user_id: string;
  client_id: string | null;
  content: string;
  platform: string | null;
  status: string | null;
  scheduled_for: string | null;
  hashtags: string | null;
  image_url: string | null;
  topic: string | null;
  pillar: string | null;
  created_at: string | null;
  post_type: string | null;
  owner_kind: string | null;
  owner_id: string | null;
  late_post_id: string | null;
  video_url: string | null;
  video_request_id: string | null;
  audio_mixed_url: string | null;
  claim_id: string | null;
  claim_at: string | null;
  fb_video_id: string | null;
  fb_publish_state: string | null;
  postproxy_post_id: string | null;
  postproxy_status: string | null;
  postproxy_permalink: string | null;
  postproxy_sent_at: string | null;
  postproxy_finished_at: string | null;
  publish_attempts: number | string | null;
  qa_feedback_target: string | null;
  qa_feedback_reason: string | null;
  qa_feedback_note: string | null;
  qa_feedback_at: string | null;
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

interface ApplySqlInput {
  consent: ConsentReceipt;
  client: SourceClient;
  sanitizedProfile: Record<string, unknown>;
  drafts: SourceDraft[];
  appliedAt: string;
  monthlyBudgetCents: number;
}

interface WithdrawalSqlInput {
  consent: ConsentReceipt;
  copiedPostIds: string[];
  withdrawnAt: string;
}

interface CopyArtifact {
  schemaVersion: 1;
  action: 'dry_run' | 'applied' | 'withdrawn' | 'failed_and_rolled_back';
  generatedAt: string;
  gitCommit: string;
  gitClean: boolean;
  consent: {
    receiptId: string;
    sha256: string;
    statement: string;
    capturedAt: string;
    withdrawalAllowed: boolean;
  };
  source: {
    environment: 'production';
    database: string;
    readOnly: boolean;
    clientId: string;
    sourceHash: string;
    profileKeysCopied: string[];
    profileKeysDropped: string[];
    eligibleDrafts: Array<{
      sourceId: string;
      copiedId: string;
      contentSha256: string;
      mediaSha256: string | null;
      sourceScheduleCleared: boolean;
    }>;
    excludedDrafts: Array<{ id: string; reasons: string[] }>;
    hugheseysQueOnHold: boolean;
  };
  target: {
    environment: 'staging';
    database: string;
    writesRequested: boolean;
    clientId: string;
    recordOnly: true;
    mode: 'approval';
    experimentRate: 0;
    autopublishConsentAt: null;
    scheduledRows: 0;
    publishableRows: 0;
    copiedPostIds: string[];
    verified: boolean;
  };
  productionRecheckHash: string | null;
  notes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== false;
}

function isoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  if (parsed > Date.now() + 60_000) throw new Error(`${label} cannot be in the future`);
  return new Date(parsed).toISOString();
}

export function validateConsentReceipt(value: ConsentReceipt): ConsentReceipt {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Consent receipt schemaVersion must be 1');
  }
  if (
    value.customer?.name !== EXPECTED_CUSTOMER_NAME
    || value.customer?.clientId !== EXPECTED_CLIENT_ID
    || value.customer?.userId !== EXPECTED_USER_ID
  ) {
    throw new Error('Consent receipt does not identify the bounded Gladstone workspace');
  }
  if (value.source?.kind !== 'user_provided_attestation' || !value.source.threadId?.trim()) {
    throw new Error('Consent receipt requires a user-provided attestation source');
  }
  if (value.statement !== EXPECTED_CONSENT_STATEMENT) {
    throw new Error('Consent statement does not match the explicit customer authorization');
  }
  if (!Number.isInteger(value.scope?.maxDrafts) || value.scope.maxDrafts < 1
    || value.scope.maxDrafts > MAX_CONSENTED_DRAFTS) {
    throw new Error('Consent scope permits no more than four Drafts');
  }
  if (!value.scope.requiresUnpublished) {
    throw new Error('Consent scope must require unpublished Drafts');
  }
  if (!value.scope.isolatedStaging || !value.scope.recordOnly) {
    throw new Error('Consent scope must be isolated staging and record-only');
  }
  if (value.scope.scheduleAllowed) {
    throw new Error('Consent scope requires scheduling to be forbidden');
  }
  if (value.scope.publishAllowed) {
    throw new Error('Consent scope requires publishing must be forbidden');
  }
  if (!value.withdrawal?.allowed) {
    throw new Error('Consent scope must remain withdrawable');
  }
  isoTimestamp(value.capturedAt, 'Consent capturedAt');
  return value;
}

function parseProfile(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== 'string') {
    if (!isRecord(value)) throw new Error('Business profile must be an object');
    return value;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) throw new Error('not an object');
    return parsed;
  } catch (error) {
    throw new Error(`Business profile is not valid object JSON: ${String(error)}`);
  }
}

export function sanitizeBusinessProfile(value: string | Record<string, unknown>): {
  profile: Record<string, unknown>;
  droppedKeys: string[];
} {
  const source = parseProfile(value);
  const allowed = new Set<string>(ALLOWED_PROFILE_FIELDS);
  const droppedKeys: string[] = [];

  for (const [key, item] of Object.entries(source)) {
    if (SECRET_SHAPED_KEY.test(key) && nonEmpty(item)) {
      throw new Error(`Business profile contains a non-empty secret-shaped field: ${key}`);
    }
    if (!allowed.has(key)) {
      if (KNOWN_DISCARDED_PROFILE_FIELDS.has(key) || !nonEmpty(item)) {
        droppedKeys.push(key);
        continue;
      }
      throw new Error(`Business profile field is not allowlisted: ${key}`);
    }
  }

  const profile: Record<string, unknown> = {};
  for (const key of ALLOWED_PROFILE_FIELDS) {
    const item = source[key];
    if (key === 'videoEnabled') {
      if (typeof item === 'boolean') profile[key] = item;
      else if (item !== null && item !== undefined) {
        throw new Error('Business profile videoEnabled must be boolean');
      }
      continue;
    }
    if (item === null || item === undefined || item === '') continue;
    if (typeof item !== 'string') {
      throw new Error(`Business profile ${key} must be a string`);
    }
    const normalized = item.trim();
    if (!normalized) continue;
    if (normalized.length > 3_000) {
      throw new Error(`Business profile ${key} exceeds the staging safety limit`);
    }
    profile[key] = normalized;
  }
  if (profile.name !== EXPECTED_CUSTOMER_NAME) {
    throw new Error('Sanitized profile name does not match Gladstone BBQ Festival');
  }
  const meaningfulFields = Object.entries(profile).filter(
    ([key, item]) => key !== 'name' && nonEmpty(item),
  );
  if (meaningfulFields.length < 2) {
    throw new Error('Sanitized profile is too incomplete for record-only evaluation');
  }
  if (JSON.stringify(profile).length > 10_000) {
    throw new Error('Sanitized profile exceeds the staging safety limit');
  }
  return { profile, droppedKeys: [...new Set(droppedKeys)].sort() };
}

function markerPresent(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

function validMediaUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    for (const key of url.searchParams.keys()) {
      if (SECRET_SHAPED_KEY.test(key)) return false;
    }
    return true;
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

export function classifyDraft(row: SourceDraft): string[] {
  const reasons: string[] = [];
  if (!row.id?.trim()) reasons.push('missing_id');
  if (row.user_id !== EXPECTED_USER_ID || row.client_id !== EXPECTED_CLIENT_ID) {
    reasons.push('wrong_workspace');
  }
  if (row.status?.trim().toLowerCase() !== 'draft') reasons.push('not_draft');
  if (row.owner_kind !== 'client' || row.owner_id !== EXPECTED_CLIENT_ID) {
    reasons.push('wrong_owner_identity');
  }
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
  return reasons;
}

export function selectEligibleDrafts(rows: SourceDraft[], maxDrafts: number): {
  selected: SourceDraft[];
  excluded: Array<{ id: string; reasons: string[] }>;
} {
  if (!Number.isInteger(maxDrafts) || maxDrafts < 1 || maxDrafts > MAX_CONSENTED_DRAFTS) {
    throw new Error('Draft selection must remain within the four-Draft consent limit');
  }
  const selected: SourceDraft[] = [];
  const excluded: Array<{ id: string; reasons: string[] }> = [];
  for (const row of rows) {
    const reasons = classifyDraft(row);
    if (reasons.length > 0) {
      excluded.push({ id: row.id, reasons });
    } else if (selected.length < maxDrafts) {
      selected.push(row);
    } else {
      excluded.push({ id: row.id, reasons: ['consent_limit'] });
    }
  }
  return { selected, excluded };
}

function sha256(value: string): string {
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

function sqlText(value: string): string {
  if (value.includes('\0')) throw new Error('SQL text cannot contain a NUL byte');
  return `'${value.split("'").join("''")}'`;
}

function sqlNullable(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'NULL' : sqlText(value);
}

export function copiedPostId(sourceId: string): string {
  return `pilot-copy-${sha256(`${EXPECTED_CLIENT_ID}:${sourceId}`).slice(0, 24)}`;
}

function enrollmentId(consent: ConsentReceipt): string {
  return `pilot-enroll-${sha256(consent.receiptId).slice(0, 24)}`;
}

function settingsId(consent: ConsentReceipt): string {
  return `pilot-settings-${sha256(consent.receiptId).slice(0, 24)}`;
}

export function buildApplySql(input: ApplySqlInput): string {
  const consent = validateConsentReceipt(input.consent);
  if (
    input.client.id !== EXPECTED_CLIENT_ID
    || input.client.user_id !== EXPECTED_USER_ID
    || input.client.name !== EXPECTED_CUSTOMER_NAME
    || input.client.status?.trim().toLowerCase() !== 'active'
  ) {
    throw new Error('Source client is not the active, consented Gladstone workspace');
  }
  if (!Number.isInteger(input.monthlyBudgetCents)
    || input.monthlyBudgetCents < 1 || input.monthlyBudgetCents > 500) {
    throw new Error('Record-only pilot budget must be between 1 and 500 cents');
  }
  if (input.drafts.length < 1 || input.drafts.length > consent.scope.maxDrafts) {
    throw new Error('Apply requires one to four consented Drafts');
  }
  for (const row of input.drafts) {
    const reasons = classifyDraft(row);
    if (reasons.length > 0) {
      throw new Error(`Draft ${row.id} is not eligible: ${reasons.join(', ')}`);
    }
  }
  const appliedAt = isoTimestamp(input.appliedAt, 'appliedAt');
  const profileJson = JSON.stringify(stableValue(input.sanitizedProfile));
  const statements = [
    '-- Staging-only record copy. This SQL must never run against production.',
    `INSERT OR ABORT INTO clients (
      id,user_id,name,business_type,created_at,profile,status,archetype_slug
    ) VALUES (
      ${sqlText(input.client.id)},${sqlText(input.client.user_id)},
      ${sqlText(input.client.name)},${sqlNullable(input.client.business_type)},
      ${sqlText(appliedAt)},${sqlText(profileJson)},'active',
      ${sqlNullable(input.client.archetype_slug)}
    );`,
  ];
  for (const row of input.drafts) {
    statements.push(`INSERT OR ABORT INTO posts (
      id,user_id,client_id,content,platform,status,scheduled_for,hashtags,
      image_url,topic,pillar,created_at,post_type,owner_kind,owner_id,publish_attempts
    ) VALUES (
      ${sqlText(copiedPostId(row.id))},${sqlText(EXPECTED_USER_ID)},
      ${sqlText(EXPECTED_CLIENT_ID)},${sqlText(row.content.trim())},
      ${sqlNullable(row.platform)},'Draft',NULL,${sqlText(row.hashtags?.trim() || '[]')},
      ${sqlNullable(row.image_url)},${sqlNullable(row.topic)},${sqlNullable(row.pillar)},
      ${sqlText(appliedAt)},'image','client',${sqlText(EXPECTED_CLIENT_ID)},0
    );`);
  }
  statements.push(
    `INSERT OR ABORT INTO learning_pilot_enrollments (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,
      policy_version,enrolled_by,enrolled_at,record_only,
      consent_basis,consent_confirmed_at,consent_note
    ) VALUES (
      ${sqlText(enrollmentId(consent))},${sqlText(EXPECTED_USER_ID)},
      ${sqlText(EXPECTED_CLIENT_ID)},${sqlText(EXPECTED_CLIENT_ID)},
      'client',${sqlText(EXPECTED_CLIENT_ID)},${sqlText(POLICY_VERSION)},
      ${sqlText(EXPECTED_USER_ID)},${sqlText(appliedAt)},1,
      'customer_attested',${sqlText(consent.capturedAt)},${sqlText(consent.statement)}
    );`,
    `INSERT OR ABORT INTO workspace_learning_settings (
      id,user_id,workspace_key,client_id,owner_kind,owner_id,mode,
      autopublish_consent_at,autopublish_policy_version,experiment_rate,
      monthly_ai_budget_usd_cents,disabled_reason,created_at,updated_at
    ) VALUES (
      ${sqlText(settingsId(consent))},${sqlText(EXPECTED_USER_ID)},
      ${sqlText(EXPECTED_CLIENT_ID)},${sqlText(EXPECTED_CLIENT_ID)},
      'client',${sqlText(EXPECTED_CLIENT_ID)},'approval',NULL,NULL,0,
      ${input.monthlyBudgetCents},NULL,${sqlText(appliedAt)},${sqlText(appliedAt)}
    );`,
  );
  return `${statements.join('\n')}\n`;
}

export function buildStagingWriteArgs(sqlFile: string): string[] {
  if (!sqlFile.trim()) throw new Error('A staging SQL file path is required');
  return [
    'd1',
    'execute',
    STAGING_DATABASE,
    '--remote',
    '--env',
    'staging',
    '--config',
    'wrangler.toml',
    '--file',
    sqlFile,
  ];
}

export function buildWithdrawalSql(input: WithdrawalSqlInput): string {
  validateConsentReceipt(input.consent);
  isoTimestamp(input.withdrawnAt, 'withdrawnAt');
  if (input.copiedPostIds.length < 1 || input.copiedPostIds.length > MAX_CONSENTED_DRAFTS) {
    throw new Error('Withdrawal requires one to four copied post IDs');
  }
  if (input.copiedPostIds.some((id) => !/^pilot-copy-[a-f0-9]{24}$/.test(id))) {
    throw new Error('Withdrawal refused an unexpected post ID');
  }
  const user = sqlText(EXPECTED_USER_ID);
  const workspace = sqlText(EXPECTED_CLIENT_ID);
  const ids = input.copiedPostIds.map(sqlText).join(',');
  const scopedTables = [
    'publication_events',
    'platform_metric_snapshots',
    'conversion_feedback',
    'tracking_links',
    'learning_experiments',
    'learning_profiles',
    'learning_signals',
    'learning_pilot_samples',
    'learning_decision_disqualifications',
    'learning_calibration_audits',
    'learning_adjudications',
    'learning_pilot_enrollments',
  ];
  const statements = [
    `-- Consent withdrawal captured at ${input.withdrawnAt}. Staging only.`,
    `DELETE FROM archetype_aggregates
      WHERE archetype_slug IN (
        SELECT archetype_slug FROM clients
        WHERE id = ${workspace} AND user_id = ${user} AND archetype_slug IS NOT NULL
      );`,
    `DELETE FROM learning_outcomes WHERE publication_event_id IN (
      SELECT id FROM publication_events WHERE user_id = ${user} AND workspace_key = ${workspace}
    );`,
    `DELETE FROM learning_outcome_attempts WHERE publication_event_id IN (
      SELECT id FROM publication_events WHERE user_id = ${user} AND workspace_key = ${workspace}
    );`,
    ...scopedTables.map((table) => `DELETE FROM ${table}
      WHERE user_id = ${user} AND workspace_key = ${workspace};`),
    `DELETE FROM learning_critic_verdicts WHERE decision_id IN (
      SELECT id FROM learning_decisions WHERE user_id = ${user} AND workspace_key = ${workspace}
    );`,
    `DELETE FROM learning_decisions
      WHERE user_id = ${user} AND workspace_key = ${workspace};`,
    `DELETE FROM workspace_learning_settings
      WHERE user_id = ${user} AND workspace_key = ${workspace};`,
    `DELETE FROM posts
      WHERE user_id = ${user} AND client_id = ${workspace} AND id IN (${ids});`,
    `DELETE FROM clients
      WHERE id = ${workspace} AND user_id = ${user}
        AND NOT EXISTS (
          SELECT 1 FROM posts WHERE user_id = ${user} AND client_id = ${workspace}
        );`,
  ];
  return `${statements.join('\n')}\n`;
}

const SOURCE_SQL = `
SELECT id,user_id,name,business_type,profile,status,archetype_slug
  FROM clients
 WHERE id = '${EXPECTED_CLIENT_ID}' AND user_id = '${EXPECTED_USER_ID}';
SELECT id,user_id,client_id,content,platform,status,scheduled_for,hashtags,image_url,
       topic,pillar,created_at,post_type,owner_kind,owner_id,late_post_id,
       video_url,video_request_id,audio_mixed_url,claim_id,claim_at,
       fb_video_id,fb_publish_state,postproxy_post_id,postproxy_status,
       postproxy_permalink,postproxy_sent_at,postproxy_finished_at,publish_attempts,
       qa_feedback_target,qa_feedback_reason,qa_feedback_note,qa_feedback_at
  FROM posts
 WHERE user_id = '${EXPECTED_USER_ID}' AND client_id = '${EXPECTED_CLIENT_ID}'
   AND LOWER(TRIM(COALESCE(status, ''))) = 'draft'
 ORDER BY created_at ASC,id ASC;
SELECT id,status FROM clients
 WHERE id = 'hughesq-001' AND user_id = '${EXPECTED_USER_ID}';
`;

const STAGING_PREFLIGHT_SQL = `
SELECT COUNT(*) AS count FROM users
 WHERE id = '${EXPECTED_USER_ID}' AND is_admin = 1;
SELECT COUNT(*) AS count FROM clients;
SELECT COUNT(*) AS count FROM posts
 WHERE client_id = '${EXPECTED_CLIENT_ID}';
SELECT COUNT(*) AS count FROM learning_pilot_enrollments
 WHERE policy_version = '${POLICY_VERSION}' AND owner_kind = 'client';
SELECT COUNT(*) AS count FROM workspace_learning_settings
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${EXPECTED_CLIENT_ID}';
SELECT COUNT(*) AS count FROM sqlite_master
 WHERE type = 'table' AND name = 'social_tokens';
SELECT COUNT(*) AS count FROM workspace_learning_settings
 WHERE mode = 'protected_autopilot';
`;

function stagingVerificationSql(copiedIds: string[]): string {
  const ids = copiedIds.map(sqlText).join(',');
  return `
SELECT COUNT(*) AS client_count,
       COALESCE(SUM(CASE
         WHEN name = '${EXPECTED_CUSTOMER_NAME}'
          AND status = 'active'
          AND COALESCE(stats, '{}') = '{}'
          AND insight_report IS NULL
          AND late_profile_id IS NULL
          AND COALESCE(late_connected_platforms, '[]') = '[]'
          AND COALESCE(late_account_ids, '{}') = '{}'
          AND COALESCE(social_tokens, '{}') = '{}'
          AND COALESCE(use_postproxy, 0) = 0
         THEN 1 ELSE 0 END), 0) AS safe_client_count
  FROM clients
 WHERE id = '${EXPECTED_CLIENT_ID}' AND user_id = '${EXPECTED_USER_ID}';
SELECT COUNT(*) AS copied_count,
       COALESCE(SUM(CASE
         WHEN status = 'Draft' AND scheduled_for IS NULL
          AND late_post_id IS NULL AND video_url IS NULL AND video_request_id IS NULL
          AND audio_mixed_url IS NULL AND claim_id IS NULL AND claim_at IS NULL
          AND fb_video_id IS NULL AND fb_publish_state IS NULL
          AND postproxy_post_id IS NULL AND postproxy_status IS NULL
          AND postproxy_permalink IS NULL AND postproxy_sent_at IS NULL
          AND postproxy_finished_at IS NULL AND COALESCE(publish_attempts, 0) = 0
          AND qa_feedback_target IS NULL AND qa_feedback_reason IS NULL
          AND qa_feedback_note IS NULL AND qa_feedback_at IS NULL
         THEN 1 ELSE 0 END), 0) AS safe_draft_count,
       COALESCE(SUM(CASE WHEN scheduled_for IS NOT NULL THEN 1 ELSE 0 END), 0)
         AS scheduled_count,
       COALESCE(SUM(CASE WHEN status != 'Draft' THEN 1 ELSE 0 END), 0)
         AS publishable_count
  FROM posts
 WHERE user_id = '${EXPECTED_USER_ID}' AND client_id = '${EXPECTED_CLIENT_ID}'
   AND id IN (${ids});
SELECT COUNT(*) AS enrollment_count
  FROM learning_pilot_enrollments
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${EXPECTED_CLIENT_ID}'
   AND client_id = '${EXPECTED_CLIENT_ID}' AND owner_kind = 'client'
   AND owner_id = '${EXPECTED_CLIENT_ID}' AND policy_version = '${POLICY_VERSION}'
   AND record_only = 1 AND consent_basis = 'customer_attested'
   AND consent_note = ${sqlText(EXPECTED_CONSENT_STATEMENT)};
SELECT COUNT(*) AS settings_count
  FROM workspace_learning_settings
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${EXPECTED_CLIENT_ID}'
   AND client_id = '${EXPECTED_CLIENT_ID}' AND owner_kind = 'client'
   AND owner_id = '${EXPECTED_CLIENT_ID}' AND mode = 'approval'
   AND autopublish_consent_at IS NULL AND autopublish_policy_version IS NULL
   AND experiment_rate = 0 AND monthly_ai_budget_usd_cents = ${DEFAULT_MONTHLY_BUDGET_CENTS}
   AND disabled_reason IS NULL;
SELECT COUNT(*) AS token_table_count FROM sqlite_master
 WHERE type = 'table' AND name = 'social_tokens';
SELECT COUNT(*) AS protected_count FROM workspace_learning_settings
 WHERE mode = 'protected_autopilot';
`;
}

function withdrawalVerificationSql(): string {
  return `
SELECT COUNT(*) AS count FROM clients
 WHERE id = '${EXPECTED_CLIENT_ID}' AND user_id = '${EXPECTED_USER_ID}';
SELECT COUNT(*) AS count FROM posts
 WHERE user_id = '${EXPECTED_USER_ID}' AND client_id = '${EXPECTED_CLIENT_ID}';
SELECT COUNT(*) AS count FROM learning_pilot_enrollments
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${EXPECTED_CLIENT_ID}';
SELECT COUNT(*) AS count FROM workspace_learning_settings
 WHERE user_id = '${EXPECTED_USER_ID}' AND workspace_key = '${EXPECTED_CLIENT_ID}';
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

function executeReadOnlyD1(database: string, sql: string, environment?: 'staging'): D1StatementResult[] {
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

export function assertStagingWriteProcess(result: {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error?: { message?: string } | null;
}): void {
  if (result.status === 0 && !result.error) return;
  const detail = [result.error?.message, result.stderr?.trim(), result.stdout?.trim()]
    .filter(Boolean)
    .join('; ') || `exit status ${String(result.status)}`;
  throw new Error(`Staging D1 write failed: ${detail}`);
}

function executeStagingSql(sql: string): void {
  const tempDirectory = mkdtempSync(resolve(tmpdir(), 'socialai-pilot-'));
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
  return Number.isFinite(value) ? value : -1;
}

function sourceSnapshot(): {
  rows: D1StatementResult[];
  client: SourceClient;
  drafts: SourceDraft[];
  hugheseysQueOnHold: boolean;
  hash: string;
} {
  const rows = executeReadOnlyD1(PRODUCTION_DATABASE, SOURCE_SQL);
  const [clientResult, draftsResult, holdResult] = rows;
  const clients = clientResult.results ?? [];
  if (clients.length !== 1) throw new Error('Production Gladstone client was not found exactly once');
  const client = clients[0] as unknown as SourceClient;
  if (
    client.id !== EXPECTED_CLIENT_ID
    || client.user_id !== EXPECTED_USER_ID
    || client.name !== EXPECTED_CUSTOMER_NAME
    || client.status?.trim().toLowerCase() !== 'active'
  ) {
    throw new Error('Production Gladstone identity or status changed');
  }
  const holdRows = holdResult.results ?? [];
  const hugheseysQueOnHold = holdRows.length === 1
    && String(holdRows[0].status ?? '').trim().toLowerCase() === 'on_hold';
  if (!hugheseysQueOnHold) throw new Error('Hugheseys Que is not proven on hold');
  const drafts = (draftsResult.results ?? []) as unknown as SourceDraft[];
  return {
    rows,
    client,
    drafts,
    hugheseysQueOnHold,
    hash: payloadHash({ client, drafts, hold: holdRows }),
  };
}

function assertStagingPreflight(): Record<string, number> {
  const rows = executeReadOnlyD1(STAGING_DATABASE, STAGING_PREFLIGHT_SQL, 'staging');
  const values = firstRows(rows).map((row) => count(row));
  const [
    adminUsers,
    conflictingClients,
    clientPosts,
    customerEnrollments,
    settings,
    tokenTables,
    protectedWorkspaces,
  ] = values;
  if (adminUsers !== 1) throw new Error('Staging admin identity is missing or ambiguous');
  if (conflictingClients !== 0) throw new Error('Staging contains a conflicting client or foreign owner');
  if (clientPosts !== 0) throw new Error('Staging already contains Gladstone post rows');
  if (customerEnrollments !== 0) throw new Error('The customer pilot slot is already occupied');
  if (settings !== 0) throw new Error('Staging already contains Gladstone learning settings');
  if (tokenTables !== 0) {
    throw new Error('Staging token storage changed; this copier requires a reviewed isolation check');
  }
  if (protectedWorkspaces !== 0) {
    throw new Error('Protected Autopilot is unexpectedly enabled in staging');
  }
  return {
    adminUsers,
    conflictingClients,
    clientPosts,
    customerEnrollments,
    settings,
    tokenTables,
    protectedWorkspaces,
  };
}

function verifyApplied(copiedIds: string[]): { scheduledRows: 0; publishableRows: 0 } {
  const rows = executeReadOnlyD1(
    STAGING_DATABASE,
    stagingVerificationSql(copiedIds),
    'staging',
  );
  const [client, drafts, enrollment, settings, tokenTables, protectedWorkspaces] = firstRows(rows);
  if (count(client, 'client_count') !== 1 || count(client, 'safe_client_count') !== 1) {
    throw new Error('Staging client safety verification failed');
  }
  if (count(drafts, 'copied_count') !== copiedIds.length
    || count(drafts, 'safe_draft_count') !== copiedIds.length) {
    throw new Error('Staging Draft safety verification failed');
  }
  if (count(enrollment, 'enrollment_count') !== 1) {
    throw new Error('Staging record-only enrollment verification failed');
  }
  if (count(settings, 'settings_count') !== 1) {
    throw new Error('Staging approval settings verification failed');
  }
  if (count(tokenTables, 'token_table_count') !== 0) {
    throw new Error('Staging token isolation assumptions changed');
  }
  if (count(protectedWorkspaces, 'protected_count') !== 0) {
    throw new Error('Protected Autopilot must remain disabled');
  }
  const scheduledRows = count(drafts, 'scheduled_count');
  const publishableRows = count(drafts, 'publishable_count');
  if (scheduledRows !== 0 || publishableRows !== 0) {
    throw new Error('Copied staging rows are schedulable or publishable');
  }
  return { scheduledRows: 0, publishableRows: 0 };
}

function verifyWithdrawn(): void {
  const rows = executeReadOnlyD1(STAGING_DATABASE, withdrawalVerificationSql(), 'staging');
  if (firstRows(rows).some((row) => count(row) !== 0)) {
    throw new Error('Withdrawal verification found residual Gladstone staging data');
  }
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function hasOption(name: string): boolean {
  return process.argv.includes(name);
}

function gitState(): { commit: string; clean: boolean } {
  const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  const statusResult = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (commitResult.status !== 0 || statusResult.status !== 0) {
    throw new Error('Unable to capture Git state for the staging copy receipt');
  }
  return { commit: commitResult.stdout.trim(), clean: statusResult.stdout.trim() === '' };
}

function readConsent(path: string): ConsentReceipt {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as ConsentReceipt;
  return validateConsentReceipt(raw);
}

function writeArtifact(artifact: CopyArtifact, outputDirectory: string): string {
  const artifactRoot = resolve('D:\\GitHubBackup\\SocialAi');
  const resolvedOutput = resolve(outputDirectory);
  const relativeOutput = relative(artifactRoot, resolvedOutput);
  if (relativeOutput.startsWith('..') || isAbsolute(relativeOutput)) {
    throw new Error('Pilot artifacts must remain under D:\\GitHubBackup\\SocialAi');
  }
  mkdirSync(resolvedOutput, { recursive: true });
  const timestamp = artifact.generatedAt.split(':').join('-').split('.').join('-');
  const path = resolve(resolvedOutput, `learning-pilot-staging-copy-${timestamp}.json`);
  const contents = `${JSON.stringify(artifact, null, 2)}\n`;
  writeFileSync(path, contents, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(`${path}.sha256`, `${sha256(contents)}  ${path}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return path;
}

function loadAppliedArtifact(path: string): CopyArtifact {
  const value = JSON.parse(readFileSync(path, 'utf8')) as CopyArtifact;
  if (value.schemaVersion !== 1 || value.action !== 'applied'
    || value.target.clientId !== EXPECTED_CLIENT_ID
    || value.target.database !== STAGING_DATABASE
    || value.target.copiedPostIds.length < 1) {
    throw new Error('Withdrawal requires a valid applied-copy artifact');
  }
  return value;
}

async function withdraw(consent: ConsentReceipt, outputDirectory: string): Promise<void> {
  if (!hasOption('--apply') || option('--confirm-withdraw') !== EXPECTED_CLIENT_ID) {
    throw new Error(`Withdrawal requires --apply --confirm-withdraw ${EXPECTED_CLIENT_ID}`);
  }
  const artifactPath = option('--artifact');
  if (!artifactPath) throw new Error('Withdrawal requires --artifact from the applied copy');
  const applied = loadAppliedArtifact(resolve(artifactPath));
  const withdrawnAt = new Date().toISOString();
  executeStagingSql(buildWithdrawalSql({
    consent,
    copiedPostIds: applied.target.copiedPostIds,
    withdrawnAt,
  }));
  verifyWithdrawn();
  const source = sourceSnapshot();
  const git = gitState();
  const artifact: CopyArtifact = {
    ...applied,
    action: 'withdrawn',
    generatedAt: withdrawnAt,
    gitCommit: git.commit,
    gitClean: git.clean,
    source: { ...applied.source, readOnly: true, sourceHash: source.hash },
    target: {
      ...applied.target,
      writesRequested: true,
      scheduledRows: 0,
      publishableRows: 0,
      verified: true,
    },
    productionRecheckHash: source.hash,
    notes: [...applied.notes, 'Consent withdrawn; scoped staging copy and derived data were deleted.'],
  };
  const receiptPath = writeArtifact(artifact, outputDirectory);
  process.stdout.write(`Withdrawal verified. Artifact: ${receiptPath}\n`);
}

async function main(): Promise<void> {
  const consentPath = resolve(option('--consent-file') ?? defaultConsentPath);
  const outputDirectory = resolve(option('--output-dir') ?? defaultArtifactDirectory);
  const consent = readConsent(consentPath);
  if (hasOption('--withdraw')) {
    await withdraw(consent, outputDirectory);
    return;
  }

  const sourceBefore = sourceSnapshot();
  const sanitized = sanitizeBusinessProfile(sourceBefore.client.profile ?? '{}');
  const selection = selectEligibleDrafts(sourceBefore.drafts, consent.scope.maxDrafts);
  if (selection.selected.length === 0) {
    throw new Error('No production Draft is safely eligible for the consented staging copy');
  }
  assertStagingPreflight();

  const apply = hasOption('--apply');
  if (apply && option('--confirm-client') !== EXPECTED_CLIENT_ID) {
    throw new Error(`Apply requires --confirm-client ${EXPECTED_CLIENT_ID}`);
  }
  const generatedAt = new Date().toISOString();
  const git = gitState();
  const copiedIds = selection.selected.map((row) => copiedPostId(row.id));
  let verification: { scheduledRows: 0; publishableRows: 0 } = {
    scheduledRows: 0,
    publishableRows: 0,
  };
  let sourceAfterHash: string | null = null;
  let action: CopyArtifact['action'] = 'dry_run';

  if (apply) {
    const sql = buildApplySql({
      consent,
      client: sourceBefore.client,
      sanitizedProfile: sanitized.profile,
      drafts: selection.selected,
      appliedAt: generatedAt,
      monthlyBudgetCents: DEFAULT_MONTHLY_BUDGET_CENTS,
    });
    try {
      executeStagingSql(sql);
      verification = verifyApplied(copiedIds);
      const sourceAfter = sourceSnapshot();
      sourceAfterHash = sourceAfter.hash;
      if (sourceAfter.hash !== sourceBefore.hash) {
        throw new Error('Production source changed during the staging copy; refusing the snapshot');
      }
      action = 'applied';
    } catch (error) {
      try {
        executeStagingSql(buildWithdrawalSql({
          consent,
          copiedPostIds: copiedIds,
          withdrawnAt: new Date().toISOString(),
        }));
        verifyWithdrawn();
      } catch (rollbackError) {
        throw new Error(
          `Staging copy failed and rollback could not be verified: ${String(error)}; rollback: ${String(rollbackError)}`,
        );
      }
      throw new Error(`Staging copy failed and was rolled back: ${String(error)}`);
    }
  }

  const artifact: CopyArtifact = {
    schemaVersion: 1,
    action,
    generatedAt,
    gitCommit: git.commit,
    gitClean: git.clean,
    consent: {
      receiptId: consent.receiptId,
      sha256: payloadHash(consent),
      statement: consent.statement,
      capturedAt: consent.capturedAt,
      withdrawalAllowed: consent.withdrawal.allowed,
    },
    source: {
      environment: 'production',
      database: PRODUCTION_DATABASE,
      readOnly: sourceBefore.rows.every((row) => row.meta?.changed_db === false
        && row.meta?.rows_written === 0),
      clientId: EXPECTED_CLIENT_ID,
      sourceHash: sourceBefore.hash,
      profileKeysCopied: Object.keys(sanitized.profile),
      profileKeysDropped: sanitized.droppedKeys,
      eligibleDrafts: selection.selected.map((row) => ({
        sourceId: row.id,
        copiedId: copiedPostId(row.id),
        contentSha256: sha256(row.content),
        mediaSha256: row.image_url ? sha256(row.image_url) : null,
        sourceScheduleCleared: Boolean(row.scheduled_for),
      })),
      excludedDrafts: selection.excluded,
      hugheseysQueOnHold: sourceBefore.hugheseysQueOnHold,
    },
    target: {
      environment: 'staging',
      database: STAGING_DATABASE,
      writesRequested: apply,
      clientId: EXPECTED_CLIENT_ID,
      recordOnly: true,
      mode: 'approval',
      experimentRate: 0,
      autopublishConsentAt: null,
      scheduledRows: verification.scheduledRows,
      publishableRows: verification.publishableRows,
      copiedPostIds: copiedIds,
      verified: apply,
    },
    productionRecheckHash: sourceAfterHash,
    notes: [
      apply
        ? 'Copied only eligible unpublished Draft data into isolated staging.'
        : 'Dry run only; no database writes were requested.',
      'Legacy source schedules were not copied.',
      'No tokens, stats, insights, provider IDs, claims, QA state, or publish metadata were copied.',
      'Exact-post attestation remains separate and has not been inferred from broad copy consent.',
    ],
  };
  const artifactPath = writeArtifact(artifact, outputDirectory);
  process.stdout.write([
    `Action: ${action}`,
    `Eligible Drafts: ${selection.selected.length}`,
    `Excluded Drafts: ${selection.excluded.length}`,
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
