# Screencast Script — One Continuous Take, ~3:30–4:00

**Goal:** demonstrate, in ONE unedited take, the full end-to-end flow for all 5 submitted scopes. The previous submission (2026-03-13, rejected 2026-03-16) was rejected because it started AFTER the OAuth consent dialog — reviewers couldn't verify that users see and consent to the permissions before the app uses them. This script fixes that by putting the OAuth dialog at the centre of the video with explicit narration of every permission line.

**App ID:** `847198108337884`
**Scopes covered (5):** `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `instagram_content_publish`, `publish_video`
**Use case approved:** *"Help small businesses automate Facebook and Instagram posts"* — no change needed
**Target length:** 3 min 30 sec to 4 min 0 sec
**Target file size:** ≤50 MB MP4 H.264 1080p

---

## Continuity rules — read these once before recording

1. **One take, no cuts.** Beginning to end. If you fumble a line, keep going.
2. **English only.** UI language, voiceover, and burned-in captions all in English. The FB OAuth dialog must render in English — verify in pre-flight.
3. **Show the URL bar at all times.** Reviewers want to confirm we're really at `socialaistudio.au`. Don't go full-screen.
4. **Narrate every permission.** When the OAuth dialog appears, read each permission line aloud. This is the single most important moment in the video.
5. **Show outcomes on Facebook itself.** After publishing, open `facebook.com/<test-page>` in a new tab to prove the post is live. Same for Instagram (`instagram.com/<test-handle>`).
6. **Don't show passwords.** When you log into Facebook, do it OFF-camera or with the password manager auto-filling. Show the login form but not the typed password.

---

## Scene-by-scene

### Scene 1 — Intro (0:00 – 0:15)

**On screen:** Browser tab on <https://socialaistudio.au>. The landing page is visible.
**Action:** click "Sign up free" / log in with the Test Clerk account (`socialai-fb-review+meta@…`).
**Narration:**

> "I'm a small business owner. I run a local cafe and I want to show how SocialAI Studio helps me publish AI-written posts and Reels to my Facebook Page and Instagram account."

---

### Scene 2 — Wizard up to Connect step (0:15 – 0:30)

**On screen:** OnboardingWizard — pre-fill business name (`SocialAI Demo Cafe`), business type (`Cafe`), tone, location. Click Next through each step quickly.
**Action:** advance until you reach the **"Connect your Facebook Page"** step. Stop here.
**Narration:**

> "After signup the wizard walks me through setting up my business. Once it knows what kind of business I run, the next step is to connect my Facebook Page so the app can publish on my behalf."

---

### Scene 3 — Click Connect, hover the explainer (0:30 – 0:50)

**On screen:** the "Connect your Facebook Page" step. Below the big blue button, click the "What happens when I click Connect?" disclosure to expand it. Read the list of 5 steps aloud briefly.
**Action:** click the "What happens when I click Connect?" disclosure. After ~5 seconds, click the **"Connect with Facebook"** button.
**Narration:**

> "Before I click Connect, the app explains exactly what will happen — a real Facebook popup, picking my Page, reviewing permissions, and granting access. Now I'll click Connect with Facebook."

---

### Scene 4 — Facebook OAuth dialog (0:50 – 1:30) — **THE CRITICAL SCENE**

**On screen:** the Facebook Login for Business consent dialog opens in a popup window. It shows:
- The app name ("SocialAI Studio") and Steve's profile avatar
- A list of Pages the user admins → tick **SocialAI Demo Cafe**
- A list of Instagram Business accounts → tick the linked IG account
- A permissions list. Read EVERY line aloud:
  - "View a list of the Pages you manage" → `pages_show_list`
  - "Create and manage content on your Page" → `pages_manage_posts`
  - "Show a list of the Page's posts and read engagement" → `pages_read_engagement`
  - "Create and publish content on behalf of your Instagram Business account" → `instagram_content_publish`
  - "Publish video content to your Page including Reels" → `publish_video`

**Action:** click **Continue → Save** (or Allow, depending on FLB version).
**Narration (read slowly, this is the scene reviewers care about most):**

> "Facebook opens its own popup — this is not our UI, this is Facebook asking me directly. I select the Page I want to connect — SocialAI Demo Cafe. I select the linked Instagram account. Then Facebook shows me exactly what permissions the app is requesting. View my list of Pages — that's pages_show_list. Create and manage posts on my Page — that's pages_manage_posts. Read the engagement on my Page's posts — that's pages_read_engagement. Publish to my Instagram Business account — instagram_content_publish. And publish video content including Reels to my Page — publish_video. I'll click Continue to grant these permissions."

**DO NOT cut the video while the OAuth popup is on screen.** Reviewers must see the full permission list and the user (you) consenting to it in one continuous frame.

---

### Scene 5 — Token exchange + Page picker (1:30 – 1:50) — `pages_show_list` demo

**On screen:** the popup closes, the app returns to the wizard step. Briefly a "Connecting…" spinner appears, then the Page picker UI renders (the `pages` array returned by `/me/accounts`, which is exactly what `pages_show_list` enables).
**Action:** the picker shows your test Page. Click it.
**Narration:**

> "The popup closes and the app receives my consent. Behind the scenes the app calls Facebook's API to fetch the list of Pages I admin — this is pages_show_list in action. The app shows me that list so I can confirm which Page to connect. I'll select SocialAI Demo Cafe."

---

### Scene 6 — Dashboard, generate a post (1:50 – 2:20)

**On screen:** the dashboard. Show the connected-state banner ("SocialAI Demo Cafe connected — auto-publishing active"). Click **Smart Schedule** or **Create Post**.
**Action:** trigger AI generation of a single post. Wait for it to finish (~5-10 seconds). The post appears with caption + AI-generated image.
**Narration:**

> "Now I'm on the dashboard. The app shows my Page is connected. I'll ask the AI to generate a post for me — a special on flat whites this week. The AI writes the caption, generates an image to match, and gets it ready to publish."

---

### Scene 7 — Publish post (2:20 – 2:45) — `pages_manage_posts` demo

**On screen:** the generated post card. Click **Publish to Facebook** (or the equivalent button).
**Action:** the success toast appears. Switch tabs to `facebook.com/<SocialAI-Demo-Cafe>`. The post is live on the Page wall.
**Narration:**

> "I click Publish. The app uses pages_manage_posts to create the post on my Facebook Page. Let me prove it actually published — I'll open Facebook in a new tab and go to my Page. There it is. The post is live with the image and the caption."

---

### Scene 8 — Publish Reel (2:45 – 3:15) — `publish_video` demo

**On screen:** back in the app. Trigger a Reel generation OR use a pre-generated Reel from earlier (must be a video that's already `ready` in the DB — pre-generate it before recording, but only publish during the take). Click **Publish Reel**.
**Action:** the app sends the Reel to FB's `/video_reels` endpoint (this is what `publish_video` gates). Wait for the success toast. Switch tabs to `facebook.com/<SocialAI-Demo-Cafe>/reels` — the Reel is live.
**Narration:**

> "The app also generates short-form video Reels. Same flow — I publish, and the app uses publish_video to upload the Reel to my Page's Reels feed. Here it is on Facebook — published as a Reel."

---

### Scene 9 — Publish to Instagram (3:15 – 3:35) — `instagram_content_publish` demo

**On screen:** back in the app. Show the same generated post being scheduled for Instagram (or use the Instagram tab if separated). Click publish.
**Action:** success toast. Switch tabs to `instagram.com/<test-handle>` — the post is on the IG grid.
**Narration:**

> "And for Instagram — the app uses instagram_content_publish to post the same content to my Instagram Business account. Let me show that on Instagram itself. There it is on the grid."

---

### Scene 10 — Insights tab (3:35 – 3:55) — `pages_read_engagement` demo

**On screen:** back in the app. Click the **Insights** or **Performance** tab. Show the engagement stats reading back from FB — number of likes, comments, shares on the published posts. Even if numbers are zero on a fresh test Page, the API call is what's being demonstrated.
**Action:** point at the engagement numbers on screen.
**Narration:**

> "Finally — the app reads engagement back from Facebook so the user can see how their posts are performing. This is pages_read_engagement. The numbers update as people like and comment on my posts. That helps me see what's working and the AI uses this signal to write better posts over time."

---

### Scene 11 — Wrap (3:55 – 4:00)

**On screen:** dashboard with multiple posts scheduled / published.
**Narration:**

> "That's the full flow — connect my Page through Facebook's own consent dialog, generate AI posts and Reels, publish them to Facebook and Instagram, and read engagement back. Five scopes, all demonstrated end-to-end."

---

## What NOT to do — these caused the previous rejection

- Don't start the video AFTER the OAuth popup. The OAuth dialog must be visible in the recording.
- Don't pre-connect Facebook and "show" a connected state — reviewers can't verify consent that way.
- Don't cut/edit between scenes. One continuous take.
- Don't use a non-English UI. Including the Facebook OAuth dialog itself — verify your browser is set to English BEFORE clicking Connect.
- Don't skip any of the 5 scopes. Each one must have its own visible demonstration moment, even if it takes 15 seconds. Reviewers grade each scope independently.
- Don't show passwords on screen.
- Don't say "trust me, this works" — show the post on Facebook/Instagram itself. Reviewers want proof, not narration.

---

## After recording

### Re-encode and trim

1. Trim to start exactly at Scene 1 — no "checking the mic" preamble.
2. Re-encode to MP4 H.264 at 1080p, target ≤50 MB.
3. If you're using burned-in captions instead of voiceover, render them into the video file (not as a separate `.srt`).

### Submission steps

1. Open <https://developers.facebook.com/apps/847198108337884/app-review/submissions/>
2. Click **New Submission** (or **Request again** if the previous submission UI is still in flight).
3. Select all 5 permissions to add to the submission:
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_content_publish`
   - `publish_video`
4. For EACH permission, upload the same screencast file and paste that scope's section from `reviewer-notes.md` into the notes field.
5. In the "How will your app use this permission?" field for each scope, paste the corresponding section from `reviewer-notes.md`.
6. In the **Test User credentials** section (encrypted), paste credentials from `test-user-credentials.md`.
7. Submit. Meta typically responds in 3–7 business days.

### While you wait

- Existing customers who were manually added as Testers are unaffected. They keep working.
- Any new customer who hits the "App not available" error can still be added as a Tester at <https://developers.facebook.com/apps/847198108337884/roles/roles/> as a stopgap.
- When approval lands, follow `rollout-plan.md`.
