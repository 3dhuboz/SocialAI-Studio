# Test User Credentials — For Meta Reviewers

Meta App Review requires a working Test User that reviewers can log in as. The credentials go into the **encrypted "Test User credentials"** field on the submission form (developers.facebook.com → app → App Review → Submissions → your submission → Edit → Test credentials section). That field is end-to-end encrypted — only the assigned reviewer sees it.

There are two flavors of "Test User" Meta supports. Use **Option A** (real Clerk + real test FB Page). Option B (FB-issued Test User) is documented for completeness but has limitations that make it the wrong choice for our use case.

---

## Option A — Real Clerk account + dedicated Facebook test Page (RECOMMENDED)

This is what reviewers actually want to see and what our screencast script assumes.

### Step 1 — Create the dedicated Facebook account

Use a **dedicated Facebook personal profile** for this — not your daily-driver account. Reviewers will log into this profile, so don't share an account that has personal photos, private messages, or anything sensitive.

If you don't already have one:

1. Open <https://www.facebook.com> in an incognito window.
2. Create an account with email `socialai-fb-review@<your-domain>.com` and a password you'll store in the credentials block below.
3. Confirm the email.

> If you already have a "Steve dev" or "test" Facebook account, you can reuse it — just make sure it doesn't have any other apps connected that might confuse the reviewer.

### Step 2 — Create the test Facebook Page

1. Logged in as the test FB account → <https://www.facebook.com/pages/create>
2. Page name: **SocialAI Demo Cafe**
3. Category: Local business → Coffee Shop (or Restaurant/Cafe)
4. Skip the "add a profile photo" step or add a generic stock photo — content doesn't matter, the OAuth flow does
5. **Save the Page username** — you'll need the URL for reviewer notes. Aim for something like `SocialAIDemoCafe` so the URL is `https://www.facebook.com/SocialAIDemoCafe`.

### Step 3 — Create the test Instagram Business account

1. On a mobile device or via <https://www.instagram.com/accounts/signup/>, create an Instagram account: `socialaidemocafe`
2. In the IG app: Settings → Account → Switch to Business Account → Cafe category
3. In the IG app: Settings → Account → Linked Accounts → Facebook → log in as the test FB account → link to the SocialAI Demo Cafe Page

Verify on Facebook: SocialAI Demo Cafe Page → Settings → Linked Accounts → Instagram should show connected.

### Step 4 — Create the SocialAI Studio (Clerk) account

1. Open <https://socialaistudio.au> in a fresh incognito browser.
2. Sign up with email `socialai-fb-review@<your-domain>.com` (same as the FB account is fine — different system, no conflict).
3. Complete the wizard with placeholder business details:
   - Business name: SocialAI Demo Cafe
   - Type: Cafe
   - Location: Sydney, Australia
   - Tone: Friendly and casual
4. **Stop at the "Connect your Facebook Page" step. Do NOT connect.**

   We want the reviewer to perform the OAuth handshake themselves to verify it works — that's the point of the submission.

### Step 5 — Add the test FB account as an App Tester

Until the app is Live, only Roles users can OAuth into it. So:

1. <https://developers.facebook.com/apps/847198108337884/roles/roles/>
2. Add Testers → invite the test FB account by email or FB profile URL
3. The test FB account will receive a notification — accept it by logging in.

(Once we go Live this step is no longer needed — but for the App Review itself we still need the test account to be a Tester because the app IS still in Development Mode during review.)

### Step 6 — Paste the credentials block into the encrypted Meta field

Paste the following block into the encrypted "Test User credentials" field on the submission form. Fill in the bracketed placeholders.

```
SocialAI Studio test account credentials
=========================================

Login URL:    https://socialaistudio.au
Email:        socialai-fb-review@[YOUR-DOMAIN].com
Password:     [SET A STRONG PASSWORD AND PASTE HERE]

After logging in, the dashboard loads. To test the OAuth handshake:
  Settings → Connected Accounts → click "Disconnect Facebook" (if connected)
  → click "Connect with Facebook" → the OAuth dialog appears.

This Test User is admin of:
  - Facebook Page:    https://www.facebook.com/SocialAIDemoCafe
                      (Page ID: [VERIFY — fill in once the Page is created])
  - Instagram:        https://www.instagram.com/socialaidemocafe
                      (Instagram Business account linked to the FB Page)

Facebook login credentials (for the OAuth dialog inside the Test User flow):
  Email:    socialai-fb-review@[YOUR-DOMAIN].com
  Password: [SAME PASSWORD as Clerk above, OR document separately if different]

If anything is unclear or the test account stops working during the review window,
contact Steve at steve@pennywiseit.com.au — same-day response in AEST.
```

---

## Option B — Facebook-issued Test Users (NOT recommended for this submission)

Meta also lets you generate "Test Users" at:
<https://developers.facebook.com/apps/847198108337884/roles/test-users/>

These are FB-issued fake accounts that automatically have access to all of the app's permissions. **Why we DON'T use them here:**

- Test Users cannot admin real Pages, so the Page picker demo would show a Page that obviously isn't a real business — reviewers sometimes flag this as "not representative of real usage".
- Test Users cannot have a real Instagram Business account linked, breaking the `instagram_content_publish` demo.
- The Reels publishing path requires a real Page in good standing — Test User Pages sometimes fail the Reels eligibility check.

Stick with Option A.

---

## Security hygiene

- The encrypted field on developers.facebook.com is genuinely encrypted — only the assigned reviewer can read it. But:
  - Don't reuse a password you use anywhere else
  - Don't use 2FA on the test FB account during the review window (reviewers can't pass 2FA — turn it off, then turn it back on after approval)
  - Rotate the password 24h after approval lands

- Add a calendar reminder for the day approval lands:
  - Disable the test FB account (or rotate its password)
  - Revoke the Clerk test session
  - Remove the test FB account from Roles → Testers (no longer needed once Live)
