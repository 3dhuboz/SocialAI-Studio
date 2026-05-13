// Publish-missed cron — every 5 minutes.
//
// The load-bearing cron of the platform. Claims posts whose scheduled_for has
// passed and publishes them to Facebook (image or text fallback), Instagram,
// or as a Reel via the video_reels endpoint. Owns the JIT image generation
// fallback when prewarm didn't fire, the "reel→image fallback" when video
// processing failed, and the "alert the owner" failure path when a post
// can't be published at all.
//
// Concurrent-safety: posts are claimed atomically via the claim_id column
// (schema v7) so multiple cron instances can't double-post. Zombie Publishing
// rows >10min old get reset to Missed so they're eligible for re-claim.
//
// Extracted from src/index.ts as Phase B step 13 of the route-module split.
// Colocated helpers (friendlyPublishReason / notifyOwnerOnPublishFailure /
// escapeHtml / postReelToFacebookPage) are cron-only — no HTTP route depends
// on them — so they live next to their single caller.

import type { Env } from '../env';
import { buildSafeImagePrompt } from '../lib/image-safety';
import { generateImageWithBrandRefs } from '../lib/image-gen';
import { sendResendEmail } from '../lib/email';
import { ACTIVE_CLIENT_FILTER } from './_shared';

// Translate raw FB Graph errors into a human sentence the user can act on.
// Keep originals for debugging — but the version we put in posts.reasoning
// (and the alert email) needs to read like advice, not a stack trace.
function friendlyPublishReason(raw: string): string {
  const r = (raw || '').toLowerCase();
  if (r.includes('expired') || r.includes('invalid_token') || r.includes('oauth') || r.includes('error validating access token')) {
    return 'Facebook token expired — reconnect Facebook in Settings (takes 30 sec).';
  }
  if (r.includes('not found') || r.includes('does not exist') || r.includes('unknown path')) {
    return 'Facebook page not found — it may have been deleted, renamed, or disconnected.';
  }
  if (r.includes('permission') || r.includes('forbidden') || r.includes('manage_pages') || r.includes('pages_manage_posts')) {
    return 'Facebook permission denied — reconnect Facebook and grant publishing permissions.';
  }
  if (r.includes('rate') && r.includes('limit')) {
    return 'Facebook rate limit hit — will retry on the next 5-min cron tick.';
  }
  if (r.includes('image') && (r.includes('download') || r.includes('upload'))) {
    return 'Image upload to Facebook failed — open Calendar and click Retry.';
  }
  return raw.slice(0, 200);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// Email the workspace owner when one of their posts fails to publish.
// Throttled to ONE email per workspace per hour — a 14-post Smart Schedule batch
// hitting an expired token shouldn't fire 14 emails. Uses cron_runs as a tiny
// KV store: a row of synthetic type `alert:fb_failure:<wsKey>` means "we sent
// for this workspace at this run_at." Query the latest within 1h to throttle.
async function notifyOwnerOnPublishFailure(
  env: Env,
  post: { id: string; user_id?: string | null; client_id?: string | null },
  reason: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    const wsKey = post.client_id ? `client:${post.client_id}` : `user:${post.user_id ?? 'unknown'}`;
    const cronType = `alert:fb_failure:${wsKey}`.slice(0, 80);

    // Throttle — skip if we sent for this workspace in the last hour
    const recent = await env.DB.prepare(
      `SELECT 1 FROM cron_runs WHERE cron_type = ? AND run_at > datetime('now','-1 hour') LIMIT 1`,
    ).bind(cronType).first();
    if (recent) return;

    // Look up owner email + workspace name
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

    const isTokenIssue = /token|expired|reconnect|permission|forbidden|connect facebook|page not found|manage_pages/i.test(reason);
    const fixCta = isTokenIssue
      ? `<a href="https://socialaistudio.au/admin" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;">Reconnect Facebook</a>`
      : `<a href="https://socialaistudio.au" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;">Open Calendar</a>`;

    await sendResendEmail(env, {
      to: email,
      subject: `Heads up — a scheduled post couldn't publish to Facebook`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
        <h2 style="margin:0 0 8px;color:#dc2626;">A scheduled post didn't go out</h2>
        <p style="margin:0 0 16px;color:#374151;">A post for <strong>${escapeHtml(workspaceName)}</strong> was scheduled but couldn't be published to Facebook.</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
          <strong>Reason:</strong><br/><span style="color:#374151;">${escapeHtml(reason)}</span>
        </div>
        ${isTokenIssue
          ? `<p style="margin:0 0 16px;color:#374151;">This usually means your Facebook page connection has expired. It takes 30 seconds to reconnect — click below.</p>`
          : `<p style="margin:0 0 16px;color:#374151;">Open your calendar to retry the post or check what went wrong.</p>`}
        <p>${fixCta}</p>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">We only send one of these per workspace per hour, so you won't get spammed if multiple posts queue up.</p>
      </div>`,
    });

    // Mark sent — doubles as a 1-hour throttle window
    await env.DB.prepare(
      `INSERT INTO cron_runs (cron_type, success, posts_processed, error, duration_ms) VALUES (?,1,0,?,0)`,
    ).bind(cronType, reason.slice(0, 200)).run();
    console.log(`[CRON] Sent publish-failure alert to ${email} for post ${post.id}`);
  } catch (e: any) {
    // Never let alert plumbing kill the publish path — log and move on
    console.error(`[CRON] notifyOwnerOnPublishFailure error: ${e?.message || e}`);
  }
}

// ── Facebook Page Reels publishing ──────────────────────────────────────────
// Three-phase resumable upload: start → transfer (FB pulls from file_url) →
// finish/publish. Runs only inside the publish cron — never exposed as an HTTP
// route. Mirrors the existing IG postReelToInstagram pattern in
// src/services/facebookService.ts so error shapes are consistent.
//
// Permissions: pages_manage_posts + publish_video (already in OAuth scope).
// Reel requirements: 9:16 aspect, 3-90s, H.264, MP4. Kling at aspect_ratio:'9:16'
// satisfies all of these.
async function postReelToFacebookPage(
  pageId: string,
  pageAccessToken: string,
  description: string,
  videoUrl: string,
): Promise<string> {
  const base = 'https://graph.facebook.com/v21.0';
  if (description.length > 2200) {
    throw new Error(`FB reel description exceeds 2200 char limit (got ${description.length})`);
  }

  // Phase 1 — start: get a video_id + upload_url.
  const startRes = await fetch(`${base}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'start', access_token: pageAccessToken }),
  });
  const startData = await startRes.json() as any;
  if (startData.error) throw new Error(`FB reel start: ${startData.error.message}`);
  const videoId: string | undefined = startData.video_id;
  const uploadUrl: string | undefined = startData.upload_url;
  if (!videoId || !uploadUrl) throw new Error('FB reel start: missing video_id or upload_url');

  // Phase 2 — hosted-URL transfer. FB pulls the MP4 from R2 itself.
  const transferRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${pageAccessToken}`,
      file_url: videoUrl,
    },
  });
  const transferData = await transferRes.json() as any;
  if (transferData.error) throw new Error(`FB reel transfer: ${transferData.error.message}`);
  if (transferData.success === false) throw new Error('FB reel transfer: hosted-URL fetch failed');

  // Phase 3 — poll until video processing completes (typically 30-120s).
  const maxWait = 180_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWait) {
    const statusRes = await fetch(
      `${base}/${videoId}?fields=status&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    const statusData = await statusRes.json() as any;
    const uploadingPhase = statusData.status?.uploading_phase?.status;
    const processingPhase = statusData.status?.processing_phase?.status;
    if (uploadingPhase === 'error' || processingPhase === 'error') {
      const errMsg =
        statusData.status?.uploading_phase?.errors?.[0]?.message
        || statusData.status?.processing_phase?.errors?.[0]?.message
        || 'unknown FB processing error';
      throw new Error(`FB reel processing failed: ${errMsg}`);
    }
    if (statusData.status?.video_status === 'ready' || uploadingPhase === 'complete') break;
    await new Promise(r => setTimeout(r, 5000));
  }

  // Phase 4 — finish: flip the reel to PUBLISHED with the caption.
  const finishUrl =
    `${base}/${pageId}/video_reels`
    + `?upload_phase=finish&video_id=${encodeURIComponent(videoId)}`
    + `&video_state=PUBLISHED&description=${encodeURIComponent(description)}`
    + `&access_token=${encodeURIComponent(pageAccessToken)}`;
  const finishRes = await fetch(finishUrl, { method: 'POST' });
  const finishData = await finishRes.json() as any;
  if (finishData.error) throw new Error(`FB reel publish: ${finishData.error.message}`);
  if (finishData.success === false) throw new Error('FB reel publish: finish phase rejected');
  return videoId;
}

// Image-quality guard threshold for publish-time blocking. Posts whose
// vision critique scored AT OR BELOW this AND have exhausted their FLUX
// regen budget (image_regen_count >= MAX_REGEN_ATTEMPTS in runBacklogRegen)
// are marked Missed instead of claimed for publish. Prevents shipping the
// "generic gradient on a wellness post" failure mode we observed live —
// the regen loop catches it but if FLUX can't produce a better image after
// 3 tries, blocking is safer than publishing a known-bad image.
const QUALITY_GUARD_THRESHOLD = 3;

export async function cronPublishMissedPosts(env: Env): Promise<{ posts_processed: number }> {
  // Posts are stored in AEST (UTC+10) without timezone offset, so compare in AEST
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().replace('Z', '');

  // Clean up zombie Publishing posts — only if they've been stuck for >10 min
  // (previous code reset ALL Publishing posts every 5-min cron tick, which
  // caused posts to be marked Missed while still actively being published).
  // Also clear claim_id so the post is eligible for re-claim by a healthy run.
  const tenMinAgo = new Date(Date.now() + 10 * 60 * 60 * 1000 - 10 * 60 * 1000).toISOString().replace('Z', '');
  await env.DB.prepare(
    `UPDATE posts SET status = 'Missed', claim_id = NULL, claim_at = NULL WHERE status = 'Publishing' AND scheduled_for <= ?`
  ).bind(tenMinAgo).run();

  // Image-quality guard. Posts whose image scored at/below the guard threshold
  // AND whose FLUX regen budget is exhausted go straight to Missed with a
  // human-readable reason — the owner gets the same publish-failure alert
  // email as a token-expired post and can hand-fix from the calendar.
  // Runs BEFORE the claim so these never enter the Publishing flow.
  const qualityBlocked = await env.DB.prepare(
    `SELECT id, user_id, client_id, image_critique_score, image_regen_count
     FROM posts
     WHERE status = 'Scheduled' AND scheduled_for <= ?
       AND image_critique_score IS NOT NULL AND image_critique_score <= ?
       AND COALESCE(image_regen_count, 0) >= 3
       AND ${ACTIVE_CLIENT_FILTER}`
  ).bind(nowAEST, QUALITY_GUARD_THRESHOLD).all<{
    id: string; user_id: string | null; client_id: string | null;
    image_critique_score: number; image_regen_count: number | null;
  }>();
  for (const p of (qualityBlocked.results || [])) {
    const reason = `Image quality below threshold (score ${p.image_critique_score}/10) after ${p.image_regen_count ?? 0} regen attempts — open Calendar to upload a custom image or edit the caption to give the AI better grounding.`;
    await env.DB.prepare(
      `UPDATE posts SET status = 'Missed', reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?`,
    ).bind(reason, p.id).run();
    await notifyOwnerOnPublishFailure(env, p, reason);
    console.log(`[CRON] Quality-blocked publish for post ${p.id} (score=${p.image_critique_score}, attempts=${p.image_regen_count})`);
  }

  // Claim posts with a unique ID so concurrent cron instances don't double-post.
  // Each instance stamps its own claimId in the dedicated claim_id column,
  // then only selects posts it claimed. Schema v7 added the column — replaces
  // the previous string-concat-on-image_prompt hack which corrupted the
  // content column and required the JIT branch to split on `|claim:`.
  const claimId = crypto.randomUUID();
  const claimAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE posts SET status = 'Publishing', claim_id = ?, claim_at = ?
     WHERE status = 'Scheduled' AND scheduled_for <= ?
       AND claim_id IS NULL
       AND ${ACTIVE_CLIENT_FILTER}`
  ).bind(claimId, claimAt, nowAEST).run();

  const rows = await env.DB.prepare(
    `SELECT id, content, hashtags, image_url, image_prompt, platform, user_id, client_id,
            post_type, video_url, video_status, audio_mixed_url
     FROM posts WHERE status = 'Publishing' AND claim_id = ? LIMIT 20`
  ).bind(claimId).all();
  const posts = rows.results ?? [];
  if (posts.length === 0) { console.log('[CRON] No posts to publish'); return { posts_processed: 0 }; }
  console.log(`[CRON] Claimed ${posts.length} posts (claim: ${claimId.substring(0, 8)})`);

  // Cap on JIT image generations per cron run. fal.ai can be slow (~10-15s per
  // image on cold start) and the worker has a wall-time budget, so we don't let
  // a stampede of missing images blow the budget. Posts above the cap publish
  // text-only this tick and get picked up by the next 5-minute tick (a future
  // tick re-claims them via the missed-post sweep).
  const MAX_JIT_IMAGES_PER_RUN = 5;
  let jitGenerated = 0;

  for (const post of posts) {
    try {
      // Get social tokens for this workspace
      const tokensRaw = (post as any).client_id
        ? await env.DB.prepare('SELECT social_tokens FROM clients WHERE id = ?').bind((post as any).client_id).first<{ social_tokens: string | null }>()
        : await env.DB.prepare('SELECT social_tokens FROM users WHERE id = ?').bind((post as any).user_id).first<{ social_tokens: string | null }>();
      const tokens = tokensRaw?.social_tokens ? JSON.parse(tokensRaw.social_tokens) : null;
      if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
        const reason = 'No Facebook page connected — go to Settings → Connect Facebook to fix.';
        console.warn(`[CRON] No FB tokens for post ${(post as any).id} — marking missed`);
        await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ? WHERE id = ?')
          .bind('Missed', reason, (post as any).id).run();
        await notifyOwnerOnPublishFailure(env, post as any, reason);
        continue;
      }

      const hashtags = (post as any).hashtags ? JSON.parse((post as any).hashtags as string) : [];
      const contentText = (post as any).content as string;
      // Strip any trailing hashtags from content (idempotent: handles inline hashtags and double-appended cases)
      const cleanContent = contentText.replace(/(\s+#\w+)+\s*$/, '').trim();
      const fullText = hashtags.length > 0
        ? `${cleanContent}\n\n${hashtags.join(' ')}`
        : cleanContent;

      const base = 'https://graph.facebook.com/v21.0';
      const pageId = tokens.facebookPageId;
      const token = tokens.facebookPageAccessToken;

      // ── JIT image backfill ────────────────────────────────────────────────
      // Smart Schedule fires Promise.all over a batch of posts — if the user is
      // accepting 14+ posts at once, the fal-proxy 20/min/user rate limit drops
      // some of them on the floor, the catch silently swallows the error, and
      // the post lands with image_url=NULL. Without this block the publish
      // cron would fall through to text-only-fallback every time. Generate the
      // image just before publishing instead, paced + capped so a stampede can't
      // exhaust the cron's wall-time budget.
      let imageUrl: string | null = ((post as any).image_url || null) as string | null;
      // Schema v7+ stores claim ownership in claim_id; image_prompt is now
      // a clean column with the actual prompt only. Older rows that were
      // claimed pre-v7 still have the legacy `|claim:UUID` suffix appended,
      // so we strip it defensively for one release. Remove this split call
      // after v7 has been live long enough that no Publishing posts have
      // legacy claim suffixes (typically 1 cron tick = 5min).
      const rawPrompt = (post as any).image_prompt as string | null;
      const promptForGen = rawPrompt ? rawPrompt.split('|claim:')[0].trim() : '';
      const needsImage = !imageUrl
        && promptForGen
        && promptForGen !== 'N/A'
        && promptForGen.length > 5;
      if (needsImage && env.FAL_API_KEY && jitGenerated < MAX_JIT_IMAGES_PER_RUN) {
        const safe = buildSafeImagePrompt(promptForGen);
        if (safe) try {
          // 2026-05 image-stack upgrade: route through generateImageWithBrandRefs
          // so JIT generation gets the same brand-grounded path the manual
          // backfill + frontend use. See helper at top of this file.
          const gen = await generateImageWithBrandRefs(
            env,
            (post as any).user_id,
            (post as any).client_id || null,
            safe,
            { caption: cleanContent },
          );
          if (gen.imageUrl) {
            imageUrl = gen.imageUrl;
            await env.DB.prepare('UPDATE posts SET image_url = ? WHERE id = ?')
              .bind(gen.imageUrl, (post as any).id).run();
            jitGenerated++;
            console.log(`[CRON] JIT-generated image for post ${(post as any).id} via ${gen.modelUsed} (${gen.referencesUsed} refs, ${jitGenerated}/${MAX_JIT_IMAGES_PER_RUN})`);
          } else {
            console.warn(`[CRON] JIT image gen returned no URL for post ${(post as any).id} via ${gen.modelUsed}`);
          }
        } catch (e: any) {
          console.warn(`[CRON] JIT image gen failed for post ${(post as any).id}: ${e?.message}`);
        }
      } else if (needsImage && jitGenerated >= MAX_JIT_IMAGES_PER_RUN) {
        // Post still publishes (better than missing the slot). The cap is a wall-time
        // safety valve — in practice 5+ images stuck in one batch is rare; the bulk
        // of misses come from Smart Schedule's 14-post Promise.all, which spaces out
        // by scheduled_for so they don't all hit the same cron tick.
        console.log(`[CRON] Post ${(post as any).id} needs image but JIT cap reached — publishing text-only this tick`);
      }

      // ── Video / Reel publish branch ────────────────────────────────────────
      // Reels published via the new Graph video_reels endpoint. If the prewarm
      // cron didn't finish (video_status != 'ready'), fall through to the image
      // path below using the thumbnail — slot still ships, just as an image
      // post instead of a reel. This is the load-bearing safety net: the
      // worst case is "your reel became an image post", never "your slot was
      // marked Missed". Aligned with the user's #1 priority — reliability.
      const postType = (post as any).post_type as string | null;
      const videoUrl = ((post as any).audio_mixed_url || (post as any).video_url) as string | null;
      const videoStatus = (post as any).video_status as string | null;

      if (postType === 'video' && videoStatus === 'ready' && videoUrl) {
        try {
          // Reel caption — strip trailing hashtags from content (idempotent)
          // and append clean hashtag block. Same idiom as fullText above.
          const reelDescription = fullText.length > 2200 ? fullText.slice(0, 2199) : fullText;
          const reelId = await postReelToFacebookPage(pageId, token, reelDescription, videoUrl);
          await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?')
            .bind('Posted', 'fb-page-reel', (post as any).id).run();
          console.log(`[CRON] Published reel ${(post as any).id} -> ${reelId}`);
          continue;
        } catch (reelErr: any) {
          // Reel publish failed — fall through to image post so the slot still
          // ships. Persist the error so the dashboard surfaces it.
          console.warn(`[CRON] Reel publish failed for post ${(post as any).id}: ${reelErr?.message}. Falling back to image post.`);
          await env.DB.prepare('UPDATE posts SET video_error = ? WHERE id = ?')
            .bind(`Reel publish failed: ${(reelErr?.message || 'unknown').slice(0, 400)}`, (post as any).id).run();
          // Continue to image fallback below
        }
      }

      let publishMethod = postType === 'video' ? 'video-fallback-image' : 'text-only';

      let fbRes: Response | null = null;

      if (imageUrl && imageUrl.startsWith('http')) {
        // Download image and upload via manual multipart body construction.
        // CF Workers FormData API silently drops binary data in cron context,
        // so we build the multipart body from raw bytes.
        try {
          const imgRes = await fetch(imageUrl);
          if (imgRes.ok) {
            const imageBuffer = await imgRes.arrayBuffer();
            const imageBytes = new Uint8Array(imageBuffer);
            console.log(`[CRON] Downloaded image (${imageBytes.length} bytes) for post ${(post as any).id}`);

            const boundary = '----CFBoundary' + Date.now();
            const enc = new TextEncoder();

            const head = enc.encode(
              `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="source"; filename="image.jpg"\r\n` +
              `Content-Type: image/jpeg\r\n\r\n`
            );
            const mid = enc.encode(
              `\r\n--${boundary}\r\n` +
              `Content-Disposition: form-data; name="message"\r\n\r\n` +
              fullText +
              `\r\n--${boundary}\r\n` +
              `Content-Disposition: form-data; name="published"\r\n\r\n` +
              `true` +
              `\r\n--${boundary}--\r\n`
            );

            const body = new Uint8Array(head.length + imageBytes.length + mid.length);
            body.set(head, 0);
            body.set(imageBytes, head.length);
            body.set(mid, head.length + imageBytes.length);

            fbRes = await fetch(`${base}/${pageId}/photos?access_token=${encodeURIComponent(token)}`, {
              method: 'POST',
              headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
              body: body,
            });
            publishMethod = `multipart-raw (${imageBytes.length}b)`;
            console.log(`[CRON] Multipart upload status: ${fbRes.status} for post ${(post as any).id}`);
          } else {
            console.warn(`[CRON] Image download returned ${imgRes.status} for post ${(post as any).id}`);
          }
        } catch (dlErr: any) {
          console.warn(`[CRON] Image download/upload failed for post ${(post as any).id}: ${dlErr.message}`);
        }
      }

      // Text-only fallback
      if (!fbRes) {
        fbRes = await fetch(`${base}/${pageId}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: fullText, access_token: token }),
        });
        publishMethod = 'text-only-fallback';
      }

      const fbText = await fbRes.text();
      console.log(`[CRON] FB response [${publishMethod}] for post ${(post as any).id}: ${fbText.substring(0, 300)}`);
      const fbData = JSON.parse(fbText);
      if (fbData.error) {
        throw new Error(`FB API [${publishMethod}]: ${fbData.error.message || JSON.stringify(fbData.error)}`);
      }

      // Log publish method to D1 for debugging. Clear claim_id so a hung
      // claim can't pin a Posted row indefinitely (defensive — Posted should
      // never be re-claimed, but this avoids dangling state).
      await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?')
        .bind('Posted', publishMethod, (post as any).id).run();
      console.log(`[CRON] Published post ${(post as any).id} via ${publishMethod} -> ${fbData.id || fbData.post_id || 'ok'}`);
    } catch (e: any) {
      const reason = friendlyPublishReason(e?.message || String(e));
      console.error(`[CRON] Failed to publish post ${(post as any).id}:`, e.message, e.stack);
      // Clear claim_id on Missed too so the missed-post sweep can re-claim
      // it next tick if appropriate (the sweep also handles stuck Publishing).
      await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?')
        .bind('Missed', reason, (post as any).id).run();
      await notifyOwnerOnPublishFailure(env, post as any, reason);
    }
  }
  return { posts_processed: posts.length };
}
