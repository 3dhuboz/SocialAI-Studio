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

## 2026-07-15 Bounded Release Evidence Freshness

### Completion-Audit Finding And Repair

The readiness evaluator treated a release-evidence row with no expiry as
permanently valid. The authenticated admin route defaulted new evidence to a
seven-day lifetime but accepted a caller-supplied expiry with no upper bound.
An old or accidentally long-lived staging, red-team, kill-switch, or publishing
proof could therefore outlive the live system state it was intended to attest.

PR `#194` established one shared maximum release-evidence lifetime of seven
days. Readiness now fails closed when a proof has no expiry, malformed times, a
future `recorded_at`, an expiry at or before its recording time, or a lifetime
over seven days. The admin route rejects requested expiries beyond the same
limit while retaining the existing seven-day default.

The new tests were observed failing before implementation: null-expiry evidence
returned a passing kill-switch proof and the route accepted an expiry in 2100.
Verification after repair:

- Focused readiness and route verification: 71 tests passed.
- Worker verification: 89 test files and 1,128 tests passed.
- Strict Worker TypeScript verification passed.
- Wrangler production packaging dry run passed.
- GitHub `typecheck-and-build` passed before merge.

PR `#194` merged to `main` as
`9ee83bef5ff203d9dda1f4b071f096ff23770d47`. The tested branch and merged
commit had the same Git tree. Worker version
`8f7583cb-ca8e-465d-a3f0-94d6fee6c548` was deployed from that tree. Direct
Worker, same-domain API, Hugheseys Que portal, and Hugheseys Que API health all
returned 200. An unauthenticated evidence write returned 401.

Production contained zero release-evidence rows, including zero null-expiry,
malformed, future-dated, or overlong rows. The first natural 15-minute readiness
evaluation after deployment wrote receipt
`757a1724-984b-429d-87d9-4bd2f1d1b77a` at
`2026-07-15T07:00:45.379Z`. It remained `ready=0`, with replay/red-team and
publish-regression proof absent as required.

The post-deploy read-only D1 recount matched the pre-deploy baseline: one
owner-only pilot enrollment, zero client enrollments, five release decisions,
zero adjudications, zero stored autopublish consents, zero Protected Autopilot
workspaces, and latest readiness `ready=0`. Hugheseys Que remains
`status='on_hold'` with no learning setting. Every verification query reported
`changed_db=false` and `rows_written=0`.

Runtime controls remain dormant:

- `LEARNING_RELEASE_ENFORCEMENT=false`
- `LEARNING_AUTOPILOT_ENABLED=false`
- `ORGANIC_REACH_APPLY_ENABLED=false`

This repair strengthens live readiness monitoring only. It does not create or
change a post, schedule, pilot enrollment, adjudication, consent, customer
status, Protected Autopilot setting, or current publishing decision.

## 2026-07-16 Smart Schedule Automatic Safety Repair

### Production Finding

Penny Wise I.T Smart Schedule could remain at 96 percent while it ran one
semantic judge and up to three nested regeneration attempts for each post.
The same path treated all scraped Facebook rows as verified facts even though
the 34 stored signals included historical posts, photo captions, and a stale
follower count. This caused both unnecessary latency and false review warnings
against owner-declared services such as AI websites and white-label software.

The previous `_needsReview` state was also display-only. `Accept All` did not
exclude flagged drafts from calendar writes, so a warning was not a sufficient
release boundary.

### Repair And Verification

PR `#196` establishes one bounded safety-editor pass per ten drafts. The editor
automatically repairs unsupported claims in the same response. Owner-entered
business identity, services, products, positioning, audience, and location are
authoritative; historical posts and photo captions remain voice signals only.
Dynamic scraped follower, reach, engagement, impression, and like counts are
removed from factual context.

Incomplete or unavailable critic results fail closed as held drafts. Both
calendar acceptance paths filter those drafts before any `db.createPost` call,
and preview image generation skips them. Preview images now use bounded
concurrency of two. The progress display exposes research, writing, and
automatic safety repair rather than parking at a misleading 96 percent. Draft
schema version 6 invalidates the unsafe pre-release browser draft on reload.

Verification before promotion:

- Focused generation and safety verification: 109 tests passed.
- Full frontend verification: 15 test files and 180 tests passed.
- Strict frontend TypeScript verification passed.
- Production Vite build passed with 1,923 modules transformed.
- The Penny Wise regression proves one batch editor request for three posts,
  repairs the unsupported five-hours claim, accepts profile-supported services,
  and excludes stale or historical claims from critic evidence.
- A separate malformed-editor regression proves an incomplete batch result is
  held and fails `isSmartPostSafetyCleared`.
- GitHub `typecheck-and-build` run `29458904543` passed all frontend, Worker,
  Shopify, on-hold, and publish-egress guards.

PR `#196` merged to `main` as
`2d8bd2790883e6c9657bf73661fb9d5c83df603e`. This was a frontend-only
deployment; no Worker code, D1 schema, runtime variable, post, schedule, or
publishing path was changed.

### Production Promotion And Safety State

All five Cloudflare Pages production checks completed successfully:

- SocialAI Studio: `91ac46a2-3c86-4080-9b5b-a4a49a61f649`.
- Hugheseys Que: `d9f03282-e314-45b6-b228-411b3f701d53`.
- Pickle Nick: `0a228dc5-3aa6-47fc-9c31-e83d15ff6435`.
- Reloaded: `88150372-6447-4e44-a76f-45bf040eab91`.
- Street Meats: `b98e830a-2807-4539-b3a6-f3e8ec509338`.

`https://socialaistudio.au` serves `assets/index-Dwbq_T5g.js`, SHA-256
`f3c0c6b183803d2390b69fd04bd4df6e108031fd7783944a3f39305e0da41900`.
`https://social.hugheseysque.au` serves `assets/index-CtEH4_on.js`, SHA-256
`f75961586bcf59eb55f9e69d2a1f59108efedff3e48929b6cef6fc33c999d50d`.
Both live bundles contain the batch safety editor, automatic hold boundary,
and corrected historical-caption provenance rule. Both page and asset requests
returned 200. Direct Worker health remained 200.

Read-only production D1 verification reported `changed_db=false`,
`rows_written=0`, zero Protected Autopilot workspaces, zero stored autopublish
consents, latest readiness `ready=0`, and no Hugheseys Que learning setting.
Hugheseys Que remains `status='on_hold'`.

Runtime controls remain dormant:

- `LEARNING_RELEASE_ENFORCEMENT=false`
- `LEARNING_AUTOPILOT_ENABLED=false`
- `ORGANIC_REACH_APPLY_ENABLED=false`

No authenticated customer generation was submitted during deployment proof,
and no draft was accepted, scheduled, or published. The production bundles and
fail-closed behavior are verified; the next customer generation will exercise
the corrected path without requiring routine per-post human approval.

## 2026-07-17 Record-Only Pilot Collector Staging Gate

### Operational Gap And Bounded Repair

The counted approval-mode pilot still depended on an admin manually validating
each new Draft. The permanent release pipeline and critics were present, but a
new genuine owner or consented-client Draft could remain outside the measured
pilot until an operator clicked the validation button.

Draft PR `#209` now adds a record-only collector to the isolated 15-minute
non-publishing lane. It is deliberately dormant unless the learning brain is
on while release enforcement and Protected Autopilot are both off. Each tick:

- selects at most one Draft from one owner workspace and one explicitly
  customer-attested client workspace;
- revalidates the current policy enrollment, approval mode, consent timestamp,
  positive monthly budget, and client hold state;
- reserves 50 cents of remaining monthly budget before starting critics;
- atomically leases the immutable release-decision key so a concurrent admin
  click cannot duplicate critic spend;
- retries only a stale incomplete claim after 20 minutes; and
- never updates, accepts, schedules, publishes, or deletes the source post.

The admin validation route now uses the same lease and budget boundary. A
complete existing receipt is reused, a concurrent run returns a safe conflict,
and unavailable cost telemetry fails closed before any critic call.

### Verification And Staging Proof

The implementation was observed failing its new tests before the collector
modules existed. Verification after implementation:

- Focused pilot, route, and wiring verification: 43 tests passed.
- Worker verification: 90 test files and 1,160 tests passed.
- Frontend verification: 17 test files and 195 tests passed.
- Strict Worker and frontend TypeScript verification passed.
- Production Vite build passed.
- GitHub CI run `29557936943` passed frontend, Worker, Shopify, on-hold,
  Facebook scheduling, and route-registration guards.

Verified Worker source tip `9f8616502dba0b1e5e71789a2c6501ec2d08a5eb`
remains on draft PR `#209`; it has not been merged. Staging Worker version
`69ef85f7-4bb9-4243-b842-f39a55c7bd0e` was deployed with:

- `LEARNING_BRAIN_ENABLED=true`
- `LEARNING_RELEASE_ENFORCEMENT=false`
- `LEARNING_AUTOPILOT_ENABLED=false`
- `ORGANIC_REACH_APPLY_ENABLED=false`

The natural `2026-07-17 05:45:20` staging trigger wrote successful cron receipt
`5551` for `learning_pilot`, processed zero posts, and reported no error.
Before and after the trigger, staging contained zero posts, workspace learning
settings, pilot enrollments, learning decisions, and critic verdicts. The real
D1 candidate query executed successfully. An `EXPLAIN` of the exact lease
upsert also succeeded with `changed_db=false`, `changes=0`, and
`rows_written=0`.

Credential-free evidence:

- Artifact:
  `D:\GitHubBackup\SocialAi\release-evidence\staging-learning-pilot-collector-proof-2026-07-17T05-48-25-302Z.json`
- Artifact SHA-256:
  `108D2DC6B33A4394B1B8D33A6D3BBDE199F86F79BF010A796257498D55334B52`
- Canonical payload SHA-256:
  `BE64CB2A948DF59D4792A7D9401B9800D1779FA8BF75B476A02FB50EE584AD0E`

### Production Remains Unchanged And Not Ready

No production deploy or production mutation was performed. Production remains
on Worker version `26c19f95-7bb2-40b2-ae72-12c2a6e330e5`; direct health is
200, release enforcement is off, Protected Autopilot is off, and organic reach
apply is off. Hugheseys Que remains exactly `status='on_hold'`; the read-only
verification reported `rows_written=0`.

The latest current-policy production snapshot remains `ready=0` with one owner
workspace, five completed owner decisions, zero client decisions, zero
adjudications, and zero current-policy release-evidence rows. This staging
proof does not count toward promotion. Promotion still requires an explicitly
consented active client, 30 genuine two-workspace decisions, 30 independent
adjudications, complete 168-hour real publication outcomes, and all documented
replay, regression, tenancy, and kill-switch evidence.

## 2026-07-17 Exact-Workspace Pilot Consent Binding

### Consent And Cohort Race Repair

The admin pilot queue previously reused one customer-consent checkbox and note
across every unenrolled client card. An operator could attest one customer and
then submit a different client card. The enrollment schema already had the
correct final atomic cohort lock, but the route also wrote approval settings
before confirming that its exact immutable enrollment receipt had won that
lock. A concurrent losing request could therefore leave settings behind even
though the enrollment was rejected.

Draft PR `#209` now binds consent state to the exact workspace key and names the
target client in the attestation control. Every pilot action is disabled while
another pilot action is in flight in the same admin session. On the Worker, the
existing unique index on `(policy_version, owner_kind)` remains the final
cohort lock. Approval settings are written only after `INSERT OR IGNORE` and a
read-back confirm the exact user, workspace, client, owner kind, and owner ID
receipt. A race loser returns `409` and cannot leave a stray learning mode.

This repair does not infer or create consent. A client workspace still requires
an explicit `customer_attested` note from the named customer before enrollment.

### Verification And Staging Proof

The new frontend and Worker regressions were observed failing before the repair.
Verification after implementation at source commit
`d5be49bd9ee8031677487f203d8933004ceaa23b`:

- Frontend: 17 test files and 196 tests passed.
- Worker: 90 test files and 1,161 tests passed.
- Strict frontend and Worker TypeScript verification passed.
- Production Vite build passed.
- GitHub CI run `29570294337` passed frontend, Worker, Shopify, on-hold,
  Facebook scheduling, and route-registration guards.
- Draft PR `#209` remains unmerged.

Staging Worker version `c8b53562-75e5-4a7f-a417-05f1066cffb5` returned health
`200`. An unauthenticated enrollment request returned `401`. Read-only D1
verification found zero posts, workspace learning settings, pilot enrollments,
learning decisions, and critic verdicts, with `changed_db=false` and
`rows_written=0`.

Credential-free evidence:

- Artifact:
  `D:\GitHubBackup\SocialAi\release-evidence\staging-learning-pilot-consent-binding-proof-2026-07-17T09-37-19-778Z.json`
- Artifact SHA-256:
  `FEF336F2A382617CF18A973700F4F3635A32C3B8DD37AAD58460327BAD005CF6`
- Canonical payload SHA-256:
  `9087F0D28DB310E2D7F8CEAAA3C115CFA1AA7092FA138714FB1AA94DA8F3CC01`

### Production Remains Unchanged And Not Ready

No production deploy or mutation was performed. Production remains on Worker
version `26c19f95-7bb2-40b2-ae72-12c2a6e330e5` with health `200`. The latest
read-only D1 check reported one current-policy enrollment, five release
decisions, zero adjudications, and zero current-policy release-evidence rows;
both statements reported `changed_db=false` and `rows_written=0`. Hugheseys Que
remains exactly `status='on_hold'`.

This staging proof creates no customer consent, no pilot enrollment, no post,
no schedule, and no publication, and it does not count toward promotion. The
remaining gate still requires explicit client consent, 25 additional genuine
decisions across the two-workspace cohort, 30 total independent adjudications,
complete 168-hour real publication outcomes, and the documented release,
replay, regression, tenancy, and kill-switch evidence.

## 2026-07-17 Lane-Aware Critic And Release Judge Availability Gate

### Readiness Accounting Gap

The readiness calculation previously grouped every verdict only by
`critic_kind`. A deterministic pass could therefore mask an unavailable
independent LLM verdict of the same kind. The denominator also omitted the
selected image or video critic. Separately, the admin operations view treated
any complete pipeline receipt as proof that the independent Release Judge was
available even when a blocking critic had correctly prevented the Judge call.

Read-only production evidence exposed the difference. The five current owner
pilot decisions each selected an image and each stopped at `block_red` because
the image critic blocked. Their persisted verdicts contain:

- 20 of 20 available deterministic slots;
- 12 of 25 available independent text and business-harm slots; and
- 5 of 5 available selected-media slots.

The lane-aware result is therefore 37 of 50, or 74 percent, rather than the
stored legacy readiness value of 80 percent. All five legacy summaries have no
Judge status because the Judge correctly did not run after the image block.

Draft PR `#209` now:

- separates deterministic, independent, and media critic lanes;
- uses the latest attempt within each lane and critic kind;
- requires exactly the selected image or video critic;
- uses a four-slot denominator after a deterministic hard block and a
  nine-slot text/harm denominator plus selected media on the ordinary path;
- persists Release Judge telemetry as `available`, `unavailable`, or
  `not_run`;
- treats missing or contradictory Judge telemetry as `unknown` and fails
  readiness closed;
- measures Judge availability only across actual Judge invocations while
  separately requiring 100 percent Judge telemetry coverage; and
- requires both Judge gates and complete path-aware receipts before Protected
  Autopilot can become ready.

Legacy inference is deliberately narrow. A legacy receipt is `not_run` only
when its stored critic verdicts prove a Judge-preventing block, warning,
unavailability, or missing required slot. A legacy green or red receipt with
all required critics passing may infer that the Judge was available. An
ambiguous legacy hold remains unknown and cannot count as complete.

### Verification And Staging Proof

The new proof-manifest regression was observed failing before the four new
mandatory checks were registered. The lane, path, media, and Judge tests were
also observed failing before the readiness repair. Verification at source
commit `5d6d1132bdb411ef829406e2f39415811d338967`:

- Frontend: 17 test files and 197 tests passed.
- Worker: 90 test files and 1,169 tests passed.
- Focused Worker verification: 4 test files and 91 tests passed.
- Strict frontend and Worker TypeScript verification passed.
- Production Vite build passed with 1,924 modules transformed.
- The 70-check image/content smoke suite passed.
- The signed offline release proof passed 19 mandatory checks backed by
  154 tests with no failed or missing checks.
- GitHub CI run `29572773439` passed frontend, Worker, Shopify, on-hold,
  Facebook scheduling, and route-registration guards.
- Draft PR `#209` remains unmerged and mergeable.

The clean-tree offline artifact is:

- `D:\GitHubBackup\SocialAi\release-evidence\learning-release-proof-2026-07-17T10-14-01-717Z.json`
- Envelope SHA-256:
  `3F1E709C1B76CF332D1A3618712A4F12291869F666CC2D0501D4117E75407C25`
- Artifact file SHA-256:
  `E9BAB5C411155197F3C6392A2CB974B1860226F331F2048817D7137DD4DB2D20`
- Raw Vitest report SHA-256:
  `4785DD4C71E550BDFC16F70732BC23A988359B1CC203517FCEB20EDEA0CCD4B1`

Staging Worker version `04bf4fd3-400a-4d52-8374-a2a2c1eef545`
was deployed from that exact commit with:

- `LEARNING_BRAIN_ENABLED=true`
- `LEARNING_RELEASE_ENFORCEMENT=false`
- `LEARNING_AUTOPILOT_ENABLED=false`
- `ORGANIC_REACH_APPLY_ENABLED=false`

Post-deploy health returned `200`. Unauthenticated pilot enrollment and admin
operations requests returned `401`. The exact final admin operations CTE
compiled against the real staging D1 and read two rows while writing zero.
Staging still contains zero workspace learning settings, pilot enrollments,
learning decisions, and critic verdicts.

The first natural post-deploy trigger wrote successful staging cron receipts
`5916` (`learning_pilot`, `2026-07-17 10:30:59`) and `5917`
(`learning_readiness`, `2026-07-17 10:31:01`). Both processed zero posts and
reported no error. The readiness receipt evaluated at
`2026-07-17T10:31:00.055Z` remained `ready=0` and included the new Judge
metrics and checks: zero invocations, zero availability, zero telemetry
coverage, and both Judge gates false. This proves the new code fails closed
when staging has no genuine evidence.

Credential-free staging evidence:

- Artifact:
  `D:\GitHubBackup\SocialAi\release-evidence\staging-learning-availability-proof-2026-07-17T10-32-27-147Z.json`
- Artifact SHA-256:
  `C6ED3224C1CBF16F8481355EDBFC7E8E10975D17F029CA7AD4CCF5591B932A69`
- Canonical payload SHA-256:
  `0F267B48C5E6A68E39BCBACE6AE0C88F3A9386FE4513537813D05ECD341C3817`

The production Clerk session was not accepted by the isolated staging Worker.
No authentication control was weakened or bypassed. Authenticated staging
evidence therefore remains unproven and this staging exercise does not count as
promotion evidence.

### Production Remains Unchanged And Not Ready

No production Worker deploy was performed. Production remains on version
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5` with direct health `200`.
Hugheseys Que remains exactly `status='on_hold'`. The latest production
readiness receipt remains `ready=0`, with five owner decisions, one workspace,
zero client decisions, zero adjudications, stored legacy availability of 80
percent, and 100 percent legacy receipt coverage. All direct verification
queries reported `changed_db=false` and `rows_written=0`.

This increment created no customer consent, pilot enrollment, post, schedule,
adjudication, outcome, or publication. It changed no production runtime flag
and does not count toward promotion. The remaining gate still requires an
explicitly consented active client, 25 additional genuine decisions across the
two-workspace cohort, 30 total independent adjudications, complete 168-hour real
publication outcomes, authenticated staging ownership evidence, and every
documented replay, publishing-regression, tenancy, and kill-switch proof.

## 2026-07-17 Independent Critic Provider Contract Recheck

### Historical Failure Diagnosis

The five current production owner decisions were re-examined read-only after
the lane-aware calculation exposed weak independent-critic availability. The
provider requests themselves had returned model output. The unavailable
verdicts came from strict parsing of:

- fenced JSON;
- omitted repairs for a repairable warning;
- invalid verdict enum values; and
- an invalid nested `kind` even though the canonical outer key was correct.

Each failure predates the corresponding parser hardening already merged into
the current source: fenced JSON normalization, strict-schema retry, explicit
enum instructions, canonical outer-key handling, a larger output budget, and
contradictory-unavailable rejection. No current parser failure was reproduced,
so no runtime rewrite was made.

The production collector candidate predicate was also executed directly using
IDs and receipt counts only. All five owner drafts are correctly enrolled and
otherwise valid, but each has exactly one terminal release decision and exactly
one complete immutable receipt. The collector therefore excludes all five by
design. Re-running or overwriting those receipts would corrupt the audit trail
and falsely convert historical output into post-fix evidence.

### Synthetic Live Provider Proof

The exact current-source text council, business-harm critic, and Release Judge
were exercised with a synthetic cafe fixture. AI usage metering was disabled
with the staging environment setting; no D1 binding was supplied. The check
used no customer content and had no enrollment, scheduling, publishing, or
production mutation capability.

The live result completed in 6,608 milliseconds:

- brand, fact, repetition, and platform returned available `pass` verdicts;
- business harm returned an available `pass` verdict;
- the Release Judge returned `pass_green` with status `available`;
- each stage completed in one high-level call through
  `anthropic/claude-haiku-4-5`; and
- OpenRouter was configured as the fallback but was not needed.

Credential-free evidence:

- Artifact:
  `D:\GitHubBackup\SocialAi\release-evidence\learning-critic-provider-smoke-2026-07-17T10-45-18-092Z.json`
- Artifact SHA-256:
  `6D3D0AAE63A96D65591298ABAED83060DE863286E80BB68C14745911B8122093`
- Source commit:
  `adcd09ca88b8889b2deb6c12ec278c6aee5dcf50`

The artifact explicitly records `gateEligible=false`,
`customerDataUsed=false`, `databaseWritesEnabled=false`, and
`productionMutation=false`. It is provider-contract health evidence only. It
does not prove the deployed production Worker path and cannot replace genuine
immutable owner and consented-client pilot decisions.

### Production Remains Unchanged And Gate-Closed

No production deploy or production write was performed. The final read-only
query again returned `hughesq-001` as exactly `status='on_hold'`, with
`changed_db=false` and `rows_written=0`. The latest production readiness
evaluation at `2026-07-17T10:45:58.761Z` remained `ready=0`, with five owner
decisions and zero client decisions.

The original schema-handling issue is rectified in current source and the live
provider contract is healthy, but the rollout remains not ready. The next
eligible evidence must come from a genuinely new owner draft created through
normal product use; an explicitly consented active client is still required for
the second workspace. Historical receipts, synthetic fixtures, and operator
replays remain excluded from promotion calculations.

## 2026-07-17 Shopify Release Judge Readiness Parity

### Completion-Audit Finding And Repair

A requirement-to-evidence audit confirmed that the privacy-safe fleet
aggregation already enforces ten distinct workspaces, one hundred distinct
posts, coarse fields only, duplicate-post suppression, deletion invalidation,
and weekly rebuilding. No duplicate aggregation repair was needed.

The audit instead found a real cross-surface readiness gap. The Worker and main
dashboard expose separate `releaseJudgeAvailability` and
`releaseJudgeTelemetry` gates, but the Shopify Protected Autopilot checklist
omitted both and typed readiness checks and metrics as generic records. The
server still failed closed, so this was not a publication bypass, but a Shopify
merchant could not see two independent reasons that Protected Autopilot was
not ready.

The Shopify API contract now explicitly types every readiness check and metric,
including Judge availability, Judge telemetry coverage, and Judge invocation
count. Shopify Settings now renders both missing Judge gates alongside the
existing critic, receipt, evidence, cost, and tenancy gates. Each check uses an
exact `=== true` comparison, so a missing field during a staggered deployment
is shown as not passed rather than inferred safe.

A regression requiring both fields in the API contract and both rows in the
Shopify checklist was observed failing before the repair and passing after it.

### Verification

- Frontend: 17 test files and 198 tests passed.
- Worker: 90 test files and 1,169 tests passed.
- Focused Protected Autopilot parity: 7 tests passed.
- Signed Shopify learning route: 23 tests passed; the authenticated readiness
  response preserved both Judge checks plus availability, telemetry coverage,
  and invocation metrics from the durable receipt.
- Strict frontend, Worker, and Shopify TypeScript verification passed.
- Main production build passed with 1,924 modules transformed.
- The 70-check image/content safety smoke suite passed.
- Shopify production build passed with 1,124 modules transformed.
- Shopify build verification found no unresolved Vite placeholders.

The Shopify build used the public committed `client_id` from
`shopify.app.toml` only in the build process. No env file or secret was
created. No Worker runtime changed, so no Worker deployment was performed for
this UI-only parity repair.

### Production Remains Unchanged And Gate-Closed

Production remains on Worker version
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5`; direct health returned `200`.
Read-only D1 verification again returned `hughesq-001` as
`status='on_hold'` and the latest current-policy readiness receipt as
`ready=0`, with five owner decisions and zero client decisions. Both statements
reported `changed_db=false` and `rows_written=0`.

The isolated staging Worker still has no Clerk, JWT, or signed-embed
verification secret available from the approved local environment.
Authentication was not weakened and no unverifiable credential was copied.
Authenticated staging ownership evidence therefore remains unproven.

This increment creates no consent, enrollment, post, schedule, adjudication,
outcome, or publication and does not count toward promotion. Protected
Autopilot and reach-plan application remain disabled until every documented
gate is satisfied by genuine evidence.

## 2026-07-17 Two-Workspace Pilot Cohort Readiness Parity

### Completion-Audit Finding And Repair

The Worker already required exactly two pilot workspaces, at least one genuine
owner decision, and at least one genuine client decision before its
`pilotCohort` readiness check could pass. The main dashboard already received
the three supporting metrics but omitted the check from its type and gate
list. The Shopify dashboard omitted the check, its supporting metrics, and the
corresponding gate row.

This was an operator-visibility gap rather than a publication bypass: the
server continued to fail closed. Both dashboards now expose an
`Owner + client pilot cohort` gate. The main dashboard shows the exact
workspace, owner-decision, and client-decision counts. The Shopify API contract
now strongly types the same check and all three metrics. Both surfaces require
the check to be exactly `true`, so missing data remains visibly failed during a
staggered deployment.

The focused frontend contract was observed failing in two places before the
repair: the main rendered output had no cohort row, and the Shopify API
contract had no `pilotCohort` field. The same seven-test contract passed after
the repair. The signed Shopify route test also proves that the authenticated
readiness response preserves `pilotCohort`, `pilotWorkspaceCount`,
`pilotUserDecisions`, and `pilotClientDecisions` from the immutable readiness
receipt.

### Verification

- Frontend: 17 test files and 198 tests passed.
- Worker: 90 test files and 1,169 tests passed.
- Focused Protected Autopilot parity: 7 tests passed.
- Signed Shopify learning route: 23 tests passed.
- Strict frontend, Worker, and Shopify TypeScript verification passed.
- Main production build passed with 1,924 modules transformed.
- The 70-check image/content safety smoke suite passed.
- Shopify production build passed with 1,124 modules transformed.
- Shopify build verification found no unresolved Vite placeholders.

The Shopify build used the public committed `client_id` from
`shopify.app.toml` only in the build process. No env file or secret was
created. This repair changes display and TypeScript contracts only; it does not
change the readiness calculation, learning pipeline, release enforcement, or
publication path.

### Production Remains Unchanged And Gate-Closed

No production Worker deployment was performed. Production remains on version
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5`, and direct health returned `200`.
The latest current-policy readiness evaluation at
`2026-07-17T11:00:59.337Z` remains `ready=0`: five total owner decisions, one
pilot workspace, zero client decisions, and `pilotCohort=false`.

Read-only D1 verification returned `hughesq-001` as exactly
`status='on_hold'`. Both statements reported `changed_db=false`,
`changes=0`, and `rows_written=0`.

This increment creates no consent, enrollment, post, schedule, adjudication,
outcome, publication, or customer-status mutation and does not count toward
promotion. The rollout remains in approval mode until a genuinely consented
active client contributes real pilot evidence and every other documented gate
passes.

## 2026-07-17 Complete Offline Release-Proof Contract

### Completion-Audit Finding And Repair

The offline release artifact could previously report `offline_pass` after
nineteen representative checks even though several named Customer Learning
Brain subsystems were not mandatory members of the proof contract. The
underlying implementations and tests existed, but an accidental omission from
`REQUIRED_RELEASE_PROOF_CHECKS` could let a future regression in bounded
self-repair, outcome learning, privacy aggregation, centralized egress, reach
application, or consent gating escape the artifact.

The proof contract now requires forty-seven exact test assertions covering:

- tenant-scoped shadow receipts with no post mutation;
- deterministic, independent LLM, selected-media, and Release Judge lanes;
- two-attempt bounded repair and non-overridable critical blocks;
- the two-workspace owner/client pilot cohort and readiness thresholds;
- readiness persistence, green-to-red alerting, and stale-on-failure behavior;
- explicit current consent, current tenancy proof, cost, and kill-switch gates;
- zero processing for malformed or on-hold workspaces;
- manual, cron, Quick Post, Calendar, Postproxy, and Graph egress;
- Facebook/Instagram-specific reach treatments, one-variable experiments,
  non-mutating shadow plans, and guarded apply mode;
- immutable 24-hour, 72-hour, and 168-hour outcomes under canonical tenant
  scope;
- bounded confidence-weighted strategy updates and private versioned profiles;
- ten-workspace and one-hundred-post privacy thresholds, coarse output only,
  and deletion invalidation; and
- literal dormant production and staging enforcement flags.

The contract test was observed failing against the prior nineteen-check
manifest, then passing after all required assertions were added. A pre-commit
generator run found all forty-seven checks across 247 passing tests but
correctly returned `failed_or_unreviewed` solely because the Git tree was
dirty.

The audit also caught an evidence-integrity defect before recording the new
artifact. The `.sha256` sidecar labelled the JSON artifact path with the
canonical payload-envelope hash rather than the hash of the artifact file
bytes. The generator now labels the payload hash separately, calculates the
serialized JSON file hash after writing, and stores that real file hash in the
sidecar. A regression contract and an independent `Get-FileHash` comparison
prove the distinction.

### Authoritative Offline Artifact

The clean-tree generator completed at source commit
`98bc77639c03f6f4f44452885a23d6fd55754dd7`:

- Result: `offline_pass`
- Required checks: 47
- Missing checks: 0
- Failed checks: 0
- Executed tests: 247
- Passed tests: 247
- Artifact:
  `D:\GitHubBackup\SocialAi\release-evidence\learning-release-proof-2026-07-17T11-21-53-964Z.json`
- Canonical payload SHA-256:
  `09561DA2981AF9D516EACC08AAD795656867BFB324C888B86F87E5B16EA3F027`
- Artifact file SHA-256:
  `B7269D1FD23324A272F6F717568DB367DB883A91EBCA2B7A0D0B83C69096FF4D`
- Raw Vitest report SHA-256:
  `CD63E1E31CDFC14B5628B4F33D43A980137CC3D566D3C715985B49490A759857`

The sidecar and independently calculated artifact file hash match exactly. The
embedded report hash and independently calculated raw-report hash also match.
The artifact explicitly records `liveStagingProven=false`,
`authenticatedEvidenceSubmitted=false`, `productionMutationPerformed=false`,
and `releaseFlagsChanged=false`; it is a stronger offline replay candidate, not
a promotion certificate.

### Complete Verification

- Frontend: 17 test files and 199 tests passed.
- Worker: 90 test files and 1,169 tests passed.
- Expanded proof suites: 247 tests passed.
- Strict frontend and Worker TypeScript verification passed.
- Main production build passed with 1,924 modules transformed.
- The 70-check image/content safety smoke suite passed.
- Shopify production build passed with 1,124 modules transformed.
- Shopify build verification found no unresolved Vite placeholders.

The Shopify build used the public committed `client_id` from
`shopify.app.toml` only in the build process. No env file or secret was
created.

### Production Remains Unchanged And Gate-Closed

No production Worker deployment or variable update was performed. Production
remains on version `26c19f95-7bb2-40b2-ae72-12c2a6e330e5`, and direct health
returned `200`. The deployed version still has:

- `LEARNING_BRAIN_ENABLED="true"`;
- `LEARNING_RELEASE_ENFORCEMENT="false"`;
- `LEARNING_AUTOPILOT_ENABLED="false"`;
- `ORGANIC_REACH_ENABLED="true"`; and
- `ORGANIC_REACH_APPLY_ENABLED="false"`.

The latest current-policy readiness evaluation at
`2026-07-17T11:15:59.191Z` remains `ready=0`: five owner decisions, one pilot
workspace, zero client decisions, and `pilotCohort=false`. Read-only D1
verification returned `hughesq-001` as exactly `status='on_hold'`. Both
statements reported `changed_db=false`, `changes=0`, and `rows_written=0`.

Authenticated staging ownership evidence remains unproven because no approved
staging Clerk, JWT, or signed-embed verification credential is available.
Authentication was not weakened and no credential was copied. This increment
creates no consent, enrollment, post, schedule, adjudication, outcome,
publication, or customer-status mutation and does not count toward promotion.

## 2026-07-17 Authenticated Record-Only Pilot And Critic Repair Safety

### Staging Authentication Was Constrained, Not Bypassed

The isolated staging Worker now accepts Clerk bearer authentication only when
both staging-only constraints pass: the token subject is in the exact
`STAGING_AUTH_ALLOWED_USER_IDS` allowlist and the Clerk `azp` claim matches
`https://socialaistudio.au`. The global staging guard requires both settings
to exist and fails closed when either is missing. It reuses the verified
identity in route middleware rather than weakening the normal Clerk path.

Only the public Clerk JWT signing key was installed in staging. No production
secret, bearer token, or browser credential was written to disk or committed.
An unauthenticated owned route returned `401`; the allowlisted owner returned
`200`; the learning admin route returned `403` before bootstrap and `200`
after the normal authenticated user bootstrap plus one documented,
staging-only admin promotion. The promotion changed exactly one isolated
staging row.

The authenticated owner then enrolled only their own workspace in the
current-policy approval pilot. The enrollment is immutable, record-only, and
uses `consent_basis='owner_self'`. It has no Protected Autopilot consent,
no autopublish policy, a zero experiment rate, and a bounded 500-cent monthly
AI budget.

### Live Pilot Findings And Repairs

The live record-only pilot exposed a genuine critic defect before promotion.
An independent fact critic proposed adding unsupported metrics, client counts,
testimonials, and case studies as repairs. The pipeline held the Draft and did
not apply or publish those suggestions, but they were unsafe to retain as
repair input. The repair path now:

- normalizes fact warnings to one removal-only instruction;
- tells every critic that rhetorical questions are not facts and recent posts
  are repetition context only;
- validates every independently repaired caption against deterministic
  fabrication and fact checks before reuse; and
- rejects any critic response that attaches repairs to `pass`, `block`, or
  `unavailable`, forcing a strict retry or fail-closed result.

A claim-free Draft produced an internal `pass_green` after two bounded
repairs, but the persisted decision correctly remained `hold_amber` because
the resulting candidate differed from the source Draft. A second distinct
claim-free Draft remained amber after genuine repetition warnings and a
release-critical unavailable harm verdict caused by the intentionally empty
staging business profile. Neither result was relabelled as a green proof.

A new post-deployment synthetic red-team Draft made an absolute revenue
guarantee. The real pipeline returned `block_red` with one attempt, no repair,
critical fact and business-harm blocks, `sourceStatus='Draft'`, and
`postMutated=false`. A malformed non-warning repair in that receipt motivated
the final parser hardening; that final parser-only commit has full automated
and staging-deployment proof, but no second authenticated live decision is
claimed for it.

All five staging fixtures remain text-only Drafts with null schedules, images,
and videos. Staging contains zero publication events, zero delivery receipts,
zero outcomes, zero outcome attempts, and zero approved media assets.

### Final Staging State

The final staged code head is
`301221d33914d76d662c34fc773b06ef0d46f0c8`. Staging runs Worker version
`d94fcc79-a543-4cc4-b9f9-d94cedf87e6f` against only
`socialai-db-staging`. Its deployment still has:

- `LEARNING_BRAIN_ENABLED="true"`;
- `LEARNING_RELEASE_ENFORCEMENT="false"`;
- `LEARNING_AUTOPILOT_ENABLED="false"`;
- `ORGANIC_REACH_ENABLED="true"`; and
- `ORGANIC_REACH_APPLY_ENABLED="false"`.

Focused critic and preflight verification passed 42 tests. The complete Worker
suite passed 92 files and 1,180 tests, strict Worker TypeScript passed, and the
staging Wrangler dry-run targeted the isolated D1 with all three
behavior-changing flags disabled. GitHub PR `#209` remains draft and
mergeable; its CI and current Pages checks passed at the exact final head.

The final staging readiness cron succeeded at
`2026-07-17T12:15:56.495Z` and persisted `ready=0`. It observed five owner
decisions in one workspace, zero client decisions, zero adjudications, and
failed pilot-volume, cohort, false-hold, availability, prediction, ranking,
and cost gates. This is partial live safety evidence, not a promotion
certificate.

The credential-free artifact and verified byte-hash sidecar are:

- `D:\GitHubBackup\SocialAi\release-evidence\staging-authenticated-learning-pilot-proof-2026-07-17T12-16-35-438Z.json`
- SHA-256:
  `95BCECC26EED37AAD9950D951CF1A87586834DB073CD1C6F1B63EEC85541CFC4`

### Production Remains Unchanged And Gate-Closed

No production Worker deployment, variable update, consent, customer
enrollment, adjudication, release-evidence submission, or customer-status
mutation was performed. Production remains on version
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5`; direct health returned `200`; all
three behavior-changing flags remain false. The latest production readiness
receipt at `2026-07-17T12:15:56.474Z` remains `ready=0`. Production has zero
Protected Autopilot workspaces, zero autopublish consents, and zero
learning-related publication events or delivery receipts in the preceding
day.

Read-only D1 verification returned `hughesq-001` as exactly
`status='on_hold'`. Every production query reported `changed_db=false`,
`changes=0`, and `rows_written=0`. Promotion remains blocked until genuine
consented client evidence, unchanged green decisions, adjudications, required
volume, quality, cost, prediction, and all other documented gates pass.

## 2026-07-17 Readiness Regression Alert Contract Recheck

### Completion-Audit Finding And Closure

The readiness cron already persisted every evaluation and called the
rate-limited operational alert when readiness changed from green to red. Its
test asserted only that some alert was called once. It did not prove the
load-bearing alert key, critical severity, failed-check body, or silence for
non-transition states.

The readiness contract now proves that an actual green-to-red transition calls
exactly `learning_readiness_green_to_red` at `critical` severity and includes
the failed `severeFalsePasses` check in the operator body. A separate
three-scenario test proves no alert is emitted on initial startup with no
previous receipt, while readiness remains red, or while readiness remains
green. Every scenario still persists its immutable readiness receipt.

This is a test-only safety closure. It changes no Worker runtime, alert
configuration, customer data, consent, learning decision, schedule,
publication path, or rollout flag.

### Production Signal Diagnosis

The production readiness metric `publishingRegressions=1` was rechecked rather
than treated as proof of a live bypass. The readiness implementation
initializes that metric to one until current-policy publish-regression evidence
passes. It is a fail-closed missing-proof marker.

Read-only production D1 inspection of the five current approval-pilot
decisions found all five at `block_red`, all five with no attached
`publication_event_id`, and no adjudications. The corresponding readiness
metric `criticalBypasses=0` is therefore consistent with the source rows: no
blocked pilot decision was published.

### Verification

- Focused readiness verification: 25 tests passed.
- Complete Worker verification: 92 files and 1,181 tests passed.
- Strict Worker TypeScript verification passed.
- Clean-tree release proof: 47 mandatory checks and 250 tests passed.
- Source commit:
  `5c71eba992f3749d19f94fe7e2d2a7f5c50edf30`.
- Artifact:
  `D:\GitHubBackup\SocialAi\release-evidence\learning-release-proof-2026-07-17T12-29-36-747Z.json`
- Artifact file SHA-256:
  `37F0D8A6061D8912E259877A77ED179A9C74B6F748B5BFD08B55A99C875DC147`

The artifact continues to record `liveStagingProven=false`,
`authenticatedEvidenceSubmitted=false`, `productionMutationPerformed=false`,
and `releaseFlagsChanged=false`. This regression contract strengthens
operator monitoring but does not count toward pilot volume, adjudication,
tenancy, outcome, cost, or promotion gates.

### Production Remains Unchanged And Gate-Closed

No production Worker deployment, variable change, database mutation, consent,
customer enrollment, adjudication, evidence submission, or customer-status
change was performed. Production remains on
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5`, current readiness remains `ready=0`,
and `hughesq-001` remains exactly `status='on_hold'`.

## 2026-07-17 Pilot Business-Context Readiness Gate

### Live Defect And Fail-Closed Contract

The authenticated record-only pilot had exposed a quality defect that was
separate from the critic-repair safety fixes. A claim-free Draft could spend
all three business-harm attempts and end at `unavailable` solely because its
staging business profile was empty. The post remained held and unpublished,
but the route wasted critic budget and reported an ambiguous hold instead of
telling the operator that required business evidence was missing.

Pilot validation now loads the tenant-scoped critic context after immutable
enrollment verification and before budget telemetry, decision creation, or
critic execution. It proceeds only when the workspace has at least one
substantive business descriptor or a non-placeholder verified fact. Names,
logos, tone, location, denylist entries, social goals, and placeholders such
as `TBD`, `N/A`, or `unknown` do not make the workspace ready.

Missing context returns a deterministic `409` with
`code='pilot_context_not_ready'`, zero profile/fact counts, and an instruction
to complete the profile or add a verified fact. Context-loading failures
return a separate fail-closed `503`. The normal release pipeline remains
unchanged and fail-closed; this precheck applies only to the dormant,
admin-only, record-only pilot endpoint.

### Automated And Staging Verification

Focused context and route verification passed 40 tests. The route test proves
the missing-context branch does not query cost telemetry, create a learning
decision, invoke the critic pipeline, or mutate a post. The complete Worker
suite passed 92 files and 1,186 tests, strict Worker TypeScript passed, the
frontend suite passed 199 tests, and the production frontend build completed.
GitHub PR `#209` checks passed at implementation commit
`e9169ef636044c4dbaad3b38390b315b371c2ec1`.

Only the isolated staging Worker was deployed. Staging version
`878032eb-4cad-4905-af04-fed06b0e0cef` runs against
`socialai-db-staging` with:

- `LEARNING_BRAIN_ENABLED="true"`;
- `LEARNING_RELEASE_ENFORCEMENT="false"`;
- `LEARNING_AUTOPILOT_ENABLED="false"`;
- `ORGANIC_REACH_ENABLED="true"`; and
- `ORGANIC_REACH_APPLY_ENABLED="false"`.

Direct staging and production health checks returned `200`. The unauthenticated
staging pilot route returned `401`, confirming the Clerk boundary remained
closed. No reusable bearer token was retained, so a fresh authenticated live
`409` was not submitted and is not claimed. Authentication was not weakened,
and no credential was copied or written to disk.

Read-only staging D1 verification found one record-only owner enrollment,
zero context-ready owner enrollments, zero scheduled or published posts, and
zero publication events. Latest staging readiness remains `ready=0`. Every
successful verification query reported `changed_db=false`, `changes=0`, and
`rows_written=0`.

Credential-free evidence:

- `D:\GitHubBackup\SocialAi\release-evidence\staging-pilot-context-readiness-proof-2026-07-17T12-43-38-645Z.json`
- SHA-256:
  `8B1D069058FF337BBC01623A1A2B77F8388349905D32A226551E5134E7C67D33`

### Production Remains Unchanged And Gate-Closed

Production was not deployed and remains on version
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5`. Its exact deployed bindings still
have learning enforcement, Protected Autopilot, and organic-reach application
disabled; latest readiness remains `ready=0`. Read-only production D1
verification returned `hughesq-001` as exactly `status='on_hold'` with zero
rows written.

This removes an avoidable source of inconsistent pilot holds and critic cost.
It does not supply the missing genuine client cohort, unchanged green
decisions, adjudications, outcome history, or promotion evidence. Production
rollout therefore remains blocked.

## 2026-07-17 Scheduled Pilot Context Gate And Counter Telemetry

### Completion-Audit Finding And Repair

The authenticated manual pilot route was fail-closed on missing business
context, but the natural 15-minute collector still went directly from
candidate selection to budget and critic evaluation. That separate scheduled
path could therefore spend critic budget and create another ambiguous hold for
the same incomplete workspace.

The collector now loads the same tenant-scoped critic context and applies the
same readiness contract before budget telemetry or critic execution. Its
candidate pool is balanced at up to five owner and five client Drafts, with a
ten-row scan ceiling and at most one ready workspace from each owner kind
evaluated per run. A missing-context or exhausted-budget workspace no longer
reserves its owner-kind slot and cannot starve a later ready workspace.

Schema v43 adds a bounded `cron_runs.details_json` field. Only the following
non-negative integer counters are serialized for `learning_pilot` receipts:
`posts_processed`, `candidates_considered`, `evaluated`, `reused`,
`claimed_elsewhere`, `budget_skipped`, `context_not_ready`,
`invalid_skipped`, and `errors`. Arbitrary result properties, captions, and
customer content are not persisted or returned by `/api/cron-health`.

### Authenticated And Natural Staging Proof

One clearly labelled synthetic staging fixture was created through the normal
authenticated `POST /api/db/posts` route, not by inserting a proof row into
D1. Fixture `bf848b80-b88d-4ff4-88b8-6ab0992e535f` was created as text-only
`Draft` content with no client, schedule, image, video, or publish path.

The authenticated manual validation route returned HTTP `409` with
`code='pilot_context_not_ready'`, zero meaningful profile fields, zero
verified facts, and no decision ID. The Clerk bearer token existed only inside
the already authenticated page, was never output or written to disk, and the
temporary browser tab was closed after verification.

Cloudflare then invoked the real staging scheduler without a manual trigger.
Natural receipt `6148`, at `2026-07-17 13:30:57` UTC, succeeded with:

```json
{
  "posts_processed": 0,
  "candidates_considered": 1,
  "evaluated": 0,
  "reused": 0,
  "claimed_elsewhere": 0,
  "budget_skipped": 0,
  "context_not_ready": 1,
  "invalid_skipped": 0,
  "errors": 0
}
```

The same receipt was independently visible through D1 and the public
`/api/cron-health` read model. After both checks, the fixture remained an
unscheduled, media-free Draft. It had zero decisions and zero publication
events; total staging decisions remained five with the same latest timestamp;
and the entire staging `ai_usage` ledger remained at zero rows and zero cost.
The only intentional business-data write was the isolated QA Draft, and the
only automatic proof write was the normal cron receipt.

This synthetic fixture proves a safety branch only. It does not count as a
pilot decision, customer consent, adjudication, outcome, publication, or
promotion record.

Credential-free evidence:

- `D:\GitHubBackup\SocialAi\release-evidence\staging-pilot-context-collector-proof-2026-07-17T13-33-16-867Z.json`
- SHA-256:
  `759125F5778D63F175701872D04FCADD10CE84D48C30356EEFDAA97DA3D586C6`

### Verification And Deployment Boundary

The final implementation source before this evidence update is
`0080588a4ed8ca1b9b095bebf8a473cf62abe857`. Focused collector and telemetry
contracts passed, the complete Worker suite passed 93 files and 1,192 tests,
strict Worker TypeScript passed, the frontend suite passed 17 files and 199
tests, and the production frontend build passed. Draft PR `#209` remained
mergeable with CI passing at that exact source commit.

Only staging received schema v43 and Worker version
`ea139d3d-a2be-4191-9c7d-6fd6c982bfa5`. Its behavior-changing flags remain
disabled and it is bound only to `socialai-db-staging`.

Production was not migrated or deployed. It remains on Worker version
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5`, schema v42 has no
`cron_runs.details_json` column, current readiness is `ready=0`, protected
workspace count is zero, and autopublish consent count is zero. Read-only
production checks wrote zero rows, and `hughesq-001` remains exactly
`status='on_hold'`.

The scheduled-path defect and its observability gap are closed in staging.
Production promotion remains blocked until all genuine consent, client-cohort,
adjudication, availability, cost, outcome, and release-readiness gates pass.

## 2026-07-17 Synthetic Pilot Evidence Disqualification

### Integrity Finding And Permanent Boundary

The five authenticated staging decisions were explicitly documented synthetic
QA fixtures, but the readiness collector and admin pilot cohort treated every
current-policy approval decision as promotion evidence. Left unfixed, repeated
red-team runs could accumulate toward the 30-decision gate even though the
evidence log said they must not count.

Schema v44 adds `learning_decision_disqualifications`, an append-only,
tenant-scoped receipt table. It accepts only `reason='synthetic_qa'`, enforces
canonical user/client ownership tuples, blocks updates with a trigger, and
cascades only when the parent decision is removed during scoped privacy
erasure. The original post, decision, and critic verdicts remain intact for
audit.

The authenticated admin endpoint
`POST /api/learning/pilot/disqualify/:decisionId` exists only when
`ENVIRONMENT='staging'`, the learning brain is enabled, and release enforcement
and Protected Autopilot are both disabled. Its single atomic insert accepts
only a current-policy, unpublished, unadjudicated, unscheduled Draft in an
active enrolled workspace. It derives the tenant tuple from the decision,
rejects unexpected body fields, is idempotent on `decision_id`, and never
updates a post or decision.

Readiness, adjudication sampling, and the admin operations cohort all join the
receipt by the complete tenant tuple and require no matching exclusion before
their 30-row limit. Privacy deletion explicitly removes the receipts within
the same tenant scope. Five exact schema, route, idempotency, fail-closed, and
readiness contracts are now mandatory entries in the offline release-proof
allowlist.

### Authenticated And Natural Staging Proof

Only staging received schema v44 and Worker version
`d828d0ef-6f2a-4e5d-a06d-2ae68cefb9f9`, deployed from
`b3214eece1c8b6e765e4a30ad0b691bb4b3529fa`. GitHub PR `#209` checks passed
that source commit.

The existing authenticated SocialAI browser session submitted all five
decisions through the real staging endpoint. Every response returned HTTP
`200`, `created=true`, and `postMutated=false`. Repeating the first request
returned the same receipt with `created=false` and `postMutated=false`. The
Clerk bearer existed only in page memory and was never output or persisted.

Read-only D1 verification then found exactly five distinct synthetic exclusion
receipts. All five source decisions still existed, all five source posts
remained unscheduled Drafts, and publication and adjudication counts remained
zero.

No readiness evaluation was manually triggered. The natural 15-minute
scheduler persisted successful cron receipt `6206` at
`2026-07-17 14:15:58` UTC and immutable readiness snapshot
`2a226094-5d45-45eb-b02e-aa59c955d7ce` at
`2026-07-17T14:15:57.894Z`. Compared with the preceding 14:00 snapshot:

- eligible pilot decisions fell from five to zero;
- eligible workspaces and owner decisions fell from one/five to zero/zero;
- client decisions and adjudications remained zero;
- critical bypasses remained zero; and
- readiness remained safely red.

Authenticated `/api/learning/readiness` and
`/api/learning/admin/operations` independently returned HTTP `200` with zero
pilot decisions; the owner workspace operations row also reported
`decisionCount=0`.

Credential-free evidence:

- `D:\GitHubBackup\SocialAi\release-evidence\staging-synthetic-pilot-exclusion-proof-2026-07-17T14-17-09-603Z.json`
- SHA-256:
  `01C589D03F34E7716E27D60AA63D577A07C2B4E383B9317BFC105211F392612F`

### Verification And Production Boundary

The complete Worker suite passed 94 files and 1,196 tests, strict Worker
TypeScript passed, the frontend suite passed 17 files and 199 tests, and the
staging Wrangler dry-run compiled against only `socialai-db-staging`.

Production was not migrated, deployed, or mutated. It remains on Worker
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5` and schema v42 with no v44 table,
zero Protected Autopilot workspaces, zero autopublish consents, and red
readiness. The separate five production owner-pilot decisions have different
IDs and older timestamps; no artifact classified them as these staging
fixtures, so they were not relabelled or changed. `hughesq-001` remains exactly
`status='on_hold'`.

This closes the synthetic-volume integrity defect. It does not create genuine
pilot volume, client-cohort evidence, adjudications, outcome history, or
promotion approval. Pilot-attributable staging cost telemetry remains the next
fail-closed readiness gap.

## 2026-07-17 Pilot AI Usage Attribution

### Defect And Permanent Boundary

The readiness budget check previously used only the workspace-wide monthly
`ai_usage` total. Unrelated product calls could therefore make the budget
telemetry appear present even when the selected pilot decisions had no cost
receipts. Staging usage logging was also disabled, and the general logger
intentionally swallowed persistence failures. That combination could not
support a release gate.

Schema v45 adds nullable `ai_usage.learning_decision_id`, an indexed foreign
key to `learning_decisions`. Its insert trigger accepts an attribution only
when the decision, user, client, and post tuple exactly matches. Its update
trigger makes the attribution identity and tenant tuple immutable. Tenant
privacy deletion can still cascade the receipt with its parent decision.

Pilot evaluation now allocates the decision claim before running critics and
passes a request-local usage scope through the complete critic pipeline. Every
metered AI call in that scope must persist against the exact claim. A scoped
logging failure is fatal, and a decision cannot transition from
`persistenceState='writing'` to `persistenceState='complete'` unless the number
of persisted receipts exactly equals the number of attempted calls with zero
failures. The scope is held in a `WeakMap`; it cannot be supplied through
Wrangler variables or leak into parent or concurrent requests. Unscoped
product AI calls retain their existing best-effort behavior.

Readiness still treats the full workspace monthly ledger as the hard budget
cap. Separately, it now requires every selected, eligible pilot decision to
have exact tenant-and-post-matched usage receipts, a positive pilot spend no
greater than the workspace total, and no null or negative estimates. Generic
unrelated usage cannot satisfy the pilot evidence gate. Eight corresponding
schema, scope, identity, completion, coverage, and estimate-integrity checks
are permanent mandatory release-proof contracts.

### Isolated Database And Staging Proof

The v45 migration was first exercised against a disposable local D1 database.
An exact attribution inserted successfully; a cross-tenant attribution and an
identity update were both rejected; deleting the parent decision cascaded the
usage receipt. No remote data participated in that exercise.

Only `socialai-db-staging` then received v45. Read-only metadata verification
found the new column, one guarded index, both guard triggers, and the expected
`learning_decision_id -> learning_decisions.id ON DELETE CASCADE` foreign key.
The staging `ai_usage` ledger remained at zero rows before and after migration.
Matching Worker version `c43d0828-b76e-4c33-bb63-2d81a7a7c352` was deployed
from source commit `996c8844e65e07e8aaa3032c20b686cedf94b37e`.
Release enforcement, Protected Autopilot, and organic-reach application remain
disabled.

No profile, fact, post, consent, schedule, or decision was created or modified
to force a paid proof. Cloudflare naturally invoked the staging pilot at
`2026-07-17 15:00:57` UTC. Cron receipt `6262` succeeded with:

```json
{
  "posts_processed": 0,
  "candidates_considered": 1,
  "evaluated": 0,
  "reused": 0,
  "claimed_elsewhere": 0,
  "budget_skipped": 0,
  "context_not_ready": 1,
  "invalid_skipped": 0,
  "errors": 0
}
```

The only candidate was the existing, explicitly labelled staging QA Draft
`bf848b80-b88d-4ff4-88b8-6ab0992e535f`. The owning profile was still exactly
the empty JSON object and had zero verified client facts, so the skip was
truthful. After the run, the post remained an unscheduled 168-character text
Draft with no image or video. It had zero decisions, while the entire staging
usage ledger still had zero rows, zero attributed rows, zero invalid costs, and
zero spend. The following readiness cron also succeeded and remained red.

This proves that missing truthful context fails closed before critics, spend,
decision completion, scheduling, or publishing. It does not prove a live paid
pilot attribution. That separate gate remains unsatisfied until a genuinely
configured, enrolled staging workspace naturally produces an evaluation; no
synthetic context or fabricated cost will be substituted.

Credential-free evidence:

- `D:\GitHubBackup\SocialAi\release-evidence\staging-pilot-cost-attribution-proof-2026-07-17T15-06-00-000Z.json`
- SHA-256:
  `20C7C20795C2F9EC3B8FC53E679B969B13898D04B8031F4046C81393D2C0F35A`

### Verification And Production Boundary

Before this evidence update, the complete Worker suite passed 95 files and
1,204 tests, strict Worker TypeScript passed, the frontend suite passed 17
files and 199 tests, the production frontend build passed, and the focused
release-proof allowlist test passed all ten cases. The final clean-tree release
proof and immutable repository save are run again after this evidence is
committed.

Production was not migrated, deployed, or mutated. It remains on Worker
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5`, its `ai_usage` table has no v45
column, and every production database check reported `changed_db=false`.
`hughesq-001` remains exactly `status='on_hold'`.

## 2026-07-17 Pre-Spend Pilot Context Gate

### Operational Gap And Permanent Control

Pilot validation already refused to run critics when the workspace lacked a
meaningful business profile or verified fact. Enrollment did not apply the
same precondition, however, and the candidate queue exposed no readiness
diagnostic. An operator could therefore consume the immutable one-user or
one-client cohort slot and discover the context problem only after attempting
validation.

Enrollment now loads the same canonical, tenant-scoped critic context used by
validation before writing either the consent receipt or approval settings. A
missing profile record returns `pilot_context_unavailable`; an empty profile
and fact set returns `pilot_context_not_ready` with aggregate counts. Neither
path writes an enrollment, settings row, decision, or AI usage receipt.
Validation independently repeats the context check, so later profile removal
also fails closed.

The candidate query derives readiness from at most 80 tenant-scoped verified
fact contents and the exact owner/client profile. Those values remain inside
the Worker. Its response contains only:

- `contextReady`;
- the canonical readiness reason;
- meaningful profile-field count; and
- verified-fact count.

The admin card shows separate enrollment and context badges, explains the
missing prerequisite before action, and disables both enrollment and
validation while context is incomplete. It also states that critics and AI
spend remain blocked. Customer consent remains separately required for a
client candidate and is still not consent to publish.

Two new mandatory offline release checks pin the enrollment-before-context
failure path and the privacy-safe candidate diagnostics:

- `pilot_context_before_enrollment`
- `pilot_context_candidate_diagnostics`

### Verification And Staging Runtime

Source commit `372930d0da937ef561c5df28426513c6dba3f04e`
passed GitHub CI run `29591972853`, including frontend, Worker, Shopify, hold,
and forbidden Facebook scheduling guards. Locally, the complete Worker suite
passed 95 files and 1,205 tests, strict Worker TypeScript passed, the frontend
suite passed 17 files and 200 tests, frontend TypeScript passed, the
production build passed, and the staging Wrangler dry run resolved only
`socialai-db-staging`.

Matching staging Worker version
`281399b5-16ca-428e-8c84-392fc6814f02` was deployed at
`2026-07-17T15:26:12.639Z`. Release enforcement, Protected Autopilot, and
organic-reach application remained disabled. Public health returned HTTP 200;
the unauthenticated candidate endpoint returned HTTP 401.

The logged-in frontend session did not expose a supported in-memory Clerk
token handle. No cookie, browser storage, network credential interception, or
token output was attempted, so an authenticated candidate GET is not claimed
as runtime evidence.

Cloudflare naturally invoked the newly deployed pilot at
`2026-07-17 15:30:57` UTC. Cron receipt `6300` succeeded with one candidate
considered, `context_not_ready=1`, zero evaluations, zero reused or competing
claims, zero budget skips, zero invalid rows, and zero errors. Readiness
snapshot `0331c777-9394-40e4-b55d-9db5a2678711` remained safely red with zero
eligible pilot decisions.

Before and after deployment, staging retained exactly one owner enrollment and
one settings row. The QA Draft remained unscheduled, text-only, 168 characters,
and media-free. It retained zero decisions, while the complete staging
`ai_usage` ledger retained zero rows. The owner profile remained the empty JSON
object and had zero verified facts. No profile, fact, client, post, consent,
schedule, or publication data was created to force the proof.

Credential-free evidence:

- `D:\GitHubBackup\SocialAi\release-evidence\staging-pilot-context-readiness-proof-2026-07-17T15-33-00-000Z.json`
- SHA-256:
  `B59BDDF0BBABC0282F59C36D444D88E2C1A8F49A54B3E111B0323DE9D424EAFB`

### Production Boundary And Next Gate

Production was not migrated, deployed, or mutated. It remains on Worker
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5`; its `ai_usage` table still has no v45
column, and `hughesq-001` remains exactly `status='on_hold'`.

This closes the operator-visibility and premature-enrollment defect. It does
not create genuine context, customer consent, a paid pilot evaluation, or
attributable cost evidence. The next gate remains an explicit, authorized
owner-self staging business profile or a separately attested client profile;
neither will be fabricated or copied implicitly.

## 2026-07-17 Authorized Owner Context And Natural Record-Only Pilot

### Authorization And Data Minimization

Steve explicitly authorized copying Penny Wise I.T's non-secret business
profile into staging for record-only testing. The production profile was read
only. Its raw values were never printed, written to an evidence artifact, or
committed.

A strict allowlist retained only five canonical business-context strings:
`description`, `productsServices`, `targetAudience`, `uniqueValue`, and
`contentTopics`. Ten other fields were excluded, including Facebook
configuration, name, location, logo, tone, social preferences, disclosure
preferences, video preferences, and forbidden-subject configuration. The
selected fields were capped at 1,000 characters, stripped of control
characters, and rejected if they resembled an email address, URL, phone
number, API key, credential, secret, or long token. No sensitive pattern was
detected.

The source profile was 1,025 bytes with SHA-256
`23e15c627b6bc7742ee7dfb776f7641f692d94af506b945644453bfeb1db5275`.
The minimized payload was 700 bytes with SHA-256
`dc0f6a2aa1444cad0e19b78dc6843ab3caf4b2cd56c809ca21954187457a6159`.
At `2026-07-17T22:37:12.715Z`, one exact staging owner row changed from the
empty-object hash
`44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`
to the minimized hash. The write required the existing profile to be exactly
`{}` and independently verified one target row, the exact post-write hash,
and the exact five-key set. Temporary SQL was removed. Production changed
zero rows.

### Natural Runtime And Cost Attribution

No evaluator endpoint was called. Cloudflare naturally invoked the isolated
staging `learning_pilot` cron after the authorized profile became ready. Cron
receipt `6855` completed at `2026-07-17 22:46:05` UTC in 8,724 ms with one
candidate considered, one post processed, one evaluation, and zero reused
receipts, competing claims, budget skips, context skips, invalid rows, or
errors.

Decision `12b1aec0-5556-4d46-9a98-af78262f8a37` belongs to the exact owner
workspace and QA Draft
`bf848b80-b88d-4ff4-88b8-6ab0992e535f`. It persisted
`persistenceState='complete'`, `release_state='hold_amber'`, and exact 9/9
summary-to-row verdict parity. It ran one attempt, made no repair, changed no
candidate content, and requested no media.

The decision persisted all required deterministic critic slots plus the
independent Anthropic text council and business-harm critic. The deterministic
fact critic returned a release-critical repairable warning. The independent
business-harm critic returned `unavailable`, so the Release Judge correctly
recorded `judgeStatus='not_run'` and the post stayed amber. This is the intended
fail-closed behavior: provider output that cannot satisfy the critic contract
does not become unattended approval.

Exactly two AI usage rows were attached to the decision and the exact
owner/post tuple:

- `learning_text_council`: 1,000 input tokens, 388 output tokens,
  estimated `$0.002940`;
- `learning_harm_critic`: 656 input tokens, 129 output tokens,
  estimated `$0.001301`.

Total estimated spend was `$0.004241`. There were zero unattributed rows, zero
null or negative cost estimates, and zero failed usage receipts. The source
post's full safety fingerprint remained
`c302cd467bc4d03a9a17c033c8a90fbfc787423e9cc60a237ec5613ba5786ff9`
before and after evaluation. It remained an unscheduled, media-free Draft with
zero publication events and zero adjudications.

### Synthetic Exclusion And Production Boundary

The post is an explicit staging QA fixture, not a real customer sample.
Readiness snapshot `3e857397-da53-4b02-a3ed-fce67a32ff1c` therefore remained
red even before exclusion: receipt coverage and cost attribution were
complete, but required critic availability was 8/9. An immutable staging-only
`synthetic_qa` exclusion
`106bf41e-47c3-45ec-9b0f-0cb59eb45c58` was appended only after the exact
current-policy enrollment, consent, workspace, Draft, schedule, publication,
and adjudication preconditions passed. It did not mutate the post or decision.

The next natural scheduler cycle persisted the exclusion outcome. Pilot cron
receipt `6874` succeeded at `2026-07-17 23:00:57` UTC with zero candidates,
zero evaluations, and zero errors. Readiness snapshot
`77bd0bb8-2157-44cb-a973-464f11927c12` followed at
`2026-07-17T23:00:57.208Z`, remained red, and reported zero eligible pilot
decisions, workspaces, user decisions, or client decisions. The two attributed
cost rows remain available for audit but cannot count toward readiness.

Credential-free evidence:

- `D:\GitHubBackup\SocialAi\release-evidence\staging-authorized-profile-natural-pilot-proof-2026-07-17T23-02-01-116Z.json`
- SHA-256:
  `57B8F5FAEB35BBE82A958A8FCD6FFF46997B8C4258CEA4D42401379F8EFB6883`

The complete Worker suite passed 95 files and 1,205 tests, strict Worker
TypeScript passed, the frontend suite passed 17 files and 200 tests, frontend
TypeScript passed, and the production frontend build passed. Staging remained
on Worker `281399b5-16ca-428e-8c84-392fc6814f02` with release enforcement,
Protected Autopilot, and organic-reach application disabled.

Production was not migrated, deployed, or written. It remains on Worker
`26c19f95-7bb2-40b2-ae72-12c2a6e330e5`, and `hughesq-001` remains exactly
`status='on_hold'`.

## 2026-07-18 Pilot Continuation And Critic Adapter Hardening

### Staging Status

The canonical branch `codex/learning-pilot-progress` resumed from commit
`0f0c483b20c4359e2a13546481bb4f99f120cdd0` with a clean worktree and PR
`#209` still open, draft, merge-clean, and green.

Read-only staging D1 checks found one record-only owner enrollment for
`user_3B9YKodZsIQjLdGW8wtwd7mmBMQ`, with `mode='approval'`,
`consent_basis='owner_self'`, and `monthly_ai_budget_usd_cents=500`.
The latest readiness snapshots remain safely red with zero eligible pilot
decisions, zero pilot workspaces, and `costWithinBudget=false` because there
are no eligible decisions in the active window.

The six staging Draft posts have all been evaluated once. Four produced
`hold_amber` and two produced `block_red`; all six decisions have complete
verdict-row parity and are explicitly disqualified as `synthetic_qa`, so they
correctly do not count toward release readiness. The final natural cron
decision remains the only metered pilot decision, with two attributed AI usage
rows totaling `$0.004241`.

This confirms the current blocker is not a missing cron run or accidental
production drift. The rollout gate still requires genuine, consented,
non-synthetic customer pilot posts with adjudicated outcomes; synthetic QA
receipts remain audit-only.

### Critic Adapter Hardening

The independent critic adapter was tightened to reduce unnecessary
`unavailable` results from harmless provider wrapping around JSON. It now
accepts an exact JSON object, a complete Markdown JSON fence, or a single
balanced JSON object after a harmless JSON/result preamble. Ambiguous prose
around JSON remains invalid and continues to fail closed through the strict
critic parser.

Focused verification passed `src/__tests__/learning-text-critics.test.ts`
with 29 tests. The full Worker suite passed 95 test files and 1,207 tests,
and strict Worker TypeScript passed.
