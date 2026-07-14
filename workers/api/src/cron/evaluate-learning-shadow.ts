import type { Env } from '../env';
import { createDecisionReceipt } from '../lib/learning/decision-repository';
import type { WorkspaceOwnerKind } from '../lib/learning/types';
import { loadWorkspaceLearningMode } from '../lib/learning/workspace-mode';

type ShadowPostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: string | null;
  owner_id: string | null;
  content: string | null;
  image_url: string | null;
  platform: string | null;
  scheduled_for: string | null;
  image_critique_score: number | null;
  image_critique_reasoning: string | null;
};

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function cronEvaluateLearningShadow(
  env: Env,
): Promise<{ posts_processed: number }> {
  if (env.LEARNING_BRAIN_ENABLED !== 'true') {
    return { posts_processed: 0 };
  }

  // Posts use the publisher's AEST-without-offset storage convention.
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000)
    .toISOString().replace('Z', '');
  const lookaheadAEST = new Date(Date.now() + 34 * 60 * 60 * 1000)
    .toISOString().replace('Z', '');
  const rows = await env.DB.prepare(`
    SELECT
      p.id, p.user_id, p.client_id, p.owner_kind, p.owner_id,
      p.content, p.image_url, p.platform, p.scheduled_for,
      p.image_critique_score, p.image_critique_reasoning
    FROM posts p
    LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = p.user_id
    WHERE p.status = 'Scheduled'
      AND p.scheduled_for > ?
      AND p.scheduled_for <= ?
      AND (
        p.client_id IS NULL
        OR (c.id IS NOT NULL AND COALESCE(c.on_hold, 0) = 0)
      )
    ORDER BY p.scheduled_for ASC
    LIMIT 8
  `).bind(nowAEST, lookaheadAEST).all<ShadowPostRow>();

  let processed = 0;
  for (const post of rows.results ?? []) {
    const clientId = post.client_id ?? null;
    const ownerKind: WorkspaceOwnerKind = post.owner_kind === 'shop'
      ? 'shop'
      : clientId === null ? 'user' : 'client';
    const ownerId = post.owner_id?.trim() || clientId || post.user_id;
    const mode = await loadWorkspaceLearningMode(
      env,
      post.user_id,
      clientId,
      ownerKind,
      ownerId,
    );
    if (mode === 'off') continue;

    const contentHash = await sha256(JSON.stringify({
      content: post.content,
      image: post.image_url,
      platform: post.platform,
    }));
    await createDecisionReceipt(env.DB, {
      userId: post.user_id,
      clientId,
      ownerKind,
      ownerId,
      postId: post.id,
      mode,
      stage: 'snapshot',
      releaseState: 'shadow_only',
      contentHash,
      summary: {
        scheduledFor: post.scheduled_for,
        imageCritiqueScore: post.image_critique_score,
        imageCritiqueReasoning: post.image_critique_reasoning,
      },
    });
    processed += 1;
  }

  return { posts_processed: processed };
}
