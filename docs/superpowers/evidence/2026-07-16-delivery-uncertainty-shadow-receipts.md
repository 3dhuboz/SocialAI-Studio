# Delivery Uncertainty Shadow Receipts

Date: 2026-07-16 (Australia/Brisbane)

## Scope

This release adds dormant, tenant-scoped evidence around centralized provider
delivery attempts. It records attempt start, provider acceptance, definite
rejection, and ambiguous outcomes such as timeouts. It does not change provider
requests, responses, thrown errors, retries, post status, release decisions, or
publishing eligibility.

All instrumentation is best-effort and every row is constrained to
`shadow_only=1`. Hugheseys Que remains on hold. Release enforcement, organic
reach application, and Protected Autopilot remain disabled.

## Source And Review

- Implementation PR: `#198`.
- Tested branch commit: `7e329c028444ed4a173f56e05519210368e73b9a`.
- Merged `main` commit: `380711fc67e59efcfc38e9f93cf85818fdb34ced`.
- GitHub `typecheck-and-build` passed before merge.
- The tested Worker/schema paths and merged paths had no diff.

## Verification Before Production

- Focused repository and publish-egress suites: 42 tests passed.
- Full Worker suite: 89 test files and 1,136 tests passed.
- Worker TypeScript check: `tsc --noEmit` passed.
- Wrangler deploy dry-run passed with the production bindings.
- Isolated D1 proof stored two distinct events for one attempt and ignored only
  the duplicate attempt/event pair.
- The isolated schema rejected an invalid tenant tuple, rejected receipt
  updates through the append-only trigger, and cascaded parent post deletion to
  zero receipt rows.

## Production Migration

The pre-migration D1 Time Travel bookmark was:

`000050f9-00000000-000050aa-2b53448431a171de984b71e9dcdec7fb`

The pre-migration baseline reported no receipt table, zero Protected Autopilot
workspaces, zero stored autopublish consents, latest readiness `ready=0`,
Hugheseys Que `status='on_hold'`, and 84 posts (45 Posted and 26 Draft).

Schema v42 completed successfully at bookmark:

`000050f9-00000006-000050aa-db6f761fead2471e68786ce2b4f09779`

Read-only verification found the `publish_delivery_receipts` table, three
intended indexes, and the immutable-update trigger. The table contained zero
rows before Worker deployment. Every verification query reported
`changed_db=false` and `rows_written=0`.

## Production Deployment

Worker version `646e2e3f-e803-4f79-b95c-7987567d612f` was deployed and receives
100 percent traffic. Deploy output confirmed:

- `LEARNING_RELEASE_ENFORCEMENT=false`
- `LEARNING_AUTOPILOT_ENABLED=false`
- `ORGANIC_REACH_APPLY_ENABLED=false`

Direct Worker health, same-domain SocialAI health, and Hugheseys Que API health
all returned JSON 200.

All five Pages production deployments completed from merged commit `380711f`:

- SocialAI Studio: `24c07149-f6e7-49df-9a39-987b934bc217`.
- Hugheseys Que: `b7957b9d-3073-471c-b480-e55e86e6752f`.
- Pickle Nick: `ff0411d2-40fe-419e-bc7c-fe2c7e6d2170`.
- Reloaded: `6c02c546-8563-4c1b-a6ec-b593980d98d3`.
- Street Meats: `a84e0ef6-4038-442a-8181-73695d3ceff7`.

Each corresponding custom domain returned 200.

## Post-Deploy Safety State

The read-only D1 recount matched the baseline exactly: zero receipt rows, zero
Protected Autopilot workspaces, zero stored autopublish consents, latest
readiness `ready=0`, Hugheseys Que still `status='on_hold'`, and 84 posts (45
Posted and 26 Draft). There were no scheduled or overdue posts at verification
time.

No synthetic post, consent, learning setting, customer status, or publication
was created. The receipt writer is live and dormant; its first production row
must be verified against the next natural publish. Until then, this release
proves schema, routing, non-interference, and deployment readiness, not a
fabricated live provider transaction.
