# Reels round-trip smoke test

Manual end-to-end test for the Shopify embedded-app Reels flow:
**Autopilot → prewarm-videos cron → publish-missed cron → live FB Reel**.

Budget: **~25 min wall-clock** (5 min setup + 5 min Kling kickoff + 10–15 min generation + publish).

---

## Pre-flight (do these once, before scheduling)

1. **FB Page connected** — Shopify admin → app → **Settings** → Facebook shows "Connected" with a page name.
2. **Products synced** — **Products** tab shows at least 1 row. If empty: click **Sync products**.
3. **Cron triggers live** — confirm in Cloudflare dashboard → Workers → `socialai-api` → Triggers:
   - `*/5 * * * *` (prewarm-videos + publish-missed)
4. **R2 binding** — `REELS_R2` bucket bound + `R2_REELS_PUBLIC_BASE` env var set (otherwise videos won't survive 24h).
5. **fal.ai credit** — at least $5 (Kling i2v is ~$0.30/run; a 3-Reel batch = ~$1).

---

## Run the test

### Step 1 — Generate

1. Open **Autopilot** in the Shopify admin.
2. Pick **Smart Schedule** vibe (good default — 14 posts max, spaced sensibly).
3. Set **Post count = 4** (small enough to watch end-to-end, even spread = 2 image + 2 video).
4. Toggle **Include Reels** ON.
5. Click **Generate N posts**.
6. Watch the progress card: should hit `4/4 succeeded` within ~60–90s.

**Checkpoint A — confirm posts landed in D1**

```bash
cd workers/api
npx wrangler d1 execute socialai-db --remote --command="
  SELECT id, post_type, video_status, status, scheduled_for, substr(content, 1, 60) AS preview
  FROM posts
  WHERE owner_kind = 'shop'
    AND owner_id = '<your-shop>.myshopify.com'
  ORDER BY created_at DESC
  LIMIT 4
"
```

Expect: 4 rows, alternating `post_type` = `image` / `video`, all `status='Scheduled'`, video rows have `video_status='pending'`.

### Step 2 — Watch prewarm-videos

Wait up to **5 min** for the next cron tick. Then re-run the query above.

**Checkpoint B — video kickoff**

Video rows should now show `video_status='generating'` (and have a populated `video_request_id` if you `SELECT` it).

```sql
-- Verify Kling was called
SELECT id, video_status, video_request_id, video_started_at, video_error
FROM posts
WHERE owner_kind = 'shop' AND owner_id = '<your-shop>.myshopify.com'
  AND post_type = 'video';
```

If `video_status='failed'` — check `video_error`. Common causes:
- "No thumbnail to animate" → `image_url` was null (image stage failed silently — check Autopilot logs)
- "Kling start failed: insufficient credits" → top up fal.ai
- "Kling start failed: HTTP 401" → `FAL_API_KEY` worker secret missing / wrong

### Step 3 — Watch video land

Kling i2v p99 ≈ 3 min. Allow **5–10 min** from kickoff. Re-run the query above.

**Checkpoint C — video ready**

`video_status='ready'`, `video_url` populated with an R2-backed URL (starts with `R2_REELS_PUBLIC_BASE`).

If stuck on `generating` for >8 min → the prewarm cron will time it out and flip to `failed` automatically. Publish-missed will then fall back to image-only.

### Step 4 — Reschedule one Reel to publish soon

By default Autopilot schedules in the future. To watch the publish path without waiting hours:

1. Open **Calendar**.
2. Drag one of the **video** posts onto today's slot, ~5 min from now.
3. Confirm the time in the toast.

```sql
-- Sanity-check the reschedule landed
SELECT id, scheduled_for, status
FROM posts
WHERE owner_kind = 'shop' AND owner_id = '<your-shop>.myshopify.com'
  AND post_type = 'video' AND video_status = 'ready'
ORDER BY scheduled_for ASC
LIMIT 1;
```

### Step 5 — Watch publish-missed

Wait for `scheduled_for` to pass, then the next cron tick (≤5 min after).

**Checkpoint D — published**

```sql
SELECT id, status, fb_post_id, reasoning, published_at
FROM posts
WHERE owner_kind = 'shop' AND owner_id = '<your-shop>.myshopify.com'
  AND post_type = 'video'
ORDER BY scheduled_for DESC
LIMIT 1;
```

Expect: `status='Published'`, `fb_post_id` populated (`<page_id>_<post_id>` shape), `published_at` set.

Then go to the merchant's Facebook Page → **Reels** tab → confirm the Reel is live.

---

## Failure-mode quick reference

| Symptom | Where to look |
|---|---|
| Autopilot shows `0/N succeeded` | Worker logs (Cloudflare → Workers → Live tail). Look for `[shopify-autopilot]` errors. |
| Posts created but no `video_status` set | Frontend sent `postType='image'`. Check `Include Reels` toggle was ON before clicking Generate. |
| `video_status` stuck on `pending` >10 min | prewarm-videos cron didn't run, or `FAL_API_KEY` missing. Check Cloudflare → Workers → Triggers + Logs. |
| `video_status='ready'` but never publishes | `scheduled_for` is in the future, OR publish-missed cron not firing. Check cron logs. |
| Published as image-only (no video) | `video_status='failed'` — publish path falls back to image. Look at `video_error` for the cause. |
| FB error "Video not eligible for Reels" | Aspect ratio mismatch (Reels requires 9:16). Kling is set to `9:16` — if you see this, raise an issue. |
| FB error "Reels require a page subscription" | Page is missing `pages_manage_posts` scope or the page is in a restricted state. Reconnect in Settings. |

---

## What this validates

If Checkpoint D passes:

- [x] Autopilot bulk-gen path (caption + image + scheduling) — **#84/#85**
- [x] Active-campaign context lookup (if you had a campaign running) — **#86/#87**
- [x] Shop-tenant filter in `ACTIVE_CLIENT_FILTER` (shop posts have `client_id=NULL`) — **#88**
- [x] prewarm-videos cron picks up shop-owned video posts — **#89**
- [x] R2 caching of fal.ai video before fal's 24h URL expires — **#89**
- [x] publish-missed cron handles `owner_kind='shop'` rows and ships to FB Reels — **#89**

If any checkpoint fails, the failure-mode table above narrows it to a single cron / route / config issue.
