# Shopify Publish Readiness

Status: no-go for full shop-owned auto-publish.

This is intentional. Shopify merchants can compose and preview posts, but the publish path is protected until shop-owned publishing has its own token and scheduling path.

## Protective state

- Shopify scheduler is disabled in `workers/api/src/routes/shopify-posts.ts`.
  - `PATCH /api/shopify/posts/:id` rejects `status='Scheduled'` with `SHOPIFY_SCHEDULER_DISABLED`.
  - `POST /api/shopify/posts/:id/publish-now` rejects before it can flip a row to `Scheduled`.
- Shopify autopilot persistence is disabled in `workers/api/src/routes/shopify-autopilot.ts`.
  - `/api/shopify/autopilot/generate-one` still allows `dryRun=true` preview generation.
  - Non-dry-run `generate-one` and `/save-batch` reject with `SHOPIFY_SCHEDULER_DISABLED`.
- Generic `publish-missed` excludes shop-owned rows through `NON_SHOP_OWNER_FILTER`.
  - The count gate, zombie sweep, quality guard, and claim query all exclude `owner_kind='shop'`.
  - Existing `owner_kind='shop'` rows should not be claimed, marked missed by the generic zombie sweep, or quality-blocked by the generic publisher.

## Why full publish is not feasible yet

The SocialAI publisher still assumes a Clerk user or agency client. Shop-owned rows use `owner_kind='shop'` / `owner_id=<shopDomain>` and need a different loader contract.

Remaining implementation:

1. Add a Shopify social-token loader.
   - Read `shopify_stores.social_tokens` by `posts.owner_id`.
   - Validate `facebookPageId` and `facebookPageAccessToken`.
   - Validate `instagramBusinessAccountId` before allowing Instagram publish.
   - Decide whether this JSON should be parsed directly like current Shopify fact routes or migrated onto the encrypted `social_tokens` helper format.
2. Add Shopify platform mapping.
   - Current generic mapping resolves `posts.platform` to one Postproxy/Graph destination for user/client workspaces.
   - Shopify rows can store `facebook`, `instagram`, or `both`.
   - `both` needs deterministic fan-out or two stored publish attempts, not the generic fallback that treats unknown values as Facebook.
3. Canonicalize Shopify scheduled times before enabling writes.
   - Generic posts normalize `scheduled_for` to the cron's naive AEST format with `normalizeScheduledFor`.
   - Shopify autopilot currently canonicalizes to UTC ISO (`toISOString()`), and publish-now uses UTC ISO.
   - Before removing the disabled guard, choose one canonical format for shop rows and make the Shopify cron comparison use that same format.
4. Add the shop-owned publisher path.
   - Either extend `publish-missed` with a separate shop branch after the current non-shop claim path, or create a Shopify-specific cron.
   - Keep row claiming atomic.
   - Preserve existing terminal states: `Posted` on success, `Missed` with readable `reasoning` on final failure, retry on transient failures.
   - Keep existing denylist, fabrication, quality, image/video prewarm, and AI-disclosure behavior intentionally in or intentionally out, with tests for whichever choice is made.

## Test coverage

`workers/api/src/__tests__/publish-missed-shop-guard.test.ts` proves the generic cron does not claim or mutate shop-owned scheduled rows.

`workers/api/src/__tests__/shopify-publish-readiness.test.ts` locks the protective state: Shopify scheduling remains disabled, autopilot persistence remains disabled, and generic token loading still does not read from `shopify_stores`.
