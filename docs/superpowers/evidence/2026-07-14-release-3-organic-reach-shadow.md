# Release 3 Organic Reach Shadow Evidence

Date: 2026-07-14 (Australia/Brisbane)

## Release posture

- `LEARNING_BRAIN_ENABLED="true"`
- `LEARNING_RELEASE_ENFORCEMENT="false"`
- `ORGANIC_REACH_ENABLED="true"`
- `ORGANIC_REACH_APPLY_ENABLED="false"`
- Schedule recommendations default to `dryRun=true` and write only when the request explicitly sends `dryRun=false`, the apply flag is true, and the workspace has a confirmed reach profile.
- The shadow cron records reach plans and receipt links only. It does not update post content, hashtags, media, platform, schedule, status, or publishing behavior.

## Automated gates

- Worker: 76 files, 932 tests passed, including same-content/profile-version reach-plan reuse and the confirmed-profile schedule gate.
- Worker TypeScript: `tsc --noEmit` passed.
- Main app: 11 files, 155 tests passed.
- Main app production build passed. Existing chunk-size/dynamic-import warnings remain non-blocking.
- Shopify embedded app TypeScript passed.
- Shopify production build and `verify-build` passed with no unresolved Vite placeholders.
- Focused Release 3 gate: 43 tests passed across configuration, shadow evaluation, timing evidence, and recommendations.

## Database rollout

- Staging D1 `socialai-db-staging` migrated with `schema_v38_organic_reach.sql`.
- Staging `PRAGMA table_info` verified `reach_profiles`, `audience_segments`, `approved_media_assets`, and `reach_plans`.
- Production pre-migration export:
  - `D:\GitHubBackup\SocialAi\db-backups\socialai-db-pre-v38-20260714-153522.sql`
  - 22,208,319 bytes
  - SHA-256 `1F088A95405B23BA02C333FA2ADDCD1395FF6723E7DA8126CB8206E4EEA7A65B`
- Production D1 `socialai-db` migrated with the same additive migration.
- Production `PRAGMA table_info` verified all four tables after migration.

## Deployments

- Staging Worker version: `1bc693c8-0655-4d7c-8a37-447e67fe26be`
- Production Worker version: `b09f5c16-2ed6-415a-a7fb-c1c8606d2cb6`
- Both deploy outputs confirmed reach enabled and reach apply disabled.
- `https://socialai-api.steve-700.workers.dev/api/health` returned `{ "ok": true, "service": "socialai-api" }`.
- `https://socialaistudio.au/api/health` returned the same JSON through the Pages proxy.

## Live invariants

- The first `learning_shadow` cron after the final production Worker version ran at `2026-07-14 06:00:05` UTC and succeeded with no error, zero posts processed, and a 221 ms duration.
- Production had zero `Scheduled` posts before deploy and zero after deploy, so no queued customer post could be changed or published during the rollout window.
- Reach profile, plan, and linked-receipt counts were queried separately for `user`, `client`, and `shop`; each is zero until an owner confirms setup.
- Out-of-area reach plans: zero.
- Hugheseys Que (`hughesq-001`) remained `status='on_hold'` before migration, after migration, and after Worker deployment.

## Deferred gates

- No owner geography was auto-confirmed. A proposed profile may be evaluated only in shadow; it cannot influence scheduling or generated media, and application requires a confirmed profile.
- No schedule application, critic enforcement, or protected autopilot was enabled in this release.
- Higgsfield remains production-gated and is not part of this release.
