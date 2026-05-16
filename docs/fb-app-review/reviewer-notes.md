# Reviewer Notes — One Block Per Scope

These are the texts to paste into each scope's reviewer-notes textarea on the Meta dashboard. Copy each section verbatim. Timestamps reference the screencast (`screencast-script.md`).

Tone: professional, concise, user-value first. Imagine a Meta reviewer looking at their 500th app today — make their job easy. Each block answers three questions: *what we do with the data, why we need it, where to verify in the video*.

---

## How users authenticate (paste at the TOP of the first scope's notes — Meta shows this on the submission summary)

> SocialAI Studio is a content-scheduling tool for small businesses (cafes, retailers, tradespeople). After a user signs up at https://socialaistudio.au, our onboarding wizard prompts them to connect their Facebook Page using Facebook Login for Business. The Configuration ID is `947627521425720` and the resulting User Access Token is exchanged server-side for long-lived Page Access Tokens (via `oauth/access_token` with `grant_type=fb_exchange_token`) which we store encrypted in Cloudflare D1.
>
> All permission usage happens server-side from a Cloudflare Workers cron that runs every 5 minutes (workers/api/src/cron/publish-missed.ts) and is triggered when a scheduled post's `scheduled_for` timestamp has passed.
>
> Please use the test credentials in the encrypted "Test User credentials" section. The Test User is admin of the Facebook Page "SocialAI Demo Cafe" and the connected Instagram Business account "@socialaidemocafe".

---

## `pages_show_list`

**Paste into this scope's "How will your app use this permission?" field:**

> After a user grants consent through the Facebook Login for Business dialog, we call `GET /me/accounts` to retrieve the list of Pages they admin. We render those Pages in a picker so the user can choose which one to connect to SocialAI Studio — most users admin more than one Page, and we cannot assume which one they want to use the app with.
>
> Without `pages_show_list` the user would have to type their Page ID manually, which is not discoverable from the user-facing Facebook UI and would block 90% of small-business owners from completing setup.
>
> **Verify in screencast:** 1:30 – 1:50. After the OAuth dialog closes, the page picker renders inline in our wizard. The voiceover names the scope explicitly as the picker appears.

---

## `pages_manage_posts`

**Paste into this scope's "How will your app use this permission?" field:**

> Our app generates AI-written posts (caption + image) for the user's business. When the user clicks Publish — or when the scheduled time arrives in our background cron — we publish the post to the user's Facebook Page by calling `POST /{page-id}/feed` (text-only) or `POST /{page-id}/photos` (image + caption) with the Page Access Token.
>
> This is the core value proposition of the product: small-business owners outsource the time-consuming work of writing and scheduling Facebook posts to an AI that knows their brand. `pages_manage_posts` is the permission that enables the actual publishing step — without it the app can generate posts but cannot post them, which defeats the purpose.
>
> We do not read user-generated content with this scope. We do not modify or delete posts the user did not create through our app. We only create new posts on Pages the user explicitly connected.
>
> **Verify in screencast:** 2:20 – 2:45. The user clicks Publish in our app, then the next tab shows the post live on facebook.com/SocialAI-Demo-Cafe.

---

## `pages_read_engagement`

**Paste into this scope's "How will your app use this permission?" field:**

> After a post is published, we read engagement metrics (likes, comments, shares, and Page-level Insights) back from Facebook. Two reasons:
>
> 1. **User-facing analytics.** The user opens the Insights tab in our dashboard and sees how each of their posts is performing — same data they would see in Facebook's native Meta Business Suite, surfaced inside the tool they're already using.
> 2. **AI improvement signal.** The AI uses 28-day rolling engagement data as a feedback signal — posts with higher engagement inform the style of future generations for that business. Without this scope the AI cannot learn what's actually working for the user.
>
> We call `GET /{page-id}/insights` (`page_impressions_unique`, `page_engaged_users` over 28 days) and `GET /{page-id}/posts` (`likes.summary`, `comments.summary`, `shares`). Aggregate values only — we never read individual user identities of commenters.
>
> **Verify in screencast:** 3:35 – 3:55. The Insights tab shows the engagement numbers reading back from Facebook.

---

## `instagram_content_publish`

**Paste into this scope's "How will your app use this permission?" field:**

> When a user connects their Facebook Page, we also detect any linked Instagram Business account (via the `instagram_business_account` field on `/me/accounts`). After AI generation, the user can publish the same post — caption + image — to their Instagram account using the Content Publishing API: two calls, `POST /{ig-user-id}/media` to create a media container, then `POST /{ig-user-id}/media_publish` with the resulting creation ID.
>
> Small businesses publish to Facebook AND Instagram in parallel — most of them want one source of truth and one place to schedule from. `instagram_content_publish` lets us match what Meta Business Suite does for first-party users, so small businesses don't need separate tools for FB and IG.
>
> We only publish to Instagram Business accounts the user has explicitly linked to their Facebook Page. We do not read DMs, follower lists, or any private data with this scope. Publishing only — never editing or deleting existing posts.
>
> **Verify in screencast:** 3:15 – 3:35. The app publishes a post to the connected IG account; the next tab shows it live on instagram.com.

---

## `publish_video`

**Paste into this scope's "How will your app use this permission?" field:**

> Our app generates short-form video Reels (3–60s, 9:16, MP4 H.264) for the user's business. When the user publishes a Reel — or our cron picks up a scheduled video post — we call the `/{page-id}/video_reels` endpoint with the three-phase resumable upload flow (`upload_phase=start` → hosted-URL transfer → `upload_phase=finish` with `video_state=PUBLISHED`).
>
> Reels are the highest-engagement format on Facebook in 2026 and they're the single most-requested feature from our customers. Without `publish_video`, our app can generate Reel videos but cannot publish them, and users have to download the MP4 and upload to Facebook themselves — which defeats the "set it and forget it" value of the product.
>
> Implementation lives at `workers/api/src/cron/publish-missed.ts` (the `postReelToFacebookPage` function) and there is a pre-flight smoke-test endpoint at `POST /api/test-reel-publish` that kicks off `upload_phase=start` without completing the upload, so users can verify their connection works before scheduling a batch of Reels.
>
> **Verify in screencast:** 2:45 – 3:15. The user publishes a Reel through our app; the next tab shows it live on the Page's Reels feed.

---

## Catch-all "Test instructions" field (paste at the bottom of every scope)

> **Test instructions for the reviewer:**
>
> 1. Open https://socialaistudio.au in a fresh browser session (incognito recommended).
> 2. Click "Log in" and use the test credentials provided in the encrypted Test User field.
> 3. The dashboard loads with the connected Page "SocialAI Demo Cafe" already linked — the Test User was set up by signing up and completing the wizard ahead of submission. **To test the OAuth handshake from scratch:** open Settings → Connected Accounts → click "Disconnect Facebook" → click "Connect with Facebook" → walk through the OAuth dialog. This reproduces the flow shown at 0:30–1:30 in the screencast.
> 4. To test publishing: open the dashboard, click Smart Schedule, generate a post, click Publish to Facebook. The post will appear on the "SocialAI Demo Cafe" Page (https://www.facebook.com/SocialAI-Demo-Cafe — [VERIFY] use real URL once Page exists).
> 5. To test Instagram publishing: same flow with the "Post to Instagram" toggle on. Post appears at https://www.instagram.com/socialaidemocafe.
> 6. To test Reels: dashboard → Create Reel → Generate → Publish. The Reel appears on the Page's Reels tab. (Reel generation takes 30–60s — please wait for the success toast.)
> 7. To test engagement read: open the Insights tab in the dashboard. Engagement metrics for the test Page's posts will display.
>
> If anything fails, please contact Steve at the developer email — happy to walk a reviewer through the flow live on a video call.
