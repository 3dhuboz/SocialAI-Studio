import type { Env } from '../../env';
import {
  createPost,
  type PostproxyCreatePostArgs,
} from '../postproxy';
import {
  evaluateReleasePreflight,
  type PreflightDecision,
  type PublishablePost,
} from '../learning/release-preflight';
import { normalizeWorkspaceIdentity } from '../learning/types';

export type PersistedPublishPost = PublishablePost;

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

const defaultDeps: PublishOrchestratorDeps = {
  validateWorkspace,
  evaluatePreflight: evaluateReleasePreflight,
  persistHold,
  createPost,
  graphFetch: fetch,
};

export async function publishPersistedPost(
  env: Env,
  post: PersistedPublishPost,
  target: PublishTarget,
  injectedDeps: Partial<PublishOrchestratorDeps> = {},
): Promise<PublishOrchestratorResult> {
  const deps = { ...defaultDeps, ...injectedDeps };
  await deps.validateWorkspace(env, post);
  const preflight = await deps.evaluatePreflight(env, post);
  if (!preflight.mayPublish) {
    await deps.persistHold(env, post, preflight);
    throw new Error(
      `release preflight ${preflight.state} held post ${post.id}`,
    );
  }

  if (target.backend === 'postproxy') {
    return {
      backend: 'postproxy',
      result: await deps.createPost(env, target.payload),
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
      throw new Error(`FB reel start: ${startData.error?.message || startResponse.status}`);
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
    if (!transferResponse.ok || transferData.error || transferData.success === false) {
      throw new Error(
        `FB reel transfer: ${transferData.error?.message || transferResponse.status}`,
      );
    }
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
    return {
      backend: 'graph_instagram',
      mediaId: published.id,
      preflight,
    };
  }

  return {
    backend: 'graph',
    response: await deps.graphFetch(target.url, target.init),
    preflight,
  };
}
