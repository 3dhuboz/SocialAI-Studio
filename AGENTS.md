# SocialAI Studio — Developer Map

Quick reference for navigating the codebase. Read this before touching anything.

---

## Codex save rule

When finishing a substantive work session, run `npm run codex:save` before the final response unless Steve explicitly says not to commit, push, or back up. This commits the current Git changes, pushes the active branch to GitHub, and mirrors the project to `D:\GitHubBackup\SocialAi`.

`D:\GitHubBackup` is the shared removable-drive backup folder. Each direct child folder is a project; this repo's backup project folder is `SocialAi`.

If `D:\GitHubBackup` is unavailable, report that clearly and do not pretend the local backup succeeded.

---

## Architecture at a glance

```
GitHub repo
├── src/                  React frontend (Vite + Tailwind + Clerk)
├── functions/            Cloudflare Pages Functions (legacy proxies — mostly superseded)
├── workers/api/          Cloudflare Worker (Hono, the real API)
└── dist/                 Vite build output (CF Pages serves this)
```

**Three separate deployments:**
- **Frontend** → Cloudflare Pages (`socialaistudio.au`). Auto-deploys from `main` via GitHub integration. Manual: `npm run build` → Pages dashboard.
- **Worker** → Cloudflare Worker (`socialai-api`). Must be deployed manually. See [Deploying](#deploying) below.
- **Shopify embedded app** → Cloudflare Pages from `shopify-app/`. Build requires `VITE_SHOPIFY_API_KEY` (same value as `shopify.app.toml` `client_id`).

**Auth:** Clerk. Every worker route calls `getAuthUserId(req, CLERK_SECRET_KEY, CLERK_JWT_KEY, DB)` from `src/auth.ts`. Returns `uid` or `null` (→ 401).

**Database:** Cloudflare D1 (`socialai-db`). Accessed via `c.env.DB` in the worker. Schema lives in `workers/api/schema_v*.sql`.

---

## Frontend (`src/`)

### Entry points
| File | Purpose |
|------|---------|
| `src/main.tsx` | React root, Clerk provider |
| `src/App.tsx` | Tab router, top-level state, all major feature flows |
| `src/index.css` | Tailwind base + global styles |
| `src/client.config.ts` | Default brand config (logo, colors, name) |
| `src/types.ts` | Shared TypeScript types |

### Components (`src/components/`)
| Component | What it does |
|-----------|-------------|
| `HomeDashboard.tsx` | Main dashboard — stats, quick actions |
| `WhatsWorkingPanel.tsx` | Customer learning summary — measured signals, predicted audiences, geography, and evidence confidence |
| `ProtectedAutopilotPanel.tsx` | One-time consent control — readiness gates, spend ceiling, blockers, and effective learning mode |
| `CalendarGrid.tsx` | Post calendar — view, create, edit scheduled posts |
| `PostModal.tsx` | Post editor — content, image gen, critique, score, and collapsed read-only learning safety report |
| `AdminDashboard.tsx` | Owner admin — all clients, posts, quality scan |
| `AdminQualityScan.tsx` | Bulk image/post quality review |
| `AdminCustomers.tsx` | Customer management |
| `OnboardingWizard.tsx` | New user setup flow |
| `LandingPage.tsx` | Public marketing page |
| `PricingTable.tsx` | Plans + Stripe/PayPal checkout |
| `TrialPaywall.tsx` | Trial gate |
| `BrandKitEditor.tsx` | Brand colors/fonts/logo config |
| `ClientSwitcher.tsx` | Agency multi-client switcher |
| `ClientIntakeForm.tsx` | New client onboarding form |
| `FacebookConnectButton.tsx` | FB OAuth connect + page selection |
| `DashboardStats.tsx` | Followers/engagement stat cards |
| `SetupBanner.tsx` | Setup checklist progress |
| `AnimatedReelPreview.tsx` | Reel video preview card |
| `ReelStudio.tsx` | Owner Reel desk - durable phone-video upload, verified workspace context, editable AI captions, and draft/schedule/publish controls |
| `LiveGallery.tsx` | Published post gallery |
| `LivePostPreview.tsx` | Real-time post preview (FB/IG format) |
| `PostShowcase.tsx` | Featured post display |
| `PosterManager.tsx` (`src/pages/`) | AI poster/graphic builder |
| `AiEnginePanel.tsx` | AI settings panel |
| `ReachProfilePanel.tsx` | One-time organic reach geography/profile confirmation and protected audience review |
| `OrganicReachCard.tsx` (`shopify-app/src/components/`) | Signed-session Shopify mirror of the one-time organic reach setup |
| `AccountPanel.tsx` | Account/billing settings |
| `AuthScreen.tsx` | Login/signup screen |
| `CinematicTour.tsx` | Feature tour overlay |
| `HowItActuallyWorks.tsx` | Feature explanation section |
| `DateTimePicker.tsx` | Schedule date/time picker |
| `CreditPackModal.tsx` | fal.ai credit top-up modal |
| `InstallPrompt.tsx` | PWA install prompt |
| `Toast.tsx` | Notification toasts |
| `AppLogo.tsx` | Logo component |
| `TestReelPublishButton.tsx` | Dev tool — test reel publishing |

### Services (`src/services/`)
| File | Purpose |
|------|---------|
| `db.ts` | All D1 queries called from the frontend (via worker API) |
| `gemini.ts` | AI generation — smart posts, image prompts, schedules, batch scheduler |
| `facebookService.ts` | FB Graph API — token exchange, page info, token refresh |
| `facebookPublishService.ts` | FB/IG publishing — posts, reels, stories |
| `falService.ts` | fal.ai client — image/video generation via `/api/fal-proxy` |
| `posterAi.ts` | Poster AI generation (fal.ai Ideogram) |
| `posters.ts` | Poster CRUD — save/load/delete via worker |
| `videoAudioService.ts` | Video + audio processing for reels |
| `reelMedia.ts` | Authenticated owner-video validation and progress-aware upload to the Worker R2 route |

### Data & utils
| File | Purpose |
|------|---------|
| `src/data/archetypes.ts` | 13 business archetypes — prompts, image examples, guardrails |
| `src/data/socialMediaResearch.ts` | Platform best-practice data (character limits, timing, etc.) |
| `src/contexts/AuthContext.tsx` | Clerk auth context |
| `src/contexts/BrandKitContext.tsx` | Brand kit global state |
| `src/contexts/PortalAuthContext.tsx` | White-label portal auth |
| `src/hooks/useDb.ts` | DB hook wrapper |
| `src/utils/posterBrandKit.ts` | Brand kit → poster style mapping |
| `src/utils/posterComposer.ts` | Poster layout composer |

### White-label client configs (`src/client.configs/`)
Each file exports a brand config (name, logo, colors, domain). The active config is selected at build time via `VITE_CLIENT_ID` env var — see `vite.config.ts`.
```
blackcat.ts / gladstonebbq.ts / hughesq.ts / jenniannesjewels.ts
jonesysgarage.ts / picklenick.ts / reloaded.ts / streetmeats.ts
```

---

## Worker (`workers/api/src/`)

### Entry + config
| File | Purpose |
|------|---------|
| `index.ts` | Hono app setup, CORS config, route registration, cron dispatch |
| `env.ts` | `Env` type — all bindings (DB, R2, secrets) |
| `auth.ts` | `getAuthUserId`, `isRateLimited` |

### Routes (`src/routes/`) — one file per concern
| File | Endpoints |
|------|-----------|
| `health.ts` | `GET /api/health` |
| `user.ts` | User profile CRUD |
| `posts.ts` | Post CRUD + scheduling |
| `clients.ts` | Agency client management |
| `ai.ts` | AI generation endpoints |
| `post-quality.ts` | `POST /api/critique-image-caption`, `POST /api/score-post` |
| `proxies.ts` | `POST /api/fal-proxy` (image/video gen), `/api/runway-proxy/*` |
| `facebook.ts` | FB token exchange, page list, token refresh |
| `social-tokens.ts` | Social token storage/retrieval |
| `facts.ts` | `client_facts` CRUD (engagement history) |
| `archetypes.ts` | Business archetype classifier |
| `campaigns.ts` | Campaign CRUD |
| `integrations.ts` | Richo Road and My Assistant server-to-server ingest routes |
| `portal.ts` | White-label portal routes |
| `activations.ts` | Account activation |
| `billing.ts` | Subscription billing |
| `paypal.ts` | PayPal webhook + verification |
| `pennybuilder.ts` | PennyBuilder provisioning integration |
| `posters.ts` | Poster save/load/delete + R2 image stream |
| `onboarding.ts` | Onboarding flow endpoints |
| `admin-stats.ts` | Admin analytics |
| `admin-actions.ts` | Admin: regen images, critique backlog, backfill |
| `recommendations.ts` | `POST /api/recommendations/auto-fix-checklist` — classify checklist items + run safe auto-fixes (FB audit, schedule shift, description rewrite) |
| `routes/learning.ts` | Authenticated decision receipts, settings/readiness controls, consent-attested record-only pilot enrollment/validation, admin adjudication/evidence/backfill, anonymous links, and tenant-scoped owner outcome feedback |
| `tracking.ts` | Public HTTPS-only short-link redirects with aggregate, bot-filtered click counts and no personal tracking |
| `reach.ts` | Clerk/portal-authenticated reach profile, audience confirmation, and read-only plan APIs |
| `shopify-reach.ts` | Signed Shopify-session mirror of reach profile, audience, and plan APIs |
| `shopify-learning.ts` | Signed Shopify-session settings/readiness controls and owner conversion feedback with server-derived shop identity |
| `reel-media.ts` | `POST /api/reel-media/uploads` - authenticated, workspace-scoped MP4/MOV/WebM upload to durable Reel R2 storage |

### Lib (`src/lib/`) — shared business logic
| File | Purpose |
|------|---------|
| `image-gen.ts` | `generateImageWithGuardrails` — single chokepoint for all image generation. Applies archetype guardrails, uses Nano Banana Pro for refined BBQ-cut prompts, then falls back to FLUX-dev. Returns `{ imageUrl, modelUsed, archetypeSlug }` |
| `image-safety.ts` | `buildSafeImagePrompt`, `isAbstractUIPrompt`, `sniffArchetypeFromCaption`, `applyArchetypeGuardrails`, `FLUX_NEGATIVE_PROMPT`, `FLUX_STYLE_SUFFIX` |
| `critique.ts` | `critiqueImageInternal`, `buildCritiqueSystemPrompt` — vision critique (Haiku 4.5) |
| `profile-guards.ts` | `loadForbiddenSubjects` (unions users.profile + clients.profile), `scanForForbidden`, `parseForbiddenSubjects` |
| `backfill.ts` | `backfillImagesForUser`, `runBacklogCritique`, `runBacklogRegen` |
| `anthropic.ts` | `callAnthropicDirect`, `callOpenRouter` — LLM routing with cache |
| `archetypes.ts` | `resolveArchetypeSlug`, `classifyBusiness` |
| `facebook-facts.ts` | FB Graph API scraping → `client_facts` |
| `campaign-research.ts` | Campaign AI research |
| `email.ts` | Resend email helpers |
| `post-critique.ts` | Shared critique context + stale-score invalidation rules |
| `learning/read-model.ts` | Tenant-scoped customer learning profile, signal, and outcome read model |
| `pricing.ts` | Plan/tier logic |
| `provisioning.ts` | White-label workspace provisioning and insert-only canonical learning settings defaults |
| `prompt-safety.ts` | Prompt injection detection |
| `web-fetch.ts` | Fetch wrapper with retries |
| `paypal.ts` | PayPal API helpers |
| `lib/learning/` | Tenant-scoped critic council, bounded repair, Release Judge, decision receipts, immutable outcomes, bounded strategy learning, and safe experiment policy |
| `lib/learning/archetype-aggregates.ts` | Privacy-gated coarse fleet learning with 10-workspace/100-post thresholds and atomic per-archetype rebuilds |
| `lib/learning/readiness.ts` | Protected Autopilot readiness thresholds, durable evidence evaluation, prediction quality, and strict tenant-scoped metric collection |
| `lib/publishing/publish-orchestrator.ts` | Single Postproxy/Meta publish egress after canonical ownership validation and release preflight |
| `lib/reach/` | Confirmed geography, protected audience prediction, timing/hashtag models, media direction, immutable reach plans, HTTP mapping, and deletion helpers |
| `lib/reach/timing-evidence.ts` | Tenant-scoped Facebook/Shopify engagement facts to local-time ranked posting windows with bounded archetype fallbacks |

### Cron (`src/cron/`)
| File | Schedule | Purpose |
|------|----------|---------|
| `dispatcher.ts` | — | Routes `scheduled()` events to the right cron handler |
| `prewarm-images.ts` | `*/5 * * * *` | Generate + critique images for upcoming posts |
| `prewarm-videos.ts` | `*/5 * * * *` | Generate + cache reel videos to R2 |
| `cron/evaluate-learning-shadow.ts` | `*/5 * * * *` | Read-only shadow snapshots and reach-plan receipts for up to 8 upcoming posts |
| `cron/evaluate-learning-readiness.ts` | `*/15 * * * *` | Persist readiness receipts and alert on green-to-red safety regressions |
| `collect-learning-outcomes.ts` | `0 */6 * * *` | Reconcile confirmed publications and collect immutable 24/72/168-hour outcome windows |
| `learn-strategies.ts` | `0 21 * * SUN` | Build private confidence-weighted customer strategy profiles before weekly review |
| `publish-missed.ts` | `*/5 * * * *` | Publish overdue scheduled posts to FB/IG |
| `refresh-tokens.ts` | `0 3 * * *` | Refresh 60-day Facebook tokens |
| `refresh-facts.ts` | `0 4 * * *` | Scrape FB Pages → `client_facts` engagement history |
| `check-fal-credits.ts` | `0 */6 * * *` | Alert when fal.ai balance < $5 |
| `weekly-review.ts` | `0 21 * * SUN` | Autonomous weekly review (Mon 7am AEST) |
| `_shared.ts` | — | Shared cron utilities |

---

## Database

**Instance:** `socialai-db` (D1), id `6295841e-e5f7-4355-b0e0-c5f22e58d99d`

**Current source schema version:** v42

**Current production schema version:** v42.

Delivery uncertainty migration: `workers/api/schema_v42_delivery_uncertainty_receipts.sql`.
It adds tenant-scoped, append-only shadow evidence around provider delivery
attempts. It does not change retries, post status, release decisions, or
publishing behavior. The migration and Worker instrumentation are live; the
first production receipt must come from a natural publish rather than a
synthetic customer action.

Pilot cohort migration: `workers/api/schema_v41_learning_pilot_enrollments.sql`.
It adds append-only pilot enrollment receipts, preserves scoped privacy erasure,
and does not change posts or publishing behavior. The migration is live; the
Worker/UI code must still be deployed from the merge containing this migration
before using the pilot enrollment controls.

Metric-window hardening migration: `workers/api/schema_v40_learning_metric_snapshots.sql`.
The migration is live. Deploy Worker source from `main` at merge `2e5cb85` or
later before expecting the collector to consume snapshot/retry rows.

Release 1 migration: `workers/api/schema_v37_learning_foundation.sql`.

Release 3 migration: `workers/api/schema_v38_organic_reach.sql`.

Release 4 migration: `workers/api/schema_v39_learning_outcomes.sql`.

Release 4 metric-window hardening migration: `workers/api/schema_v40_learning_metric_snapshots.sql`.

Release 1 proof is recorded in `docs/superpowers/evidence/2026-07-14-release-1-shadow-foundation.md`.

Release 3 proof is recorded in `docs/superpowers/evidence/2026-07-14-release-3-organic-reach-shadow.md`.

Release 4 dormant rollout proof is recorded in `docs/superpowers/evidence/2026-07-14-release-4-learning-protected-autopilot.md`.

Delivery uncertainty rollout proof is recorded in `docs/superpowers/evidence/2026-07-16-delivery-uncertainty-shadow-receipts.md`.

### Migration process
```bash
cd workers/api
wrangler d1 execute socialai-db --remote --file=schema_vN.sql
```
New migrations go in `workers/api/schema_vN.sql`. Use `IF NOT EXISTS` guards where D1 supports them. Current D1/Wrangler v3 rejects `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; for column adds, verify with `PRAGMA table_info(table)` or use a one-time plain `ADD COLUMN` migration.

### Key tables
| Table | Purpose |
|-------|---------|
| `users` | Clerk users — profile, subscription, denylist (`profile` JSON) |
| `clients` | Agency-managed clients — profile JSON; `status='on_hold'` pauses cron work |
| `posts` | Scheduled/published posts — content, image_url, critique score |
| `social_tokens` | FB/IG OAuth tokens per user+client |
| `client_facts` | Current verified Facebook fact cache used by prompts and account analysis |
| `campaigns` | Marketing campaigns with date ranges |
| `posters` | AI poster metadata + R2 key |
| `activations` | Account activation codes |
| `portals` | White-label portal configs |
| `workspace_learning_settings` | Tenant mode, consent, policy, experiment, and AI-budget settings |
| `learning_decisions` | Immutable tenant-scoped evaluation and release receipts |
| `learning_critic_verdicts` | Per-critic evidence attached to decision receipts |
| `reach_profiles` | Versioned owner-confirmed geography, timezone, service area, platforms, and cadence |
| `audience_segments` | Private predicted/confirmed audience needs scoped to one reach profile and workspace |
| `approved_media_assets` | Tenant-scoped media with explicit usage-rights status and matching tags |
| `reach_plans` | Immutable shadow/selected platform, timing, hashtag, media, and experiment treatments |
| `publish_delivery_receipts` | Append-only, tenant-scoped shadow evidence for provider attempts and ambiguous delivery outcomes |
| `publication_events` | Confirmed publication receipts and due outcome-window checkpoints |
| `learning_outcomes` | Immutable 24/72/168-hour business and engagement outcome windows |
| `platform_metric_snapshots` | Append-only, tenant-scoped Facebook metric scrapes used at exact outcome windows |
| `learning_outcome_attempts` | Bounded 6h/12h/24h retry state before an unavailable outcome becomes final |
| `learning_signals` | Bounded tenant strategy associations learned from confirmed outcomes |
| `learning_profiles` | Versioned tenant learning-profile summaries |
| `learning_experiments` | Bounded tenant experiments and their measured result state |
| `archetype_aggregates` | Privacy-thresholded, coarse cross-workspace archetype aggregates |
| `tracking_links` | Tenant-scoped organic action and conversion tracking links |
| `conversion_feedback` | Owner-recorded calls, messages, leads, bookings, sales, and order value |
| `learning_adjudications` | Admin pilot labels for sampled immutable release decisions |
| `learning_pilot_enrollments` | Policy-versioned record-only pilot cohort and consent receipts; update-blocked but privacy-deletable |
| `learning_release_evidence` | Expiring, hashed replay, tenancy, kill-switch, staging, and publish proofs |
| `learning_release_readiness` | Durable release-gate snapshots evaluated by cron |

---

## Deploying

### Worker (manual — required after any `workers/api/src/` change)
```bash
cd workers/api
npx --yes wrangler@4.110.0 deploy --config wrangler.toml --env=""
```
> `--config` avoids the repo-root Pages detection bug, and `--env=""` explicitly targets the top-level production config. The pinned Wrangler 3.114.17 currently rejects the refreshed OAuth token with error 9109; Wrangler 4.110.0 authentication, dry-run bundling, and production deployment were verified on 2026-07-15.

### Frontend (auto via GitHub → Cloudflare Pages)
Push to `main` → Pages auto-deploys. Check status at Cloudflare Dashboard → Pages → `socialai-studio`.

Manual build:
```bash
npm run build    # outputs to dist/
```

### Secrets (worker)
```bash
wrangler secret put SECRET_NAME   # from workers/api/
```
Key secrets: `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, `FAL_API_KEY`, `FAL_ADMIN_API_KEY`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `RESEND_API_KEY`, `POSTPROXY_API_KEY`, `POSTPROXY_WEBHOOK_SECRET` or `POSTPROXY_WEBHOOK_QUERY_SECRET`, `SHOPIFY_API_SECRET`, `MASTER_ENCRYPTION_KEY`, `MONITOR_SECRET`, `SOCIALAI_STUDIO_API_KEY`, `MY_ASSISTANT_INGEST_API_KEY`. Use `FAL_ADMIN_API_KEY` only for fal account billing checks; generation continues to use the least-privilege `FAL_API_KEY`. My Assistant routing vars: `MY_ASSISTANT_AGENT_ACCOUNT_ID`, `MY_ASSISTANT_WORKSPACE_ID`. Image rollout control: set `IMAGE_GEN_PROVIDER=gpt-image-2` as a Worker secret to use GPT Image 2 medium; unset it or set `flux-dev` for immediate rollback. Optional future image-provider secrets: `HIGGSFIELD_API_KEY`, `HIGGSFIELD_API_SECRET`; do not use a desktop CLI/browser OAuth token in production.

Release 2 runs the Customer Learning Brain in shadow mode in production and staging with `LEARNING_BRAIN_ENABLED="true"`. Release enforcement remains disabled with `LEARNING_RELEASE_ENFORCEMENT="false"`. Shadow mode may record decision receipts and critic verdicts only. It cannot hold or change post content, media, schedules, status, or publishing behavior.

Release 3 enables organic reach planning in shadow with `ORGANIC_REACH_ENABLED="true"` and keeps application disabled with `ORGANIC_REACH_APPLY_ENABLED="false"` in production and staging. Recommendation timing changes additionally require an explicit `dryRun=false` request and a confirmed reach profile, so the disabled apply flag prevents schedule writes even when a caller requests application.

Release 4 controls are deployed but activation remains gated. Keep `LEARNING_RELEASE_ENFORCEMENT="false"`, `LEARNING_AUTOPILOT_ENABLED="false"`, and `ORGANIC_REACH_APPLY_ENABLED="false"` until the current-policy readiness snapshot passes every documented check with at least 30 real pilot decisions and 30 sampled adjudications. Never manufacture readiness rows or insert release evidence directly into D1; use the authenticated admin evidence route. On-hold clients, including Hugheseys Que, remain ineligible and must retain normal app access without learning release activation. Higgsfield remains a separate production gate and is not enabled by learning readiness.

---

## Testing

```bash
cd workers/api
npm test          # vitest — runs src/__tests__/**/*.test.ts
npm run typecheck # tsc --noEmit
```

Test files:
- `src/__tests__/image-safety.test.ts` — prompt safety, archetype guardrails (28 tests)
- `src/__tests__/critique.test.ts` — critique system prompt builder (11 tests)
- `src/__tests__/profile-guards.test.ts` — denylist loading + scanning (27 tests)

Frontend:
```bash
npm test   # from repo root
```

---

## Key patterns

### Adding a new worker endpoint
1. Create or find the right `routes/*.ts` file
2. Export a `registerXxxRoutes(app)` function
3. Import + call it in `src/index.ts`
4. Always: `getAuthUserId` → `isRateLimited` → handler

### Image generation (always use the chokepoint)
```ts
import { generateImageWithGuardrails } from '../lib/image-gen';
const result = await generateImageWithGuardrails(env, userId, clientId, prompt, { caption });
// result.archetypeSlug is returned — don't call resolveArchetypeSlug again
```

### Loading the owner denylist (all 7 pipeline paths must do this)
```ts
import { loadForbiddenSubjects } from '../lib/profile-guards';
const forbiddenSubjects = await loadForbiddenSubjects(env, userId, clientId);
// Pass to critiqueImageInternal + buildSafeImagePrompt
```

### LLM calls
```ts
import { callAnthropicDirect, callOpenRouter } from '../lib/anthropic';
// Prefer callAnthropicDirect when ANTHROPIC_API_KEY is set — 1h cache TTL
// Fall back to callOpenRouter when it's not
```

---

## Known quirks

- **Do not trust an `Idle` Git-triggered Pages row as a successful deploy** - `socialai-studio` rows for `b2eeecc`, `d769c55`, and `7640db9` remained `Idle` and their immutable hostnames returned 404 while the custom domain stayed on an older bundle. Verify the immutable deployment URL, the custom-domain asset path/hash, and same-domain `/api/health`. If the Git row remains `Idle`/404, build the exact merged tree and recover with `npx --yes wrangler@4.110.0 pages deploy dist --project-name socialai-studio --branch main --commit-hash <full-merge-sha> --commit-dirty=false`, then repeat all three checks.
- **Use the verified Wrangler v4 production command** — the repo-root `functions/` directory can trigger Pages detection without `--config`, while the pinned Wrangler 3.114.17 rejects the current OAuth token with error 9109. From `workers/api/`, use `npx --yes wrangler@4.110.0 deploy --config wrangler.toml --env=""`; run the same command with `--dry-run` first when validating a new deployment path.
- **Same-domain `/api/*` depends on the Pages catch-all proxy plus explicit invocation routes** — `functions/api/[[path]].js` forwards unmatched `/api/*` requests to `https://socialai-api.steve-700.workers.dev`, and `public/_routes.json` pins Pages Functions to `/api/*` + `/embed`. Without that pair, `public/_redirects` (`/* /index.html 200`) can swallow URLs like `/api/health` and serve the SPA HTML shell instead of JSON.
- **Seamus (Hugheseys Que) is on hold** — the canonical field is `clients.status = 'on_hold'`. It was verified after the Release 1 production rollout. Cron skips automatically; do not change it without checking with Steve.
- **Facebook `scheduled_publish_time` is banned** — creates uncancellable FB orphans. DB is the source of truth; the `publish-missed` cron publishes at the right time.
- **CORS list in `index.ts`** — when adding a new white-label domain, add it to the `allowed` array at the top of `index.ts`.
- **`tech-saas-agency` archetype** — image examples are bright daylight desk/notebook scenes. Never revert to dark UI/server rack shots.
- **`functions/` directory** — legacy CF Pages Functions, mostly superseded by the worker. `functions/api/late-proxy.js` is dead code (Late.dev removed Apr 2026).

---

## Keeping this file updated

A `PostToolUse` hook (`.Codex/settings.json`) fires after every `Write` call and reminds Codex to update this file when a new module lands in a tracked directory.

**Update AGENTS.md when:**
- A new component is added to `src/components/`
- A new service is added to `src/services/`
- A new worker route file is added to `workers/api/src/routes/`
- A new lib module is added to `workers/api/src/lib/`
- A new cron job is added to `workers/api/src/cron/`
- A new white-label client config is added to `src/client.configs/`
- A new D1 table is added (update the Key tables section)
- A new secret/env var is added to `env.ts`
- A deploy quirk or pattern is discovered

**Do not update for:** bug fixes, refactors, or edits to existing files where the file's purpose hasn't changed.
