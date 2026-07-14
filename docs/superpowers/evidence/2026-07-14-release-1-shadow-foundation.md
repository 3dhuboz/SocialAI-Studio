# Release 1 Shadow Foundation Evidence

Date: 2026-07-14 AEST
Branch: `codex/customer-learning-brain`
Implementation commits: `93adbb7`, `5bbdc4e`

## Scope

Release 1 adds tenant-scoped learning settings, decision receipts, explicit
deletion coverage, a read-only shadow evaluator, and an authenticated receipt
inspection route. Both learning flags remain disabled. The release does not
change post content, images, schedules, statuses, or publish decisions.

## Local Gates

- Worker typecheck: passed (`tsc --noEmit`).
- Worker tests: 61 files and 803 tests passed.
- Focused contracts cover schema, canonical owner/client/shop identity,
  hold handling, route ownership, deletion scope, disabled flags, cron order,
  AEST schedule windows, and zero-query disabled behavior.
- Wrangler local D1 migration: all 7 v37 commands executed successfully.
- Local table inspection: 14 settings columns, 16 decision columns, and 12
  verdict columns were present.

## Staging Gates

- Pre-migration backup:
  `D:\GitHubBackup\SocialAi\database\socialai-db-staging-pre-v36-v37-20260714-104223.sql`
  (13,844 bytes).
- Staging was missing v36. The four v36 post feedback columns were applied
  before v37 so staging matched production prerequisites.
- v37 migration: 7 queries succeeded; all columns, 3 indexes, and the verdict
  foreign key with `ON DELETE CASCADE` were inspected.
- Corrected staging Worker version:
  `c947b943-bc8e-4815-b812-81f60012fc49`.
- Cloudflare displayed both `LEARNING_BRAIN_ENABLED=false` and
  `LEARNING_RELEASE_ENFORCEMENT=false` at deployment.
- Health returned `ok=true`; unauthenticated receipt access returned 401.
- Across a scheduled cron boundary: 0 decisions and 0 `learning_shadow`
  cron rows.
- Known pre-existing staging warning: Shopify vars and the `POSTER_ASSETS`
  binding are not inherited into `env.staging`. This did not affect the
  Release 1 health, D1, auth, or disabled-cron gates.

## Production Gates

- Pre-migration backup:
  `D:\GitHubBackup\SocialAi\database\socialai-db-pre-v37-20260714-105603.sql`
  (22,155,909 bytes).
- Live schema inspection found the canonical client hold field is
  `clients.status`, not a non-existent `clients.on_hold` column. Runtime,
  tests, plans, and the developer map were corrected before production.
- Hugheseys Que was restored with one conditional update and read back as
  `id='hughesq-001', status='on_hold'` before migration and after deployment.
- v37 migration: 7 queries succeeded. Production inspection found 14 settings
  columns, 16 decision columns, 12 verdict columns, 3 learning indexes, and
  the verdict-to-decision cascade.
- Production Worker version:
  `3927575c-3118-4932-b1d2-dff1fd4d0188`.
- Cloudflare displayed both learning flags as `false` at deployment.
- Immediate and post-cron-boundary health checks returned `ok=true`.
- The receipt route returned 401 without authentication.
- Immediate and post-cron-boundary database checks both showed 0 decisions,
  0 `learning_shadow` cron rows, `hugheseys_status='on_hold'`, and 0 scheduled
  posts. Disabled Release 1 therefore caused no learning writes or post drift.

## Rollback

- Worker rollback can use Cloudflare deployment history if required.
- The v37 database change is additive and dormant while both flags are false.
- The verified production export above is the database recovery point.
- Do not enable either learning flag until the next release plan and its
  documented staging and production gates pass.
