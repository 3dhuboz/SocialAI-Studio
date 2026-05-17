# Facebook App Review — Submission Package

**App:** SocialAI Studio (App ID `847198108337884`)
**Status:** Stuck in Development Mode since 2026-03-16 (last submission rejected)
**Blocker impact:** every new customer who tries to self-onboard hits *"It looks like this app isn't available"*. We currently work around this by manually adding each customer as a Tester at <https://developers.facebook.com/apps/847198108337884/roles/roles/>.

This package contains everything you (Steve) need to record the screencast and submit the App Review — re-doing the previous rejected submission AND adding the two scopes (`instagram_content_publish`, `publish_video`) that the cron already uses but were never submitted.

---

## What's in this folder

| File | Purpose |
| - | - |
| `README.md` (this) | Pre-flight checklist — run through this BEFORE recording |
| `screencast-script.md` | Frame-by-frame shot list with narration |
| `reviewer-notes.md` | Text to paste in each scope's reviewer-notes textarea |
| `scope-set.json` | The exact scope set being submitted (machine-readable, diffable) |
| `test-user-credentials.md` | How to create the test user Meta reviewers will use |
| `rollout-plan.md` | What to do once approval lands |

---

## Pre-flight checklist — DO ALL OF THIS BEFORE HITTING RECORD

### 1. Sanity-check the app is in the right state

- [ ] Visit <https://developers.facebook.com/apps/847198108337884/dashboard/>
- [ ] Verify top-right toggle shows **"Development Mode"** (not Live). If somehow it's Live and broken, that's a different problem — stop and triage.
- [ ] Visit <https://developers.facebook.com/apps/847198108337884/app-review/permissions/> and confirm:
  - The 5 scopes we're submitting all show **"Standard Access"** (not "Advanced Access" — that's the goal of this submission)
  - There's no leftover in-progress submission from a previous attempt. If there is, withdraw it first so reviewers don't see two pending requests.

### 2. Verify scope set matches what's in the code

The OAuth scope set declared in code must match what we submit. The scope set is declared in two places — verify both:

- [ ] **`src/services/facebookService.ts` line ~56** (classic fallback path) currently reads:
      `'pages_show_list,pages_read_engagement,pages_manage_posts,publish_video,instagram_basic,instagram_content_publish,pages_read_user_content'`

      Compare against `docs/fb-app-review/scope-set.json`. If anything's missing, the OAuth dialog won't ask for it and the reviewer will mark the scope as "not demonstrated".

      **Note:** `pages_read_user_content` is in the fallback string but **NOT** in our submission set. That's intentional — we don't actually use it, and submitting unused scopes is a known rejection cause. Before recording, remove `pages_read_user_content` from the fallback string. [VERIFY]

- [ ] **Facebook Login for Business Configuration** (Configuration ID `947627521425720`)
      Visit <https://developers.facebook.com/apps/847198108337884/fb-login-for-business/configurations/>
      Open the "SocialAI Studio Connect" configuration and verify the Permissions list contains exactly the 5 submission scopes plus `instagram_basic` (helper scope — already approved or doesn't require review).
      If `pages_read_user_content` is in there, remove it.

### 3. Browser and recording setup

- [ ] **Fresh Chrome profile.** Open `chrome://settings/people` → Add → "SocialAI App Review". This gives you a profile with no auto-fill, no extensions, no logged-in FB session — exactly what a Meta reviewer sees.
- [ ] **English locale.** In that profile: `chrome://settings/languages` — make sure English (United States) is at the top of the list. The Facebook OAuth dialog renders in the browser's language, and a non-English dialog is an instant rejection.
- [ ] **Window size.** Set browser window to exactly 1280×720 or larger (use the Chrome dev-tools device toolbar to lock the viewport). Meta wants to see the URL bar — don't go full-screen and hide chrome.
- [ ] **Screen recorder.** macOS: QuickTime → File → New Screen Recording → entire screen. Windows: OBS or Xbox Game Bar. Record at 1080p+. Output as MP4 (H.264). Target file size under 50 MB.
- [ ] **Audio.** Either record voiceover live (USB mic recommended) or burn captions in post. Don't rely on a separate `.srt` file — Meta doesn't always render external subtitles. If you go captions-only, write them out from `screencast-script.md` and stack them in the recorder/editor.
- [ ] **Pre-clean Facebook.** In a separate browser (your daily one), log into the Facebook account that admins the test Page, and visit Settings → Apps & Websites → confirm the SocialAI Studio app does NOT already have a token granted. If it does, click "Remove" — the OAuth dialog only shows the full permission list on a fresh grant, not on re-grants.

### 4. Test Page and IG account ready

- [ ] **Test Facebook Page.** If you don't already have one, create a Page called **"SocialAI Demo Cafe"** at <https://www.facebook.com/pages/create>. Category: Local business → Restaurant/Cafe. Don't fill in too many details — reviewers don't care about page content, they care about the OAuth flow.
- [ ] **Test Instagram Business account.** Go to Instagram → Settings → Account type → switch to Business → link to the SocialAI Demo Cafe Page. (If you already have a personal IG you don't want to convert, create a fresh one called `socialaidemocafe`.)
- [ ] **Verify IG linkage.** On Facebook: SocialAI Demo Cafe Page → Settings → Linked Accounts → confirm Instagram shows connected. If not, the `instagram_content_publish` demo won't work.

### 5. Test Clerk account ready

- [ ] Create a new email address dedicated to the test user (e.g. `socialai-fb-review+meta@your-domain.com`). Don't reuse a personal email — Meta reviewers log in with these credentials and you don't want them in your inbox.
- [ ] Sign up at <https://socialaistudio.au> with that email. Complete the OnboardingWizard up to (but NOT including) the "Connect Facebook" step — you want the recording to BEGIN at that step.
- [ ] **Do NOT pre-connect Facebook on this account.** The whole point of the re-submission is to show the OAuth handshake from a virgin state. If you pre-connect, you'll have to disconnect (and even then, FB sometimes shows a different dialog on re-grants).

### 6. Final dry run

- [ ] Run through the entire `screencast-script.md` flow ONCE without recording. Time it. If you're under 2:30 or over 4:30, adjust pacing.
- [ ] Confirm every scope's "demonstration moment" actually fires in the dry run:
  - `pages_show_list` → the page picker shows your test Page
  - `pages_manage_posts` → a real post appears on the test FB Page
  - `pages_read_engagement` → the Insights tab shows non-zero numbers (post at least one thing 24h in advance so the numbers aren't all 0)
  - `instagram_content_publish` → a real post appears on the test IG account
  - `publish_video` → a real Reel appears on the test FB Page

### 7. THEN hit record

One continuous take. No edits other than top-and-tail trim. If you fluff a line, finish the take anyway — reviewers prefer one continuous clip over a stitched edit.

---

## After recording

See `screencast-script.md` for the submission step (uploading the same video against each scope's "Request again" button) and `reviewer-notes.md` for the text to paste in each scope's notes field.

## After approval lands

See `rollout-plan.md` for the SHIP plan — flipping the app to Live mode, smoke-testing fresh signups, and the customer comms.
