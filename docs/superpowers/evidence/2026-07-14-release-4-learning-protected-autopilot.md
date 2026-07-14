# Release 4 Learning And Protected Autopilot Evidence

Date: 2026-07-14

## Result

Release 4 implementation is deployed in dormant production mode. Customer,
admin, and Shopify learning controls are live, but release enforcement,
reach-plan application, and Protected Autopilot remain disabled. No workspace
was silently consented or promoted.

This is a safe rollout checkpoint, not an activation approval. Protected
Autopilot must remain disabled until the real pilot and evidence gates pass.

## Deployed Artifacts

- Functional frontend closeout commit: `bb903ff`
- Worker production version: `66c1225e-359a-4e8a-be00-071481e361eb`
- Worker staging version: `d51c3597-f4db-4678-94c1-4d91a1f17b20`
- Main Pages production deployment: `679ed6ac`
- Shopify Pages production deployment: `ef740b6e`
- Main deployed bundle: `assets/index-7C5NKFtU.js`
- Main bundle SHA-256: `43bc2f36e43472e7ef3e3226b8cb8bd81747819fb182e74814987b4a043aec3c`
- Shopify deployed chunks: `Autopilot-Di8GPY_0.js` and `Settings-DVu97Gw5.js`

## Database Safety

- Production pre-v39 Time Travel bookmark:
  `00004f05-0000000e-000050a8-cb747c6555f5720f32a257d04cc1f856`
- Staging pre-v39 Time Travel bookmark:
  `00000071-0000000a-000050a8-d66728d3dff2e5998681008b09eb3c54`
- Production v39 final import bookmark:
  `00004f05-00000016-000050a8-44fcd7b0c54561a0562e0a343253667d`
- Staging v39 final import bookmark:
  `00000071-00000012-000050a8-343723679ce9e2ed56232ff89abcb4df`
- Verified in both environments: all 11 v39 tables exist.
- Verified in production: all 9 v39 indexes exist.
- Full post-v39 production export:
  `D:\GitHubBackup\SocialAi\database\socialai-db-post-v39-20260714T0945Z.sql`
- Export size: 22,269,197 bytes
- Export SHA-256:
  `4127bde9e811af26f4488076bfd3756f291db7f66051e4dd6fafb31a1a4ba61f`

Wrangler cannot export an historical bookmark without restoring the live
database. Production was not restored merely to create a file. The pre-v39
bookmark is the rollback point; the SQL export is explicitly post-v39.

## Verification

- Root tests: 15 files, 173 tests passed.
- Root production build: passed.
- Worker tests: 87 files, 1,101 tests passed.
- Worker typecheck: passed.
- Shopify typecheck and production build: passed.
- Shopify unresolved-placeholder verifier: passed.
- Independent content-safety smoke audit: 70 of 70 checks passed.
- Direct Worker health: `200`, `{ "ok": true, "service": "socialai-api" }`.
- Same-domain `/api/health`: `200` with Worker JSON, not the SPA shell.
- Unsigned customer learning route: `401`.
- Unsigned Shopify learning route in production: `401`.
- Production customer bundle contains What's Working, permanent release gates,
  Protected Autopilot controls, and honest pending-proof wording.
- Production Shopify bundle contains latest critic receipt, organic reach
  rationale, one workspace-level consent, and no paid-reach guarantee.
- Post-deploy learning shadow, publish, image prewarm, and video prewarm cron
  runs succeeded with empty errors.

## Live Safety State

Production deployment variables were verified at deploy time:

```text
LEARNING_BRAIN_ENABLED=true
LEARNING_RELEASE_ENFORCEMENT=false
LEARNING_AUTOPILOT_ENABLED=false
ORGANIC_REACH_ENABLED=true
ORGANIC_REACH_APPLY_ENABLED=false
```

Production D1 checks after deployment:

- Protected-mode settings rows: 0
- Stored autopublish consents: 0
- Green readiness snapshots: 0
- Release-evidence rows: 0
- Hugheseys Que status: `on_hold`
- Hugheseys Que learning mode/consent: none
- Hugheseys Que newest post row predates this rollout; no rollout-time post was
  created or published.

The first readiness snapshot is correctly red with zero pilot decisions. The
`publishingRegressions=1` metric is a fail-closed sentinel for missing validated
publish-regression evidence, not an observed failed publish. The UI now labels
that state as pending or failed proof rather than claiming an incident count.

## Activation Gate

Do not enable release enforcement, reach application, or Protected Autopilot
until all documented Release 4 checks pass, including at least 30 real pilot
decisions, 30 sampled adjudications, zero severe false passes, false holds below
5 percent, required critic availability of at least 99.5 percent, 100 percent
receipt coverage, positive prediction evidence, passing tenant proofs, passing
replay/red-team and publish-regression artifacts, a tested kill switch, and
metered cost below the explicit workspace ceiling.

Evidence must be recorded through the authenticated admin evidence route. Do
not insert readiness evidence directly into D1 and do not fabricate pilot rows.
Hugheseys Que remains excluded while on hold. Higgsfield remains independently
production-gated and is not enabled by this release.
