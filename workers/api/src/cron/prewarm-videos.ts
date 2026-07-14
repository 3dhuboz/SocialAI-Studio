// Video/Reel prewarm cron — every 5 minutes, looks 45 minutes ahead.
//
// Two-state machine driven by video_status:
//   NULL/'pending'    → kick off Kling i2v on the thumbnail (image_url),
//                        store request_id, flip to 'generating'
//   'generating'      → poll task-status; on SUCCEEDED, fetch result, copy to
//                        R2, set video_url + flip to 'ready'. On FAILED or
//                        >8min stale → 'failed' (publish cron falls back to
//                        image-only so the slot still ships)
//
// 45-min lookahead × 5-min ticks = 9 ticks of headroom; Kling needs 1-3min so
// there's plenty of slack even if a tick fails. Cap at 2 in-flight per tick
// because Kling is ~$0.30/run — pacing keeps the bill predictable.
//
// Colocated helper cacheVideoToR2 — fal.ai Kling URLs expire ~24h. Posts can
// be scheduled days ahead, so we copy the MP4 to our own R2 bucket and
// persist the durable URL on the post row. FB/IG ingest the video via
// file_url server-side, which means the URL must be publicly fetchable from
// Meta IPs — R2 with a public domain (or pub-{hash}.r2.dev after enabling
// public access) handles that. fal.ai's CDN occasionally rate-limits Meta's
// crawlers, so the copy isn't optional.
//
// Extracted from src/index.ts as Phase B step 15 of the route-module split.

import type { Env } from '../env';
import { ACTIVE_CLIENT_FILTER } from './_shared';
import { logAiUsage } from '../lib/ai-usage';
import { evaluateReleasePreflight } from '../lib/learning/release-preflight';
import type { WorkspaceOwnerKind } from '../lib/learning/types';

const KLING_STANDARD_VIDEO_COST_USD = 0.30;

type PostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: WorkspaceOwnerKind | null;
  owner_id: string | null;
  content: string | null;
  platform: string | null;
  hashtags: string | null;
  image_url: string | null;
  post_type: string | null;
  video_script: string | null;
  video_shots: string | null;
  video_request_id: string | null;
  video_status: string | null;
};

async function cacheVideoToR2(env: Env, sourceUrl: string, postId: string): Promise<string | null> {
  if (!env.REELS_R2) {
    console.warn('[r2] REELS_R2 not bound — returning fal URL (will expire ~24h)');
    return sourceUrl;
  }
  // Already durable — caller passed an R2 URL or our custom domain.
  try {
    const host = new URL(sourceUrl).host;
    if (host.endsWith('r2.dev') || (env.R2_REELS_PUBLIC_BASE && sourceUrl.startsWith(env.R2_REELS_PUBLIC_BASE))) {
      return sourceUrl;
    }
  } catch {
    return null;
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(sourceUrl, { signal: ctrl.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok || !res.body) {
    console.warn(`[r2] fetch ${sourceUrl} failed: ${res.status}`);
    return null;
  }

  // 50MB defensive cap — Kling outputs are typically 2-10MB.
  const MAX_BYTES = 50 * 1024 * 1024;
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > MAX_BYTES) {
    console.warn(`[r2] video too large for post ${postId}: ${len} bytes`);
    return null;
  }

  const key = `reels/${postId}.mp4`;
  await env.REELS_R2.put(key, res.body, {
    httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=2592000' }, // 30d
  });

  // Custom domain if configured, else default r2.dev public bucket URL.
  // Set R2_REELS_PUBLIC_BASE in [vars] once the bucket exposes a public URL.
  const base = (env.R2_REELS_PUBLIC_BASE || '').replace(/\/$/, '');
  return base ? `${base}/${key}` : null;
}

export async function cronPrewarmVideos(env: Env): Promise<{ posts_processed: number }> {
  if (!env.FAL_API_KEY) return { posts_processed: 0 };
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().replace('Z', '');
  const in45AEST = new Date(Date.now() + 10 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString().replace('Z', '');
  const eightMinAgoAEST = new Date(Date.now() + 10 * 60 * 60 * 1000 - 8 * 60 * 1000).toISOString().replace('Z', '');

  // First — time out any 'generating' job stuck >8 min so the publish path can
  // fall back to image. Kling p99 is ~3 min; 8 min is "something's wrong".
  await env.DB.prepare(
    `UPDATE posts SET video_status = 'failed', video_error = 'Generation timed out (>8 min)'
     WHERE post_type = 'video' AND video_status = 'generating'
       AND video_started_at IS NOT NULL AND video_started_at < ?`
  ).bind(eightMinAgoAEST).run();

  const rows = await env.DB.prepare(
    `SELECT id, user_id, client_id, owner_kind, owner_id, content, platform, hashtags,
            image_url, post_type, video_script, video_shots, video_request_id, video_status
     FROM posts
     WHERE post_type = 'video' AND status = 'Scheduled'
       AND scheduled_for > ? AND scheduled_for <= ?
       AND (video_status IS NULL OR video_status IN ('pending','generating'))
       AND ${ACTIVE_CLIENT_FILTER}
     ORDER BY scheduled_for ASC LIMIT 2`
  ).bind(nowAEST, in45AEST).all<PostRow>();

  const posts = rows.results ?? [];
  if (posts.length === 0) return { posts_processed: 0 };
  console.log(`[CRON prewarm-video] ${posts.length} reel(s) in 45-min window`);

  const authHeader = { Authorization: `Key ${env.FAL_API_KEY}`, 'Content-Type': 'application/json' };
  let processed = 0;

  for (const post of posts) {
    const postId = post.id;
    const userId = post.user_id || null;
    const clientId = post.client_id;
    const status = post.video_status;
    const requestId = post.video_request_id;
    try {
      if (!status || status === 'pending') {
        // Kick off generation.
        const thumbnail = post.image_url;
        const motionPrompt = post.video_script;
        if (!thumbnail) {
          await env.DB.prepare(
            `UPDATE posts SET video_status = 'failed', video_error = 'No thumbnail to animate' WHERE id = ?`
          ).bind(postId).run();
          continue;
        }
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 15000);
        const startRes = await fetch('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video', {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify({
            prompt: motionPrompt || 'cinematic, smooth motion',
            image_url: thumbnail,
            duration: '5',
            aspect_ratio: '9:16',
          }),
          signal: ctrl.signal,
        });
        clearTimeout(timeout);
        const startData: any = await startRes.json();
        await logAiUsage(env, {
          userId,
          clientId,
          provider: 'fal',
          model: 'kling-video/v1.6/standard/image-to-video',
          operation: 'prewarm-video-start',
          imagesGenerated: 0,
          estCostUsd: startRes.ok && !!startData.request_id ? KLING_STANDARD_VIDEO_COST_USD : 0,
          postId,
          ok: startRes.ok && !!startData.request_id,
        });
        if (!startRes.ok || !startData.request_id) {
          const reason = startData?.detail || startData?.message || `Kling HTTP ${startRes.status}`;
          await env.DB.prepare(
            `UPDATE posts SET video_status = 'failed', video_error = ? WHERE id = ?`
          ).bind(`Kling start failed: ${reason}`.slice(0, 500), postId).run();
          continue;
        }
        await env.DB.prepare(
          `UPDATE posts SET video_status = 'generating', video_request_id = ?, video_started_at = ? WHERE id = ?`
        ).bind(startData.request_id, nowAEST, postId).run();
        processed++;
        console.log(`[CRON prewarm-video] kicked off Kling for post ${postId}`);
        continue;
      }

      // status === 'generating' → poll
      if (!requestId) {
        await env.DB.prepare(
          `UPDATE posts SET video_status = 'failed', video_error = 'No request_id to poll' WHERE id = ?`
        ).bind(postId).run();
        continue;
      }
      const statusRes = await fetch(
        `https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`,
        { headers: authHeader },
      );
      const statusData: any = await statusRes.json();
      if (statusData.status === 'COMPLETED' || statusData.status === 'SUCCEEDED') {
        // Fetch the result → get video URL → cache to R2 → mark ready.
        const resultRes = await fetch(
          `https://queue.fal.run/fal-ai/kling-video/requests/${requestId}`,
          { headers: authHeader },
        );
        const resultData: any = await resultRes.json();
        const falVideoUrl = resultData?.video?.url || resultData?.output?.video?.url;
        await logAiUsage(env, {
          userId,
          clientId,
          provider: 'fal',
          model: 'kling-video',
          operation: 'prewarm-video-result',
          imagesGenerated: 0,
          estCostUsd: 0,
          postId,
          ok: resultRes.ok && !!falVideoUrl,
        });
        if (!falVideoUrl) {
          await env.DB.prepare(
            `UPDATE posts SET video_status = 'failed', video_error = 'No video URL in Kling result' WHERE id = ?`
          ).bind(postId).run();
          continue;
        }
        const durableUrl = await cacheVideoToR2(env, falVideoUrl, postId);
        // If R2 isn't configured, durableUrl falls back to falVideoUrl (still
        // works for ~24h — long enough for posts scheduled within 45 min).
        const persistedUrl = durableUrl || falVideoUrl;
        await env.DB.prepare(
          `UPDATE posts SET video_status = 'ready', video_url = ?, r2_video_key = ? WHERE id = ?`
        ).bind(persistedUrl, durableUrl ? `reels/${postId}.mp4` : null, postId).run();
        await recordReleasePreflight(env, post, persistedUrl);
        processed++;
        console.log(`[CRON prewarm-video] reel ready for post ${postId}`);
      } else if (statusData.status === 'FAILED') {
        const reason = statusData?.failure || 'Kling reported FAILED';
        await env.DB.prepare(
          `UPDATE posts SET video_status = 'failed', video_error = ? WHERE id = ?`
        ).bind(String(reason).slice(0, 500), postId).run();
      }
      // else IN_QUEUE / IN_PROGRESS — leave as 'generating', try next tick
    } catch (e: any) {
      console.warn(`[CRON prewarm-video] failed for post ${postId}: ${e?.message}`);
    }
  }
  return { posts_processed: processed };
}

async function recordReleasePreflight(
  env: Env,
  post: PostRow,
  videoUrl: string,
): Promise<void> {
  if (!post.owner_kind || !post.owner_id) {
    console.warn(`[CRON prewarm-video] skipped early release receipt for ${post.id}: ownership metadata missing`);
    return;
  }
  try {
    await evaluateReleasePreflight(env, {
      id: post.id,
      user_id: post.user_id,
      client_id: post.client_id,
      owner_kind: post.owner_kind,
      owner_id: post.owner_id,
      content: post.content ?? '',
      platform: post.platform ?? 'facebook',
      hashtags: post.hashtags,
      image_url: post.image_url,
      post_type: post.post_type ?? 'video',
      video_url: videoUrl,
      video_status: 'ready',
      video_script: post.video_script,
      video_shots: post.video_shots,
    });
  } catch (error) {
    console.warn(
      `[CRON prewarm-video] early release receipt failed for ${post.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
