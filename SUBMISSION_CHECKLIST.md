# App Store Submission Checklist - SocialAI Studio for Shopify

Current state as of June 17, 2026.

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
| Reviewer-facing Shopify UI copy | Ready | Compose, Autopilot, Calendar, Insights, Settings, and shell copy now advertise Facebook-only scheduling |
| Reviewer listing copy | Ready | `LISTING_COPY.md` now matches the current supported scope |
| Publish-readiness documentation | Ready | `docs/shopify-publish-readiness.md` rewritten for the Facebook-only App Store slice |

## Verification completed

| Check | Result |
|---|---|
| `cd workers/api && npm test` | Passed - 50 files, 746 tests |
| `cd workers/api && npm run typecheck` | Passed |
| `cd shopify-app && VITE_SHOPIFY_API_KEY=test-shopify-key npm run build` | Passed |

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

## Operational steps still to run

These are the final ship steps after code review is done:

1. Deploy the updated worker from `workers/api` with `npx wrangler deploy --config wrangler.toml`
2. Push the updated repo so the Shopify Pages frontend can redeploy from GitHub
3. Verify live app pages after deploy:
   - `https://app.socialaistudio.au/privacy`
   - `https://app.socialaistudio.au/support`
   - Shopify embedded frontend at `https://app.socialaistudio.au`
4. Paste the updated copy from `LISTING_COPY.md` into the Partners listing form
5. Upload screenshots and icon assets
6. Submit for Shopify review

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
