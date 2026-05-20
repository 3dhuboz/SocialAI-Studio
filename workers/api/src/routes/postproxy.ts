// Postproxy integration — HTTP routes.
//
// Five Clerk-authed routes for the connect/save-placement/publish flow,
// plus one public webhook endpoint. All wire through lib/postproxy.ts
// for the outbound API and lib/postproxy-webhook.ts for inbound signature
// + event-action mapping (those are kept side-effect-free so they can be
// exhaustively tested).
//
// Mounted in src/index.ts via registerPostproxyRoutes(app).
//
// Route map:
//   POST   /api/postproxy/init-connection    Clerk + rate-limited 10/min
//   GET    /api/postproxy/oauth-callback     Public (state nonce auths it)
//   GET    /api/postproxy/placements         Clerk
//   POST   /api/postproxy/save-placement     Clerk
//   POST   /api/postproxy/webhook            Public (HMAC + query-secret)
//   POST   /api/postproxy/publish-now        Clerk + rate-limited + billing
//
// Per-workspace tuple convention mirrors the rest of the worker:
//   uid alone           = own workspace (postproxy_profiles.client_id IS NULL)
//   uid + clientId      = agency-managed client workspace
//
// schema_v22 enforces ONE row per workspace tuple via partial unique indexes.

import type { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId, isRateLimited } from '../auth';
import { checkBillingGate } from '../lib/billing-gate';
import { notifyOwnerOnFailure } from '../lib/cron-notify';
import { timingSafeEqualStr } from '../lib/timing-safe';
import {
  ensureProfileGroup,
  initializeConnection,
  listPlacements,
  listProfiles,
  createPost,
} from '../lib/postproxy';
import {
  parseWebhookEvent,
  planWebhookAction,
  verifyWebhookSignature,
} from '../lib/postproxy-webhook';
import { normalizePostPlatform } from '../cron/_shared';

const uuid = () => crypto.randomUUID();

/** Short-stable workspace label used as the Postproxy profile_group name.
 *  Avoids leaking full UUIDs into the dashboard — first 8 chars are
 *  enough to disambiguate per-account and stay human-scannable. */
function workspaceLabel(uid: string, clientId: string | null): string {
  const short = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'na';
  return clientId
    ? `socialai-${short(uid)}-${short(clientId)}`
    : `socialai-${short(uid)}-own`;
}

/** Resolve the request origin for the OAuth redirect_url. Prefer the
 *  worker's own origin (so the redirect lands back on the worker, not
 *  the frontend). Falls back to a sane default if the header is missing. */
function workerOrigin(req: Request, env: Env): string {
  // c.req.url is the worker's URL — use its origin so the OAuth round-trip
  // returns to this same worker deployment regardless of which CF Pages
  // origin opened the connect modal.
  try {
    return new URL(req.url).origin;
  } catch {
    return env.ENVIRONMENT === 'production'
      ? 'https://socialai-api.steve-700.workers.dev'
      : 'https://socialai-api.steve-700.workers.dev';
  }
}

/** Build the post-OAuth redirect target for the browser. After the
 *  oauth-callback persists the new profile, we send the user back to
 *  the onboarding wizard's placement-picker step. */
function postOauthRedirect(env: Env, clientId: string | null): string {
  // Honour ENVIRONMENT for staging vs prod frontends; CF Pages preview
  // domains all hit the prod worker so we still send them to prod UI.
  const base = env.ENVIRONMENT === 'staging'
    ? 'https://staging.socialaistudio.au'
    : 'https://socialaistudio.au';
  const workspace = clientId ? encodeURIComponent(clientId) : 'own';
  return `${base}/onboarding?step=pick-placement&workspace=${workspace}`;
}

/** Build the "connected, no picker needed" redirect target. Used by the
 *  IG path post-OAuth — IG has no placements, so we skip Stage 2 entirely
 *  and land the user on a success state. The frontend reads
 *  `?step=connected&platform=instagram` and renders a small confirmation
 *  instead of the placement-picker UI. */
function postOauthConnectedRedirect(env: Env, clientId: string | null, platform: 'facebook' | 'instagram'): string {
  const base = env.ENVIRONMENT === 'staging'
    ? 'https://staging.socialaistudio.au'
    : 'https://socialaistudio.au';
  const workspace = clientId ? encodeURIComponent(clientId) : 'own';
  return `${base}/onboarding?step=connected&workspace=${workspace}&platform=${platform}`;
}

/** Build the failure-case redirect target. Postproxy appends
 *  `failure=true&error_code=...` to our callback URL when OAuth fails
 *  at Meta (account already in another group, user cancelled, scope
 *  denied, etc). We pass the code through to the frontend so the UI can
 *  render a friendly message instead of a raw JSON error page. */
function postOauthFailureRedirect(env: Env, clientId: string | null, errorCode: string): string {
  const base = env.ENVIRONMENT === 'staging'
    ? 'https://staging.socialaistudio.au'
    : 'https://socialaistudio.au';
  const workspace = clientId ? encodeURIComponent(clientId) : 'own';
  const code = encodeURIComponent(errorCode || 'unknown');
  return `${base}/onboarding?step=connect-failed&workspace=${workspace}&postproxy_error=${code}`;
}

interface PostproxyProfileRow {
  id: string;
  user_id: string;
  client_id: string | null;
  postproxy_group_id: string;
  postproxy_profile_id: string | null;
  postproxy_placement_id: string | null;
  fb_page_name: string | null;
  profile_status: string | null;
  oauth_state: string | null;
  platform: string;
}

/** Parse + validate the `platform` body/query param. Defaults to 'facebook'
 *  so existing callers that don't pass a platform get byte-identical
 *  behaviour. Wraps `normalizePostPlatform` (already platform-aware +
 *  tested in cron-shared.test.ts) so we don't duplicate the string-
 *  normalisation logic across the codebase. */
function parsePlatform(raw: unknown): 'facebook' | 'instagram' {
  return normalizePostPlatform(typeof raw === 'string' ? raw : null);
}

/** Look up the postproxy_profiles row for a workspace tuple + platform.
 *  NULL client_id is handled with `IS NULL` (param binding won't match).
 *  Platform defaults to 'facebook' for back-compat with pre-ig-wire
 *  callers — schema_v24 backfills existing rows with platform='facebook'
 *  so the lookup remains semantically identical for legacy data. */
async function selectProfileByWorkspace(
  env: Env,
  uid: string,
  clientId: string | null,
  platform: 'facebook' | 'instagram' = 'facebook',
): Promise<PostproxyProfileRow | null> {
  if (clientId) {
    return env.DB.prepare(
      `SELECT id, user_id, client_id, postproxy_group_id, postproxy_profile_id,
              postproxy_placement_id, fb_page_name, profile_status, oauth_state, platform
       FROM postproxy_profiles WHERE user_id = ? AND client_id = ? AND platform = ?`
    ).bind(uid, clientId, platform).first<PostproxyProfileRow>();
  }
  return env.DB.prepare(
    `SELECT id, user_id, client_id, postproxy_group_id, postproxy_profile_id,
            postproxy_placement_id, fb_page_name, profile_status, oauth_state, platform
     FROM postproxy_profiles WHERE user_id = ? AND client_id IS NULL AND platform = ?`
  ).bind(uid, platform).first<PostproxyProfileRow>();
}

export function registerPostproxyRoutes(app: Hono<{ Bindings: Env }>): void {
  // ── POST /api/postproxy/init-connection ───────────────────────────────
  // Body: { clientId?: string|null }
  //
  // 1. Resolve workspace tuple
  // 2. Ensure a postproxy_profiles row exists (create with new oauth_state nonce)
  // 3. Resolve / create the profile_group via Postproxy
  // 4. Ask Postproxy for a hosted-OAuth URL with our redirect_url
  // 5. Return { authUrl, oauthState }
  app.post('/api/postproxy/init-connection', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    if (await isRateLimited(c.env.DB, `pp-init:${uid}`, 10)) {
      return c.json({ error: 'Rate limit exceeded — 10 connect attempts per minute' }, 429);
    }
    const body = await c.req.json<{ clientId?: string | null; platform?: string }>().catch(() => ({} as { clientId?: string | null; platform?: string }));
    const clientId = body?.clientId ?? null;
    const platform = parsePlatform(body?.platform);

    // Agency-tenant safety: only allow connecting clients the caller owns.
    if (clientId) {
      const owns = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ? AND user_id = ?')
        .bind(clientId, uid).first<{ id: string }>();
      if (!owns) return c.json({ error: 'Client not found' }, 404);
    }

    try {
      // 1. Resolve / create profile_group via Postproxy (workspace label first;
      //    falls back to the default group if POST returns 404 — see lib doc).
      const label = workspaceLabel(uid, clientId);
      const group = await ensureProfileGroup(c.env, label);

      // 2. Upsert the workspace row for THIS platform. After ig-wire,
      //    one workspace can own up to one row per platform (UNIQUE on
      //    user_id + client_id + platform per schema_v24). The existing
      //    check is platform-scoped — connecting Instagram won't clobber
      //    the FB row, and vice versa.
      const existing = await selectProfileByWorkspace(c.env, uid, clientId, platform);
      const oauthState = uuid();
      const nowIso = new Date().toISOString();
      if (existing) {
        await c.env.DB.prepare(
          `UPDATE postproxy_profiles
           SET postproxy_group_id = ?, oauth_state = ?, updated_at = ?
           WHERE id = ?`
        ).bind(group.id, oauthState, nowIso, existing.id).run();
      } else {
        await c.env.DB.prepare(
          `INSERT INTO postproxy_profiles
             (id, user_id, client_id, postproxy_group_id, profile_status,
              oauth_state, platform, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).bind(uuid(), uid, clientId, group.id, 'pending', oauthState, platform, nowIso, nowIso).run();
      }

      // 3. Open Postproxy's hosted-OAuth URL for the chosen platform.
      //    The state nonce lives in the redirect path so the callback can
      //    resolve workspace + platform from the row without needing the
      //    browser to send anything else.
      const redirectUrl = `${workerOrigin(c.req.raw, c.env)}/api/postproxy/oauth-callback?state=${encodeURIComponent(oauthState)}`;
      const { url: authUrl } = await initializeConnection(c.env, group.id, redirectUrl, platform);

      return c.json({ authUrl, oauthState, platform });
    } catch (err: any) {
      console.error('[postproxy] init-connection failed:', err?.message);
      return c.json({ error: 'Connection setup failed', message: String(err?.message || err) }, 502);
    }
  });

  // ── GET /api/postproxy/oauth-callback?state=<nonce> ───────────────────
  // Public endpoint — the state nonce IS the auth. Postproxy redirects
  // the browser back here after Meta consent; we resolve the workspace,
  // pull the new profile's id from /api/profiles, persist it, and 303
  // back to the onboarding wizard's placement-picker step.
  app.get('/api/postproxy/oauth-callback', async (c) => {
    const state = c.req.query('state');
    if (!state) return c.json({ error: 'Missing state' }, 400);

    const row = await c.env.DB.prepare(
      `SELECT id, user_id, client_id, postproxy_group_id, platform
       FROM postproxy_profiles WHERE oauth_state = ?`
    ).bind(state).first<{ id: string; user_id: string; client_id: string | null; postproxy_group_id: string; platform: string }>();
    if (!row) return c.json({ error: 'Unknown oauth state' }, 404);
    const rowPlatform = parsePlatform(row.platform);

    // Postproxy signals OAuth failure via `failure=true&error_code=...`
    // (common codes: account_is_already_in_group, access_denied,
    // user_cancelled, scope_denied). Clear oauth_state so the user can
    // retry from Stage 1, then redirect to the frontend with the code so
    // the UI can render a friendly error instead of a raw JSON page.
    const failure = c.req.query('failure');
    const errorCode = c.req.query('error_code');
    if (failure === 'true' || errorCode) {
      await c.env.DB.prepare('UPDATE postproxy_profiles SET oauth_state = NULL, updated_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), row.id).run();
      console.warn(`[postproxy:oauth-callback] failure code=${errorCode || 'unknown'} user=${row.user_id} client=${row.client_id ?? 'own'}`);
      return c.redirect(postOauthFailureRedirect(c.env, row.client_id, errorCode || 'unknown'), 303);
    }

    try {
      // List profiles in this group; pick the newest matching the
      // platform we just connected. Postproxy doesn't surface a
      // "freshly-connected" marker — best heuristic is "most recent
      // active profile for this platform in our group" — falling back
      // to the first matching profile if all are pending.
      const allProfiles = await listProfiles(c.env, row.postproxy_group_id);
      const profiles = allProfiles.filter((p) => parsePlatform(p.platform) === rowPlatform);
      const fresh = profiles.find((p) => p.status === 'active') ?? profiles[0];
      if (!fresh) {
        // Same redirect pattern as the explicit-failure case — but with a
        // synthesised error_code so the UI can still render the friendly
        // banner instead of a raw JSON response.
        await c.env.DB.prepare('UPDATE postproxy_profiles SET oauth_state = NULL, updated_at = ? WHERE id = ?')
          .bind(new Date().toISOString(), row.id).run();
        return c.redirect(postOauthFailureRedirect(c.env, row.client_id, 'no_profile_after_oauth'), 303);
      }

      const nowIso = new Date().toISOString();
      await c.env.DB.prepare(
        `UPDATE postproxy_profiles
         SET postproxy_profile_id = ?, profile_status = ?, connected_at = ?,
             expires_at = ?, oauth_state = NULL, updated_at = ?
         WHERE id = ?`
      ).bind(
        fresh.id,
        fresh.status || 'active',
        nowIso,
        fresh.expires_at ?? null,
        nowIso,
        row.id,
      ).run();

      // IG short-circuit (ig-wire): Instagram has no placements per
      // docs §3299 — there's nothing to pick. Auto-flip use_postproxy=1
      // here so the publish cron starts routing IG posts on its next
      // tick without the user having to click through a picker that
      // would always show "0 placements". For FB, this still happens
      // in save-placement after the user picks a Page.
      if (rowPlatform === 'instagram') {
        if (row.client_id) {
          await c.env.DB.prepare('UPDATE clients SET use_postproxy = 1 WHERE id = ? AND user_id = ?')
            .bind(row.client_id, row.user_id).run();
        } else {
          await c.env.DB.prepare('UPDATE users SET use_postproxy = 1 WHERE id = ?')
            .bind(row.user_id).run();
        }
      }

      const target = rowPlatform === 'instagram'
        ? postOauthConnectedRedirect(c.env, row.client_id, 'instagram')
        : postOauthRedirect(c.env, row.client_id);
      return c.redirect(target, 303);
    } catch (err: any) {
      console.error('[postproxy] oauth-callback failed:', err?.message);
      return c.json({ error: 'Callback handling failed', message: String(err?.message || err) }, 502);
    }
  });

  // ── GET /api/postproxy/placements?clientId=<id>&platform=<facebook|instagram> ──
  // Returns the placements (FB Pages) available for the workspace's
  // connected profile. Used by the placement-picker UI.
  //
  // ig-wire: Instagram has no placements (docs §3299) — we return an empty
  // array with `skipPicker: true` so the frontend knows to bypass Stage 2
  // entirely. The IG auto-flip in oauth-callback means the user is already
  // fully connected by the time they'd hit this endpoint.
  app.get('/api/postproxy/placements', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const clientId = c.req.query('clientId') ?? null;
    const platform = parsePlatform(c.req.query('platform'));

    if (platform === 'instagram') {
      // Short-circuit — IG has no picker step. Frontend can detect this
      // shape and skip rendering the picker UI entirely.
      return c.json({ placements: [], platform: 'instagram', skipPicker: true });
    }

    const row = await selectProfileByWorkspace(c.env, uid, clientId, platform);
    if (!row?.postproxy_profile_id) {
      return c.json({ error: 'No social connection for this workspace' }, 404);
    }
    try {
      const placements = await listPlacements(c.env, row.postproxy_profile_id, row.postproxy_group_id);
      return c.json({ placements: placements.map((p) => ({ id: p.id, name: p.name })), platform });
    } catch (err: any) {
      console.error('[postproxy] placements failed:', err?.message);
      return c.json({ error: 'Placement fetch failed', message: String(err?.message || err) }, 502);
    }
  });

  // ── POST /api/postproxy/save-placement ────────────────────────────────
  // Body: { clientId?: string|null, placementId: string, pageName: string }
  //
  // Final step of connect — persists the chosen FB Page and flips
  // users.use_postproxy (or clients.use_postproxy) to 1 so the publish
  // cron starts routing this workspace through Postproxy on its next tick.
  app.post('/api/postproxy/save-placement', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json<{ clientId?: string | null; placementId?: string; pageName?: string; platform?: string }>().catch(() => null);
    if (!body) return c.json({ error: 'JSON body required' }, 400);
    const clientId = body.clientId ?? null;
    const platform = parsePlatform(body.platform);

    // IG bypass: the oauth-callback already flipped use_postproxy=1 for
    // IG since there's no picker to wait for. If the frontend still calls
    // save-placement (e.g. for shape uniformity), no-op success.
    if (platform === 'instagram') {
      return c.json({ ok: true, platform: 'instagram', skipped: true });
    }

    // FB requires placementId + pageName from the picker.
    if (typeof body.placementId !== 'string' || typeof body.pageName !== 'string') {
      return c.json({ error: 'placementId and pageName are required' }, 400);
    }

    const row = await selectProfileByWorkspace(c.env, uid, clientId, platform);
    if (!row) return c.json({ error: 'No social connection for this workspace — connect Facebook first' }, 404);

    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE postproxy_profiles
       SET postproxy_placement_id = ?, fb_page_name = ?, updated_at = ?
       WHERE id = ?`
    ).bind(body.placementId, body.pageName, nowIso, row.id).run();

    // Flip the per-workspace cutover flag. Cron branches on this on its
    // next */5 tick — no restart / migration needed.
    if (clientId) {
      await c.env.DB.prepare('UPDATE clients SET use_postproxy = 1 WHERE id = ? AND user_id = ?')
        .bind(clientId, uid).run();
    } else {
      await c.env.DB.prepare('UPDATE users SET use_postproxy = 1 WHERE id = ?')
        .bind(uid).run();
    }
    return c.json({ ok: true });
  });

  // ── POST /api/postproxy/webhook ───────────────────────────────────────
  // Public endpoint — auth is HMAC-SHA256 over the raw body via
  // POSTPROXY_WEBHOOK_SECRET, with a `?secret=<env>` query-string
  // fallback for environments where Postproxy can't sign payloads yet.
  //
  // Idempotency: every event has a unique event_id; INSERT OR IGNORE
  // dedupes Postproxy's at-least-once retries.
  app.post('/api/postproxy/webhook', async (c) => {
    const rawBody = await c.req.text();
    const sigHeader = c.req.header('X-Postproxy-Signature')
      ?? c.req.header('x-postproxy-signature')
      ?? null;

    // Auth — HMAC first, fall back to query-string shared secret.
    const hmacOk = await verifyWebhookSignature(rawBody, sigHeader, c.env.POSTPROXY_WEBHOOK_SECRET);
    let authOk = hmacOk;
    if (!authOk) {
      const qs = c.req.query('secret');
      const expected = c.env.POSTPROXY_WEBHOOK_QUERY_SECRET;
      if (qs && expected && timingSafeEqualStr(qs, expected)) {
        authOk = true;
      }
    }
    if (!authOk) {
      console.warn('[postproxy:webhook] auth failed (HMAC=false, query=false)');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const event = parseWebhookEvent(rawBody);
    if (!event) {
      // Return 200 — we don't want Postproxy retrying a malformed payload.
      return c.json({ ok: false, reason: 'parse_failed' });
    }

    // Idempotent insert. SQLite returns success on the IGNORE branch, so
    // we check rowcount via the meta to detect a duplicate. Cheaper: SELECT
    // first, but the INSERT-then-check pattern avoids a round-trip on the
    // happy path (most events are first-delivery).
    const insertRes = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO postproxy_webhook_events
         (event_id, event_type, post_id, payload)
       VALUES (?,?,?,?)`
    ).bind(event.event_id, event.event_type, event.data.id, rawBody).run();
    const dedup = !(insertRes.meta?.changes ?? 0);
    if (dedup) {
      return c.json({ ok: true, dedup: true });
    }

    const action = planWebhookAction(event);

    if (action.kind === 'log_only') {
      return c.json({ ok: true, kind: 'log_only' });
    }

    // Resolve our post row from the Postproxy post id.
    const postRow = await c.env.DB.prepare(
      `SELECT id, user_id, client_id FROM posts WHERE postproxy_post_id = ? LIMIT 1`
    ).bind(action.postproxyPostId).first<{ id: string; user_id: string | null; client_id: string | null }>();
    if (!postRow) {
      // Possible if the post was deleted between create + webhook, OR
      // we're double-mounted on the same Postproxy account from a
      // different worker. Log + drop, but stay 200 so Postproxy doesn't
      // retry forever.
      console.warn(`[postproxy:webhook] no post for postproxy_post_id=${action.postproxyPostId}`);
      return c.json({ ok: true, kind: action.kind, post_not_found: true });
    }

    const nowIso = new Date().toISOString();
    if (action.kind === 'mark_published') {
      await c.env.DB.prepare(
        `UPDATE posts
         SET status = 'Posted',
             postproxy_status = 'published',
             postproxy_permalink = ?,
             postproxy_finished_at = ?,
             claim_id = NULL,
             claim_at = NULL
         WHERE id = ?`
      ).bind(action.permalink ?? null, nowIso, postRow.id).run();
      return c.json({ ok: true, kind: 'mark_published' });
    }

    // mark_failed
    const reason = action.errorMessage || 'Publish failed at the publishing layer';
    await c.env.DB.prepare(
      `UPDATE posts
       SET status = 'Missed',
           postproxy_status = 'failed',
           postproxy_finished_at = ?,
           reasoning = ?,
           claim_id = NULL,
           claim_at = NULL
       WHERE id = ?`
    ).bind(nowIso, reason, postRow.id).run();
    await notifyOwnerOnFailure(c.env, postRow, reason, 'post');
    return c.json({ ok: true, kind: 'mark_failed' });
  });

  // ── POST /api/postproxy/publish-now ───────────────────────────────────
  // Body: { postId: string }
  //
  // Out-of-band manual publish (skips the */5 cron tick). Used by the
  // Calendar "Publish now" UI. Same payload-shape as the cron path —
  // creates a Postproxy post + flips status to Publishing — but invoked
  // synchronously so the user gets immediate feedback.
  app.post('/api/postproxy/publish-now', async (c) => {
    const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
    if (!uid) return c.json({ error: 'Unauthorized' }, 401);
    // RATE LIMIT + BILLING GATE — Postproxy /api/posts is paid (per-post
    // Postproxy fees + per-platform Meta delivery). Block past_due
    // subscribers so a declined card can't churn Postproxy credit until
    // the cancellation lands. Different tables (rate_limit_log vs users)
    // — fire both checks in parallel (matches the ai/generate pattern).
    const [isLimited, denied] = await Promise.all([
      isRateLimited(c.env.DB, `pp-publish:${uid}`, 10),
      checkBillingGate(c, uid),
    ]);
    if (isLimited) return c.json({ error: 'Rate limit exceeded — 10 manual publishes per minute' }, 429);
    if (denied) return denied;

    const body = await c.req.json<{ postId?: string }>().catch(() => null);
    if (!body?.postId) return c.json({ error: 'postId required' }, 400);

    // Load the post + verify ownership (own-workspace OR agency client owned by uid).
    const post = await c.env.DB.prepare(
      `SELECT p.id, p.user_id, p.client_id, p.content, p.hashtags,
              p.image_url, p.video_url, p.audio_mixed_url, p.post_type
       FROM posts p
       LEFT JOIN clients c ON c.id = p.client_id
       WHERE p.id = ?
         AND (p.user_id = ? OR c.user_id = ?)`
    ).bind(body.postId, uid, uid).first<{
      id: string; user_id: string | null; client_id: string | null;
      content: string; hashtags: string | null;
      image_url: string | null; video_url: string | null;
      audio_mixed_url: string | null; post_type: string | null;
    }>();
    if (!post) return c.json({ error: 'Post not found' }, 404);

    const mapping = await selectProfileByWorkspace(
      c.env,
      post.user_id ?? uid,
      post.client_id,
    );
    if (!mapping?.postproxy_profile_id || !mapping?.postproxy_placement_id) {
      return c.json({
        error: 'No social connection for this workspace — connect Facebook first',
      }, 409);
    }

    const hashtags = post.hashtags ? (JSON.parse(post.hashtags) as string[]) : [];
    const cleanContent = post.content.replace(/(\s+#\w+)+\s*$/, '').trim();
    const fullText = hashtags.length > 0 ? `${cleanContent}\n\n${hashtags.join(' ')}` : cleanContent;
    const media = [post.audio_mixed_url, post.video_url, post.image_url].find((u): u is string => !!u);
    if (!media) return c.json({ error: 'Post has no media (image or video) to publish' }, 400);

    const format: 'feed' | 'reel' = post.post_type === 'video' ? 'reel' : 'feed';

    try {
      const result = await createPost(c.env, {
        profileId: mapping.postproxy_profile_id,
        body: fullText,
        media: [media],
        format,
        pageId: mapping.postproxy_placement_id,
        title: format === 'reel' ? cleanContent.slice(0, 60) : undefined,
      });

      const nowIso = new Date().toISOString();
      await c.env.DB.prepare(
        `UPDATE posts
         SET postproxy_post_id = ?, postproxy_sent_at = ?,
             postproxy_status = 'pending', status = 'Publishing'
         WHERE id = ?`
      ).bind(result.id, nowIso, post.id).run();

      return c.json({ ok: true, postproxyPostId: result.id });
    } catch (err: any) {
      console.error('[postproxy] publish-now failed:', err?.message);
      return c.json({ error: 'Publish failed', message: String(err?.message || err) }, 502);
    }
  });
}
