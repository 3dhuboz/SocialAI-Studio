# Shopify Publish Readiness

Status: go for the App Store submission slice.

Supported scope is now:

- Shopify shop-owned scheduling to a connected Facebook Page
- Shopify publish-now for Draft or Missed Facebook posts
- Shopify Autopilot batch save for Facebook-ready posts
- shop-owned token loading from `shopify_stores.social_tokens`
- app scope drift handling through `app/scopes_update`

Intentionally out of scope for this submission:

- Instagram-only publishing from the Shopify embedded app
- combined Facebook + Instagram fan-out from a single shop-owned post row

## What changed

### Worker routes

- `workers/api/src/routes/shopify-posts.ts`
  - accepts Facebook as the supported shop platform
  - blocks unsupported platform requests with `UNSUPPORTED_PLATFORM`
  - requires a connected Facebook Page before scheduling or publish-now
- `workers/api/src/routes/shopify-autopilot.ts`
  - keeps `dryRun=true` preview generation
  - saves approved batches as real Scheduled rows when Facebook is connected
- `workers/api/src/routes/shopify-oauth.ts`
  - now handles `POST /api/shopify/webhooks/app/scopes_update`

### Cron path

- `workers/api/src/cron/_shared.ts`
  - loads shop-owned social tokens from `shopify_stores`
- `workers/api/src/cron/publish-missed.ts`
  - claims Facebook shop rows
  - loads shop denylist data with `loadForbiddenSubjectsForShop`
  - marks unsupported non-Facebook shop rows `Missed` with an actionable reason
- `workers/api/src/cron/poll-pending-reels.ts`
  - resolves shop-owned token lookups for reel polling

### Embedded app

- Compose, Autopilot, Calendar, Insights, Settings, and app shell copy now present a Facebook Page-only scheduling story.
- Dragging an unscheduled Draft onto a day in Calendar now schedules it directly.

## Known limits

These are deliberate for the current review package:

1. Instagram publishing is not exposed in the embedded app.
2. Legacy shop rows that already contain `platform='instagram'` or `platform='both'` are treated as unsupported and should not be recreated from the current UI.
3. Reviewer flows that need real scheduling still require a real connected Facebook Page admin account.

## Verification

Local verification completed on June 17, 2026:

- `cd workers/api && npm test`
- `cd workers/api && npm run typecheck`
- `cd shopify-app && VITE_SHOPIFY_API_KEY=test-shopify-key npm run build`

Focused coverage now includes:

- `workers/api/src/__tests__/shopify-publish-readiness.test.ts`
- `workers/api/src/__tests__/cron-shared.test.ts`
- `workers/api/src/__tests__/connection-check.test.ts`

## Live reviewer data

The live dev-shop install in D1 was cleaned back to zero shop-owned post rows on June 17, 2026 so reviewers do not land in stale Draft, Missed, or legacy `both` posts.
