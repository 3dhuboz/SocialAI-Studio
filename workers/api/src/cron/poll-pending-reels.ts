// Pending-reel poll cron — every 5 minutes, owns Phase 3 (status poll) +
// Phase 4 (finish/publish) of the FB Reel upload pipeline.
//
// Audit P0 fix (Hono/Workers lane, 2026-05). The publish cron used to do
// all four FB-Reel phases inline, blocking for up to 180s per post on
// Phase 3. With 20 posts per claim × 180s, the cron blew its 30s CPU
// budget on the first slow IG response and got killed mid-batch, silently
// dropping posts.
//
// Now split: cron/publish-missed.ts owns Phase 1+2 (start + transfer, ~3-5s)
// and persists fb_video_id + fb_publish_state='kicked' to the row. This cron
// picks up those rows on the next */5 tick, polls FB once (no inner wait
// loop), and on completion runs Phase 4 to publish the reel. Mirrors the
// kick-then-poll architecture in cron/prewarm-videos.ts for Kling i2v.
//
// Tick budget: hard 10s wall-clock budget per tick. With ~1s per FB status
// fetch + ~1s per finish call, we can process ~5-8 reels per tick. Typical
// FB processing tail is 30-120s, so a reel kicked at T+0 generally finishes
// by T+5-10min — 1 or 2 poll-cron ticks. The kick cron's tick budget drops
// from "minutes" (the old 180s-per-post inline poll) to single-digit seconds
// per post because the FB processing wait is moved out.
//
// Failure modes:
//   - FB reports error in uploading_phase / processing_phase → mark Missed,
//     surface the FB error message to the owner. video_error column gets
//     the raw FB message for the dashboard.
//   - kicked >8 min ago and still no terminal state → mark Missed with a
//     "FB processing timed out" message. Owner can retry from Calendar.
//   - finish phase rejected → mark Missed; the row's fb_publish_state goes
//     to 'failed' so we can find it in metrics later.
//
// Concurrent-safety: no claim_id needed. fb_publish_state is the
// per-row latch — only rows in 'kicked' or 'polling' are eligible. The
// transition to 'done' / 'failed' is a single UPDATE that ratchets the
// state forward, so a second concurrent poll cron racing on the same
// row will see fb_publish_state='done' and skip it.

import type { Env } from '../env';
import { notifyOwnerOnFailure } from '../lib/cron-notify';
import {
  publishPersistedPost,
  recordPublishedPostBestEffort,
  type PersistedPublishPost,
  type PublicationOwnedPost,
} from '../lib/publishing/publish-orchestrator';
import {
  buildPublishCaption,
  loadSocialTokensForPosts,
  lookupSocialTokens,
  normalizePostPlatform,
} from './_shared';

const TICK_BUDGET_MS = 10_000;

function parseHashtags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : [];
  } catch {
    return [];
  }
}

function persistedReelPost(post: {
  id: string;
  user_id: string | null;
  client_id: string | null;
  owner_kind: string | null;
  owner_id: string | null;
  content: string | null;
  platform: string | null;
  hashtags: string | null;
  image_url: string | null;
  post_type: string | null;
  publish_video_url: string | null;
  video_status: string | null;
  video_script: string | null;
  video_shots: string | null;
}): PersistedPublishPost {
  if (
    !post.user_id
    || !post.owner_id
    || !['user', 'client', 'shop'].includes(post.owner_kind ?? '')
  ) {
    throw new Error(`Post ${post.id} has incomplete ownership metadata`);
  }
  return {
    id: post.id,
    user_id: post.user_id,
    client_id: post.client_id,
    owner_kind: post.owner_kind as PersistedPublishPost['owner_kind'],
    owner_id: post.owner_id,
    content: post.content ?? '',
    platform: normalizePostPlatform(post.platform),
    hashtags: post.hashtags,
    image_url: post.image_url,
    post_type: post.post_type,
    video_url: post.publish_video_url,
    video_status: post.video_status,
    video_script: post.video_script,
    video_shots: post.video_shots,
  };
}
const STALE_KICK_THRESHOLD_MS = 8 * 60 * 1000; // 8 min — FB Reel p99 is ~2-3 min

// Phase 4 — finish: flip the FB reel to PUBLISHED only after rebuilding the
// current caption/media candidate and running a fresh centralized preflight.
// The kick-time reasoning value is diagnostics only, never publish input.
export async function cronPollPendingReels(env: Env): Promise<{ posts_processed: number }> {
  const startedAt = Date.now();
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().replace('Z', '');

  // Early bail — single cheap COUNT(*) gate. Most ticks have no in-flight reels
  // (poll cron typically catches up within 1-2 ticks of a kick), so the gate
  // turns those ticks into a single DB call.
  const dueCheck = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM posts
      WHERE status = 'Publishing'
        AND fb_publish_state IN ('kicked', 'polling')`
  ).first<{ c: number }>();
  if (!dueCheck || dueCheck.c === 0) {
    return { posts_processed: 0 };
  }

  // Pick up rows with an in-flight FB upload. Bounded by LIMIT 10 — at ~2s
  // per row (status fetch + maybe finish), 10 rows ≈ 20s worst case but the
  // tick budget guard will short-circuit before we go over.
  const rows = await env.DB.prepare(
    `SELECT id, user_id, client_id, owner_kind, owner_id,
            fb_video_id, fb_publish_state, fb_kicked_at,
            content, platform, hashtags, image_url,
            post_type, COALESCE(audio_mixed_url, video_url) AS publish_video_url,
            video_status, video_script, video_shots
     FROM posts
     WHERE status = 'Publishing'
       AND fb_publish_state IN ('kicked', 'polling')
       AND fb_video_id IS NOT NULL
     ORDER BY fb_kicked_at ASC LIMIT 10`
  ).all<{
    id: string;
    user_id: string | null;
    client_id: string | null;
    owner_kind: string | null;
    owner_id: string | null;
    fb_video_id: string;
    fb_publish_state: string;
    fb_kicked_at: string | null;
    content: string | null;
    platform: string | null;
    hashtags: string | null;
    image_url: string | null;
    post_type: string | null;
    publish_video_url: string | null;
    video_status: string | null;
    video_script: string | null;
    video_shots: string | null;
  }>();

  const posts = rows.results ?? [];
  if (posts.length === 0) return { posts_processed: 0 };
  console.log(`[CRON poll-reels] ${posts.length} reel(s) pending`);

  const base = 'https://graph.facebook.com/v21.0';
  let processed = 0;

  // Batch-load social_tokens for every workspace in this batch — one query
  // per table (clients, users) instead of N round-trips. See _shared.ts.
  const tokensMap = await loadSocialTokensForPosts(env, posts);

  // Kick off FB status fetches in parallel BEFORE the sequential loop.
  // Pre-fix this was a serial ~1s fetch per row inside the loop body, so a
  // 10-row batch needed ~10s of FB-latency time alone — already over the
  // 10s tick budget before any DB work. Now all fetches start at once and
  // the loop awaits each by post.id when it needs the result; DB writes +
  // finish-phase POSTs stay sequential. Rows without tokens or fb_video_id
  // are skipped — the token-missing branch in the loop fires first and we
  // `continue` before touching this map.
  const statusPromises = new Map<string, Promise<any>>();
  for (const post of posts) {
    const t = lookupSocialTokens(tokensMap, post);
    if (!t?.facebookPageAccessToken || !post.fb_video_id) continue;
    statusPromises.set(
      post.id,
      fetch(`${base}/${post.fb_video_id}?fields=status&access_token=${encodeURIComponent(t.facebookPageAccessToken)}`)
        .then(r => r.json())
        .catch((e: any) => ({ __fetchError: e?.message || 'fetch failed' })),
    );
  }

  for (const post of posts) {
    if (Date.now() - startedAt > TICK_BUDGET_MS) {
      console.log(`[CRON poll-reels] tick budget exceeded (${Date.now() - startedAt}ms) — deferring ${posts.length - processed} reel(s) to next tick`);
      break;
    }

    try {
      // Stale-kick guard — if we've been kicked >8min and still haven't
      // landed in a terminal state, FB is taking too long. Fail the row so
      // the publish cron's reel→image fallback isn't blocked indefinitely.
      // (Owners can retry from the calendar.) The threshold matches the
      // prewarm-videos.ts 8-min Kling timeout.
      if (post.fb_kicked_at) {
        const kickedAtMs = new Date(post.fb_kicked_at.replace(' ', 'T') + 'Z').getTime();
        const ageMs = Date.now() + 10 * 60 * 60 * 1000 - kickedAtMs;
        if (ageMs > STALE_KICK_THRESHOLD_MS) {
          const reason = 'Facebook reel upload took too long (>8 min) — open Calendar and click Retry. Will fall back to image post on retry.';
          await env.DB.prepare(
            `UPDATE posts SET status = 'Missed', reasoning = ?, video_error = ?,
                              fb_publish_state = 'failed', fb_finished_at = ?,
                              claim_id = NULL, claim_at = NULL
             WHERE id = ?`
          ).bind(reason, 'FB reel processing timed out (>8 min)', nowAEST, post.id).run();
          await notifyOwnerOnFailure(env, post, reason, 'reel');
          console.warn(`[CRON poll-reels] reel ${post.id} timed out — marked Missed`);
          processed++;
          continue;
        }
      }

      // Tokens come from the batch-loaded map (preloaded above) — no per-row
      // DB round-trip. Missing entry = workspace has no tokens row OR the
      // JSON was malformed → treat same as "no FB connected".
      const tokens = lookupSocialTokens(tokensMap, post);
      if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
        const reason = 'No Facebook page connected — go to Settings → Connect Facebook to fix.';
        await env.DB.prepare(
          `UPDATE posts SET status = 'Missed', reasoning = ?,
                            fb_publish_state = 'failed', fb_finished_at = ?,
                            claim_id = NULL, claim_at = NULL
           WHERE id = ?`
        ).bind(reason, nowAEST, post.id).run();
        await notifyOwnerOnFailure(env, post, reason, 'reel');
        processed++;
        continue;
      }

      // Phase 3 — await the parallel-kicked status fetch (no inner wait loop,
      // that was the bug). The fetch was started before the loop began, so
      // most of the FB network round-trip is already in-flight by the time
      // we get here. The fetch may have transport-failed; treat the same as
      // "still processing" so we retry next tick rather than mark Missed.
      const statusData = await statusPromises.get(post.id) as any;
      if (!statusData || statusData.__fetchError) {
        console.warn(`[CRON poll-reels] reel ${post.id} status fetch failed: ${statusData?.__fetchError || 'no response'} — will retry next tick`);
        continue;
      }
      const uploadingPhase = statusData.status?.uploading_phase?.status;
      const processingPhase = statusData.status?.processing_phase?.status;
      const videoStatus = statusData.status?.video_status;

      // FB reported error — mark Missed and surface to owner.
      if (uploadingPhase === 'error' || processingPhase === 'error') {
        const fbMsg =
          statusData.status?.uploading_phase?.errors?.[0]?.message
          || statusData.status?.processing_phase?.errors?.[0]?.message
          || 'unknown FB processing error';
        const reason = `Facebook reel processing failed: ${fbMsg}. Open Calendar to retry as an image post.`;
        await env.DB.prepare(
          `UPDATE posts SET status = 'Missed', reasoning = ?, video_error = ?,
                            fb_publish_state = 'failed', fb_finished_at = ?,
                            claim_id = NULL, claim_at = NULL
           WHERE id = ?`
        ).bind(reason, `FB reel processing error: ${fbMsg}`.slice(0, 500), nowAEST, post.id).run();
        await notifyOwnerOnFailure(env, post, reason, 'reel');
        console.warn(`[CRON poll-reels] reel ${post.id} FB error: ${fbMsg}`);
        processed++;
        continue;
      }

      // Ready — run Phase 4 (finish phase) to publish.
      const ready = videoStatus === 'ready' || uploadingPhase === 'complete';
      if (!ready) {
        // Still processing — bump state to 'polling' so we know we've seen it,
        // and try again next tick. Idempotent — repeated polling pre-ready is
        // fine, FB is happy with status fetches on a video_id.
        if (post.fb_publish_state === 'kicked') {
          await env.DB.prepare(
            `UPDATE posts SET fb_publish_state = 'polling' WHERE id = ?`
          ).bind(post.id).run();
        }
        continue;
      }

      try {
        // Build the exact current candidate inside the guarded finish block so
        // malformed ownership/content fails closed and is surfaced consistently.
        const actualPost = persistedReelPost(post);
        const currentCaption = buildPublishCaption({
          content: actualPost.content,
          hashtags: parseHashtags(actualPost.hashtags),
          hasImage: Boolean(actualPost.image_url),
        });
        const caption = currentCaption.length > 2_200
          ? currentCaption.slice(0, 2_199)
          : currentCaption;
        if (!caption) {
          throw new Error('Internal: reel caption missing at finish-phase time');
        }

        const outcome = await publishPersistedPost(
          env,
          actualPost,
          {
            backend: 'graph_reel',
            pageId: tokens.facebookPageId,
            pageAccessToken: tokens.facebookPageAccessToken,
            description: caption,
            videoId: post.fb_video_id,
          },
        );
        if (outcome.backend !== 'graph_reel') {
          throw new Error('Unexpected publish backend');
        }
        const publishedAt = new Date().toISOString();
        await env.DB.prepare(
          `UPDATE posts SET status = 'Posted', reasoning = 'fb-page-reel',
                            fb_publish_state = 'done', fb_finished_at = ?,
                            claim_id = NULL, claim_at = NULL
           WHERE id = ?`
        ).bind(nowAEST, post.id).run();
        await recordPublishedPostBestEffort(
          env,
          actualPost as PublicationOwnedPost,
          {
            platform: 'facebook',
            remotePostId: post.fb_video_id,
            permalink: null,
            decisionId: null,
            publishedAt,
          },
        );
        console.log(`[CRON poll-reels] reel ${post.id} -> Posted (fb_video_id=${post.fb_video_id})`);
        processed++;
      } catch (finishErr: any) {
        const finishMessage = String(finishErr?.message || finishErr);
        if (/release preflight/i.test(finishMessage)) {
          await env.DB.prepare(
            `UPDATE posts SET fb_publish_state = 'failed', fb_finished_at = ?,
                               video_error = ?
             WHERE id = ? AND status = 'Draft'`
          ).bind(
            nowAEST,
            `Reel held by release preflight: ${finishMessage.slice(0, 350)}`,
            post.id,
          ).run();
          console.warn(`[CRON poll-reels] reel ${post.id} held by fresh release preflight`);
          processed++;
          continue;
        }
        if (/workspace inactive/i.test(finishMessage)) {
          const reason = `Reel held because the workspace is inactive: ${finishMessage.slice(0, 350)}`;
          await env.DB.prepare(
            `UPDATE posts SET status = 'Draft', scheduled_for = NULL,
                              reasoning = ?, video_error = ?,
                              fb_publish_state = 'failed', fb_finished_at = ?,
                              claim_id = NULL, claim_at = NULL
             WHERE id = ? AND status = 'Publishing'`
          ).bind(reason, reason, nowAEST, post.id).run();
          console.warn(`[CRON poll-reels] reel ${post.id} held because its workspace is inactive`);
          processed++;
          continue;
        }
        const reason = `Facebook reel publish (finish) failed: ${finishMessage || 'unknown'}. Open Calendar to retry.`;
        await env.DB.prepare(
          `UPDATE posts SET status = 'Missed', reasoning = ?, video_error = ?,
                            fb_publish_state = 'failed', fb_finished_at = ?,
                            claim_id = NULL, claim_at = NULL
           WHERE id = ?`
        ).bind(reason, `FB reel finish error: ${(finishMessage || 'unknown').slice(0, 400)}`, nowAEST, post.id).run();
        await notifyOwnerOnFailure(env, post, reason, 'reel');
        console.warn(`[CRON poll-reels] reel ${post.id} finish failed: ${finishErr?.message}`);
        processed++;
      }
    } catch (e: any) {
      // Per-row resilience — log and move on so one flaky row doesn't kill
      // the rest of the tick.
      console.error(`[CRON poll-reels] error for post ${post.id}: ${e?.message || e}`);
    }
  }

  return { posts_processed: processed };
}
