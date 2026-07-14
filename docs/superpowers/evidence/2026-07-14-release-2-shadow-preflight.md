# Release 2 Shadow Preflight Evidence

Date: 2026-07-14 AEST
Branch: `codex/customer-learning-brain`
Enforcement: disabled

## Scope

Release 2 adds independent text, harm, and media critics; bounded repair; a
Release Judge; a single publish preflight; and a collapsed read-only safety
report. The Customer Learning Brain runs in shadow mode. It may record
decisions and verdicts, but it cannot hold or alter a post while
`LEARNING_RELEASE_ENFORCEMENT="false"`.

## Local Gates

- Worker learning suite: 13 files and 93 tests passed.
- Full Worker suite: 67 files and 871 tests passed.
- Worker TypeScript: passed (`tsc --noEmit`).
- Full frontend suite: 9 files and 147 tests passed.
- Frontend TypeScript: passed (`tsc --noEmit`).
- Frontend production build: passed. Only the existing mixed-import and large
  chunk warnings remained.
- `git diff --check`: passed.
- Configuration contract confirmed `LEARNING_BRAIN_ENABLED="true"` twice and
  `LEARNING_RELEASE_ENFORCEMENT="false"` twice, with no true enforcement value.

## Staging Gates

- Staging Worker version: `3e71a601-ebb3-416b-a7b6-4a502fab1606`.
- Deployment bindings displayed brain enabled and enforcement disabled.
- Health returned `ok=true` from
  `https://socialai-api-staging.steve-700.workers.dev/api/health`.
- The staging Worker initially had no secrets. Only the existing
  `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` process values were installed;
  no secret values were printed or copied into the repository.
- A preflight schema check found that staging had v37 learning tables but was
  missing the additive v28 `owner_kind` and `owner_id` columns on `posts` and
  `campaigns`. No probe post was inserted before this was corrected.
- Pre-migration export:
  `D:\GitHubBackup\SocialAi\database\socialai-db-staging-pre-v28-20260714-1252.sql`
  (38,620 bytes, SHA-256
  `7A6772530E06292BAFD1B57A4BEB8C20E56C31D796310632F330B35E58A10B80`).
- The once-only additive v28 migration executed 10 queries successfully.
  Readback confirmed four owner columns, two owner indexes, and zero null owner
  IDs across existing posts and campaigns.
- A staging-only `example.invalid` user and future scheduled post were created
  without a client or social token. Across a scheduled cron boundary, one
  receipt appeared with `mode=shadow`, `stage=snapshot`, and
  `release_state=shadow_only`.
- The probe post's content, status, scheduled time, image URL, owner kind, and
  owner ID were unchanged across the cron boundary.
- Cleanup readback confirmed zero probe users, posts, decisions, and verdicts.
- Known pre-existing warnings remain: staging does not inherit Shopify vars or
  the `POSTER_ASSETS` binding. They do not affect the learning shadow proof.

## Production Gates

Pending. Do not enable release enforcement during this rollout.
