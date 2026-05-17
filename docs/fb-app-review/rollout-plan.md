# Rollout Plan — After Approval Lands

This is the SHIP plan once Meta marks the submission Approved. Until that email arrives, do not flip the app to Live — the existing manual-Tester workaround keeps current customers running.

---

## Step 0 — Confirm what "Approved" actually means

Meta's emails are sometimes ambiguous. Before flipping anything:

1. Open <https://developers.facebook.com/apps/847198108337884/app-review/permissions/>
2. Verify **all 5 submitted scopes** show **"Advanced Access"** (not "Standard Access"):
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_content_publish`
   - `publish_video`
3. If any one of them is still on Standard Access, do NOT flip to Live yet — fix the partial approval first by re-submitting that single scope. Going Live with a missing scope means every new customer hits a runtime error mid-OAuth.

---

## Step 1 — Flip the app to Live mode

This is the moment that unblocks customer self-onboarding.

1. <https://developers.facebook.com/apps/847198108337884/dashboard/>
2. Top-right header: **App Mode** toggle currently shows "Development".
3. Click the toggle → confirmation dialog → "Make app Live".
4. The dashboard now shows "Live". Take a screenshot for your records.

**What changes the moment this flips:**

- Any Facebook user can now OAuth into the app (not just Roles).
- Customers currently added as Testers continue to work (Live mode is additive — Testers still get a token).
- The error message *"It looks like this app isn't available"* disappears for everyone.

---

## Step 2 — Verify the existing customer cohort didn't break

The customers currently working were manually added as Testers. Live mode is additive — they should keep working — but verify before announcing.

Customers currently on Tester access (from `feedback_post_quality.md` / project memory and any tracking sheet you keep):

- [ ] Dean Smith — added 2026-05-11. Test: log into his account → confirm dashboard shows his Page connected → trigger a manual publish (or wait for the next cron tick on a scheduled post).
- [ ] Any other customer added as Tester in the 2026-03→05 workaround window — check Roles → Testers and walk down the list.
- [ ] Hugheseys Que (Seamus) — on hold per project memory, no posts. Don't surprise him with anything.

**Smoke test for each existing customer:**

1. Log into their workspace (admin impersonation if you have it).
2. Open Settings → Connected Accounts → confirm Facebook still shows connected with green check.
3. Open the calendar → find a Scheduled post in the next 24h, hit "Publish Now" to force the cron path.
4. Confirm the post lands on their Facebook Page.

If any of them break, the most likely cause is that the Tester-grant token was tied to the in-development app and Live transition invalidated it. Fix is the same as any other expired token — they reconnect FB through the existing reconnect flow. Send them a "please click Reconnect" email (templates below).

---

## Step 3 — Remove "this app isn't available" messaging from the onboarding flow

Scan the repo for any UI copy that hints the app might be restricted. Likely places:

- [ ] `src/components/FacebookConnectButton.tsx` — the "Trouble connecting? Common fixes" disclosure has 5 bullets. None of them mention App Review, but verify nothing got added.
- [ ] `src/components/OnboardingWizard.tsx` (or wherever the wizard lives) — any "if you see 'app not available' please contact us" footnote.
- [ ] `src/pages/Landing.tsx` and any FAQ — search for "app not available", "app review", "we're working with Meta".
- [ ] Email templates in `workers/api/src/lib/email.ts` — any onboarding emails that warn about the FB connection step.

Quick grep across the repo:
```
grep -rni "app.*not.*available\|app review\|development mode" src/ workers/
```

Each hit: decide whether the copy is still useful (e.g. "Make sure you're an admin of a Facebook Page" — keep) or stale (e.g. "If you see 'app not available' please contact support" — remove).

---

## Step 4 — Smoke test fresh self-onboarding

This is the most important verification. The whole point of going Live is unblocking fresh signups, so prove it works:

1. Open a brand-new incognito Chrome window.
2. Go to <https://socialaistudio.au>.
3. Sign up with a fresh email (use `+selfonboard-YYYY-MM-DD` Gmail trick).
4. Complete the wizard. At the Connect Facebook step, log in with a different real Facebook account — NOT the test one, NOT yours. Borrow a friend's account or use a secondary you've never connected to the app before. Make sure the secondary account admins at least one real Page.
5. Walk the full OAuth flow.

Confirm:

- [ ] OAuth dialog renders with the FLB asset-picker UI (Page + IG account choices)
- [ ] Token exchange completes (success toast / no error)
- [ ] Page picker shows the friend's real Page list — `pages_show_list` working
- [ ] You can generate a post in their workspace and publish it (delete the post from their Page immediately after — courtesy)
- [ ] Insights tab loads engagement for their Page

If anything fails, capture the network tab → Meta-API response → fix before announcing. Common gotchas:

- **"This permission is not approved"** error on a specific call → check that scope made it to Advanced Access; the partial-approval problem from Step 0.
- **Token exchange returns 200 but with `expires_in: 5184000`** instead of `pageTokensNeverExpire: true` → the long-lived exchange works but the Page tokens aren't being marked as never-expiring. Check `workers/api/src/routes/facebook.ts:62` returns `pageTokensNeverExpire: true`. (It already does. But verify anyway.)

---

## Step 5 — Customer announcement

Once smoke tests pass, send the unblock email.

**Recipient list:** every customer who was manually added as a Tester during the workaround period (Dean + any others). Also: any inbound leads who hit the "App not available" error and gave up.

**Email template:**

```
Subject: Good news — Facebook is now fully unblocked on SocialAI Studio

Hey [name],

Quick update: Facebook officially approved SocialAI Studio for public use today, so
the app is now Live for everyone. What this means for you:

  • Nothing changes day-to-day — you're already set up and posting.
  • If you ever need to re-grant Facebook permissions (e.g. you changed your password
    on Facebook), the reconnect flow is now self-serve. No more "add me as Tester"
    emails to Steve.
  • You can refer friends and other business owners — they can now self-onboard
    without any manual step on our side.

Thanks for sticking with us during the review period.

— Steve
```

Send via Resend (we have the integration) or your usual transactional setup.

---

## Step 6 — Tidy up

- [ ] Remove the test FB account from <https://developers.facebook.com/apps/847198108337884/roles/roles/> → Testers (no longer needed; the app is Live)
- [ ] Rotate the password on the test Clerk account (or just delete the account entirely if you've finished smoke-testing)
- [ ] Update `APP_REVIEW_SCREENCAST_PLAN.md` at the repo root: add a note at the top: "✅ Approved YYYY-MM-DD. Submission package archived in docs/fb-app-review/."
- [ ] Update `docs/fb-app-review/scope-set.json`: fill in the `submitted_at` and add an `approved_at` field
- [ ] Take screenshots of the app dashboard showing all 5 scopes on Advanced Access + Live mode toggle. Stash in `docs/fb-app-review/proof-of-approval/` for future submissions (Meta sometimes asks "have you been approved for X before?")

---

## Step 7 — Add a watch on the scope set

Going Live doesn't mean we're done forever — every time we add a new Meta scope, we need a fresh submission. To prevent the "we added a scope and forgot to submit" failure mode:

- [ ] Add a CI check (or just a pre-commit hook): if `src/services/facebookService.ts` line ~56 changes, fail the commit unless `docs/fb-app-review/scope-set.json` also changes.
- [ ] [VERIFY] If we already have a CI lint setup, plug this in. Otherwise it's a manual reviewer-checks-this-on-PR item.

---

## If something goes wrong after Live

**Symptom: existing customers report posts not publishing**
→ Check `cron_runs` table in D1 for failures.
→ If failures spike right after Live flip, most likely cause is invalidated Tester tokens. Send the reconnect email below.

**Symptom: new signups fail OAuth with "permission denied"**
→ Verify the FLB Configuration in dashboard still has all 5 scopes ticked. Sometimes Meta auto-deactivates a scope mid-day after approval lands.

**Symptom: a single scope started erroring across the board**
→ Check that scope's status in dashboard → permissions. Meta sometimes reverts a scope's Advanced Access if they get post-approval complaints.

**Reconnect email template (for existing customers if their token breaks):**

```
Subject: Quick fix needed — your Facebook connection on SocialAI Studio

Hey [name],

We just flipped SocialAI Studio to Live mode on Facebook (good news — the App
Review is approved). As a side effect, the temporary "Tester" access you had
during the review period needs to be replaced with a regular token.

30 seconds to fix:
  1. Open https://socialaistudio.au
  2. Settings → Connected Accounts → click "Reconnect Facebook"
  3. Walk through the popup the same way you did the first time

That's it. Sorry for the small interruption.

— Steve
```
