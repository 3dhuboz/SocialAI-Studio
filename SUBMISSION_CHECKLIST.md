# App Store Submission Checklist - SocialAI Studio for Shopify

Current state as of June 18, 2026: submitted to Shopify App Review.

---

## What is now aligned

| Area | Status | Notes |
|---|---|---|
| Embedded app auth | Ready | Session-token auth and token exchange are already in place |
| Billing flow | Ready | Shopify subscription flow remains active for the dev store |
| Shopify shop-owned Facebook scheduling | Ready in code | Posts route, Autopilot, and publish cron now support Facebook Page delivery for `owner_kind='shop'` rows |
| `publish-now` for Shopify posts | Ready in code | Draft and Missed Facebook shop posts can be forced into the queue |
| Shopify Autopilot save path | Ready in code | Preview flow now saves approved Facebook batches to Calendar |
| `app/scopes_update` webhook | Ready in code | Added and wired in `workers/api/src/routes/shopify-oauth.ts` |
| Shopify app config | Released in Partners | Active version `socialai-studio-5` / `gid://shopify/Version/1019223539713` |
| Admin API usage | Ready | Install/token-exchange shop info now uses Admin GraphQL, not REST `shop.json` |
| Reviewer-facing Shopify UI copy | Ready | Compose, Autopilot, Calendar, Insights, Settings, and shell copy now advertise Facebook-only scheduling |
| Reviewer listing copy | Submitted | Shopify Partners listing now matches the current supported Facebook-only scope |
| Reviewer media | Submitted | Hosted feature media, screenshots, and screencast were added to the listing |
| Shopify App Store review | Submitted | Partners shows `Success! We received your submission.` |
| App Store visibility | Ready on approval | Visibility is set to appear in search and recommendations when Shopify publishes the listing |
| Publish-readiness documentation | Ready | `docs/shopify-publish-readiness.md` rewritten for the Facebook-only App Store slice |

## Verification completed

| Check | Result |
|---|---|
| `cd workers/api && npm test` | Passed - 50 files, 746 tests |
| `cd workers/api && npm run typecheck` | Passed |
| `cd shopify-app && VITE_SHOPIFY_API_KEY=<real client id> npm run build` | Passed |
| `cd shopify-app && npx wrangler pages deploy dist --project-name socialai-shopify --branch main --commit-dirty=true` | Passed - deployment alias `https://8f1f1232.socialai-shopify.pages.dev`; live app root now serves the real Shopify API key |
| `cd workers/api && npx wrangler deploy --config wrangler.toml` | Passed - worker version `ae52224c-ecec-445e-a61d-b7c2686b2d67` |
| `npx --yes @shopify/cli@latest app deploy --client-id <client id> --allow-updates --no-build` | Passed - active Partners config release `socialai-studio-5` |
| `npx --yes --package @playwright/cli playwright-cli ... run-code --filename scripts/capture-shopify-app-store-screenshots.js` | Passed - fresh screenshots written to `C:\Users\Steve\Desktop\app-store-screenshots\fresh-2026-06-18\` |
| Hosted feature image | Passed - `https://app.socialaistudio.au/feature-media-1600x900.png` returns `200 image/png` |
| Hosted reviewer screencast | Passed - `https://app.socialaistudio.au/socialai-studio-reviewer-screencast.mp4` returns `200 video/mp4` |
| Shopify Partners automated common-error check | Passed |
| Shopify App Store submission | Passed - review page status is `Submitted` |

## Live dev-shop state

| Item | Status | Notes |
|---|---|---|
| Dev-shop install row | Present | `socialai-dev-store.myshopify.com` |
| Subscription status | Active | `subscription_status='ACTIVE'` |
| Shopify scopes | Good | `read_products` |
| Facebook connection | Present | `shopify_stores.social_tokens` exists |
| Reviewer post history | Cleaned | All shop-owned post rows were cleared on June 17, 2026 |

## Still intentionally out of scope

These are not bugs for this submission:

1. Instagram-only publishing from the Shopify embedded app
2. Combined Facebook + Instagram fan-out from a single Shopify post row
3. Reviewer-side live scheduling without a real Facebook Page admin login

## Operational status

Completed on June 18, 2026:

1. Deployed the updated worker from `workers/api` with `npx wrangler deploy --config wrangler.toml`
2. Rebuilt and deployed the Shopify embedded app with the real `VITE_SHOPIFY_API_KEY`
3. Released Shopify app config/webhooks/scopes to Partners with Shopify CLI
4. Verified live app pages after deploy:
   - `https://app.socialaistudio.au/privacy`
   - `https://app.socialaistudio.au/support`
   - Shopify embedded frontend at `https://app.socialaistudio.au`

Completed browser-only App Store review steps:

1. Opened the Shopify App Store review page for SocialAI Studio in the Partner dashboard
2. Replaced stale Instagram-facing copy with the Facebook-only listing copy
3. Uploaded hosted feature media and desktop screenshots through Shopify's staged upload flow
4. Saved the reviewer screencast URL: `https://app.socialaistudio.au/socialai-studio-reviewer-screencast.mp4`
5. Passed Shopify's automated common-error check
6. Confirmed app capability selection as `embedded`
7. Completed the AI self-review step
8. Acknowledged App Store requirements
9. Submitted for Shopify App Review
10. Set visibility so the listing appears in search and recommendations when Shopify publishes it

Operational caveat: real Facebook scheduling still requires a Facebook Page admin account. If Meta app review has not been approved and the Meta app remains in Development Mode, Shopify reviewers may be unable to test live Facebook publishing unless a reviewer/test account is explicitly allowed in Meta.

## Suggested reviewer story

Use this exact supported flow when describing the app:

1. Install and approve billing in a dev store
2. Sync products
3. Compose and save a Draft
4. Connect a Facebook Page
5. Schedule from Compose, Calendar, or Autopilot
6. Review queue state and Facebook metrics in Insights

---

Do not describe Instagram scheduling, combined FB+IG publishing, or preview-only Autopilot in the submission package anymore.
