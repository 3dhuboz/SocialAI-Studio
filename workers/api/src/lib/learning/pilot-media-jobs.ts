import type { Env } from '../../env';
import { logAiUsage } from '../ai-usage';
import { generateImageWithGuardrails } from '../image-gen';
import { buildSafeImagePrompt } from '../image-safety';
import type { CriticContext } from './critic-context';
import {
  generateRecordOnlyPilotDraft,
  type GeneratedPilotDraft,
} from './pilot-draft-generator';
import {
  buildReleaseContentHash,
  type PublishablePost,
} from './release-preflight';
import type { WorkspaceIdentity } from './types';

export const PILOT_MEDIA_MAX_SLOTS = 6;
const IMAGE_LEASE_MS = 5 * 60 * 1000;
const VIDEO_LEASE_MS = 15 * 60 * 1000;
const KLING_STANDARD_VIDEO_COST_USD = 0.30;
const KLING_STANDARD_VIDEO_MODEL =
  'fal-ai/kling-video/v1.6/standard/image-to-video' as const;
const SECRET_QUERY_KEY = /(?:api.?key|token|secret|password|credential|private.?key|auth)/i;

export type PilotMediaKind = 'image' | 'video';
export type PilotMediaJobState = 'claimed' | 'generating' | 'ready' | 'failed';

export interface PilotMediaEnrollment {
  id: string;
  policyVersion: string;
}

export interface PilotMediaJobRow {
  id: string;
  enrollment_id: string;
  slot: number | string;
  user_id: string;
  workspace_key: string;
  client_id: string | null;
  owner_kind: 'user' | 'client';
  owner_id: string;
  policy_version: string;
  media_kind: PilotMediaKind;
  state: PilotMediaJobState;
  attempt_count: number | string;
  claim_token_hash: string;
  lease_expires_at: string;
  post_id: string | null;
  content: string | null;
  hashtags: string | null;
  image_prompt: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  content_hash: string | null;
  caption_provider: string | null;
  caption_model: string | null;
  caption_attempt_count: number | string | null;
  archetype_slug: string | null;
  media_provider: string | null;
  media_model: string | null;
  provider_request_id: string | null;
  video_script: string | null;
  video_shots: string | null;
  error_code: string | null;
  generated_by: string;
  claimed_at: string;
  updated_at: string;
  completed_at: string | null;
  record_only: number | string;
}

export interface PublicPilotMediaJob {
  id: string;
  enrollmentId: string;
  slot: number;
  mediaKind: PilotMediaKind;
  state: PilotMediaJobState;
  attemptCount: number;
  postId: string | null;
  content: string | null;
  hashtags: string[];
  imagePrompt: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  contentHash: string | null;
  captionProvider: string | null;
  captionModel: string | null;
  mediaProvider: string | null;
  mediaModel: string | null;
  errorCode: string | null;
  generatedAt: string;
  completedAt: string | null;
  recordOnly: true;
  sourceStatus: 'Draft' | null;
  scheduledFor: null;
  publishingAllowed: false;
}

interface ClaimedPilotMediaJob {
  job: PilotMediaJobRow;
  claimed: boolean;
  claimTokenHash: string | null;
}

interface VideoStartResult {
  requestId: string;
  provider: 'fal';
  model: typeof KLING_STANDARD_VIDEO_MODEL;
}

interface VideoPollResult {
  state: 'pending' | 'ready' | 'failed';
  videoUrl?: string;
  errorCode?: string;
}

export interface PilotMediaJobDeps {
  generateDraft: typeof generateRecordOnlyPilotDraft;
  generateImage: typeof generateImageWithGuardrails;
  startVideo(
    env: Env,
    input: {
      postId: string;
      userId: string;
      clientId: string | null;
      thumbnailUrl: string;
      prompt: string;
    },
  ): Promise<VideoStartResult>;
  pollVideo(
    env: Env,
    input: {
      postId: string;
      userId: string;
      clientId: string | null;
      requestId: string;
      model: string;
    },
  ): Promise<VideoPollResult>;
  now(): Date;
  randomUuid(): string;
}

function finiteCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

function parsedHashtags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function boundedErrorCode(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return normalized.length >= 3 ? normalized : 'provider_failure';
}

function profileBusinessType(context: CriticContext): string | null {
  for (const key of ['businessType', 'business_type', 'type', 'industry']) {
    const value = context.profile[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > PILOT_MEDIA_MAX_SLOTS) {
    throw new Error(`Pilot media slot must be between 1 and ${PILOT_MEDIA_MAX_SLOTS}`);
  }
}

function assertSafeHttpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${label} must be a credential-free HTTPS URL`);
  }
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY_KEY.test(key)) {
      throw new Error(`${label} contains a secret-shaped query parameter`);
    }
  }
  return url.toString();
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isoAfter(now: Date, milliseconds: number): string {
  return new Date(now.getTime() + milliseconds).toISOString();
}

export function buildPilotVideoQueueUrl(
  requestId: string,
  target: 'status' | 'result',
): string {
  const scopedRequestId = requestId.trim();
  if (!scopedRequestId || scopedRequestId.length > 500) {
    throw new Error('video_provider_request_id_invalid');
  }
  const suffix = target === 'status' ? '/status' : '';
  return `https://queue.fal.run/${KLING_STANDARD_VIDEO_MODEL}/requests/${
    encodeURIComponent(scopedRequestId)
  }${suffix}`;
}

function videoManifest(draft: GeneratedPilotDraft): {
  script: string;
  shots: string;
} {
  const script = [
    'Five-second vertical social video.',
    draft.imagePrompt,
    'Use one slow natural push-in with subtle environmental motion.',
    'Keep the subject physically accurate and consistent.',
    'No people, faces, hands, logos, readable text, object morphing, or unrelated props.',
  ].join(' ');
  return {
    script: script.slice(0, 2000),
    shots: JSON.stringify([script.slice(0, 1000)]),
  };
}

async function readJson(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : {};
  } catch {
    return {};
  }
}

async function defaultStartVideo(
  env: Env,
  input: {
    postId: string;
    userId: string;
    clientId: string | null;
    thumbnailUrl: string;
    prompt: string;
  },
): Promise<VideoStartResult> {
  if (!env.FAL_API_KEY) throw new Error('staging_fal_secret_missing');
  const response = await fetch(
    `https://queue.fal.run/${KLING_STANDARD_VIDEO_MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Key ${env.FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: input.prompt,
        image_url: input.thumbnailUrl,
        duration: '5',
        aspect_ratio: '9:16',
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const data = await readJson(response);
  const requestId = typeof data.request_id === 'string' ? data.request_id.trim() : '';
  await logAiUsage(env, {
    userId: input.userId,
    clientId: input.clientId,
    provider: 'fal',
    model: KLING_STANDARD_VIDEO_MODEL,
    operation: 'learning_pilot_media_video_start',
    imagesGenerated: 0,
    estCostUsd: response.ok && requestId ? KLING_STANDARD_VIDEO_COST_USD : 0,
    postId: input.postId,
    ok: response.ok && Boolean(requestId),
  });
  if (!response.ok || !requestId) {
    throw new Error('video_provider_start_failed');
  }
  return {
    requestId,
    provider: 'fal',
    model: KLING_STANDARD_VIDEO_MODEL,
  };
}

async function defaultPollVideo(
  env: Env,
  input: {
    postId: string;
    userId: string;
    clientId: string | null;
    requestId: string;
    model: string;
  },
): Promise<VideoPollResult> {
  if (!env.FAL_API_KEY) throw new Error('staging_fal_secret_missing');
  if (input.model !== KLING_STANDARD_VIDEO_MODEL) {
    throw new Error('video_provider_model_mismatch');
  }
  const headers = { Authorization: `Key ${env.FAL_API_KEY}` };
  const statusResponse = await fetch(
    buildPilotVideoQueueUrl(input.requestId, 'status'),
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  const statusData = await readJson(statusResponse);
  if (!statusResponse.ok) throw new Error('video_provider_status_failed');
  const status = String(statusData.status ?? '').trim().toUpperCase();
  if (status === 'FAILED') {
    return { state: 'failed', errorCode: 'video_provider_reported_failed' };
  }
  if (!['COMPLETED', 'SUCCEEDED'].includes(status)) {
    return { state: 'pending' };
  }

  const resultResponse = await fetch(
    buildPilotVideoQueueUrl(input.requestId, 'result'),
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  const resultData = await readJson(resultResponse);
  const rawUrl = resultData?.video?.url ?? resultData?.output?.video?.url;
  const videoUrl = typeof rawUrl === 'string' && rawUrl.trim()
    ? assertSafeHttpsUrl(rawUrl.trim(), 'Video result URL')
    : '';
  await logAiUsage(env, {
    userId: input.userId,
    clientId: input.clientId,
    provider: 'fal',
    model: 'kling-video',
    operation: 'learning_pilot_media_video_result',
    imagesGenerated: 0,
    estCostUsd: 0,
    postId: input.postId,
    ok: resultResponse.ok && Boolean(videoUrl),
  });
  if (!resultResponse.ok || !videoUrl) {
    return { state: 'failed', errorCode: 'video_provider_result_missing' };
  }
  return { state: 'ready', videoUrl };
}

const defaultDeps: PilotMediaJobDeps = {
  generateDraft: generateRecordOnlyPilotDraft,
  generateImage: generateImageWithGuardrails,
  startVideo: defaultStartVideo,
  pollVideo: defaultPollVideo,
  now: () => new Date(),
  randomUuid: () => crypto.randomUUID(),
};

export function publicPilotMediaJob(row: PilotMediaJobRow): PublicPilotMediaJob {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    slot: finiteCount(row.slot),
    mediaKind: row.media_kind,
    state: row.state,
    attemptCount: finiteCount(row.attempt_count),
    postId: row.post_id,
    content: row.content,
    hashtags: parsedHashtags(row.hashtags),
    imagePrompt: row.image_prompt,
    thumbnailUrl: row.thumbnail_url,
    mediaUrl: row.media_url,
    contentHash: row.content_hash,
    captionProvider: row.caption_provider,
    captionModel: row.caption_model,
    mediaProvider: row.media_provider,
    mediaModel: row.media_model,
    errorCode: row.error_code,
    generatedAt: row.claimed_at,
    completedAt: row.completed_at,
    recordOnly: true,
    sourceStatus: row.state === 'ready' ? 'Draft' : null,
    scheduledFor: null,
    publishingAllowed: false,
  };
}

export function loadPilotMediaJob(
  db: D1Database,
  identity: WorkspaceIdentity,
  enrollmentId: string,
  slot: number,
): Promise<PilotMediaJobRow | null> {
  return db.prepare(`
    SELECT
      id,enrollment_id,slot,user_id,workspace_key,client_id,owner_kind,owner_id,
      policy_version,media_kind,state,attempt_count,claim_token_hash,
      lease_expires_at,post_id,content,hashtags,image_prompt,thumbnail_url,
      media_url,content_hash,caption_provider,caption_model,
      caption_attempt_count,archetype_slug,media_provider,media_model,provider_request_id,
      video_script,video_shots,error_code,generated_by,claimed_at,updated_at,
      completed_at,record_only
    FROM learning_pilot_media_jobs
    WHERE enrollment_id = ?
      AND slot = ?
      AND user_id = ?
      AND workspace_key = ?
      AND client_id IS ?
      AND owner_kind = ?
      AND owner_id = ?
      AND record_only = 1
    LIMIT 1
  `).bind(
    enrollmentId,
    slot,
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
  ).first<PilotMediaJobRow>();
}

export async function listPilotMediaJobs(
  db: D1Database,
  userId: string,
): Promise<PublicPilotMediaJob[]> {
  const result = await db.prepare(`
    SELECT
      job.id,job.enrollment_id,job.slot,job.user_id,job.workspace_key,
      job.client_id,job.owner_kind,job.owner_id,job.policy_version,
      job.media_kind,job.state,job.attempt_count,job.claim_token_hash,
      job.lease_expires_at,job.post_id,job.content,job.hashtags,
      job.image_prompt,job.thumbnail_url,job.media_url,job.content_hash,
      job.caption_provider,job.caption_model,job.caption_attempt_count,
      job.archetype_slug,job.media_provider,job.media_model,job.provider_request_id,
      job.video_script,job.video_shots,job.error_code,job.generated_by,
      job.claimed_at,job.updated_at,job.completed_at,job.record_only
    FROM learning_pilot_media_jobs job
    INNER JOIN learning_pilot_enrollments enrollment
      ON enrollment.id = job.enrollment_id
     AND enrollment.user_id = job.user_id
     AND enrollment.workspace_key = job.workspace_key
     AND enrollment.client_id IS job.client_id
     AND enrollment.owner_kind = job.owner_kind
     AND enrollment.owner_id = job.owner_id
     AND enrollment.record_only = 1
    WHERE job.user_id = ?
      AND job.record_only = 1
    ORDER BY job.workspace_key ASC, job.slot ASC
    LIMIT 12
  `).bind(userId).all<PilotMediaJobRow>();
  return (result.results ?? []).map(publicPilotMediaJob);
}

async function claimPilotMediaJob(
  env: Env,
  input: {
    identity: WorkspaceIdentity;
    enrollment: PilotMediaEnrollment;
    adminId: string;
    slot: number;
    mediaKind: PilotMediaKind;
  },
  deps: PilotMediaJobDeps,
): Promise<ClaimedPilotMediaJob> {
  assertSlot(input.slot);
  const now = deps.now();
  const nowIso = now.toISOString();
  const leaseMs = input.mediaKind === 'video' ? VIDEO_LEASE_MS : IMAGE_LEASE_MS;
  const leaseExpiresAt = isoAfter(now, leaseMs);
  const claimTokenHash = await sha256(deps.randomUuid());
  const jobId = `pilot-media-job-${deps.randomUuid()}`;

  await env.DB.prepare(`
    INSERT OR IGNORE INTO learning_pilot_media_jobs (
      id,enrollment_id,slot,user_id,workspace_key,client_id,owner_kind,owner_id,
      policy_version,media_kind,state,attempt_count,claim_token_hash,
      lease_expires_at,generated_by,claimed_at,updated_at,record_only
    )
    SELECT
      ?,enrollment.id,?,enrollment.user_id,enrollment.workspace_key,
      enrollment.client_id,enrollment.owner_kind,enrollment.owner_id,
      enrollment.policy_version,?,'claimed',1,?,?,?, ?,?,1
    FROM learning_pilot_enrollments enrollment
    INNER JOIN workspace_learning_settings settings
      ON settings.user_id = enrollment.user_id
     AND settings.workspace_key = enrollment.workspace_key
     AND settings.client_id IS enrollment.client_id
     AND settings.owner_kind = enrollment.owner_kind
     AND settings.owner_id = enrollment.owner_id
     AND settings.mode = 'approval'
     AND settings.autopublish_consent_at IS NULL
     AND settings.autopublish_policy_version IS NULL
     AND settings.experiment_rate = 0
     AND settings.monthly_ai_budget_usd_cents > 0
     AND NULLIF(TRIM(COALESCE(settings.disabled_reason, '')), '') IS NULL
    LEFT JOIN clients client
      ON client.id = enrollment.client_id
     AND client.user_id = enrollment.user_id
    WHERE enrollment.id = ?
      AND enrollment.user_id = ?
      AND enrollment.workspace_key = ?
      AND enrollment.client_id IS ?
      AND enrollment.owner_kind = ?
      AND enrollment.owner_id = ?
      AND enrollment.policy_version = ?
      AND enrollment.record_only = 1
      AND enrollment.consent_confirmed_at IS NOT NULL
      AND unixepoch(enrollment.consent_confirmed_at) <= unixepoch(?)
      AND (
        enrollment.owner_kind = 'user'
        OR (
          enrollment.owner_kind = 'client'
          AND enrollment.consent_basis = 'customer_attested'
          AND NULLIF(TRIM(COALESCE(enrollment.consent_note, '')), '') IS NOT NULL
          AND client.id IS NOT NULL
          AND COALESCE(LOWER(TRIM(client.status)), 'active') <> 'on_hold'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM learning_pilot_media_jobs active
        WHERE active.user_id = enrollment.user_id
          AND active.workspace_key = enrollment.workspace_key
          AND active.client_id IS enrollment.client_id
          AND active.owner_kind = enrollment.owner_kind
          AND active.owner_id = enrollment.owner_id
          AND active.record_only = 1
          AND (
            active.state = 'generating'
            OR (
              active.state = 'claimed'
              AND unixepoch(active.lease_expires_at) > unixepoch(?)
            )
          )
      )
  `).bind(
    jobId,
    input.slot,
    input.mediaKind,
    claimTokenHash,
    leaseExpiresAt,
    input.adminId,
    nowIso,
    nowIso,
    input.enrollment.id,
    input.identity.userId,
    input.identity.workspaceKey,
    input.identity.clientId,
    input.identity.ownerKind,
    input.identity.ownerId,
    input.enrollment.policyVersion,
    nowIso,
    nowIso,
  ).run();

  let job = await loadPilotMediaJob(
    env.DB,
    input.identity,
    input.enrollment.id,
    input.slot,
  );
  if (!job) {
    const active = await env.DB.prepare(`
      SELECT id
      FROM learning_pilot_media_jobs
      WHERE user_id = ?
        AND workspace_key = ?
        AND client_id IS ?
        AND owner_kind = ?
        AND owner_id = ?
        AND record_only = 1
        AND (
          state = 'generating'
          OR (
            state = 'claimed'
            AND unixepoch(lease_expires_at) > unixepoch(?)
          )
        )
      LIMIT 1
    `).bind(
      input.identity.userId,
      input.identity.workspaceKey,
      input.identity.clientId,
      input.identity.ownerKind,
      input.identity.ownerId,
      nowIso,
    ).first<{ id: string }>();
    if (active) throw new Error('pilot_media_generation_in_progress');
    throw new Error('pilot_media_claim_not_authorized');
  }
  if (job.media_kind !== input.mediaKind) {
    throw new Error('pilot_media_slot_kind_conflict');
  }
  if (job.state === 'ready' || job.state === 'generating') {
    return { job, claimed: false, claimTokenHash: null };
  }
  if (
    job.state === 'claimed'
    && job.claim_token_hash === claimTokenHash
  ) {
    return { job, claimed: true, claimTokenHash };
  }

  const leaseExpired = Number.isFinite(Date.parse(job.lease_expires_at))
    && Date.parse(job.lease_expires_at) <= now.getTime();
  if (
    finiteCount(job.attempt_count) === 1
    && leaseExpired
    && (job.state === 'claimed' || job.state === 'failed')
  ) {
    await env.DB.prepare(`
      UPDATE learning_pilot_media_jobs SET
        state = 'claimed',
        attempt_count = 2,
        claim_token_hash = ?,
        lease_expires_at = ?,
        post_id = NULL,
        content = NULL,
        hashtags = NULL,
        image_prompt = NULL,
        thumbnail_url = NULL,
        media_url = NULL,
        content_hash = NULL,
        caption_provider = NULL,
        caption_model = NULL,
        caption_attempt_count = NULL,
        archetype_slug = NULL,
        media_provider = NULL,
        media_model = NULL,
        provider_request_id = NULL,
        video_script = NULL,
        video_shots = NULL,
        error_code = NULL,
        claimed_at = ?,
        updated_at = ?,
        completed_at = NULL
      WHERE id = ?
        AND enrollment_id = ?
        AND user_id = ?
        AND workspace_key = ?
        AND client_id IS ?
        AND owner_kind = ?
        AND owner_id = ?
        AND media_kind = ?
        AND attempt_count = 1
        AND state IN ('claimed','failed')
        AND claim_token_hash = ?
        AND unixepoch(lease_expires_at) <= unixepoch(?)
    `).bind(
      claimTokenHash,
      leaseExpiresAt,
      nowIso,
      nowIso,
      job.id,
      input.enrollment.id,
      input.identity.userId,
      input.identity.workspaceKey,
      input.identity.clientId,
      input.identity.ownerKind,
      input.identity.ownerId,
      input.mediaKind,
      job.claim_token_hash,
      nowIso,
    ).run();
    job = await loadPilotMediaJob(
      env.DB,
      input.identity,
      input.enrollment.id,
      input.slot,
    );
    if (!job) throw new Error('pilot_media_claim_disappeared');
    if (
      job.state === 'claimed'
      && finiteCount(job.attempt_count) === 2
      && job.claim_token_hash === claimTokenHash
    ) {
      return { job, claimed: true, claimTokenHash };
    }
  }

  return { job, claimed: false, claimTokenHash: null };
}

async function markPilotMediaJobFailed(
  env: Env,
  job: PilotMediaJobRow,
  claimTokenHash: string,
  error: unknown,
  now: Date,
): Promise<PilotMediaJobRow> {
  const errorCode = boundedErrorCode(
    error instanceof Error ? error.message : String(error),
  );
  const nowIso = now.toISOString();
  await env.DB.prepare(`
    UPDATE learning_pilot_media_jobs SET
      state = 'failed',
      post_id = NULL,
      media_url = NULL,
      content_hash = NULL,
      error_code = ?,
      completed_at = ?,
      updated_at = ?
    WHERE id = ?
      AND enrollment_id = ?
      AND state IN ('claimed','generating')
      AND claim_token_hash = ?
      AND record_only = 1
  `).bind(
    errorCode,
    nowIso,
    nowIso,
    job.id,
    job.enrollment_id,
    claimTokenHash,
  ).run();
  const failed = await env.DB.prepare(`
    SELECT *
    FROM learning_pilot_media_jobs
    WHERE id = ? AND enrollment_id = ? AND record_only = 1
    LIMIT 1
  `).bind(job.id, job.enrollment_id).first<PilotMediaJobRow>();
  if (!failed) throw new Error('pilot_media_failure_receipt_missing');
  return failed;
}

async function finalizeReadyPilotMediaJob(
  env: Env,
  input: {
    identity: WorkspaceIdentity;
    job: PilotMediaJobRow;
    claimTokenHash: string;
    postId: string;
    draft: GeneratedPilotDraft;
    thumbnailUrl: string;
    mediaUrl: string;
    mediaProvider: string;
    mediaModel: string;
    providerRequestId: string | null;
    videoScript: string | null;
    videoShots: string | null;
    archetypeSlug: string | null;
    now: Date;
  },
): Promise<PilotMediaJobRow> {
  const hashtags = JSON.stringify(input.draft.hashtags);
  const post: PublishablePost = {
    id: input.postId,
    user_id: input.identity.userId,
    client_id: input.identity.clientId,
    owner_kind: input.identity.ownerKind,
    owner_id: input.identity.ownerId,
    content: input.draft.content,
    platform: 'facebook',
    hashtags,
    image_url: input.thumbnailUrl,
    post_type: input.job.media_kind,
    video_url: input.job.media_kind === 'video' ? input.mediaUrl : null,
    video_status: input.job.media_kind === 'video' ? 'ready' : null,
    video_script: input.videoScript,
    video_shots: input.videoShots,
    archetype_slug: input.archetypeSlug,
  };
  const contentHash = await buildReleaseContentHash(post);
  const nowIso = input.now.toISOString();
  const reasoning = JSON.stringify({
    source: 'learning_pilot_media_job',
    jobId: input.job.id,
    slot: finiteCount(input.job.slot),
    policyVersion: input.job.policy_version,
    recordOnly: true,
  });

  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO posts (
        id,user_id,client_id,owner_kind,owner_id,content,platform,status,
        scheduled_for,hashtags,image_url,topic,pillar,image_prompt,reasoning,
        post_type,video_url,video_status,video_script,video_shots,
        video_request_id,publish_attempts
      )
      SELECT
        ?,job.user_id,job.client_id,job.owner_kind,job.owner_id,
        ?,'facebook','Draft',NULL,?,?,NULL,NULL,?,?,
        ?,?,?,?, ?,NULL,0
      FROM learning_pilot_media_jobs job
      INNER JOIN learning_pilot_enrollments enrollment
        ON enrollment.id = job.enrollment_id
       AND enrollment.user_id = job.user_id
       AND enrollment.workspace_key = job.workspace_key
       AND enrollment.client_id IS job.client_id
       AND enrollment.owner_kind = job.owner_kind
       AND enrollment.owner_id = job.owner_id
       AND enrollment.policy_version = job.policy_version
       AND enrollment.record_only = 1
      WHERE job.id = ?
        AND job.enrollment_id = ?
        AND job.user_id = ?
        AND job.workspace_key = ?
        AND job.client_id IS ?
        AND job.owner_kind = ?
        AND job.owner_id = ?
        AND job.media_kind = ?
        AND job.state IN ('claimed','generating')
        AND job.claim_token_hash = ?
        AND job.post_id IS NULL
        AND job.record_only = 1
        AND NOT EXISTS (
          SELECT 1
          FROM publication_events event
          WHERE event.post_id = ?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM publish_delivery_receipts delivery
          WHERE delivery.post_id = ?
        )
    `).bind(
      input.postId,
      input.draft.content,
      hashtags,
      input.thumbnailUrl,
      input.draft.imagePrompt,
      reasoning,
      input.job.media_kind,
      input.job.media_kind === 'video' ? input.mediaUrl : null,
      input.job.media_kind === 'video' ? 'ready' : null,
      input.videoScript,
      input.videoShots,
      input.job.id,
      input.job.enrollment_id,
      input.identity.userId,
      input.identity.workspaceKey,
      input.identity.clientId,
      input.identity.ownerKind,
      input.identity.ownerId,
      input.job.media_kind,
      input.claimTokenHash,
      input.postId,
      input.postId,
    ),
    env.DB.prepare(`
      UPDATE learning_pilot_media_jobs SET
        state = 'ready',
        post_id = ?,
        content = ?,
        hashtags = ?,
        image_prompt = ?,
        thumbnail_url = ?,
        media_url = ?,
        content_hash = ?,
        caption_provider = ?,
        caption_model = ?,
        caption_attempt_count = ?,
        archetype_slug = ?,
        media_provider = ?,
        media_model = ?,
        provider_request_id = ?,
        video_script = ?,
        video_shots = ?,
        error_code = NULL,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
        AND enrollment_id = ?
        AND user_id = ?
        AND workspace_key = ?
        AND client_id IS ?
        AND owner_kind = ?
        AND owner_id = ?
        AND media_kind = ?
        AND state IN ('claimed','generating')
        AND claim_token_hash = ?
        AND post_id IS NULL
        AND record_only = 1
    `).bind(
      input.postId,
      input.draft.content,
      hashtags,
      input.draft.imagePrompt,
      input.thumbnailUrl,
      input.mediaUrl,
      contentHash,
      input.draft.provider,
      input.draft.model,
      input.draft.attemptCount,
      input.archetypeSlug,
      input.mediaProvider,
      input.mediaModel,
      input.providerRequestId,
      input.videoScript,
      input.videoShots,
      nowIso,
      nowIso,
      input.job.id,
      input.job.enrollment_id,
      input.identity.userId,
      input.identity.workspaceKey,
      input.identity.clientId,
      input.identity.ownerKind,
      input.identity.ownerId,
      input.job.media_kind,
      input.claimTokenHash,
    ),
  ]);

  const ready = await loadPilotMediaJob(
    env.DB,
    input.identity,
    input.job.enrollment_id,
    finiteCount(input.job.slot),
  );
  if (
    !ready
    || ready.state !== 'ready'
    || ready.post_id !== input.postId
    || ready.content_hash !== contentHash
  ) {
    throw new Error('pilot_media_ready_receipt_missing');
  }
  return ready;
}

export async function startRecordOnlyPilotMediaJob(
  env: Env,
  input: {
    identity: WorkspaceIdentity;
    enrollment: PilotMediaEnrollment;
    context: CriticContext;
    adminId: string;
    slot: number;
    mediaKind: PilotMediaKind;
  },
  deps: PilotMediaJobDeps = defaultDeps,
): Promise<PublicPilotMediaJob> {
  if (!env.FAL_API_KEY) throw new Error('staging_fal_secret_missing');
  const claim = await claimPilotMediaJob(env, input, deps);
  if (!claim.claimed || !claim.claimTokenHash) {
    return publicPilotMediaJob(claim.job);
  }

  const postId = `pilot-media-${claim.job.id}`;
  try {
    const draft = await deps.generateDraft(
      env,
      input.identity,
      input.context,
      postId,
    );
    const safePrompt = buildSafeImagePrompt(
      draft.imagePrompt,
      draft.content,
      profileBusinessType(input.context),
    );
    if (!safePrompt) throw new Error('pilot_media_prompt_rejected');
    const image = await deps.generateImage(
      env,
      input.identity.userId,
      input.identity.clientId,
      safePrompt,
      {
        caption: draft.content,
        seedHint: postId,
        postId,
        usageOperation: 'learning_pilot_media_image',
      },
    );
    if (!image.imageUrl) throw new Error('pilot_media_image_missing');
    const thumbnailUrl = assertSafeHttpsUrl(
      image.imageUrl,
      'Generated pilot image URL',
    );

    if (input.mediaKind === 'image') {
      const ready = await finalizeReadyPilotMediaJob(env, {
        identity: input.identity,
        job: claim.job,
        claimTokenHash: claim.claimTokenHash,
        postId,
        draft,
        thumbnailUrl,
        mediaUrl: thumbnailUrl,
        mediaProvider: 'fal',
        mediaModel: image.modelUsed,
        providerRequestId: null,
        videoScript: null,
        videoShots: null,
        archetypeSlug: image.archetypeSlug,
        now: deps.now(),
      });
      return publicPilotMediaJob(ready);
    }

    const manifest = videoManifest(draft);
    const videoStart = await deps.startVideo(env, {
      postId,
      userId: input.identity.userId,
      clientId: input.identity.clientId,
      thumbnailUrl,
      prompt: manifest.script,
    });
    const nowIso = deps.now().toISOString();
    await env.DB.prepare(`
      UPDATE learning_pilot_media_jobs SET
        state = 'generating',
        content = ?,
        hashtags = ?,
        image_prompt = ?,
        thumbnail_url = ?,
        caption_provider = ?,
        caption_model = ?,
        caption_attempt_count = ?,
        archetype_slug = ?,
        media_provider = ?,
        media_model = ?,
        provider_request_id = ?,
        video_script = ?,
        video_shots = ?,
        updated_at = ?
      WHERE id = ?
        AND enrollment_id = ?
        AND state = 'claimed'
        AND claim_token_hash = ?
        AND record_only = 1
    `).bind(
      draft.content,
      JSON.stringify(draft.hashtags),
      draft.imagePrompt,
      thumbnailUrl,
      draft.provider,
      draft.model,
      draft.attemptCount,
      image.archetypeSlug,
      videoStart.provider,
      videoStart.model,
      videoStart.requestId,
      manifest.script,
      manifest.shots,
      nowIso,
      claim.job.id,
      claim.job.enrollment_id,
      claim.claimTokenHash,
    ).run();
    const generating = await loadPilotMediaJob(
      env.DB,
      input.identity,
      claim.job.enrollment_id,
      input.slot,
    );
    if (
      !generating
      || generating.state !== 'generating'
      || generating.claim_token_hash !== claim.claimTokenHash
    ) {
      throw new Error('pilot_media_video_request_receipt_missing');
    }
    return publicPilotMediaJob(generating);
  } catch (error) {
    const failed = await markPilotMediaJobFailed(
      env,
      claim.job,
      claim.claimTokenHash,
      error,
      deps.now(),
    );
    return publicPilotMediaJob(failed);
  }
}

export async function pollRecordOnlyPilotVideoJob(
  env: Env,
  input: {
    identity: WorkspaceIdentity;
    enrollment: PilotMediaEnrollment;
    slot: number;
  },
  deps: PilotMediaJobDeps = defaultDeps,
): Promise<PublicPilotMediaJob> {
  assertSlot(input.slot);
  if (!env.FAL_API_KEY) throw new Error('staging_fal_secret_missing');
  const job = await loadPilotMediaJob(
    env.DB,
    input.identity,
    input.enrollment.id,
    input.slot,
  );
  if (!job) throw new Error('pilot_media_job_not_found');
  if (job.media_kind !== 'video') throw new Error('pilot_media_job_not_video');
  if (job.state !== 'generating') return publicPilotMediaJob(job);
  if (
    !job.provider_request_id
    || !job.content
    || !job.hashtags
    || !job.image_prompt
    || !job.thumbnail_url
    || !job.caption_provider
    || !job.caption_model
    || !job.caption_attempt_count
    || !job.media_provider
    || !job.media_model
    || !job.video_script
    || !job.video_shots
  ) {
    const failed = await markPilotMediaJobFailed(
      env,
      job,
      job.claim_token_hash,
      'pilot_media_video_manifest_incomplete',
      deps.now(),
    );
    return publicPilotMediaJob(failed);
  }
  if (Date.parse(job.lease_expires_at) <= deps.now().getTime()) {
    const failed = await markPilotMediaJobFailed(
      env,
      job,
      job.claim_token_hash,
      'pilot_media_video_timed_out',
      deps.now(),
    );
    return publicPilotMediaJob(failed);
  }

  let result: VideoPollResult;
  try {
    result = await deps.pollVideo(env, {
      postId: `pilot-media-${job.id}`,
      userId: input.identity.userId,
      clientId: input.identity.clientId,
      requestId: job.provider_request_id,
      model: job.media_model,
    });
  } catch {
    return publicPilotMediaJob(job);
  }
  if (result.state === 'pending') return publicPilotMediaJob(job);
  if (result.state === 'failed' || !result.videoUrl) {
    const failed = await markPilotMediaJobFailed(
      env,
      job,
      job.claim_token_hash,
      result.errorCode ?? 'pilot_media_video_failed',
      deps.now(),
    );
    return publicPilotMediaJob(failed);
  }

  try {
    const videoUrl = assertSafeHttpsUrl(result.videoUrl, 'Generated pilot video URL');
    const ready = await finalizeReadyPilotMediaJob(env, {
      identity: input.identity,
      job,
      claimTokenHash: job.claim_token_hash,
      postId: `pilot-media-${job.id}`,
      draft: {
        content: job.content,
        hashtags: parsedHashtags(job.hashtags),
        imagePrompt: job.image_prompt,
        provider: job.caption_provider,
        model: job.caption_model,
        attemptCount: finiteCount(job.caption_attempt_count),
      },
      thumbnailUrl: job.thumbnail_url,
      mediaUrl: videoUrl,
      mediaProvider: job.media_provider,
      mediaModel: job.media_model,
      providerRequestId: job.provider_request_id,
      videoScript: job.video_script,
      videoShots: job.video_shots,
      archetypeSlug: job.archetype_slug,
      now: deps.now(),
    });
    return publicPilotMediaJob(ready);
  } catch (error) {
    const failed = await markPilotMediaJobFailed(
      env,
      job,
      job.claim_token_hash,
      error,
      deps.now(),
    );
    return publicPilotMediaJob(failed);
  }
}
