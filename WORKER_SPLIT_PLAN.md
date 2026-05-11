# Worker Route-Module Split — Execution Plan

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
