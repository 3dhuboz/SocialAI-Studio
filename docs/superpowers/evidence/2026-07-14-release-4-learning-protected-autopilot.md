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

## Approval Pilot Operations Continuation

Commit `952c918377347c3cf2986f5911cff17319b4acd0` adds an admin-only,
record-only path for collecting the required genuine pilot evidence. It does
not relax the activation gate above and does not count draft validation as a
publication outcome.

- `GET /api/learning/pilot/candidates` returns only server-selected Draft posts
  owned by the authenticated admin. It excludes Shopify ownership, missing
  clients, held clients, non-canonical ownership, and posts that already have a
  release receipt.
- `POST /api/learning/pilot/enroll` can enroll at most one owner workspace and
  one active client workspace in approval mode. It requires an explicit monthly
  AI ceiling between 1 and 10,000 cents, uses experiment rate `0`, and records
  no autopublish consent.
- `POST /api/learning/pilot/validate/:postId` evaluates one unchanged Draft
  through the existing independent critics, bounded repair, and Release Judge.
  It persists the release receipt and critic verdicts but has no post update,
  scheduling, or publishing path.
- All pilot routes refuse operation unless the learning brain is enabled while
  release enforcement and Protected Autopilot remain disabled.
- Production D1 read-only discovery found exactly one eligible owner workspace
  with five drafts and one eligible active-client workspace with four drafts
  for an admin account. Sixteen held-client drafts remain excluded.

Verification before production promotion:

- Frontend: 15 files and 175 tests passed; production build passed.
- Worker: 87 files and 1,106 tests passed; TypeScript passed.
- Existing AI guardrail smoke suite: 70 of 70 checks passed.
- Staging Worker version: `c1f5ab25-cc8f-488d-a3be-f242f514fa66`.
- Staging health returned 200; all three unauthenticated pilot probes returned
  401 before route logic or D1 access.
- Pages preview: `https://c1e5853b.socialai-studio.pages.dev`; the rendered
  admin chunk contains the immutable-draft, no-consent, enrollment, and
  single-draft validation wording.

This continuation makes evidence collection operable. Readiness remains red
until the resulting posts are genuinely published through approval mode,
receive their 168-hour outcomes, and all 30 decisions are independently
adjudicated. No synthetic decision, replay-only result, or draft-only result
may satisfy that promotion requirement.

### Production Promotion Proof

- PR `#170` merged to `main` as
  `6fbc32195a31eb25f946272cc12969a9b838387c` after GitHub
  `typecheck-and-build` passed.
- Production Worker version:
  `31e50ba6-8295-4df7-b362-02b24ae89b0c`.
- Production Worker variables remained dormant:
  `LEARNING_RELEASE_ENFORCEMENT=false`,
  `LEARNING_AUTOPILOT_ENABLED=false`, and
  `ORGANIC_REACH_APPLY_ENABLED=false`.
- Production Pages deployment: `5aa4f0f2-bc19-483e-8185-9eb2906fe4a0`,
  built from source `6fbc321`.
- The hash deployment and `https://socialaistudio.au` served identical main
  and admin chunks. Main SHA-256:
  `5824077bbabd34128fc14a62dcd537a60321d06f6272d3357edd7e40c943b256`;
  admin SHA-256:
  `14452e660e35f73be5c588c43112d7c0a0bb2570559ff0dbaf4ab5a57d8d375b`.
- Direct Worker and same-domain health returned 200. Unauthenticated candidate,
  enrollment, and validation probes all returned 401.
- Post-deploy D1 verification remained unchanged: zero workspace settings,
  protected rows, autopublish consents, release decisions, adjudications, and
  scheduled posts. Hugheseys Que remained on hold.

The operational lane is live, but no workspace was enrolled and no draft was
validated during deployment. Those actions require the authenticated admin UI
and remain subject to independent adjudication and the 168-hour outcome gate.

## 2026-07-15 Metric-Window Hardening Continuation

### Production Finding

The first live outcome reconciliation created 34 publication events and all
three due windows for each event. All 102 outcome rows were correctly marked
`source_status='unavailable'`, `completeness='none'`, with no numeric score.
None was linked to a release decision and none belonged to Hugheseys Que.

The root cause was temporal rather than publishing-related:

- `client_facts` and `shopify_facts` are current scrape caches. Each refresh
  wipes and replaces the previous rows, so they cannot represent distinct
  24-hour, 72-hour, and 168-hour measurements.
- The collector required a fact with `verified_at` at or before the exact
  window boundary, then persisted the first unavailable result permanently.
- This created a deterministic blind spot when the daily fact refresh landed
  just after a window, and no bounded retry could recover it.

### Implemented Repair

PR `#172` merged to `main` as
`2e5cb859d18255246ca2b2687c869d6051fa72fe` after GitHub
`typecheck-and-build` passed.

The repair adds:

- Append-only, tenant-scoped `platform_metric_snapshots` captured by D1
  triggers whenever normal or Shopify `own_post` facts are refreshed.
- Nearest-snapshot selection within a bounded 18-hour tolerance and
  same-window historical normalization.
- `learning_outcome_attempts` with 6-hour, 12-hour, and 24-hour retry delays;
  only the fourth unavailable attempt finalizes an immutable unknown outcome.
- Explicit snapshot and retry-receipt deletion during workspace, account, and
  Shopify teardown.

Verification completed before promotion:

- Worker: 88 test files, 1,110 tests passed; strict TypeScript passed.
- Frontend: 15 test files, 175 tests passed; strict TypeScript and production
  Vite build passed.
- The v40 migration and both triggers executed against an isolated local D1.
- The exact nearest-snapshot and same-window history SQL returned the expected
  24-hour current and historical rows in local SQLite.

### Production Split State

- Pre-migration Time Travel bookmark:
  `00004fae-00000000-000050a8-f91d747005dd2a5ea079d0efb40afa57`.
- Migration SHA-256:
  `d1170a5a7cb0f6520d61af1908361cd9367aa20460f79160eb527d85ff448f4c`.
- v40 applied successfully through Cloudflare's D1 query API. Production now
  contains both tables, both indexes, both triggers, and 90 seeded snapshots:
  47 from normal client facts and 43 from Shopify facts.
- Post-migration verification remained dormant: zero retry rows, workspace
  settings, protected rows, autopublish consents, release decisions, and
  scheduled posts. Hugheseys Que remained `status='on_hold'`.
- The Wrangler credential rejected D1 export, file import, Time Travel lookup,
  and Worker upload with Cloudflare error `10000`. The authenticated Cloudflare
  connector supplied the recovery bookmark and applied/verified the additive
  migration.
- The Worker upload failed before a new version was created. Production remains
  on Worker version `31e50ba6-8295-4df7-b362-02b24ae89b0c`; direct Worker and
  same-domain health both returned 200.

The v40 schema is safe with the previous Worker because it is additive and the
new triggers only copy refreshed facts into new tables. The snapshot-aware
collector is not live until a valid Worker-write credential deploys merged
`main` and a new version is independently verified. Release enforcement,
reach application, and Protected Autopilot must remain disabled throughout.
