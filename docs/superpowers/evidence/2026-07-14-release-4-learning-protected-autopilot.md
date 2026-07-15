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

### Production Deployment State

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
- The pinned Wrangler 3.114.17 credential path rejected Cloudflare operations
  with errors `10000` and `9109`. Wrangler 4.110.0 authenticated with the same
  OAuth profile and its dry-run bundle exactly matched merged `origin/main`.
- Wrangler 4.110.0 deployed the reviewed top-level production config as Worker
  version `793abfff-2e61-4967-8a19-ee2520e93404`, deployment
  `4d1f2aa4-5a1f-40cb-987f-f4d555bebdde`, at 100 percent traffic.
- Direct Worker and same-domain health both returned 200 after deployment.
- The post-deploy audit remained dormant: zero workspace settings, approval or
  protected workspaces, autopublish consents, release decisions,
  adjudications, release-evidence rows, and scheduled posts. Production still
  had 90 metric snapshots, zero retry rows, and Hugheseys Que remained
  `status='on_hold'`.
- Runtime controls remained unchanged:
  `LEARNING_BRAIN_ENABLED=true`, `LEARNING_RELEASE_ENFORCEMENT=false`,
  `LEARNING_AUTOPILOT_ENABLED=false`, `ORGANIC_REACH_ENABLED=true`, and
  `ORGANIC_REACH_APPLY_ENABLED=false`.

The snapshot-aware collector is now live for future due windows. The 102
previously recorded unavailable outcomes remain immutable historical evidence;
they are not rewritten. Release enforcement, reach application, and Protected
Autopilot remain disabled until authenticated pilot decisions, adjudications,
outcomes, and readiness evidence satisfy the release gates.

## 2026-07-15 Pilot Cohort Evidence Hardening

### Pre-Enrollment Finding

The readiness query previously treated the latest 30 global release decisions
as pilot evidence and tied that evidence to each workspace's mutable current
mode. That could count shadow decisions, omit the required owner/client cohort,
or erase historical pilot proof after a workspace later changed mode.

PR `#176` introduces a policy-versioned, record-only cohort boundary:

- exactly one authenticated owner workspace and one consenting active client
  may enroll for the current policy;
- client enrollment requires an explicit admin attestation and evidence note;
- only approval decisions created after the enrollment receipt count;
- validation fails closed when settings exist without a current-policy receipt;
- readiness requires exactly two participating workspaces with both owner and
  client decisions; and
- receipt updates are blocked while tenant-scoped privacy deletion remains
  available through the existing erasure flow.

### Verification Before Promotion

- Worker: 89 test files and 1,114 tests passed; strict TypeScript passed.
- Frontend: 15 test files and 175 tests passed; strict TypeScript and the
  production Vite build passed.
- GitHub PR `#176` was mergeable and its `typecheck-and-build` check passed.
- An isolated D1 applied all v41 statements, rejected a receipt update with
  `SQLITE_CONSTRAINT_TRIGGER`, and accepted the scoped privacy delete.

### Production Migration State

- Pre-migration Time Travel bookmark:
  `00004fc7-00000000-000050a9-2267ca61addb9ee2157c42a3903b4624`.
- v41 applied once with Wrangler 4.110.0; post-migration bookmark:
  `00004fc8-00000006-000050a9-1d12776d2ef7a12b4bfd005986c92059`.
- Remote verification found one pilot table with 13 columns, the exact-cohort
  unique index, the update-blocking trigger, and zero enrollment rows.
- No workspace was enrolled and no draft was validated during migration. The
  Worker remains on the prior version until PR `#176` is merged and deployed.

## 2026-07-15 Authenticated Owner Pilot and Critic Repair

### Promotion and Enrollment

- PR `#176` merged to `main` as
  `e34e60e45caf2d77ee2953817d53403a9baa1842` after CI passed.
- Production Pages deployment
  `cc851d6d-f84e-428f-9d61-c38f6396ce50` was built from that exact merge.
- The authenticated admin enrolled only the Penny Wise I.T owner workspace.
  Receipt `fff91780-fbda-4ede-81a1-0e1a222ff041` is record-only, policy
  `2026-07-14-v1`, owner-self consent, approval mode, and a 500-cent monthly
  AI ceiling.
- Production still has zero client pilot enrollments, zero stored autopublish
  consents, and zero Protected Autopilot workspaces. Hugheseys Que remains
  `status='on_hold'` and was never enrolled or evaluated.

### Production Findings and Repairs

The first authenticated draft validation failed before the guarded release
pipeline because its query selected nonexistent `posts.archetype_slug`.
Remote D1 reproduced `SQLITE_ERROR: no such column: p.archetype_slug`. No
decision, post mutation, schedule, or publish occurred. PR `#177`, merged as
`657819f37fb6f36ee040b1a659c5baded4cb583c`, now derives the archetype from
the canonical client/user rows.

Subsequent record-only decisions exposed three independent-critic contract
defects without allowing a false pass:

- Markdown-fenced JSON was rejected. PR `#178`, merge
  `fe76ca8be12fa584974833cac9e1470c4ff94b18`, normalizes one complete provider
  fence while preserving strict downstream parsing.
- The prompt omitted exact severity choices and repair requirements. PR `#179`,
  merge `358b48a71a29368d877a381c3e928f37fe55c6a2`, adds explicit schemas and one
  bounded correction retry; a second invalid response remains release-critical
  unavailable.
- Both business-harm attempts reached the exact 1,400-token output ceiling.
  PR `#180`, merge `7f70e413feb9c71c30e2d1fb097daa51ab09850d`, raises structured-output
  headroom to 2,400 tokens while accepting at most three 240-character evidence
  and repair entries.
- Pipe-delimited pseudo-enums remained ambiguous. PR `#181`, merge
  `c94d75da18eb4c5e596aa793e671bde7f5ba67c7`, replaces them with explicit
  exactly-one-of instructions and field-specific diagnostics.
- The final live residual was an invalid redundant inner `kind` while the exact
  outer `business_harm` key had already passed validation. PR `#182`, merge
  `32eb1bfcce2b37ffc7a93b135868287c88fa4940`, derives kind from the
  server-requested outer key and keeps verdict, severity, confidence, evidence,
  and repair validation strict.

Each repair had a red-to-green regression, the full Worker suite, strict
TypeScript, passing GitHub CI, an exact merged-tree check, and a separate Worker
deployment. Final verification is 89 test files and 1,121 tests passed. Current
production Worker version `932baecf-e552-442a-a304-0efee67e275c` receives 100
percent traffic; same-domain health returns 200. Runtime controls remain
`LEARNING_RELEASE_ENFORCEMENT=false`, `LEARNING_AUTOPILOT_ENABLED=false`, and
`ORGANIC_REACH_APPLY_ENABLED=false`.

### Record-Only Audit State

- Five genuine owner drafts produced five immutable approval release decisions,
  each with ten stored critic verdicts. All five decisions were `block_red`;
  the image critic independently scored the generic creative below threshold.
- All five source posts remain `Draft`; the audit found five still-draft rows
  and zero status mutations.
- Pilot AI usage totals 18 metered calls and USD 0.131127, below the USD 5.00
  workspace ceiling.
- Adjudications remain zero. No customer was enrolled and no customer content
  was evaluated by this pilot.

All five existing owner drafts now have immutable receipts. The canonical-key
repair is unit-, full-suite-, CI-, and deployment-proven, but its final live
zero-unavailable re-proof must use the next naturally created owner draft; no
receipt was deleted and no synthetic production draft was fabricated. Release
enforcement, reach application, and Protected Autopilot remain disabled until
that proof, one explicitly consenting active client, 30 real decisions, 30
independent adjudications, complete 168-hour outcomes, and every existing
readiness gate pass.

## 2026-07-15 Readiness Timestamp Normalization

### Production Finding

The five immutable owner decisions were present, but the readiness evaluator
reported zero pilot decisions. Enrollment and consent receipts use JavaScript
ISO timestamps such as `2026-07-15T00:43:35.266Z`, while D1 decision defaults
use SQLite timestamps such as `2026-07-15 02:01:06`. The readiness query
compared those values as raw text, so valid same-day decisions sorted before
the `T` separator and were incorrectly excluded.

This defect affected readiness evidence counting only. It did not create,
modify, schedule, approve, or publish a post. A read-only production proof
returned `0` for the raw text comparison and `1` after both values were
normalized with SQLite `unixepoch(...)`. The exact normalized cohort query
returned all five owner receipts.

### Repair And Verification

PR `#184` merged to `main` as
`b2eeeccea57cd4540d55d7311ae8bed8a8f7d65e` after the independent
`typecheck-and-build` check passed. The repair normalizes both the enrollment
boundary and consent boundary in the readiness query and adds a regression
that rejects the previous raw comparisons.

- Focused readiness verification: 17 tests passed.
- Full Worker verification: 89 test files and 1,121 tests passed.
- Strict Worker TypeScript verification passed.
- Production Worker version:
  `045fdf83-ba94-41f6-8e2d-a35c369a6cd6`, at 100 percent traffic.
- Direct Worker and same-domain health both returned 200 with Worker JSON.

The first normal 15-minute production cron after deployment wrote readiness
receipt `345e03ed-d199-4ac2-a3a0-1bb2a67b9292` at
`2026-07-15T02:45:02.464Z`. It correctly reports five pilot decisions, zero
adjudicated decisions, and `ready=0`.

Post-deploy safety verification found all five source posts still `Draft`,
zero client pilot enrollments, zero stored autopublish consents, and Hugheseys
Que still `status='on_hold'`. Runtime controls remain dormant:
`LEARNING_RELEASE_ENFORCEMENT=false`, `LEARNING_AUTOPILOT_ENABLED=false`, and
`ORGANIC_REACH_APPLY_ENABLED=false`.

The remaining gates are unchanged: live zero-unavailable critic proof on the
next naturally created owner draft, one explicitly consenting active client,
30 real pilot decisions, 30 independent adjudications, complete 168-hour
outcomes, and every documented readiness proof. No synthetic draft or evidence
row was created to accelerate the rollout.

## 2026-07-15 Frontend Publish-Egress Closure

### Completion-Audit Finding

The Worker publish orchestrator already guarded every active manual and cron
publish path, but `src/services/facebookService.ts` still exposed five unused
browser-side publishing helpers. One helper used Facebook
`scheduled_publish_time`, which is explicitly banned because it can create an
uncancellable remote post outside D1 control. A repository-wide reference
search found zero runtime callers, and the existing Postproxy integration plan
explicitly required all five helpers to be deleted.

PR `#186` removed `postToPageDirect`, `postToPageWithImageUrl`,
`postToPageScheduled`, `postToInstagram`, and `postReelToInstagram`. It also
added a permanent source-contract regression that rejects those helpers,
`scheduled_publish_time`, or an Instagram `media_publish` call in the frontend
service. OAuth, page discovery, page statistics, and recent-post reads remain
unchanged. PR `#186` merged to `main` as
`7640db9fcdc1d92f7a320c6b210c72cb2c595971` after CI passed.

Verification before promotion:

- The regression was observed failing before deletion and passing afterward.
- Focused publish-egress verification: 16 tests passed.
- Frontend verification: 15 test files and 175 tests passed.
- Frontend production build passed.
- Worker verification: 89 test files and 1,122 tests passed.
- Strict Worker TypeScript verification passed.

### Production Promotion

The Git-triggered `socialai-studio` Pages row for source `7640db9` remained
`Idle`, its immutable hostname returned 404 for five minutes, and the custom
domain continued serving `assets/index-9aTgtfWJ.js` with all five forbidden
helper names. Earlier Git-triggered rows for `b2eeecc` and `d769c55` showed the
same `Idle`/404 behavior. No success claim was made from those rows.

The exact reviewed merged tree was rebuilt locally and directly uploaded to the
existing production project without changing Worker code or D1. Cloudflare
completed deployment `https://9c8e8626.socialai-studio.pages.dev`. The
immutable deployment and `https://socialaistudio.au` now serve the same
`assets/index-r6y7HK1-.js` with SHA-256
`655cd1a0beb1d18eabf1f248775339c6b4d9aebc73b02810c405adb0aa16287b`.
The served bundle contains none of the five helper names and no
`scheduled_publish_time`. Direct Worker and same-domain health both return 200
with Worker JSON.

This closes a latent future bypass; it does not activate release enforcement,
reach-plan application, or Protected Autopilot. The real pilot evidence gates
remain unchanged.

## 2026-07-15 Blind Independent Adjudication

### Completion-Audit Finding

The sampled admin adjudication form exposed each model release verdict as
`Observed ...` and initialized the human label to that same value. A reviewer
could therefore save an anchored answer rather than make the independent
assessment required by the 30-adjudication readiness gate. The API write path
was already correctly isolated: it stores an audit label only and cannot
approve, schedule, modify, or publish a post.

PR `#188` removed the observed verdict from the form, starts every receipt with
no expected state selected, requires the reviewer to choose independently, and
resets that choice after a successful label. The regression was observed
failing against rendered markup that selected `hold_amber`, then passing after
the repair. PR `#188` merged to `main` as
`feac260db465f76b859d2bee1c8dcce4eb83f266` after CI passed.

Verification before promotion:

- Focused adjudication verification: 3 tests passed.
- Frontend verification: 15 test files and 175 tests passed.
- Strict frontend TypeScript verification passed.
- Frontend production build passed.
- Worker verification: 89 test files and 1,122 tests passed.
- Strict Worker TypeScript verification passed.

### Production Promotion And Safety State

Cloudflare initially listed Git deployment `695ecbca` as active while its
immutable hostname still returned 404. The exact merged tree was therefore
uploaded through the documented recovery path as deployment `f42ca164`. During
verification, the Git deployment completed and became the deployment served by
the custom domain.

`https://socialaistudio.au` and
`https://695ecbca.socialai-studio.pages.dev` serve identical production
assets:

- Entry asset `assets/index-D9PSB0nb.js`, SHA-256
  `370d2e59eca4a6a99ae6a3b48e4274d424dee64de819ffedf78d2a4d924baf80`.
- Admin asset `assets/AdminCustomers-Dbkudw8J.js`, SHA-256
  `c4b19b6c007d73b1bb9a6396b6a6b971da95fee918b0a3d3206627fe357e25f7`.
- The admin asset contains the blind-review notice and independent-choice
  placeholder, and does not contain `Observed hold amber`.
- Direct Worker and same-domain health both return 200 with Worker JSON.

Read-only post-deploy D1 checks reported one owner-only pilot enrollment, zero
client enrollments, five release decisions, zero adjudications, zero
autopublish consents, zero Protected Autopilot workspaces, and latest
readiness `ready=0`. The single Hugheseys Que match remains
`status='on_hold'`. D1 reported `changed_db=false` and `rows_written=0` for the
verification queries. No post, consent, learning setting, rollout flag, or
customer status was changed by this repair.

## 2026-07-15 Verified Blind Adjudication Evidence

### Root Cause And Repair

The earlier browser-only blind-review repair was not sufficient. The admin
operations API still returned the model's release verdict, while the reviewer
was not shown the caption or media needed to make an independent decision. The
adjudication write route also accepted an admin-known decision without proving
that it belonged to the current policy pilot cohort or that its source post
still matched the immutable receipt hash.

PR `#190` removed the model verdict from the browser contract, exposes only
hash-verified current caption and media evidence, and refuses to offer a label
for missing or stale evidence. The server now limits both sampling and writes
to the latest current-policy, consented, record-only approval pilot cohort. It
re-derives the complete tenant tuple, joins the current post on that identity,
recomputes the canonical release content hash, and returns `409` before any
label write when the source is unavailable or changed. Adjudication remains an
audit-only insert and cannot approve, schedule, edit, or publish a post.

PR `#190` merged to `main` as
`22f881f5e37cdb53be63552ecaff322f93ef6308` after CI passed. The tested branch
and merged commit had the same Git tree,
`3e7db6c4de96d2bde44ed82fc0b91d7c9ce95c1a`.

Verification before promotion:

- Focused frontend adjudication verification: 4 tests passed.
- Focused Worker learning-route verification: 29 tests passed.
- Frontend verification: 15 test files and 176 tests passed.
- Worker verification: 89 test files and 1,123 tests passed.
- Strict frontend and Worker TypeScript verification passed.
- Frontend production build passed with 1,923 modules transformed.
- GitHub `typecheck-and-build` passed before merge.

### Production Promotion And Safety State

Worker version `d4c272b8-7cb8-42dc-8a49-a427eda0e1b3` was deployed from the
tested tree. Direct Worker and same-domain health both return 200 with Worker
JSON. Both unauthenticated admin operations requests return 401. The exact new
admin operations and adjudication-source SQL were extracted from the route and
executed against production D1 through read-only wrappers; both reported
`rows_written=0`.

Cloudflare Pages deployment `3530bdcd-bcfc-4a1e-b2d6-6e7d4c222f82` serves the
merged `main` commit. `https://socialaistudio.au` and
`https://3530bdcd.socialai-studio.pages.dev` serve identical production
assets:

- Entry asset `assets/index-Biq4eof0.js`, SHA-256
  `4d0b200e57262324cf2d7cfce183bc0876a5da22493a027e04904857ff0fbf2b`.
- Admin asset `assets/AdminCustomers-BqFdMI1U.js`, SHA-256
  `70ca28c841ff2f208aafb3ec1cf673970dc8ec50cfa70994baa1c821f0488a82`.
- The admin asset contains the verified-source and stale-evidence block copy,
  retains the blind-review notice, and contains no `sampleReleaseState` field.

The final read-only D1 recount reported one owner-only pilot enrollment, zero
client enrollments, five release decisions, zero adjudications, zero stored
autopublish consents, zero Protected Autopilot workspaces, and latest readiness
`ready=0`. Hugheseys Que remains `status='on_hold'` with no learning setting,
consent, or Protected Autopilot row. The final query reported
`changed_db=false` and `rows_written=0`.

Runtime controls remain dormant:

- `LEARNING_RELEASE_ENFORCEMENT=false`
- `LEARNING_AUTOPILOT_ENABLED=false`
- `ORGANIC_REACH_APPLY_ENABLED=false`

No synthetic label, customer consent, post mutation, customer status change,
or unattended publishing activation was introduced. Genuine independent
labels, outcomes, and explicit customer consent are still required before any
Protected Autopilot rollout gate can pass.

## 2026-07-15 Bounded Final Video Inspection

### Completion-Audit Finding And Repair

The paid Anthropic and OpenRouter critic transports already used tested
45-second abort signals, bounded retries, provider fallback, and fail-closed
`unavailable` verdicts. The remaining media seam did not: final video
verification issued a server-side `HEAD` without a timeout in both the media
critic default and release-preflight wiring. A stalled endpoint could therefore
consume the request instead of allowing the critic to emit a release-critical
unavailable verdict and durable receipt.

PR `#192` centralized final-video inspection in the media critic. The shared
chokepoint now:

- Rejects invalid, non-HTTPS, and credential-bearing URLs before network use.
- Uses a 10-second abort signal for every request.
- Retries one transient network failure, timeout, 408, 425, 429, or 5xx result.
- Stops after two attempts and throws into the existing fail-closed media
  critic boundary.
- Validates the final response URL and preserves the existing MIME and content
  length checks.
- Replaces the duplicate unbounded release-preflight fetch.

The new tests were observed failing before implementation because the shared
inspector did not exist. Verification after repair:

- Focused final-media and release verification: 19 tests passed.
- Adjacent release-preflight and publish-egress verification: 47 tests passed.
- Worker verification: 89 test files and 1,126 tests passed.
- Strict Worker TypeScript verification passed.
- Wrangler production packaging dry run passed.
- GitHub `typecheck-and-build` passed before merge.

PR `#192` merged to `main` as
`50e6163beb613be6bf3e353fde0aed6e9e3c93ae`. The tested branch and merged
commit had the same Git tree. Worker version
`cbb8a343-a3a6-4014-80cb-8226f50a2a7e` was deployed from that tree. Direct
Worker and same-domain health both return 200 with Worker JSON.

The post-deploy read-only D1 recount reported one owner-only pilot enrollment,
zero client enrollments, five release decisions, zero adjudications, zero
stored autopublish consents, zero Protected Autopilot workspaces, and latest
readiness `ready=0`. Hugheseys Que remains `status='on_hold'` with no learning
setting. D1 reported `changed_db=false` and `rows_written=0`.

Runtime controls remain dormant:

- `LEARNING_RELEASE_ENFORCEMENT=false`
- `LEARNING_AUTOPILOT_ENABLED=false`
- `ORGANIC_REACH_APPLY_ENABLED=false`

This repair strengthens shadow receipts and future fail-closed enforcement. It
does not change a post, schedule, consent, customer status, or current
publishing decision.
