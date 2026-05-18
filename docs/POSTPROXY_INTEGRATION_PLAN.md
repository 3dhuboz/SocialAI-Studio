# Postproxy Integration — Implementation Plan (schema_v22)

> Generated 2026-05-19 by the Architect agent. Used by Schema / Backend / Frontend / Cleanup specialists as their work brief.

## 1. Architecture decision

### Migration: **Hard cutover after a brief dual-path window**

Rationale:
- Only **Dean Smith** (and possibly 2-3 portal-tenant customers) has live FB tokens. Coordinating a single reconnect is cheap; maintaining two publish paths in `cron/publish-missed.ts` permanently doubles failure modes and blocks the retirement of `poll-pending-reels`, `refresh-tokens`, and `routes/facebook.ts`.
- **Phase 1 (weeks 1–2 after merge):** keep both code paths live, gated by a new boolean column `users.use_postproxy` (default `false` for legacy, `true` for new connections). The publish cron reads this flag and dispatches to either the legacy Graph path or the new Postproxy path.
- **Phase 2 (week 3):** email existing customers to reconnect, set `use_postproxy=true` for everyone, delete legacy code. The dual-path window is intentionally short-lived — it exists only to derisk the cutover, not to be a permanent fork.

### Profile-group strategy: **One group per workspace tuple**

Each `(user_id, client_id)` workspace gets its own Postproxy profile group named like `socialai-{userId-short}-{clientId-short|own}`. Rationale:
- We get clean isolation: one customer revoking their FB OAuth only affects their group.
- Postproxy's "initialize_connection" call requires a group ID — we mint one per workspace at first-connect time and persist it.
- The "default group" pattern would force us to filter by `profile_id` everywhere; the per-workspace-group pattern lets us trust group scoping at the API level.

## 2. New / modified file inventory

| File path | Purpose | Owner | Depends on |
|---|---|---|---|
| `workers/api/schema_v22_postproxy.sql` | ALTER TABLEs, new `postproxy_profiles` table, indexes | **Schema** | — |
| `workers/api/src/lib/postproxy.ts` | Thin typed client for Postproxy REST API (groups, init connection, profiles, placements, posts, status). One file, no UI dependencies. | **Backend** | env.ts |
| `workers/api/src/lib/postproxy-webhook.ts` | Webhook signature validation (HMAC) + event-to-DB mapping pure functions | **Backend** | env.ts |
| `workers/api/src/routes/postproxy.ts` | HTTP routes: `POST /api/postproxy/init-connection`, `GET /api/postproxy/profiles`, `GET /api/postproxy/placements`, `POST /api/postproxy/save-placement`, `POST /api/postproxy/webhook`, `GET /api/postproxy/oauth-callback` | **Backend** | postproxy.ts, postproxy-webhook.ts |
| `workers/api/src/cron/publish-missed.ts` *(modified)* | Branch on `use_postproxy` flag; for Postproxy path, call `lib/postproxy.ts:createPost` instead of Graph multipart upload; no more reel kick-poll loop on the new path | **Backend** | postproxy.ts |
| `workers/api/src/cron/_shared.ts` *(modified)* | Extend `SocialTokens` type with `postproxyProfileId`, `postproxyPlacementId`, `postproxyGroupId`; add `loadPostproxyMappingForPosts` parallel helper | **Backend** | — |
| `workers/api/src/env.ts` *(modified)* | Add `POSTPROXY_API_KEY: string`, `POSTPROXY_WEBHOOK_SECRET?: string`, `POSTPROXY_BASE_URL?: string` (default `https://api.postproxy.dev/api`) | **Backend** | — |
| `workers/api/src/index.ts` *(modified)* | Register `registerPostproxyRoutes(app)` | **Backend** | routes/postproxy.ts |
| `workers/api/src/cron/dispatcher.ts` *(modified)* | Conditionally skip `cronPollPendingReels` when env flag set (kept for legacy migration window); after cutover, remove | **Cleanup** | — |
| `workers/api/wrangler.toml` *(modified)* | Document new secrets, remove `0 3 * * *` token-refresh trigger after cutover | **Cleanup** | — |
| `src/services/postproxyService.ts` | Frontend service: `initConnection(clientId?)`, `listPlacements()`, `savePlacement(placementId)`. Wraps the worker endpoints. | **Frontend** | — |
| `src/components/PostproxyConnectButton.tsx` | New component replacing `FacebookConnectButton`. Two-stage UX: 1) "Connect Facebook via Postproxy" → opens hosted OAuth in new tab. 2) "Pick a Page" picker (placements list). | **Frontend** | postproxyService.ts |
| `src/components/MigrationBanner.tsx` | Banner shown in `AccountPanel` when `socialTokens.facebookConnected && !socialTokens.postproxyPlacementId` — "Reconnect to upgrade publishing" | **Frontend** | — |
| `src/App.tsx` *(modified)* | Swap `<FacebookConnectButton />` for `<PostproxyConnectButton />` in two places (Settings + Onboarding); update the inline direct-publish code in PostModal/Calendar to call the worker (no direct Graph from the browser); add the migration banner | **Frontend** | PostproxyConnectButton.tsx, MigrationBanner.tsx |
| `src/components/OnboardingWizard.tsx` *(modified)* | Swap `FacebookConnectButton` → `PostproxyConnectButton`; remove `longLivedUserToken` flow; tokens come from worker via `db.getSocialTokens` after redirect callback | **Frontend** | PostproxyConnectButton.tsx |
| `src/types.ts` *(modified)* | Extend `SocialTokens` interface with `postproxyProfileId`, `postproxyPlacementId`, `postproxyGroupId`, `postproxyProfileStatus`, `postproxyConnectedAt`. Deprecate `longLivedUserToken`, `facebookPageAccessToken` (keep field for back-compat read). | **Schema** | — |
| `src/services/facebookService.ts` *(modified)* | **DELETE** all publish/post methods (`postToPageDirect`, `postToInstagram`, `postReelToInstagram`, `postToPageScheduled`, etc.). **KEEP** `getPageStats`, `getRecentPosts` — these still read engagement for `client_facts` via the page token... wait, those page tokens are gone. See §6 about facts. | **Cleanup** | — |
| `src/services/facebookPublishService.ts` *(DELETE)* | Functionality fully moves to the worker | **Cleanup** | — |
| `workers/api/src/routes/facebook.ts` *(DELETE after cutover)* | `facebook-exchange-token` and `test-reel-publish` both become dead code | **Cleanup** | — |
| `workers/api/src/cron/refresh-tokens.ts` *(DELETE after cutover)* | Postproxy refreshes internally; deprecate | **Cleanup** | — |
| `workers/api/src/cron/poll-pending-reels.ts` *(DELETE after cutover)* | Reel status now arrives via webhook | **Cleanup** | — |
| `workers/api/src/lib/facebook-facts.ts` *(NO CHANGES required immediately)* | Public Page reads work via Postproxy's `/profiles/:id/placements` or via the IG/FB Graph public endpoints — see §6 open question | **Cleanup** | — |

## 3. Schema changes (schema_v22_postproxy.sql)

```sql
-- schema_v22: Postproxy integration
-- Run: npx wrangler d1 execute socialai-db --remote --file=schema_v22_postproxy.sql

-- Per-user feature flag for cutover window. Defaults to 0 = legacy Graph path.
-- The frontend's "Connect via Postproxy" flow flips this to 1 on first save.
ALTER TABLE users   ADD COLUMN use_postproxy INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN use_postproxy INTEGER DEFAULT 0;

-- Per-workspace Postproxy mapping. Single row per (user_id, client_id) tuple.
-- client_id IS NULL for own-workspace tokens; UNIQUE composite enforced via
-- partial unique index because SQLite treats NULL as distinct in regular unique
-- constraints.
CREATE TABLE IF NOT EXISTS postproxy_profiles (
  id                   TEXT PRIMARY KEY,             -- ULID minted by worker
  user_id              TEXT NOT NULL,
  client_id            TEXT,                          -- NULL = own workspace
  postproxy_group_id   TEXT NOT NULL,                 -- profile_groups.id from Postproxy
  postproxy_profile_id TEXT,                          -- profiles.id once OAuth completes; NULL pre-OAuth
  postproxy_placement_id TEXT,                        -- chosen FB page numeric ID (= placement.id)
  fb_page_name         TEXT,                          -- display label only
  profile_status       TEXT DEFAULT 'pending',        -- pending | active | expired | revoked
  oauth_state          TEXT,                          -- short-lived nonce for redirect_url
  expires_at           TEXT,                          -- Postproxy's expires_at (informational)
  connected_at         TEXT,                          -- ISO when profile became active
  created_at           TEXT DEFAULT (datetime('now')),
  updated_at           TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_postproxy_workspace_own
  ON postproxy_profiles(user_id) WHERE client_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_postproxy_workspace_client
  ON postproxy_profiles(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_postproxy_placement ON postproxy_profiles(postproxy_placement_id);
CREATE INDEX IF NOT EXISTS idx_postproxy_oauth_state ON postproxy_profiles(oauth_state)
  WHERE oauth_state IS NOT NULL;

-- Per-post tracking. Replaces fb_video_id / fb_publish_state for the Postproxy path.
ALTER TABLE posts ADD COLUMN postproxy_post_id  TEXT;
ALTER TABLE posts ADD COLUMN postproxy_status   TEXT;
ALTER TABLE posts ADD COLUMN postproxy_permalink TEXT;
ALTER TABLE posts ADD COLUMN postproxy_sent_at  TEXT;
ALTER TABLE posts ADD COLUMN postproxy_finished_at TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_postproxy_status
  ON posts(postproxy_status) WHERE postproxy_status IN ('pending');
CREATE INDEX IF NOT EXISTS idx_posts_postproxy_id
  ON posts(postproxy_post_id) WHERE postproxy_post_id IS NOT NULL;

-- Webhook idempotency
CREATE TABLE IF NOT EXISTS postproxy_webhook_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  post_id     TEXT,
  received_at TEXT DEFAULT (datetime('now')),
  payload     TEXT
);
```

## 4. End-to-end flows (sequence)

### 4.1 New customer onboarding
1. Browser clicks "Connect Facebook" → `POST /api/postproxy/init-connection {clientId?}`
2. Worker: ensure profile_group for this workspace exists (create if missing), call Postproxy `initialize_connection`, get back hosted OAuth URL, INSERT pending `postproxy_profiles` row with `oauth_state` nonce.
3. Browser redirects to Postproxy hosted page → Meta consent → Postproxy redirects back to `socialaistudio.au/api/postproxy/oauth-callback?state=<nonce>`.
4. Worker: validates state, marks `postproxy_profiles.status = 'active'`, fetches `/api/profiles` to get profile ID + expires_at.
5. 303 redirect to `/onboarding?step=pick-placement`.
6. Browser: `GET /api/postproxy/placements` → shows FB Page picker.
7. User picks page → `POST /api/postproxy/save-placement {placementId, pageName}` → worker UPDATEs `postproxy_placement_id`, sets `users.use_postproxy=1`.

### 4.2 Existing customer migration
Same as 4.1, but `MigrationBanner` is the trigger. On save-placement, `use_postproxy=1` and the publish cron stops using legacy `social_tokens.facebookPageAccessToken` for this workspace.

### 4.3 Single post publishing (text + image)
```
publish-missed cron (*/5):
  Claim 20 posts → for each:
    use_postproxy=1?
      yes → load postproxy_profile + placement
            POST https://api.postproxy.dev/api/posts
              { post:{body, draft:false}, profiles:[profile_id],
                media:[image_url],
                platforms:{facebook:{format:"feed", page_id:placement_id}} }
            → 200 {id, status:"pending"}
            UPDATE posts SET postproxy_post_id=?, postproxy_sent_at=now,
                              postproxy_status='pending', status='Publishing'
      no  → legacy Graph path (untouched)
```
Status transitions arrive via webhook. Cron does NOT poll Postproxy.

### 4.4 Reel publishing
Identical to 4.3 except `format:"reel"` and `title = first 60 chars of caption`. No kick-then-poll — Postproxy owns the upload.

### 4.5 Webhook arrival
```
POST /api/postproxy/webhook (publicly reachable, no Clerk auth)
  Headers: X-Postproxy-Signature: <hmac-sha256 of body using POSTPROXY_WEBHOOK_SECRET>
  Body: { event_id, type, post_id, platform_post:{status, permalink, error} }

Worker:
  1. Verify HMAC (timing-safe) OR fall back to ?secret= query if HMAC unavailable
  2. INSERT OR IGNORE INTO postproxy_webhook_events → dup = 200 no-op
  3. SELECT id FROM posts WHERE postproxy_post_id = ?
  4. Switch type:
       platform_post.published → status='Posted', postproxy_status='published', permalink
       platform_post.failed    → status='Missed', postproxy_status='failed', notifyOwner
       post.processed          → log only
  5. Return 200 {ok:true}
```

## 5. R2 media exposure

**No changes required.** Both buckets are already publicly fetchable:
- Videos: `REELS_R2` exposed at `https://pub-cff7bdfbd7204e129ae671d65d62b20e.r2.dev` (`R2_REELS_PUBLIC_BASE`).
- Images: fal.ai-hosted URLs are public ~24h — covers publish window.

The publish cron passes whichever public URL it has to Postproxy in the `media` array.

## 6. Cron changes

- `publish-missed` (modified): branch on `use_postproxy`. Postproxy path skips reel kick-poll entirely. One outbound HTTP per post (~300ms); 20 posts/tick fits in 30s.
- `poll-pending-reels` (retire): zero rows in `kicked|polling` state AND zero users with `use_postproxy=0` → delete file, remove dispatcher entry.
- `refresh-tokens` (retire): Postproxy refreshes internally. Delete file + remove `0 3 * * *` trigger after cutover.

## 7. Rollout plan

### Merge order (strict)
1. **Schema PR**: apply schema_v22 to staging + prod. Update src/types.ts.
2. **Backend PR**: lib/postproxy.ts, routes/postproxy.ts, modified publish-missed.ts. Behind `use_postproxy=0` default — no behavioral change. Includes secret: `wrangler secret put POSTPROXY_API_KEY`.
3. **Frontend PR**: PostproxyConnectButton, App.tsx swaps, MigrationBanner.
4. **Cleanup PR** (week 3+): delete legacy crons + routes + drop `fb_*` columns.

### Feature flag
- Per-user: `users.use_postproxy` (default 0).
- Global kill switch: `ENABLE_POSTPROXY` env var in wrangler.toml.

### Rollback
- Mid-window failure: flip `ENABLE_POSTPROXY=false`, redeploy. Cron falls back to legacy.
- Post-cutover failure: no graceful fallback. Keep schema_v22 + frontend additive until Postproxy SLAs proven.

## 8. Specialist assignments

### Schema specialist
- **Files owned:** `workers/api/schema_v22_postproxy.sql` (new), `src/types.ts` (interface extension only).
- **Dependencies:** none.
- **Acceptance criteria:**
  - schema_v22.sql lints + applies to staging successfully.
  - `SocialTokens` interface extended with optional `postproxyProfileId`, `postproxyPlacementId`, `postproxyGroupId`, `postproxyProfileStatus`, `postproxyConnectedAt`.
  - Existing JSON paths still type-check.

### Backend specialist
- **Files owned:** `workers/api/src/lib/postproxy.ts`, `workers/api/src/lib/postproxy-webhook.ts`, `workers/api/src/routes/postproxy.ts`, `workers/api/src/env.ts`, `workers/api/src/index.ts`, `workers/api/src/cron/_shared.ts`, `workers/api/src/cron/publish-missed.ts`.
- **Dependencies:** Schema PR merged first.
- **Required function signatures in `lib/postproxy.ts`:**
  ```ts
  ensureProfileGroup(env, workspaceLabel): Promise<{id: string}>
  initializeConnection(env, groupId, redirectUrl): Promise<{url: string}>
  listProfiles(env, groupId?): Promise<Profile[]>
  listPlacements(env, profileId): Promise<{id:string,name:string}[]>
  createPost(env, args: {profileId, body, media, format:'feed'|'reel', pageId, title?}): Promise<{id:string, status:string}>
  getPost(env, postId): Promise<PostStatus>
  ```
- **Acceptance criteria:**
  - `POSTPROXY_API_KEY`, `POSTPROXY_WEBHOOK_SECRET`, `POSTPROXY_BASE_URL` added to `Env`.
  - 5 routes mounted: init-connection, oauth-callback, placements, save-placement, webhook.
  - `cronPublishMissedPosts` branches on `use_postproxy`; Postproxy path passes a unit test asserting Postproxy payload shape.
  - Webhook idempotency proven via test.
  - No changes to legacy Graph path behavior when `use_postproxy=0`.

### Frontend specialist
- **Files owned:** `src/services/postproxyService.ts`, `src/components/PostproxyConnectButton.tsx`, `src/components/MigrationBanner.tsx`, `src/App.tsx` (FacebookConnectButton call sites + direct-publish sites), `src/components/OnboardingWizard.tsx`.
- **Dependencies:** Backend PR merged first.
- **Acceptance criteria:**
  - Settings page shows `PostproxyConnectButton`. Click → opens hosted OAuth in same-tab. After redirect, placement picker renders.
  - OnboardingWizard step "Connect Facebook" uses `PostproxyConnectButton`.
  - Browser-side direct Graph calls in App.tsx replaced with worker `POST /api/postproxy/publish-now`.
  - `MigrationBanner` renders when legacy FB connected but no Postproxy placement.

### Cleanup specialist (DEFERRED to week 3+)
- **Files owned:** delete `cron/poll-pending-reels.ts`, `cron/refresh-tokens.ts`, `routes/facebook.ts`, `services/facebookPublishService.ts`, `FacebookConnectButton.tsx`. Modify `dispatcher.ts`, `wrangler.toml`. Add `schema_v23_drop_legacy_fb_columns.sql`.
- **Dependencies:** Backend + Frontend live AND zero `use_postproxy=0` AND zero `fb_publish_state IN ('kicked','polling')`.

## 9. Open questions / risks

1. **Webhook auth:** HMAC vs query-string shared secret. **Default decision:** implement query-string shared secret (`?secret=<env>`), upgrade to HMAC when Postproxy publishes docs.
2. **Instagram support:** Does Postproxy IG come from same FB OAuth or separate? **Default decision:** FB-only in v1; flag IG as P1 follow-up.
3. **Per-customer Postproxy cost:** does pricing scale by profile_count? Check Postproxy dashboard.
4. **`facebook-facts.ts`:** daily engagement scraping needs page token. **Default decision:** keep legacy facts cron running on legacy `social_tokens` rows; new customers get empty fact set until resolved (P1 follow-up — ask Postproxy if they expose Insights).
5. **OAuth redirect URL:** must register `https://socialai-api.steve-700.workers.dev/api/postproxy/oauth-callback` in Postproxy dashboard.
6. **`TestReelPublishButton`:** replace with "Test connection" → `GET /api/profiles/:id`, check `status==='active'`.
