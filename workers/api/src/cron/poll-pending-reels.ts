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
import { sendResendEmail } from '../lib/email';

const TICK_BUDGET_MS = 10_000;
const STALE_KICK_THRESHOLD_MS = 8 * 60 * 1000; // 8 min — FB Reel p99 is ~2-3 min

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// Mirror of publish-missed.ts's notifier — duplicated here to avoid a
// circular import (publish-missed depends on this cron's column contract
// in turn). One-hour throttle keyed by workspace.
async function notifyOwnerOnReelPollFailure(
  env: Env,
  post: { id: string; user_id?: string | null; client_id?: string | null },
  reason: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    const wsKey = post.client_id ? `client:${post.client_id}` : `user:${post.user_id ?? 'unknown'}`;
    const cronType = `alert:fb_failure:${wsKey}`.slice(0, 80);

    const recent = await env.DB.prepare(
      `SELECT 1 FROM cron_runs WHERE cron_type = ? AND run_at > datetime('now','-1 hour') LIMIT 1`,
    ).bind(cronType).first();
    if (recent) return;

    let email: string | null = null;
    let workspaceName = 'your workspace';
    if (post.client_id) {
      const row = await env.DB.prepare(
        `SELECT u.email as email, c.name as name FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
      ).bind(post.client_id).first<{ email: string | null; name: string | null }>();
      email = row?.email ?? null;
      if (row?.name) workspaceName = row.name;
    } else if (post.user_id) {
      const row = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
        .bind(post.user_id).first<{ email: string | null }>();
      email = row?.email ?? null;
    }
    if (!email) return;

    await sendResendEmail(env, {
      to: email,
      subject: `Heads up — a scheduled reel couldn't publish to Facebook`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
        <h2 style="margin:0 0 8px;color:#dc2626;">A scheduled reel didn't go out</h2>
        <p style="margin:0 0 16px;color:#374151;">A reel for <strong>${escapeHtml(workspaceName)}</strong> uploaded to Facebook but couldn't be published.</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
          <strong>Reason:</strong><br/><span style="color:#374151;">${escapeHtml(reason)}</span>
        </div>
        <p style="margin:0 0 16px;color:#374151;">Open your calendar to retry — it'll fall back to an image post if needed.</p>
        <p><a href="https://socialaistudio.au" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;">Open Calendar</a></p>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">We only send one of these per workspace per hour, so you won't get spammed if multiple posts queue up.</p>
      </div>`,
    });

    await env.DB.prepare(
      `INSERT INTO cron_runs (cron_type, success, posts_processed, error, duration_ms) VALUES (?,1,0,?,0)`,
    ).bind(cronType, reason.slice(0, 200)).run();
  } catch (e: any) {
    console.error(`[CRON poll-reels] notifyOwnerOnReelPollFailure error: ${e?.message || e}`);
  }
}

// Phase 4 — finish: flip the FB reel to PUBLISHED with the caption.
// Caller passes the captioned description that was stashed on the post row
// at kick time (in posts.reasoning with the `fb-page-reel-pending:` prefix),
// so we don't re-derive it from content + hashtags and risk drift.
async function finishFacebookReel(
  pageId: string,
  pageAccessToken: string,
  description: string,
  videoId: string,
): Promise<void> {
  const base = 'https://graph.facebook.com/v21.0';
  const finishUrl =
    `${base}/${pageId}/video_reels`
    + `?upload_phase=finish&video_id=${encodeURIComponent(videoId)}`
    + `&video_state=PUBLISHED&description=${encodeURIComponent(description)}`
    + `&access_token=${encodeURIComponent(pageAccessToken)}`;
  const finishRes = await fetch(finishUrl, { method: 'POST' });
  const finishData = await finishRes.json() as any;
  if (finishData.error) throw new Error(`FB reel publish: ${finishData.error.message}`);
  if (finishData.success === false) throw new Error('FB reel publish: finish phase rejected');
}

export async function cronPollPendingReels(env: Env): Promise<{ posts_processed: number }> {
  const startedAt = Date.now();
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().replace('Z', '');

  // Early bail — single cheap COUNT(*) gate. Most ticks have no in-flight reels
  // (poll cron typically catches up within 1-2 ticks of a kick), so the gate
  // turns those ticks into a single DB call.
  const dueCheck = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM posts WHERE fb_publish_state IN ('kicked', 'polling')`
  ).first<{ c: number }>();
  if (!dueCheck || dueCheck.c === 0) {
    return { posts_processed: 0 };
  }

  // Pick up rows with an in-flight FB upload. Bounded by LIMIT 10 — at ~2s
  // per row (status fetch + maybe finish), 10 rows ≈ 20s worst case but the
  // tick budget guard will short-circuit before we go over.
  const rows = await env.DB.prepare(
    `SELECT id, user_id, client_id, fb_video_id, fb_publish_state, fb_kicked_at,
            reasoning, post_type
     FROM posts
     WHERE fb_publish_state IN ('kicked', 'polling')
       AND fb_video_id IS NOT NULL
     ORDER BY fb_kicked_at ASC LIMIT 10`
  ).all<{
    id: string;
    user_id: string | null;
    client_id: string | null;
    fb_video_id: string;
    fb_publish_state: string;
    fb_kicked_at: string | null;
    reasoning: string | null;
    post_type: string | null;
  }>();

  const posts = rows.results ?? [];
  if (posts.length === 0) return { posts_processed: 0 };
  console.log(`[CRON poll-reels] ${posts.length} reel(s) pending`);

  const base = 'https://graph.facebook.com/v21.0';
  let processed = 0;

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
          await notifyOwnerOnReelPollFailure(env, post, reason);
          console.warn(`[CRON poll-reels] reel ${post.id} timed out — marked Missed`);
          processed++;
          continue;
        }
      }

      // Look up FB page tokens for this workspace.
      const tokensRaw = post.client_id
        ? await env.DB.prepare('SELECT social_tokens FROM clients WHERE id = ?').bind(post.client_id).first<{ social_tokens: string | null }>()
        : await env.DB.prepare('SELECT social_tokens FROM users WHERE id = ?').bind(post.user_id).first<{ social_tokens: string | null }>();
      const tokens = tokensRaw?.social_tokens ? JSON.parse(tokensRaw.social_tokens) : null;
      if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
        const reason = 'No Facebook page connected — go to Settings → Connect Facebook to fix.';
        await env.DB.prepare(
          `UPDATE posts SET status = 'Missed', reasoning = ?,
                            fb_publish_state = 'failed', fb_finished_at = ?,
                            claim_id = NULL, claim_at = NULL
           WHERE id = ?`
        ).bind(reason, nowAEST, post.id).run();
        await notifyOwnerOnReelPollFailure(env, post, reason);
        processed++;
        continue;
      }

      // Phase 3 — single status poll (no inner wait loop, that was the bug).
      const statusRes = await fetch(
        `${base}/${post.fb_video_id}?fields=status&access_token=${encodeURIComponent(tokens.facebookPageAccessToken)}`,
      );
      const statusData = await statusRes.json() as any;
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
        await notifyOwnerOnReelPollFailure(env, post, reason);
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

      // Recover the caption stashed by the kick. We persisted it as
      // `fb-page-reel-pending:<caption>` in posts.reasoning so the finish
      // phase has the exact caption the kick decided on — re-deriving from
      // content + hashtags here would risk drift if the user edited the post
      // between kick and poll.
      const reasonField = post.reasoning || '';
      const caption = reasonField.startsWith('fb-page-reel-pending:')
        ? reasonField.slice('fb-page-reel-pending:'.length)
        : '';
      if (!caption) {
        // Defensive — shouldn't happen because we always stash on kick. If
        // somehow missing, fail loudly rather than ship an empty reel.
        const reason = 'Internal: reel caption missing at finish-phase time. Open Calendar to retry.';
        await env.DB.prepare(
          `UPDATE posts SET status = 'Missed', reasoning = ?,
                            fb_publish_state = 'failed', fb_finished_at = ?,
                            claim_id = NULL, claim_at = NULL
           WHERE id = ?`
        ).bind(reason, nowAEST, post.id).run();
        await notifyOwnerOnReelPollFailure(env, post, reason);
        processed++;
        continue;
      }

      try {
        await finishFacebookReel(tokens.facebookPageId, tokens.facebookPageAccessToken, caption, post.fb_video_id);
        await env.DB.prepare(
          `UPDATE posts SET status = 'Posted', reasoning = 'fb-page-reel',
                            fb_publish_state = 'done', fb_finished_at = ?,
                            claim_id = NULL, claim_at = NULL
           WHERE id = ?`
        ).bind(nowAEST, post.id).run();
        console.log(`[CRON poll-reels] reel ${post.id} -> Posted (fb_video_id=${post.fb_video_id})`);
        processed++;
      } catch (finishErr: any) {
        const reason = `Facebook reel publish (finish) failed: ${finishErr?.message || 'unknown'}. Open Calendar to retry.`;
        await env.DB.prepare(
          `UPDATE posts SET status = 'Missed', reasoning = ?, video_error = ?,
                            fb_publish_state = 'failed', fb_finished_at = ?,
                            claim_id = NULL, claim_at = NULL
           WHERE id = ?`
        ).bind(reason, `FB reel finish error: ${(finishErr?.message || 'unknown').slice(0, 400)}`, nowAEST, post.id).run();
        await notifyOwnerOnReelPollFailure(env, post, reason);
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
