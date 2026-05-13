# Worker Route-Module Split — Execution Plan

> **Status (2026-05-13): Phase B complete.** index.ts is 97 LOC. 21
> modules extracted across `lib/`, `cron/`, `routes/`. See "Done" section
> at the bottom for the commit list and the schema-migration gotcha
> caught on first deploy.

The audit identified `workers/api/src/index.ts` (4,167 LOC, 50+ endpoints,
9 crons, all in one file) as the highest-priority structural debt. This
doc lays out the extraction plan as a dedicated follow-up PR.

## Goal

Split the monolith into focused route modules + a thin entry point. No
behaviour changes; just file relocation.

## Target structure

```
workers/api/src/
├── index.ts                              # ~120 LOC — Hono app + cron router only
├── env.ts                                # Env type, AI/Vectorize/R2 bindings (~80 LOC)
├── auth.ts                               # getAuthUserId, requireAdmin, isRateLimited (~250 LOC)
├── lib/
│   ├── anthropic.ts                      # callAnthropicDirect, callOpenRouter (~120 LOC)
│   ├── image-safety.ts                   # buildSafeImagePrompt + isAbstractUIPrompt mirrors (~80 LOC)
│   ├── image-gen.ts                      # generateImageWithBrandRefs (~110 LOC)
│   └── facebook.ts                       # refreshFactsForUser + postReelToFacebookPage helpers (~250 LOC)
├── routes/
│   ├── ai.ts                             # /api/ai/generate (~250 LOC)
│   ├── posts.ts                          # /api/db/posts CRUD (~180 LOC)
│   ├── clients.ts                        # /api/db/clients + /api/clients/* (~200 LOC)
│   ├── billing.ts                        # /api/billing + PayPal webhooks (~280 LOC)
│   ├── admin.ts                          # /api/admin/* (10+ endpoints, ~500 LOC)
│   ├── facebook.ts                       # /api/db/facts + /api/db/refresh-facts (~220 LOC)
│   ├── fal.ts                            # /api/fal-proxy (~400 LOC)
│   ├── archetypes.ts                     # /api/business-archetype + /api/classify-business + /api/onboarding-magic (~350 LOC)
│   ├── critique.ts                       # /api/critique-image-caption + /api/score-post (~280 LOC)
│   └── portal.ts                         # /api/portal/* (~120 LOC)
└── cron/
    ├── publish.ts                        # cronPublishMissedPosts + zombie sweep (~280 LOC)
    ├── prewarm-images.ts                 # cronPrewarmImages (~80 LOC)
    ├── prewarm-videos.ts                 # cronPrewarmVideos (~140 LOC)
    ├── refresh-facts.ts                  # cronRefreshFacts (~80 LOC)
    ├── refresh-tokens.ts                 # cronRefreshTokens (~50 LOC)
    ├── weekly-review.ts                  # cronWeeklyReview (~150 LOC)
    └── check-fal-credits.ts              # cronCheckFalCredits (~60 LOC)
```

## Extraction order (lowest-risk first)

1. **lib/anthropic.ts** — pure functions, no dependencies. Easiest.
2. **lib/image-safety.ts** — same, pure helpers.
3. **auth.ts** — referenced by every route but the surface is stable.
4. **cron/* extractions** — each cron is a self-contained function.
5. **routes/critique.ts + routes/archetypes.ts** — newest, cleanest code.
6. **routes/admin.ts** — biggest individual route group, deserves its own move.
7. **routes/fal.ts** — pulls in image-gen helpers; needs careful import wiring.
8. **routes/billing.ts** — touches PayPal subscription state; test carefully.
9. **routes/ai.ts + routes/posts.ts + routes/clients.ts + routes/facebook.ts + routes/portal.ts** — bulk.
10. **Final index.ts trim** — keep only `const app = new Hono()`, route mounts, cron dispatcher, default export.

## Hono sub-app pattern (per route module)

```ts
// workers/api/src/routes/archetypes.ts
import { Hono } from 'hono';
import type { Env } from '../env';
import { getAuthUserId } from '../auth';
import { callAnthropicDirect, callOpenRouter } from '../lib/anthropic';

export const archetypesRoutes = new Hono<{ Bindings: Env }>();

archetypesRoutes.get('/business-archetype', async (c) => { /* ... */ });
archetypesRoutes.post('/classify-business', async (c) => { /* ... */ });
archetypesRoutes.post('/onboarding-magic', async (c) => { /* ... */ });
```

Then in `index.ts`:
```ts
import { archetypesRoutes } from './routes/archetypes';
app.route('/api', archetypesRoutes);
```

## Risk-mitigation rules

- Each commit extracts ONE module. Never batch.
- After each extraction: `tsc --noEmit` MUST pass + smoke test endpoints
  via curl against the deployed staging worker.
- Don't change behaviour during the extraction — that's a separate commit.
- Keep the original file as a temporary shim that re-exports moved
  symbols until the cutover commit deletes it.

## Estimated effort

- 7-10 commits, ~1-2 days of focused work
- All commits behind a feature branch — main stays buildable throughout

## Where the App.tsx split sits

Same approach, separate PR. Target:
```
src/
├── App.tsx                              # ~200 LOC — router + auth gate + top-level shell
├── contexts/
│   └── WorkspaceContext.tsx             # active client, profile, posts, social tokens
├── screens/
│   ├── HomeScreen.tsx
│   ├── CalendarScreen.tsx
│   ├── CreateScreen.tsx
│   ├── SmartScheduleScreen.tsx
│   ├── InsightsScreen.tsx
│   ├── CampaignsScreen.tsx
│   ├── SettingsScreen.tsx
│   ├── AdminScreen.tsx                  # current AdminCustomers + AdminQualityScan
│   └── ClientsScreen.tsx
└── hooks/
    ├── useArchetype.ts                  # the useEffect already in App.tsx
    ├── usePosts.ts
    └── useCampaigns.ts
```

108 useState calls → ~10-15 per screen container. 26 useEffect calls →
similarly distributed. The win: each cross-tab interaction stops
triggering a full re-render across all 5720 lines.

Same extraction-rules apply — one screen per commit, behaviour-preserving.

## Done — Phase B execution log (2026-05-11 → 2026-05-13)

Final structure (matches plan with minor renames — `routes/admin.ts` split into
`admin-stats.ts` (read) + `admin-actions.ts` (write); `critique.ts` →
`post-quality.ts`; `lib/facebook.ts` → `lib/facebook-facts.ts` paired with
`cron/refresh-facts.ts`):

```
workers/api/src/                          # 6,734 LOC total
├── index.ts                              # 97 LOC
├── env.ts                                # 80 LOC
├── auth.ts                               # 250 LOC
├── lib/                                  # 1,514 LOC across 10 files
│   ├── anthropic.ts, archetypes.ts, backfill.ts, critique.ts, email.ts,
│   │ facebook-facts.ts, image-gen.ts, image-safety.ts, paypal.ts,
│   │ pricing.ts, provisioning.ts
├── cron/                                 # ~1,000 LOC across 8 files
│   ├── _shared.ts, dispatcher.ts, check-fal-credits.ts, prewarm-images.ts,
│   │ prewarm-videos.ts, publish-missed.ts, refresh-facts.ts,
│   │ refresh-tokens.ts, weekly-review.ts
└── routes/                               # ~3,000 LOC across 19 files
    └── activations.ts, admin-actions.ts, admin-stats.ts, ai.ts,
      archetypes.ts, billing.ts, campaigns.ts, clients.ts, facebook.ts,
      facts.ts, health.ts, onboarding.ts, paypal.ts, portal.ts,
      post-quality.ts, posts.ts, proxies.ts, social-tokens.ts, user.ts
```

19 `registerXRoutes(app)` calls in index.ts mount 56 HTTP endpoints; the
`scheduled()` handoff dispatches to 7 distinct cron jobs.

### Schema migration gotcha (caught on first deploy)

The cron extraction in `a8eaaa3` started referencing `posts.claim_id`,
`posts.claim_at`, `posts.image_critique_score`, `users.archetype_slug`,
and `clients.archetype_slug` — columns that exist in `schema_v7.sql`,
`schema_v8.sql`, and `schema_v9.sql` but **had never been applied to
production D1**. Previous deploys silently shipped older index.ts code
that didn't hit these columns, so the missing schema was invisible.

The Phase-B-final deploy (`eb52860`) was the first deploy where the
new SQL actually executed against the live DB. The publish cron failed
4 ticks in a row (`D1_ERROR: no such column: claim_id`) before the
migrations were applied. Recovery:

1. `wrangler d1 execute socialai-db --remote --file=schema_v7.sql`
2. `wrangler d1 execute socialai-db --remote --file=schema_v8.sql`
3. `wrangler d1 execute socialai-db --remote --file=schema_v9.sql`
4. `wrangler d1 execute socialai-db --remote --file=seed_v7_archetypes.sql`
   (after `commit 484c979` stripped its `BEGIN TRANSACTION` which D1's
   remote executor rejects)

Lesson for future deploys: before deploying code that references a
new schema, verify the migration has actually been applied to remote
D1 — `wrangler d1 execute socialai-db --remote --command="PRAGMA
table_info(posts)"` will surface this in seconds.

### Commit log

- `aaeab9b` lib/facebook-facts + cron/refresh-facts
- `8373753` cron/weekly-review
- `a8eaaa3` publish + prewarm crons (Phase B steps 12-15)
- `eedd27d` routes/campaigns (first route module)
- `095211a` 6 low-risk route modules (health, user, social-tokens, portal,
  activations, facts)
- `238a017` fix(image-gen): NULL-archetype hole closed
- `1c22285` fix(critique): route vision call via Anthropic direct
- `ee217fc` routes: posts, clients, archetypes, facebook, ai
- `efa5f21` lib/paypal + routes/paypal
- `645b81c` routes/admin-stats + routes/billing + lib/pricing
- `33102d6` lib/backfill + lib/provisioning + lib/facebook-facts.refreshFactsForUser
- `558fa59` routes/admin-actions
- `eb52860` routes/onboarding + routes/post-quality + routes/proxies + cron/dispatcher
- `8f4537b` fix(cron): wrangler cron parser rejects `0` for SUN — use `SUN`
- `484c979` fix(seed): drop BEGIN TRANSACTION — D1 remote executor rejects it
