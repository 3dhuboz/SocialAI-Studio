import type { Env } from '../../env';
import {
  createPost,
  type PostproxyCreatePostArgs,
} from '../postproxy';
import {
  evaluateReleasePreflight,
  buildReleaseContentHash,
  type PreflightDecision,
  type PublishablePost,
} from '../learning/release-preflight';
import {
  recordPublishDeliveryReceipt,
  recordPublicationEvent,
  type PublishDeliveryBackend,
  type PublishDeliveryEventKind,
  type PublishDeliveryReceiptInput,
  type PublicationPlatform,
} from '../learning/publication-repository';
import { normalizeWorkspaceIdentity } from '../learning/types';
import { fireAlert } from '../alerts';
import { CRITIQUE_ACCEPT_THRESHOLD } from '../../../../../shared/critique-thresholds';

export type PersistedPublishPost = PublishablePost;

export type PublicationOwnedPost = Pick<
  PersistedPublishPost,
  'id' | 'user_id' | 'client_id' | 'owner_kind' | 'owner_id'
>;

export type PublishTarget =
  | {
      backend: 'postproxy';
      payload: PostproxyCreatePostArgs;
    }
  | {
      backend: 'graph';
      url: string;
      init: RequestInit;
    }
  | {
      backend: 'graph_reel';
      pageId: string;
      pageAccessToken: string;
      description: string;
      videoUrl: string;
    }
  | {
      backend: 'graph_reel';
      pageId: string;
      pageAccessToken: string;
      description: string;
      videoId: string;
    }
  | {
      backend: 'graph_instagram';
      accountId: string;
      pageAccessToken: string;
      caption: string;
      imageUrl: string;
    };

export type PublishOrchestratorResult =
  | {
      backend: 'postproxy';
      result: Awaited<ReturnType<typeof createPost>>;
      preflight: PreflightDecision;
    }
  | {
      backend: 'graph';
      response: Response;
      preflight: PreflightDecision;
    }
  | {
      backend: 'graph_reel';
      videoId: string;
      preflight: PreflightDecision;
    }
  | {
      backend: 'graph_instagram';
      mediaId: string;
      preflight: PreflightDecision;
    };

export interface PublishOrchestratorDeps {
  validateWorkspace(env: Env, post: PersistedPublishPost): Promise<void>;
  evaluatePermanentBlock(
    env: Env,
    post: PersistedPublishPost,
  ): Promise<PreflightDecision | null>;
  evaluatePreflight(
    env: Env,
    post: PublishablePost,
  ): Promise<PreflightDecision>;
  persistHold(
    env: Env,
    post: PersistedPublishPost,
    decision: PreflightDecision,
  ): Promise<void>;
  createPost: typeof createPost;
  graphFetch: typeof fetch;
  buildContentHash: typeof buildReleaseContentHash;
  recordDeliveryReceipt: typeof recordPublishDeliveryReceipt;
  newAttemptId(): string;
}

export interface PublishedPostDetails {
  platform: PublicationPlatform;
  remotePostId: string | null;
  permalink: string | null;
  decisionId: string | null;
  publishedAt: string;
}

export interface PublicationDecisionContext {
  decisionId: string | null;
  reachPlanId: string | null;
}

export interface PublicationRecordDeps {
  resolveDecisionContext(
    db: D1Database,
    post: PublicationOwnedPost,
    decisionId: string | null,
  ): Promise<PublicationDecisionContext>;
  recordPublicationEvent: typeof recordPublicationEvent;
  fireAlert: typeof fireAlert;
}

async function resolveDecisionContext(
  db: D1Database,
  post: PublicationOwnedPost,
  decisionId: string | null,
): Promise<PublicationDecisionContext> {
  const identity = normalizeWorkspaceIdentity(
    post.user_id,
    post.client_id,
    post.owner_kind,
    post.owner_id,
  );
  const row = await db.prepare(`
    SELECT id, reach_plan_id
    FROM learning_decisions
    WHERE user_id = ? AND workspace_key = ?
      AND owner_kind = ? AND owner_id = ? AND post_id = ?
      AND (? IS NULL OR id = ?)
    ORDER BY
      CASE WHEN id = ? THEN 0 WHEN stage = 'release' THEN 1 ELSE 2 END,
      updated_at DESC
    LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.ownerKind,
    identity.ownerId,
    post.id,
    decisionId,
    decisionId,
    decisionId,
  ).first<{ id: string; reach_plan_id: string | null }>();
  return {
    decisionId: row?.id ?? decisionId,
    reachPlanId: row?.reach_plan_id ?? null,
  };
}

const defaultPublicationRecordDeps: PublicationRecordDeps = {
  resolveDecisionContext,
  recordPublicationEvent,
  fireAlert,
};

export async function recordPublishedPostBestEffort(
  env: Env,
  post: PublicationOwnedPost,
  details: PublishedPostDetails,
  injectedDeps: Partial<PublicationRecordDeps> = {},
): Promise<boolean> {
  const deps = { ...defaultPublicationRecordDeps, ...injectedDeps };
  try {
    const context = await deps.resolveDecisionContext(
      env.DB,
      post,
      details.decisionId,
    );
    await deps.recordPublicationEvent(env.DB, {
      userId: post.user_id,
      clientId: post.client_id,
      ownerKind: post.owner_kind,
      ownerId: post.owner_id,
      postId: post.id,
      platform: details.platform,
      remotePostId: details.remotePostId,
      permalink: details.permalink,
      decisionId: context.decisionId,
      reachPlanId: context.reachPlanId,
      publishedAt: details.publishedAt,
    });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[publishing] publication event missing for ${post.id}: ${reason}`);
    try {
      await deps.fireAlert(
        env,
        'publication_event_missing',
        'warn',
        `Published post ${post.id} (${post.owner_kind}) needs publication-event reconciliation: ${reason}`,
      );
    } catch (alertError) {
      console.error(
        `[publishing] publication event alert failed for ${post.id}: ${
          alertError instanceof Error ? alertError.message : String(alertError)
        }`,
      );
    }
    return false;
  }
}

async function validateWorkspace(
  env: Env,
  post: PersistedPublishPost,
): Promise<void> {
  const identity = normalizeWorkspaceIdentity(
    post.user_id,
    post.client_id,
    post.owner_kind,
    post.owner_id,
  );

  if (identity.ownerKind === 'client') {
    const client = await env.DB.prepare(
      'SELECT status FROM clients WHERE id = ? AND user_id = ?',
    ).bind(identity.ownerId, identity.userId).first<{ status: string | null }>();
    if (!client) throw new Error('workspace inactive: client not found');
    if (client.status?.trim().toLowerCase() === 'on_hold') {
      throw new Error('workspace inactive: client is on hold');
    }
    return;
  }

  if (identity.ownerKind === 'shop') {
    const shop = await env.DB.prepare(
      'SELECT shop_domain FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL',
    ).bind(identity.ownerId).first<{ shop_domain: string }>();
    if (!shop) throw new Error('workspace inactive: shop not found or uninstalled');
    return;
  }

  const user = await env.DB.prepare(
    'SELECT id FROM users WHERE id = ?',
  ).bind(identity.userId).first<{ id: string }>();
  if (!user) throw new Error('workspace inactive: user not found');
}

export async function evaluatePermanentPublishBlock(
  env: Env,
  post: PersistedPublishPost,
): Promise<PreflightDecision | null> {
  if (/\[staging qa fixture - never publish\]/i.test(post.content)) {
    return {
      mode: 'approval',
      state: 'block_red',
      mayPublish: false,
      mustHold: true,
      decisionId: null,
    };
  }

  const isStaging = env.ENVIRONMENT?.trim().toLowerCase() === 'staging';
  if (isStaging) {
    const generatedPilotDraft = await env.DB.prepare(`
      SELECT generated.id
      FROM learning_pilot_generated_drafts generated
      WHERE generated.user_id = ?
        AND generated.workspace_key = ?
        AND generated.client_id IS ?
        AND generated.owner_kind = ?
        AND generated.owner_id = ?
        AND generated.post_id = ?
        AND generated.record_only = 1
      LIMIT 1
    `).bind(
      post.user_id,
      post.client_id === null ? '__owner__' : post.client_id,
      post.client_id,
      post.owner_kind,
      post.owner_id,
      post.id,
    ).first<{ id: string }>();
    if (generatedPilotDraft) {
      return {
        mode: 'approval',
        state: 'block_red',
        mayPublish: false,
        mustHold: true,
        decisionId: null,
      };
    }
  }

  const isVideo = /^(?:video|reel)$/i.test(post.post_type || '');
  const expectsImage = !!post.image_prompt?.trim() && post.image_prompt.trim() !== 'N/A';
  if (expectsImage && !isVideo && !post.image_url) {
    return {
      mode: 'approval',
      state: 'block_red',
      mayPublish: false,
      mustHold: true,
      decisionId: null,
    };
  }
  if (post.image_url && !isVideo) {
    let score = post.image_critique_score;
    if (score === undefined) {
      const qa = await env.DB.prepare(
        'SELECT image_critique_score FROM posts WHERE id = ? AND owner_kind = ? AND owner_id = ?',
      ).bind(post.id, post.owner_kind, post.owner_id).first<{ image_critique_score: number | null }>();
      score = qa?.image_critique_score ?? null;
    }
    if (score == null || score < CRITIQUE_ACCEPT_THRESHOLD) {
      return {
        mode: 'approval',
        state: 'block_red',
        mayPublish: false,
        mustHold: true,
        decisionId: null,
      };
    }
  }

  if (!isStaging && env.LEARNING_RELEASE_ENFORCEMENT !== 'true') return null;

  const identity = normalizeWorkspaceIdentity(
    post.user_id,
    post.client_id,
    post.owner_kind,
    post.owner_id,
  );
  const row = await env.DB.prepare(`
    SELECT d.id AS decision_id
      FROM learning_decisions d
      INNER JOIN learning_decision_disqualifications disq
        ON disq.decision_id = d.id
       AND disq.user_id = d.user_id
       AND disq.workspace_key = d.workspace_key
       AND disq.client_id IS d.client_id
       AND disq.owner_kind = d.owner_kind
       AND disq.owner_id = d.owner_id
     WHERE d.user_id = ?
       AND d.workspace_key = ?
       AND d.client_id IS ?
       AND d.owner_kind = ?
       AND d.owner_id = ?
       AND d.post_id = ?
       AND disq.reason = 'synthetic_qa'
     ORDER BY d.created_at DESC
     LIMIT 1
  `).bind(
    identity.userId,
    identity.workspaceKey,
    identity.clientId,
    identity.ownerKind,
    identity.ownerId,
    post.id,
  ).first<{ decision_id: string }>();

  if (!row) return null;
  return {
    mode: 'approval',
    state: 'block_red',
    mayPublish: false,
    mustHold: true,
    decisionId: row.decision_id,
  };
}

async function persistHold(
  env: Env,
  post: PersistedPublishPost,
  decision: PreflightDecision,
): Promise<void> {
  const decisionId = decision.decisionId ?? 'no-decision-id';
  const reason = `Release preflight hold (${decisionId}): ${decision.state}`;
  await env.DB.prepare(
    `UPDATE posts
        SET status = 'Draft',
            scheduled_for = NULL,
            claim_id = NULL,
            claim_at = NULL,
            reasoning = ?
      WHERE id = ?
        AND user_id = ?
        AND client_id IS ?
        AND owner_kind = ?
        AND owner_id = ?`,
  ).bind(
    reason,
    post.id,
    post.user_id,
    post.client_id,
    post.owner_kind,
    post.owner_id,
  ).run();
}

interface DeliveryAttemptContext {
  attemptId: string;
  userId: string;
  clientId: string | null;
  ownerKind: PersistedPublishPost['owner_kind'];
  ownerId: string;
  postId: string;
  platform: string;
  backend: PublishDeliveryBackend;
  contentHash: string | null;
}

interface DeliveryFailureClassification {
  eventKind: Extract<
    PublishDeliveryEventKind,
    'definite_failure' | 'ambiguous_failure'
  >;
  errorClass: string;
  httpStatus: number | null;
  errorMessage: string;
}

function statusFromErrorMessage(message: string): number | null {
  const match = message.match(
    /(?:->|status(?:\s+code)?|failed\s*\(|:)\s*(\d{3})\b/i,
  );
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

function classifyDeliveryError(error: unknown): DeliveryFailureClassification {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  const httpStatus = statusFromErrorMessage(message);

  if (
    name === 'AbortError'
    || /\b(?:abort(?:ed)?|time(?:d)?\s*out|timeout)\b/i.test(message)
  ) {
    return {
      eventKind: 'ambiguous_failure',
      errorClass: 'timeout',
      httpStatus,
      errorMessage: message,
    };
  }
  if (
    error instanceof TypeError
    || /\b(?:fetch failed|network|socket|connection reset|econnreset)\b/i.test(message)
  ) {
    return {
      eventKind: 'ambiguous_failure',
      errorClass: 'network',
      httpStatus,
      errorMessage: message,
    };
  }
  if (httpStatus !== null) {
    const ambiguous = httpStatus === 408 || httpStatus === 425 || httpStatus >= 500;
    return {
      eventKind: ambiguous ? 'ambiguous_failure' : 'definite_failure',
      errorClass: ambiguous ? 'provider_ambiguous_status' : 'provider_rejected',
      httpStatus,
      errorMessage: message,
    };
  }
  if (/non-JSON body|missing id in response|missing video_id|missing upload_url/i.test(message)) {
    return {
      eventKind: 'ambiguous_failure',
      errorClass: 'invalid_provider_response',
      httpStatus: null,
      errorMessage: message,
    };
  }
  if (/not configured|exceeds 2200|workspace inactive|profile missing|requires a connected/i.test(message)) {
    return {
      eventKind: 'definite_failure',
      errorClass: 'local_validation',
      httpStatus: null,
      errorMessage: message,
    };
  }
  return {
    eventKind: 'ambiguous_failure',
    errorClass: 'unknown_provider_outcome',
    httpStatus: null,
    errorMessage: message,
  };
}

function classifyDeliveryResponse(response: Response): {
  eventKind: Exclude<PublishDeliveryEventKind, 'attempt_started'>;
  errorClass: string | null;
} {
  if (response.ok) return { eventKind: 'provider_accepted', errorClass: null };
  const ambiguous = response.status === 408
    || response.status === 425
    || response.status >= 500;
  return {
    eventKind: ambiguous ? 'ambiguous_failure' : 'definite_failure',
    errorClass: ambiguous ? 'provider_ambiguous_status' : 'provider_rejected',
  };
}

async function recordDeliveryShadowEvent(
  env: Env,
  deps: PublishOrchestratorDeps,
  attempt: DeliveryAttemptContext | null,
  eventKind: PublishDeliveryEventKind,
  details: Partial<Pick<
    PublishDeliveryReceiptInput,
    'remotePostId' | 'httpStatus' | 'errorClass' | 'errorMessage'
  >> = {},
): Promise<void> {
  if (!env.DB || !attempt) return;
  try {
    await deps.recordDeliveryReceipt(env.DB, {
      ...attempt,
      eventKind,
      ...details,
    });
  } catch (error) {
    console.warn(
      `[publishing] delivery shadow receipt unavailable for ${attempt.postId}/${attempt.attemptId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function beginDeliveryShadowAttempt(
  env: Env,
  deps: PublishOrchestratorDeps,
  post: PersistedPublishPost,
  backend: PublishDeliveryBackend,
): Promise<DeliveryAttemptContext | null> {
  if (!env.DB) return null;

  let attemptId: string;
  try {
    attemptId = deps.newAttemptId();
  } catch (error) {
    console.warn(
      `[publishing] delivery attempt id unavailable for ${post.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  let contentHash: string | null = null;
  try {
    contentHash = await deps.buildContentHash(post);
  } catch (error) {
    console.warn(
      `[publishing] delivery content hash unavailable for ${post.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const attempt: DeliveryAttemptContext = {
    attemptId,
    userId: post.user_id,
    clientId: post.client_id,
    ownerKind: post.owner_kind,
    ownerId: post.owner_id,
    postId: post.id,
    platform: post.platform,
    backend,
    contentHash,
  };
  await recordDeliveryShadowEvent(env, deps, attempt, 'attempt_started');
  return attempt;
}

const defaultDeps: PublishOrchestratorDeps = {
  validateWorkspace,
  evaluatePermanentBlock: evaluatePermanentPublishBlock,
  evaluatePreflight: evaluateReleasePreflight,
  persistHold,
  createPost,
  // Cloudflare's global fetch is receiver-sensitive. Storing it directly and
  // later calling deps.graphFetch(...) binds `this` to the deps object, which
  // throws "Illegal invocation" before any provider request is made.
  graphFetch: (input, init) => globalThis.fetch(input, init),
  buildContentHash: buildReleaseContentHash,
  recordDeliveryReceipt: recordPublishDeliveryReceipt,
  newAttemptId: () => crypto.randomUUID(),
};

export async function publishPersistedPost(
  env: Env,
  post: PersistedPublishPost,
  target: PublishTarget,
  injectedDeps: Partial<PublishOrchestratorDeps> = {},
): Promise<PublishOrchestratorResult> {
  const deps = { ...defaultDeps, ...injectedDeps };
  await deps.validateWorkspace(env, post);
  const permanentBlock = await deps.evaluatePermanentBlock(env, post);
  if (permanentBlock) {
    await deps.persistHold(env, post, permanentBlock);
    throw new Error(`post ${post.id} is permanently disqualified from publication`);
  }
  const preflight = await deps.evaluatePreflight(env, post);
  if (!preflight.mayPublish) {
    await deps.persistHold(env, post, preflight);
    throw new Error(
      `release preflight ${preflight.state} held post ${post.id}`,
    );
  }

  const attempt = await beginDeliveryShadowAttempt(
    env,
    deps,
    post,
    target.backend,
  );
  try {
    if (target.backend === 'postproxy') {
      const result = await deps.createPost(env, target.payload);
      await recordDeliveryShadowEvent(env, deps, attempt, 'provider_accepted', {
        remotePostId: result.id,
      });
      return {
        backend: 'postproxy',
        result,
        preflight,
      };
    }

    if (target.backend === 'graph_reel') {
      if (target.description.length > 2_200) {
        throw new Error(
          `FB reel description exceeds 2200 char limit (got ${target.description.length})`,
        );
      }
      const base = 'https://graph.facebook.com/v21.0';
      if ('videoId' in target) {
        const finishUrl =
          `${base}/${target.pageId}/video_reels`
          + `?upload_phase=finish&video_id=${encodeURIComponent(target.videoId)}`
          + `&video_state=PUBLISHED&description=${encodeURIComponent(target.description)}`
          + `&access_token=${encodeURIComponent(target.pageAccessToken)}`;
        const finishResponse = await deps.graphFetch(finishUrl, { method: 'POST' });
        const finishData = await finishResponse.json() as {
          success?: boolean;
          error?: { message?: string };
        };
        if (!finishResponse.ok || finishData.error || finishData.success === false) {
          throw new Error(
            `FB reel publish: ${finishData.error?.message || finishResponse.status}`,
          );
        }
        await recordDeliveryShadowEvent(env, deps, attempt, 'provider_accepted', {
          remotePostId: target.videoId,
          httpStatus: finishResponse.status,
        });
        return {
          backend: 'graph_reel',
          videoId: target.videoId,
          preflight,
        };
      }

      const startResponse = await deps.graphFetch(
        `${base}/${target.pageId}/video_reels`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upload_phase: 'start',
            access_token: target.pageAccessToken,
          }),
        },
      );
      const startData = await startResponse.json() as {
        video_id?: string;
        upload_url?: string;
        error?: { message?: string };
      };
      if (!startResponse.ok || startData.error) {
        throw new Error(
          `FB reel start: ${startData.error?.message || startResponse.status}`,
        );
      }
      if (!startData.video_id || !startData.upload_url) {
        throw new Error('FB reel start: missing video_id or upload_url');
      }

      const transferResponse = await deps.graphFetch(startData.upload_url, {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${target.pageAccessToken}`,
          file_url: target.videoUrl,
        },
      });
      const transferData = await transferResponse.json() as {
        success?: boolean;
        error?: { message?: string };
      };
      if (
        !transferResponse.ok
        || transferData.error
        || transferData.success === false
      ) {
        throw new Error(
          `FB reel transfer: ${transferData.error?.message || transferResponse.status}`,
        );
      }
      await recordDeliveryShadowEvent(env, deps, attempt, 'provider_accepted', {
        remotePostId: startData.video_id,
        httpStatus: transferResponse.status,
      });
      return {
        backend: 'graph_reel',
        videoId: startData.video_id,
        preflight,
      };
    }

    if (target.backend === 'graph_instagram') {
      const base = 'https://graph.facebook.com/v21.0';
      const containerResponse = await deps.graphFetch(
        `${base}/${target.accountId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: target.imageUrl,
            caption: target.caption,
            access_token: target.pageAccessToken,
          }),
        },
      );
      const container = await containerResponse.json() as {
        id?: string;
        error?: { message?: string };
      };
      if (!containerResponse.ok || container.error || !container.id) {
        throw new Error(
          `IG container: ${container.error?.message || containerResponse.status}`,
        );
      }

      const publishResponse = await deps.graphFetch(
        `${base}/${target.accountId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: container.id,
            access_token: target.pageAccessToken,
          }),
        },
      );
      const published = await publishResponse.json() as {
        id?: string;
        error?: { message?: string };
      };
      if (!publishResponse.ok || published.error || !published.id) {
        throw new Error(
          `IG publish: ${published.error?.message || publishResponse.status}`,
        );
      }
      await recordDeliveryShadowEvent(env, deps, attempt, 'provider_accepted', {
        remotePostId: published.id,
        httpStatus: publishResponse.status,
      });
      return {
        backend: 'graph_instagram',
        mediaId: published.id,
        preflight,
      };
    }

    const response = await deps.graphFetch(target.url, target.init);
    const responseClassification = classifyDeliveryResponse(response);
    await recordDeliveryShadowEvent(
      env,
      deps,
      attempt,
      responseClassification.eventKind,
      {
        httpStatus: response.status,
        errorClass: responseClassification.errorClass,
        errorMessage: response.ok
          ? null
          : `Provider returned HTTP ${response.status}`,
      },
    );
    return {
      backend: 'graph',
      response,
      preflight,
    };
  } catch (error) {
    const failure = classifyDeliveryError(error);
    await recordDeliveryShadowEvent(env, deps, attempt, failure.eventKind, {
      httpStatus: failure.httpStatus,
      errorClass: failure.errorClass,
      errorMessage: failure.errorMessage,
    });
    throw error;
  }
}
