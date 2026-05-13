# Facebook App Review — Screencast Re-Submission Plan

**App:** SocialAI Studio (App ID `847198108337884`)
**Permissions to re-submit:** `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`
**Last submission:** 2026-03-13 → rejected 2026-03-16 with reason *"Screencast Not Aligned with Use Case Details"*
**Use case:** approved (no changes needed)
**Why this matters:** App is stuck in Development Mode. Only added Testers can connect. Dean Smith was added 2026-05-11 as a workaround, but every new customer hits *"It looks like this app isn't available"* until we go Live.

---

## What Meta said was missing

> The screencast didn't show the **end-to-end** experience for the use case across **all three** permissions. Specifically Meta wants to see, in one continuous flow:
>
> 1. The **complete Meta login** (the OAuth dialog where Facebook asks for permissions)
> 2. The user **explicitly granting** each requested permission
> 3. The **end-to-end use of each permission** inside our app (not screenshots — actual UI being used)
> 4. UI **in English** with English captions/audio

The previous take cut between steps and showed pre-connected state, so reviewers couldn't trace a single user journey from "click Connect" → "Facebook OAuth" → "permission granted" → "post is live on FB".

---

## Recording plan — one continuous take, ~3-4 minutes

### Setup before hitting record

- **Test account:** create a fresh Clerk account on `socialaistudio.au` (don't reuse one with prior connections)
- **Test FB page:** use a Page that's NOT already connected anywhere — the OAuth dialog renders differently for re-grants
- **Browser:** Chrome incognito with English locale (`chrome://settings/languages`)
- **Audio:** record voiceover live OR add captions in post — Meta accepts either as long as it's English
- **Window:** 1280×720 minimum, browser address bar visible (Meta wants to see the URL is `socialaistudio.au`)
- **Pre-record:** be ready to log into Facebook — don't show password entry, but DO show the FB login form so reviewers see the auth handoff

### Scene-by-scene shot list

| # | Duration | Action | Voiceover / Caption |
| - | -------- | ------ | ------------------- |
| 1 | 0:00 – 0:10 | Land on `socialaistudio.au`, click "Sign up free" | "I'm a small business owner in Australia. Let me show you how SocialAI Studio helps me automate Facebook posts." |
| 2 | 0:10 – 0:25 | Complete Clerk signup (new email), then start the OnboardingWizard | "After signup, the wizard walks me through setting up my business." |
| 3 | 0:25 – 0:45 | In the wizard, fill business name + type + tone. Reach the **"Connect your Facebook Page"** step. | "To publish posts, I need to connect my Facebook Business Page." |
| 4 | 0:45 – 1:15 | Click **Connect Facebook**. Show the **Facebook OAuth dialog** appearing. **Pause on the permissions list** — narrate each line: "It's requesting permission to view my Pages list (`pages_show_list`), to publish posts on my behalf (`pages_manage_posts`), and to read engagement on my posts (`pages_read_engagement`)." Click **Continue → Allow**. | Be VERY explicit naming each permission. This is the single most important moment for reviewers. |
| 5 | 1:15 – 1:30 | OAuth redirects back to the app. Show the **page picker** (this is `pages_show_list` in action). Select a Page. | "Now the app shows me my list of Pages — that's `pages_show_list`. I'll select my business Page." |
| 6 | 1:30 – 2:00 | Land on the dashboard. Click **Smart Schedule**. Generate a real post. Edit the caption if you want to show interactivity. | "The AI generates a post tailored to my business." |
| 7 | 2:00 – 2:30 | Click **Publish to Facebook** on the generated post. Show the success toast / "Posted to FB" indicator. **Switch tabs to facebook.com**. Navigate to your Page. **Show the post is live.** | "When I publish, the post goes straight to Facebook — that's `pages_manage_posts` working." |
| 8 | 2:30 – 3:00 | Back in the app, navigate to the **Insights / Performance tab**. Show the post's like / comment / share count being read from FB's API. | "And the app reads engagement back so I can see how my posts are performing — that's `pages_read_engagement`." |
| 9 | 3:00 – 3:15 | Wrap-up shot of the dashboard with multiple posts scheduled. | "All three permissions, end-to-end — discover my Pages, publish on my behalf, and measure how each post does." |

### What NOT to do (these caused the previous rejection)

- ❌ Don't start mid-flow with a pre-connected account
- ❌ Don't cut between "click Connect" and "page picker" — show the OAuth dialog in full
- ❌ Don't just say "and now I can publish" without showing the real Facebook post afterwards
- ❌ Don't skip `pages_read_engagement` — it was in the rejection list, so it MUST appear in the video
- ❌ Don't use a non-English UI — even if your browser defaults to en-AU, double-check the FB OAuth dialog renders in English

---

## Submission checklist

After recording:

- [ ] Re-encode to MP4, H.264, max 1080p, under 50 MB (Meta's upload limit is 100 MB but smaller uploads faster)
- [ ] If using captions instead of voiceover, burn them in (don't rely on a separate `.srt`)
- [ ] Open <https://developers.facebook.com/apps/847198108337884/app-review/submissions/feedback/?submission_id=847199385004423>
- [ ] Click **Request again** on each of the three permissions
- [ ] Upload the new screencast against EACH permission (yes, the same file three times — Meta reviews each line item independently)
- [ ] In the **Notes for reviewer** field, paste:
  > "Re-submission. Previous rejection cited 'screencast not aligned with use case details'. The new screencast shows one continuous user journey from new signup → Facebook OAuth (with the permissions dialog clearly visible) → page selection (pages_show_list) → AI-generated post → publish to FB (pages_manage_posts) → reading engagement back into the app (pages_read_engagement). All UI and captions are in English. Test account credentials are below."
- [ ] In the **Test User credentials** field, provide a working Clerk login for `socialaistudio.au` and confirm the linked FB Page is accessible to that test user

---

## After submission

Meta typically responds within 5-7 business days. While waiting:

- **Dean is unblocked** — he was added as Tester on 2026-05-11
- **Any new customer who hits the "App not available" error** can be added as Tester from <https://developers.facebook.com/apps/847198108337884/roles/roles/> as a stopgap
- **When approved:** flip the app to **Live** mode (top-right toggle in the Developer dashboard) and the "App not available" error disappears for everyone

---

## Why we keep getting rejected (root cause)

The use case Meta approved was *"Help small businesses automate Facebook posts"*. The screencast we sent showed automation but skipped the OAuth handshake — Meta needs to verify that **users see and consent to** the permissions before the app uses them. The previous take started AFTER the consent dialog, so reviewers couldn't verify consent was happening.

The new shot list above puts the OAuth dialog at scene 4 with explicit narration of each permission line — that's the specific gap Meta flagged.
