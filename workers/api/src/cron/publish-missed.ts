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
// The owner-failure notifier + escapeHtml were lifted to lib/cron-notify.ts
// since poll-pending-reels.ts needs them too. friendlyPublishReason +
// kickFacebookReelUpload remain colocated — they're cron-only.

import type { Env } from '../env';
import { buildSafeImagePrompt } from '../lib/image-safety';
import { generateImageWithGuardrails } from '../lib/image-gen';
import { notifyOwnerOnFailure } from '../lib/cron-notify';
import { loadForbiddenSubjects, resolveBusinessType, scanForForbidden } from '../lib/profile-guards';
import {
  ACTIVE_CLIENT_FILTER,
  loadSocialTokensForPosts,
  lookupSocialTokens,
  loadPostproxyMappingForPosts,
  lookupPostproxyMapping,
  normalizePostPlatform,
  type SocialTokens,
} from './_shared';
import { createPost as postproxyCreatePost } from '../lib/postproxy';
import { MAX_REGEN_ATTEMPTS } from '../../../../shared/critique-thresholds';
import { scanContentForTropes } from '../../../../shared/fabrication-patterns';

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

// NOTE(rebase, 2026-05): PR #135 originally added inline `escapeHtml` +
// `notifyOwnerOnPublishFailure` helpers here with Shopify-aware deep-linking
// (admin.shopify.com/store/<shop>/apps/socialai-studio). When rebasing onto
// main these were dropped because main's Phase-B refactor moved the canonical
// notifier into `lib/cron-notify.ts` (and poll-pending-reels.ts uses it too).
// TODO(shopify-followup): extend `notifyOwnerOnFailure` in lib/cron-notify.ts
// to honour `post.owner_kind === 'shop'` and synthesise the Shopify admin URL.
// Until that lands, shop-post failure emails carry the SocialAI Studio URLs.

// ── Facebook Page Reels publishing — KICK phase ─────────────────────────────
// Audit P0 (Hono/Workers lane, 2026-05) — was previously a 4-phase blocking
// function that polled FB for up to 180s per post serially inside the publish
// cron's hot loop. With 20 posts per claim × 180s, the cron blew its 30s CPU
// budget on the first slow IG response and got killed mid-batch, silently
// dropping posts.
//
// Now split into kickFacebookReelUpload (this function, ~3-5s, runs inside
// the publish cron) and the new cron/poll-pending-reels.ts (polls FB status
// + runs the finish phase, owned by a separate */5 tick, 10s tick budget).
// Pattern mirrors cron/prewarm-videos.ts's kick-then-poll architecture for
// Kling i2v.
//
// Persists the FB-issued video_id to posts.fb_video_id (schema_v17) so the
// poll cron has a handle for status fetches and the finish phase. The post
// row stays in status='Publishing' with fb_publish_state='kicked' until the
// poll cron resolves it to 'done' or 'failed'.
//
// Permissions: pages_manage_posts + publish_video (already in OAuth scope).
// Reel requirements: 9:16 aspect, 3-90s, H.264, MP4. Kling at aspect_ratio:'9:16'
// satisfies all of these.
async function kickFacebookReelUpload(
  pageId: string,
  pageAccessToken: string,
  description: string,
  videoUrl: string,
): Promise<string> {
  const base = 'https://graph.facebook.com/v21.0';
  if (description.length > 2200) {
    throw new Error(`FB reel description exceeds 2200 char limit (got ${description.length})`);
  }

  // Validate the video URL before passing it as a header value. The URL
  // originates from the prewarm-videos cron writing into the posts table
  // (sourced from Kling output), so server-controlled — BUT defense in
  // depth: a malformed value (CRLF, non-HTTPS scheme, missing host) could
  // smuggle headers into the FB API call. Reject explicitly.
  let parsedVideo: URL;
  try {
    parsedVideo = new URL(videoUrl);
  } catch {
    throw new Error(`FB reel videoUrl is not a valid URL: ${String(videoUrl).slice(0, 80)}`);
  }
  if (parsedVideo.protocol !== 'https:') {
    throw new Error(`FB reel videoUrl must use https:// (got ${parsedVideo.protocol})`);
  }
  // CRLF / control-char check on the raw string. URL constructor strips
  // many of these but a CR/LF embedded as %0D / %0A round-trips through
  // .href — fail closed on anything that smells like header injection.
  if (/[\r\n\x00-\x1f]/.test(videoUrl)) {
    throw new Error(`FB reel videoUrl contains control characters`);
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

  // Done — FB now has the bytes (or knows where to pull them from). The poll
  // cron owns Phase 3 (status poll) and Phase 4 (finish). Return the video_id
  // so the caller can persist it to posts.fb_video_id for handoff.
  return videoId;
}

// Image-quality guard threshold for publish-time blocking. Posts whose
// vision critique scored AT OR BELOW this AND have exhausted their FLUX
// regen budget (image_regen_count >= MAX_REGEN_ATTEMPTS in runBacklogRegen)
// are marked Missed instead of claimed for publish. Prevents shipping the
// "generic gradient on a wellness post" failure mode we observed live —
// the regen loop catches it but if FLUX can't produce a better image after
// MAX_REGEN_ATTEMPTS tries, blocking is safer than publishing a known-bad
// image. Note: this guard threshold (3) is intentionally HARDER than the
// generic regen accept threshold (CRITIQUE_ACCEPT_THRESHOLD=5) — we'd
// rather publish a score-4 image than mark every score-4 post Missed.
const QUALITY_GUARD_THRESHOLD = 3;

export async function cronPublishMissedPosts(env: Env): Promise<{ posts_processed: number }> {
  // Posts are stored in AEST (UTC+10) without timezone offset, so compare in AEST
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().replace('Z', '');

  // ── Early bail-out ──────────────────────────────────────────────────────
  // Audit P0 (2026-05): the publish cron used to do an unconditional zombie
  // sweep + quality-guard sweep + claim attempt on every */5 tick even when
  // there was nothing to publish. With most workspaces having 0 posts due in
  // a given 5-min window, the typical tick wastes 3+ DB writes for nothing.
  // Single cheap COUNT(*) gate — when 0, return immediately and skip the
  // entire heavy claim sweep.
  const dueCheck = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM posts
     WHERE status IN ('Scheduled', 'Publishing') AND scheduled_for <= ?`
  ).bind(nowAEST).first<{ c: number }>();
  if (!dueCheck || dueCheck.c === 0) {
    return { posts_processed: 0 };
  }

  // Clean up zombie Publishing posts — only if they've been stuck for >10 min
  // (previous code reset ALL Publishing posts every 5-min cron tick, which
  // caused posts to be marked Missed while still actively being published).
  // Also clear claim_id so the post is eligible for re-claim by a healthy run.
  //
  // The right column to age out on is `claim_at` — the timestamp the cron
  // stamped when it took ownership of the row. Comparing `scheduled_for`
  // here was wrong: a post scheduled for 9:00 picked up at 9:01 and stuck
  // in Publishing would be eligible for reset at 9:11 by the old logic
  // (10 min past its schedule), but a post scheduled for 8:30 picked up
  // at 9:01 would be reset on the very next tick (already 30+ min past
  // schedule) — i.e. zombies that have only been "Publishing" for a few
  // minutes get killed while truly stuck zombies hang around. claim_at
  // exists on every claimed row (set in the UPDATE below, schema v7).
  // Rows with NULL claim_at (legacy pre-v7) fall through to the old
  // scheduled_for check so we don't strand them.
  //
  // Reel kick handoff (schema_v17, 2026-05): rows with fb_publish_state IN
  // ('kicked', 'polling') are mid-transfer to FB and owned by the poll cron
  // — exclude them from the zombie sweep. The poll cron has its own 8-min
  // stale-kick guard so a hung FB upload won't pin Publishing forever.
  const tenMinAgoUtc = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const tenMinAgo = new Date(Date.now() + 10 * 60 * 60 * 1000 - 10 * 60 * 1000).toISOString().replace('Z', '');

  // Zombie sweep — active workspaces only. Posts whose workspace went
  // on-hold mid-publish are handled by the second sweep below (reset to
  // Scheduled, not Missed) so on-hold artifacts don't pollute the "Missed"
  // metric. Without this filter, 7 historical Hugheseys posts ended up
  // Missed during the May 2026 hold, with reasoning containing the AI's
  // *scheduling* strategy (never overwritten by the cron because the
  // cron's active filter correctly skipped them post-hold) — making
  // it look like an FB-publish failure when it was an operational pause.
  await env.DB.prepare(
    `UPDATE posts SET status = 'Missed', claim_id = NULL, claim_at = NULL
       WHERE status = 'Publishing'
         AND (
           (claim_at IS NOT NULL AND claim_at <= ?)
           OR (claim_at IS NULL AND scheduled_for <= ?)
         )
         AND (fb_publish_state IS NULL OR fb_publish_state NOT IN ('kicked', 'polling'))
         AND ${ACTIVE_CLIENT_FILTER}`
  ).bind(tenMinAgoUtc, tenMinAgo).run();

  // On-hold zombies — workspace was put on hold between claim and publish.
  // Reset to Scheduled (NOT Missed) so they sit in the queue and pick up
  // automatically if/when the hold is lifted. The claim UPDATE below
  // honours ACTIVE_CLIENT_FILTER so resetting these is safe — they won't
  // be re-claimed while still on hold. Rare in practice (only triggers
  // on the narrow race where a workspace is paused mid-publish) but the
  // alternative — leaving them in Publishing forever — would block them
  // from ever recovering after the hold lifts.
  await env.DB.prepare(
    `UPDATE posts SET status = 'Scheduled', claim_id = NULL, claim_at = NULL
       WHERE status = 'Publishing'
         AND (
           (claim_at IS NOT NULL AND claim_at <= ?)
           OR (claim_at IS NULL AND scheduled_for <= ?)
         )
         AND client_id IN (SELECT id FROM clients WHERE status = 'on_hold')`
  ).bind(tenMinAgoUtc, tenMinAgo).run();

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
       AND COALESCE(image_regen_count, 0) >= ?
       AND ${ACTIVE_CLIENT_FILTER}`
  ).bind(nowAEST, QUALITY_GUARD_THRESHOLD, MAX_REGEN_ATTEMPTS).all<{
    id: string; user_id: string | null; client_id: string | null;
    image_critique_score: number; image_regen_count: number | null;
  }>();
  for (const p of (qualityBlocked.results || [])) {
    const reason = `Image quality below threshold (score ${p.image_critique_score}/10) after ${p.image_regen_count ?? 0} regen attempts — open Calendar to upload a custom image or edit the caption to give the AI better grounding.`;
    await env.DB.prepare(
      `UPDATE posts SET status = 'Missed', reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?`,
    ).bind(reason, p.id).run();
    await notifyOwnerOnFailure(env, p, reason, 'post');
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

  // FIFO fairness: oldest scheduled_for first. Without ORDER BY, SQLite returns
  // rows in whatever order the index/scan produces — which under load tends to
  // be insertion order, but isn't a guarantee and is wrong when the backlog
  // spans multiple users. ASC means an 8:00 post always publishes before a
  // 9:00 post on the same tick, even if the 9:00 one was inserted later.
  // Round-robin by user_id would prevent one workspace from monopolising a
  // tick's 20-slot budget, but FIFO is the simpler correct default — if we
  // see one workspace starve others we can revisit with a window function.
  // Postproxy cutover join (schema_v22). LEFT JOIN both users + clients so
  // we can read use_postproxy off whichever workspace owns the post — the
  // flag lives on clients for agency-managed posts and on users for
  // own-workspace posts. COALESCE picks whichever one is set; missing
  // (legacy, pre-v22) → 0 = legacy Graph path.
  const rows = await env.DB.prepare(
    `SELECT p.id, p.content, p.hashtags, p.image_url, p.image_prompt, p.platform,
            p.user_id, p.client_id, p.owner_kind, p.owner_id,
            p.post_type, p.video_url, p.video_status, p.audio_mixed_url,
            COALESCE(c.use_postproxy, u.use_postproxy, 0) AS use_postproxy
     FROM posts p
     LEFT JOIN users   u ON u.id = p.user_id
     LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.status = 'Publishing' AND p.claim_id = ?
     ORDER BY p.scheduled_for ASC
     LIMIT 20`
  ).bind(claimId).all();
  const posts = rows.results ?? [];
  if (posts.length === 0) { console.log('[CRON] No posts to publish'); return { posts_processed: 0 }; }
  console.log(`[CRON] Claimed ${posts.length} posts (claim: ${claimId.substring(0, 8)})`);

  // Preload social_tokens for every workspace in this batch in two queries
  // instead of one-per-post. The previous inline lookup was N+1 against D1 —
  // up to 20 round-trips per tick to fetch what's almost always 1-3 distinct
  // workspaces' tokens (most batches are dominated by a single owner's posts).
  // See cron/_shared.ts:loadSocialTokensForPosts for the IN-list query shape.
  const tokensMap = await loadSocialTokensForPosts(env, posts as { user_id?: string | null; client_id?: string | null }[]);

  // Same batch loader for the Postproxy mapping table — populated only
  // for workspaces that have completed the Postproxy connect flow. Posts
  // with use_postproxy=1 read from here; legacy posts ignore the map.
  const postproxyMap = await loadPostproxyMappingForPosts(
    env,
    posts as { user_id?: string | null; client_id?: string | null }[],
  );

  // Global kill switch — env override forces every post back onto the
  // legacy Graph path regardless of the per-workspace flag. Used for
  // emergency rollback mid-cutover. ENABLE_POSTPROXY=false is the kill
  // signal; any other value (or unset) means Postproxy stays enabled.
  const postproxyDisabled = env.ENABLE_POSTPROXY === 'false';

  // Cap on JIT image generations per cron run. fal.ai can be slow (~10-15s per
  // image on cold start) and the worker has a wall-time budget, so we don't let
  // a stampede of missing images blow the budget. Posts above the cap publish
  // text-only this tick and get picked up by the next 5-minute tick (a future
  // tick re-claims them via the missed-post sweep).
  const MAX_JIT_IMAGES_PER_RUN = 5;
  let jitGenerated = 0;

  // Reel publishing inside postReelToFacebookPage polls up to 180s for FB
  // processing. With up to 20 posts claimed per tick, a Reel-heavy batch
  // could spend the entire cron budget on video polling and starve image
  // posts. Cap reel work to 2 per tick — remaining reel posts wait for the
  // next 5-min tick. Image / text-only posts in the same batch still
  // process normally.
  const MAX_REELS_PER_RUN = 2;
  let reelsProcessed = 0;

  for (const post of posts) {
    try {
      // Shop-owned posts (Phase 2 of the embedded Shopify app, schema_v22):
      //   owner_kind='shop', owner_id=shop_domain, client_id=NULL,
      //   user_id=shop_domain sentinel. Their FB/IG tokens live in
      //   shopify_stores.social_tokens (JSON column) instead of
      //   users.social_tokens / clients.social_tokens. Branch the
      //   denylist + token-resolution paths so we don't accidentally
      //   query the users/clients tables for a sentinel id.
      const ownerKind = (post as any).owner_kind as string | null;
      const ownerId = (post as any).owner_id as string | null;
      const isShopPost = ownerKind === 'shop' && !!ownerId;

      // ── Owner-declared exclusion guard (defense layer 5) ────────────────
      // Final safety net before auto-publish. The gen prompts (layers 1+2)
      // and vision critique (layer 4) should already have caught any
      // forbidden subject — this is the regex-scan belt-and-braces that
      // bites even if the upstream layers missed something. The post gets
      // marked NeedsReview instead of publishing, and the owner is notified.
      //
      // Per-CLIENT denylist (CRITICAL #3 fix, 2026-05): pass client_id so
      // agency-managed workspaces get their own forbiddenSubjects honoured.
      // Pre-fix this only checked the user-level denylist, which is why
      // Seamus's brisket-only exclusion silently no-opped for a managed
      // client even after the system was nominally "configured" with one.
      // Shop-owned posts skip the Clerk-tenant denylist — they don't have a
      // users.id/clients.id to read from. TODO(shopify): wire the shop-side
      // denylist via loadForbiddenSubjectsForShop when the merchant Settings
      // UI ships. See profile-guards.ts:loadForbiddenSubjectsForShop.
      if (!isShopPost) {
        const denylist = await loadForbiddenSubjects(
          env,
          (post as any).user_id as string,
          (post as any).client_id as string | null,
        );
        if (denylist.length > 0) {
          const captionHit = scanForForbidden((post as any).content as string, denylist);
          const promptHit = captionHit ? null : scanForForbidden((post as any).image_prompt as string, denylist);
          const hit = captionHit || promptHit;
          if (hit) {
            const where = captionHit ? 'caption' : 'image_prompt';
            const reason = `Auto-publish blocked: post ${where} mentions "${hit}" which the business has flagged as a forbidden subject. Edit the post or update the denylist in Settings.`;
            console.warn(`[CRON] Post ${(post as any).id} blocked by forbiddenSubjects guard: "${hit}" in ${where}`);
            await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?')
              .bind('NeedsReview', reason, (post as any).id).run();
            await notifyOwnerOnFailure(env, post as any, reason, 'post');
            continue;
          }
        }
      }

      // ── Fabrication / AI-trope scan (defense layer 6) ───────────────────
      // The gen-time path (gemini.ts:detectFabrication) already retries with
      // a stricter prompt when one of these patterns fires, but the gen
      // pipeline can be bypassed: portal edits, post-rewrite flow that
      // wasn't routed through the retry loop, or imported drafts. This is
      // the last line of defence before the post hits a customer's followers.
      //
      // Behaviour: scan caption + image_prompt. If any trope pattern fires,
      // downgrade the post to NeedsReview (NOT Missed — the content is
      // recoverable, just needs an owner edit) and notify the owner. Same
      // shared bank as admin scan-flagged-posts and gemini.ts.
      const captionTropes = scanContentForTropes((post as any).content as string);
      const promptTropes = scanContentForTropes((post as any).image_prompt as string || '');
      const allTropes = [...captionTropes, ...promptTropes];
      if (allTropes.length > 0) {
        const where = captionTropes.length > 0 ? 'caption' : 'image_prompt';
        const reason = `Auto-publish blocked: post ${where} contains fabricated content patterns (${allTropes.slice(0, 3).join('; ')}). Open Calendar to edit before this can publish.`;
        console.warn(`[CRON] Post ${(post as any).id} blocked by trope scan: ${allTropes.join('; ')}`);
        await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?')
          .bind('NeedsReview', reason, (post as any).id).run();
        await notifyOwnerOnFailure(env, post as any, reason, 'post');
        continue;
      }

      // ── Postproxy cutover branch (schema_v22) ───────────────────────────
      // Per-workspace flag use_postproxy=1 routes this post through the new
      // hosted-publishing layer instead of the legacy Graph multipart path.
      // Global kill switch (ENABLE_POSTPROXY='false') forces every post back
      // to legacy regardless of the per-workspace flag — used for emergency
      // rollback.
      //
      // The Postproxy path is intentionally a complete short-circuit: it
      // never touches the legacy `tokens` lookup, the JIT image gen, the
      // FB reel kick-poll, or the multipart upload code paths below. Status
      // transitions arrive via the webhook (routes/postproxy.ts).
      const usePostproxy = !postproxyDisabled && Number((post as any).use_postproxy) === 1;
      if (usePostproxy) {
        // ig-wire (schema_v24): derive platform from posts.platform so an
        // IG-targeted post resolves to the workspace's IG mapping row
        // (not the FB row). Legacy posts with platform=NULL fall back to
        // 'facebook' via normalizePostPlatform → lookupPostproxyMapping.
        const postPlatform = normalizePostPlatform((post as any).platform as string | null);
        const mapping = lookupPostproxyMapping(
          postproxyMap,
          post as { user_id?: string | null; client_id?: string | null; platform?: string | null },
          postPlatform,
        );
        // FB requires a placement_id; IG does not (IG has no placements
        // per docs §3299). For IG, only require profile_id.
        const placementMissingForFb = postPlatform === 'facebook' && !mapping?.postproxy_placement_id;
        if (!mapping?.postproxy_profile_id || placementMissingForFb) {
          const platformLabel = postPlatform === 'instagram' ? 'Instagram' : 'Facebook';
          const reason = `Postproxy not connected for ${platformLabel} on this workspace — reconnect ${platformLabel} via Postproxy in Settings to fix.`;
          console.warn(`[CRON] No Postproxy mapping for post ${(post as any).id} (platform=${postPlatform}) — marking missed`);
          await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?')
            .bind('Missed', reason, (post as any).id).run();
          await notifyOwnerOnFailure(env, post as any, reason, 'post');
          continue;
        }

        // Build the Postproxy payload from the post row. Same hashtag-strip
        // idiom as the legacy path so captions stay byte-identical between
        // the two code paths during the dual-window.
        const hashtagsPp = (post as any).hashtags ? JSON.parse((post as any).hashtags as string) : [];
        const contentTextPp = (post as any).content as string;
        const cleanContentPp = contentTextPp.replace(/(\s+#\w+)+\s*$/, '').trim();
        const fullTextPp = hashtagsPp.length > 0
          ? `${cleanContentPp}\n\n${hashtagsPp.join(' ')}`
          : cleanContentPp;

        // Pick the first non-null media URL. Audio-mixed > raw video > image
        // matches the legacy path's preference order, just routed through
        // Postproxy's `media` array instead of Graph's multipart body.
        const mediaUrl = ((post as any).audio_mixed_url
          ?? (post as any).video_url
          ?? (post as any).image_url) as string | null;

        const postTypePp = (post as any).post_type as string | null;
        const isReel = postTypePp === 'video';
        // Reels need media — without it Postproxy returns a 400 we can't
        // recover from. Fall through to "Missed" rather than retry forever.
        if (isReel && !mediaUrl) {
          const reason = 'Reel post has no video URL — open Calendar to regenerate or convert to image post.';
          console.warn(`[CRON] Reel ${(post as any).id} missing video — marking missed`);
          await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?')
            .bind('Missed', reason, (post as any).id).run();
          await notifyOwnerOnFailure(env, post as any, reason, 'post');
          continue;
        }

        // Map post_type → format per platform. FB uses 'feed' (legacy alias
        // for 'post' the Postproxy server backward-compats); IG uses the
        // docs-canonical 'post' / 'reel'. Stories aren't a posts.post_type
        // value today — when post-composer UI gains story support, this
        // switch picks them up via the format union.
        const format: 'feed' | 'post' | 'reel' =
          isReel ? 'reel'
          : postPlatform === 'instagram' ? 'post'
          : 'feed';

        try {
          const result = await postproxyCreatePost(env, {
            profileId: mapping.postproxy_profile_id,
            body: fullTextPp,
            media: mediaUrl ? [mediaUrl] : [],
            format,
            // page_id is IG-irrelevant — the lib only emits it for FB.
            // Pass an empty string for IG so the typed arg is satisfied;
            // buildCreatePostPayload drops it from the IG payload.
            pageId: mapping.postproxy_placement_id || '',
            title: isReel ? cleanContentPp.slice(0, 60) : undefined,
            platform: postPlatform,
          });
          // Stay in Publishing — Postproxy will arrive with a webhook to
          // flip to Posted/Missed. Clear claim_id so a zombie-Publishing
          // sweep doesn't re-claim before the webhook arrives.
          const nowIso = new Date().toISOString();
          await env.DB.prepare(
            `UPDATE posts
             SET postproxy_post_id = ?, postproxy_sent_at = ?,
                 postproxy_status = 'pending', status = 'Publishing',
                 claim_id = NULL
             WHERE id = ?`
          ).bind(result.id, nowIso, (post as any).id).run();
          console.log(`[CRON] Postproxy publish initiated for ${(post as any).id} -> postproxy_id=${result.id}`);
        } catch (err: any) {
          const reason = friendlyPublishReason(err?.message || String(err));
          console.error(`[CRON] Postproxy publish failed for ${(post as any).id}:`, err?.message);
          await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ?, claim_id = NULL, claim_at = NULL WHERE id = ?')
            .bind('Missed', reason, (post as any).id).run();
          await notifyOwnerOnFailure(env, post as any, reason, 'post');
        }
        continue;
      }

      // ── Legacy Graph path (use_postproxy=0) ─────────────────────────────
      // Everything below this line is the original code path — left
      // BYTE-IDENTICAL to pre-v22 behaviour so workspaces that haven't
      // reconnected still publish exactly as they did before the cutover.
      // schema_v23 will delete this block once every workspace has migrated.

      // Social tokens for this workspace. For non-shop posts, use the
      // batch-loaded map (collapses what used to be a per-post DB round-trip
      // into a single in-memory hash lookup — see cron/_shared.ts). Shopify
      // shop posts pull straight from shopify_stores.social_tokens since
      // they aren't in the batch-loader's users/clients scope. Coalesce
      // lookupSocialTokens's undefined → null so the downstream falsy check
      // doesn't drift between the two paths.
      let tokens: SocialTokens | null = null;
      if (isShopPost) {
        const tokensRaw = await env.DB
          .prepare('SELECT social_tokens FROM shopify_stores WHERE shop_domain = ? AND uninstalled_at IS NULL')
          .bind(ownerId)
          .first<{ social_tokens: string | null }>();
        tokens = tokensRaw?.social_tokens ? JSON.parse(tokensRaw.social_tokens) as SocialTokens : null;
      } else {
        tokens = lookupSocialTokens(tokensMap, post as { user_id?: string | null; client_id?: string | null }) ?? null;
      }
      if (!tokens?.facebookPageId || !tokens?.facebookPageAccessToken) {
        const reason = 'No Facebook page connected — go to Settings → Connect Facebook to fix.';
        console.warn(`[CRON] No FB tokens for post ${(post as any).id} — marking missed`);
        await env.DB.prepare('UPDATE posts SET status = ?, reasoning = ? WHERE id = ?')
          .bind('Missed', reason, (post as any).id).run();
        await notifyOwnerOnFailure(env, post as any, reason, 'post');
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
        // Resolve businessType so buildSafeImagePrompt's fail-closed gate
        // catches generic-workspace + abstract-UI prompts on the JIT path.
        // See cron/prewarm-images.ts for the failure mode this fixes.
        const businessType = await resolveBusinessType(
          env,
          (post as any).user_id,
          (post as any).client_id || null,
        );
        const safe = buildSafeImagePrompt(promptForGen, cleanContent, businessType);
        if (safe) try {
          // 2026-05 image-stack upgrade: route through generateImageWithGuardrails
          // so JIT generation gets the same brand-grounded path the manual
          // backfill + frontend use. See helper at top of this file.
          const gen = await generateImageWithGuardrails(
            env,
            (post as any).user_id,
            (post as any).client_id || null,
            safe,
            { caption: cleanContent, seedHint: (post as any).id },
          );
          if (gen.imageUrl) {
            imageUrl = gen.imageUrl;
            await env.DB.prepare('UPDATE posts SET image_url = ? WHERE id = ?')
              .bind(gen.imageUrl, (post as any).id).run();
            jitGenerated++;
            console.log(`[CRON] JIT-generated image for post ${(post as any).id} via ${gen.modelUsed} (${jitGenerated}/${MAX_JIT_IMAGES_PER_RUN})`);
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
        // Cron-budget guard: each reel publish can spin up to 180s on FB
        // processing polls. To keep image/text posts in the same batch from
        // starving, defer surplus reels to the next tick. They stay in the
        // queue (status='Scheduled', scheduled_for unchanged) so the next
        // 5-min sweep picks them up via the same "scheduled_for <= now"
        // predicate. The 2-per-tick cap gives us at most 6 minutes of
        // reel polling budget while leaving room for the rest of the batch.
        if (reelsProcessed >= MAX_REELS_PER_RUN) {
          console.log(`[CRON] Skipping reel ${(post as any).id} — MAX_REELS_PER_RUN (${MAX_REELS_PER_RUN}) reached, will retry next tick`);
          // Release the claim so the next tick can pick it up. Don't change
          // status — the post is still legitimately Scheduled, just deferred.
          await env.DB.prepare('UPDATE posts SET claim_id = NULL, claim_at = NULL WHERE id = ?')
            .bind((post as any).id).run();
          continue;
        }
        reelsProcessed++;
        try {
          // Reel caption — strip trailing hashtags from content (idempotent)
          // and append clean hashtag block. Same idiom as fullText above.
          // Saved to reasoning column on the post row so the poll cron has
          // the exact caption to ship at finish-phase time (it doesn't
          // re-derive from content + hashtags to avoid drift).
          const reelDescription = fullText.length > 2200 ? fullText.slice(0, 2199) : fullText;
          const fbVideoId = await kickFacebookReelUpload(pageId, token, reelDescription, videoUrl);
          // Stash the FB video_id + caption on the post and stay in Publishing.
          // The poll cron picks this up on its */5 tick (typically the very
          // next tick for FB Reels — fb_publish_state='kicked' is the
          // contract). Note: we keep claim_id set; the poll cron clears it
          // when it transitions to done/failed. Zombie reset's 10-min buffer
          // (scheduled_for <= tenMinAgo) is wide enough to cover FB's typical
          // 30-120s processing tail.
          await env.DB.prepare(
            `UPDATE posts SET fb_video_id = ?, fb_publish_state = 'kicked',
                              fb_kicked_at = ?, reasoning = ?
             WHERE id = ?`
          ).bind(fbVideoId, nowAEST, `fb-page-reel-pending:${reelDescription.slice(0, 1800)}`, (post as any).id).run();
          console.log(`[CRON] Reel kicked ${(post as any).id} -> fb_video_id=${fbVideoId} (poll cron will finish)`);
          continue;
        } catch (reelErr: any) {
          // Kick failed (start or transfer phase) — fall through to image post
          // so the slot still ships. Persist the error so the dashboard surfaces
          // it. (Note: the previous 180s poll-then-throw failure mode is gone —
          // poll-time errors are now the poll cron's problem, with the same
          // image-fallback semantics handled separately there.)
          console.warn(`[CRON] Reel kick failed for post ${(post as any).id}: ${reelErr?.message}. Falling back to image post.`);
          await env.DB.prepare('UPDATE posts SET video_error = ? WHERE id = ?')
            .bind(`Reel kick failed: ${(reelErr?.message || 'unknown').slice(0, 400)}`, (post as any).id).run();
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
      await notifyOwnerOnFailure(env, post as any, reason, 'post');
    }
  }
  return { posts_processed: posts.length };
}
