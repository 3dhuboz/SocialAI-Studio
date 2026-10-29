# Hugheseys managed social automation

## Objective

Give Steve and Macca a safe way to run Hugheseys social media through the existing SocialAI Studio. Generated content must remain reviewable until somebody explicitly approves it for publishing.

## Real production baseline

- Production client: `hughesq-001` (`Hugheseys Que`).
- Production client status: `on_hold`; the publisher must continue to skip it.
- Current production post counts: 16 Draft, 2 Scheduled, 7 Posted.
- Both Scheduled records are unsafe to release: one is overdue and one has no schedule date.
- Facebook has an active Postproxy placement. The legacy Meta token shown by the portal is expired.
- Instagram has no active Postproxy placement and requires a user reconnect before Instagram publishing can be relied on.
- The publish worker runs every five minutes and considers `Scheduled` to be publish permission.

## User-visible acceptance checks

1. Opening the Hugheseys home dashboard shows **Automation paused** while the client row is `on_hold`.
2. The panel shows the Draft, Scheduled, and Posted counts returned by the server.
3. Generating and accepting a Smart Schedule batch saves every generated post as `Draft`. It does not require a Facebook connection and does not make any post eligible for the five minute publisher.
4. A paused workspace with an overdue or undated Scheduled post cannot be resumed. The API returns HTTP 409 with code `STALE_SCHEDULED_POSTS`, and the dashboard explains the blocker.
5. The operator can explicitly move only overdue or undated Scheduled records back to Draft. This clears their schedule and publish claim fields; it does not change Posted, future Scheduled, or existing Draft records.
6. Once no stale Scheduled records remain, an explicit confirmed action can resume the workspace. The client status becomes `active`.
7. An active workspace can be paused immediately. The client status becomes `on_hold`.
8. Hugheseys remains `on_hold` throughout implementation, testing, and deployment preparation. No existing post is published or changed in production.
9. A portal token can read or change automation only for the `client_id` stored on its own portal record.

## Invariants

- `Draft` means content exists for review and cannot be claimed by the publisher.
- `Scheduled` means an operator has approved the post for publishing at its stored time.
- The automation endpoint must check both client ownership and post ownership.
- Portal authentication must also match the requested client workspace; sharing one agency owner id is not sufficient.
- Resume fails closed if the client does not exist, if stale queue state cannot be read, or if a stale/undated Scheduled record exists.
- Queue cleanup is accepted only while the workspace is paused.
- Stale comparisons use the same naive AEST wall-clock format as the publisher.
- The existing cron `ACTIVE_CLIENT_FILTER` remains the final publisher-side pause gate.

## Verification

- Focused worker tests cover counts, pause, blocked resume, safe queue reset, and successful resume.
- Focused frontend tests cover the dashboard states and review-first Smart Schedule status.
- Full test suite and production build pass via HeadSnap.
- A browser run against a staging copy confirms the visible paused state and the blocked resume flow without touching production data.
