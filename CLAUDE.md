# SocialAI Studio — Developer Map

Quick reference for navigating the codebase. Read this before touching anything.

---

## Architecture at a glance

```
GitHub repo
├── src/                  React frontend (Vite + Tailwind + Clerk)
├── shopify-app/          Embedded Shopify app (Vite + React + Polaris + App Bridge) — Phase 1
├── functions/            Cloudflare Pages Functions (legacy proxies — mostly superseded)
├── workers/api/          Cloudflare Worker (Hono, the real API)
└── dist/                 Vite build output (CF Pages serves this)
```

**Two separate deployments:**
- **Frontend** → Cloudflare Pages (`socialaistudio.au`). Auto-deploys from `main` via GitHub integration. Manual: `npm run build` → Pages dashboard.
- **Worker** → Cloudflare Worker (`socialai-api`). Must be deployed manually. See [Deploying](#deploying) below.

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
| `CalendarGrid.tsx` | Post calendar — view, create, edit scheduled posts |
| `PostModal.tsx` | Post editor — content, image gen, critique, score |
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
| `LiveGallery.tsx` | Published post gallery |
| `LivePostPreview.tsx` | Real-time post preview (FB/IG format) |
| `PostShowcase.tsx` | Featured post display |
| `PosterManager.tsx` (`src/pages/`) | AI poster/graphic builder |
| `AiEnginePanel.tsx` | AI settings panel |
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
jonesysgarage.ts / picklenick.ts / streetmeats.ts
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
| `portal.ts` | White-label portal routes |
| `activations.ts` | Account activation |
| `billing.ts` | Subscription billing |
| `paypal.ts` | PayPal webhook + verification |
| `pennybuilder.ts` | PennyBuilder provisioning integration |
| `posters.ts` | Poster save/load/delete + R2 image stream |
| `onboarding.ts` | Onboarding flow endpoints |
| `admin-stats.ts` | Admin analytics |
| `admin-actions.ts` | Admin: regen images, critique backlog, backfill |
| `shopify-oauth.ts` | Shopify embedded-app: install/callback, GDPR + uninstall webhooks, `GET /api/shopify/me` |
| `admin-shopify.ts` | Owner admin endpoints for Shopify shops — list, force-reconcile, audit trail |
| `shopify-products.ts` | Embedded-app: `POST /api/shopify/products/sync` (Admin GraphQL pagination, 500-product cap), `GET /api/shopify/products` (cached LIMIT 250) |
| `shopify-compose.ts` | Embedded-app: `POST /api/shopify/compose` — Claude Haiku caption + brand-grounded image for a Shopify product |
| `shopify-posts.ts` | Embedded-app: shop-scoped post CRUD + publish-now (owner_kind='shop' rows). All endpoints session-token gated. |
| `shopify-social-connect.ts` | Embedded-app: FB/IG connect for Shopify merchants — exchange token, connect, disconnect, status. Writes shopify_stores.social_tokens. |
| `shopify-insights.ts` | Embedded-app: `GET /api/shopify/insights` — FB Page stats (followers, reach/interactions, engagement rate) + D1 post queue summary. Mirrors main-app's `getLivePageStats` logic in the worker. |
| `shopify-post-quality.ts` | Embedded-app: `POST /api/shopify/critique-image-caption` — vision critique (Haiku 4.5) for shop posts. Session-token gated; persists onto `posts` row when `postId` is provided and owner matches. |
| `shopify-posters.ts` | Embedded-app: shop-scoped poster gallery — `POST /api/shopify/posters` (generate via OpenRouter + save to R2), `GET /api/shopify/posters` (list), `GET /api/shopify/posters/:id/image` (stream), `DELETE /api/shopify/posters/:id`. Uses `shopify_posters` table (schema_v23). |
| `shopify-autopilot.ts` | Embedded-app: bulk-content-calendar generator. `POST /api/shopify/autopilot/generate-one` composes (caption+image via shared `composeProductPost`) and inserts a Scheduled post. Supports `postType: 'image' \| 'video'` — video posts seed the existing prewarm-videos cron via `video_status='pending'`. Includes active-campaign context lookup. |
| `shopify-campaigns.ts` | Embedded-app: shop-scoped marketing campaigns. CRUD via `/api/shopify/campaigns/*` plus `/active` convenience endpoint. `shopify_campaigns` table (schema_v24). Autopilot reads active campaign context into each compose call. |
| `shopify-facts.ts` | Embedded-app: FB Page facts status + manual refresh. `GET /api/shopify/facts/status` returns `{total, by_type, last_verified_at, page_connected}`. `POST /api/shopify/facts/refresh` triggers `refreshFactsForShop` synchronously (rate-limited 3/min). `shopify_facts` table (schema_v24). |

### Lib (`src/lib/`) — shared business logic
| File | Purpose |
|------|---------|
| `image-gen.ts` | `generateImageWithBrandRefs` — single chokepoint for all image generation. Picks flux-pro-kontext (brand refs) → flux-dev (fallback). Returns `{ imageUrl, modelUsed, referencesUsed, archetypeSlug }` |
| `image-safety.ts` | `buildSafeImagePrompt`, `isAbstractUIPrompt`, `sniffArchetypeFromCaption`, `applyArchetypeGuardrails`, `FLUX_NEGATIVE_PROMPT`, `FLUX_STYLE_SUFFIX` |
| `critique.ts` | `critiqueImageInternal`, `buildCritiqueSystemPrompt` — vision critique (Haiku 4.5) |
| `profile-guards.ts` | `loadForbiddenSubjects` (unions users.profile + clients.profile), `scanForForbidden`, `parseForbiddenSubjects` |
| `backfill.ts` | `backfillImagesForUser`, `runBacklogCritique`, `runBacklogRegen` |
| `anthropic.ts` | `callAnthropicDirect`, `callOpenRouter` — LLM routing with cache |
| `archetypes.ts` | `resolveArchetypeSlug`, `classifyBusiness` |
| `facebook-facts.ts` | FB Graph API scraping → `client_facts` |
| `campaign-research.ts` | Campaign AI research |
| `email.ts` | Resend email helpers |
| `pricing.ts` | Plan/tier logic |
| `provisioning.ts` | White-label workspace provisioning |
| `prompt-safety.ts` | Prompt injection detection |
| `web-fetch.ts` | Fetch wrapper with retries |
| `paypal.ts` | PayPal API helpers |
| `shopify-auth.ts` | Shopify HMAC verification (OAuth + webhooks), session-token JWT verification, shop-domain sanitizer |
| `shopify-billing.ts` | Shopify Billing API helpers — create/cancel app subscription, billing-status lookup, plan→price mapping |
| `shopify-token-exchange.ts` | Token Exchange flow — swap session token for offline access token (replaces OAuth code-grant for fresh installs) |
| `shopify-admin-api.ts` | `shopifyGraphQL<T>(shop, accessToken, query, variables)` — discriminated-union GraphQL helper, 15s timeout, distinct network/http/graphql failure stages |
| `shopify-tenancy.ts` | `ensureShopSentinelUser(env, shop)` — `INSERT OR IGNORE` a users row keyed by shop domain so the `posts.user_id → users(id)` FK is satisfied for shop-owned writes. Idempotent. Call before any shop-tenant INSERT into posts. |

### Cron (`src/cron/`)
| File | Schedule | Purpose |
|------|----------|---------|
| `dispatcher.ts` | — | Routes `scheduled()` events to the right cron handler |
| `prewarm-images.ts` | `*/5 * * * *` | Generate + critique images for upcoming posts |
| `prewarm-videos.ts` | `*/5 * * * *` | Generate + cache reel videos to R2 |
| `publish-missed.ts` | `*/5 * * * *` | Publish overdue scheduled posts to FB/IG (handles Clerk user/client AND Shopify shop posts via `owner_kind`) |
| `refresh-tokens.ts` | `0 3 * * *` | Refresh 60-day Facebook tokens |
| `refresh-facts.ts` | `0 4 * * *` | Scrape FB Pages → `client_facts` engagement history |
| `check-fal-credits.ts` | `0 */6 * * *` | Alert when fal.ai balance < $5 |
| `weekly-review.ts` | `0 21 * * SUN` | Autonomous weekly review (Mon 7am AEST) |
| `reconcile-subscriptions.ts` | `*/15 * * * *` | Reconcile Shopify app subscriptions — catch missed `app_subscriptions/update` webhooks, downgrade lapsed shops |
| `_shared.ts` | — | Shared cron utilities |

---

## Database

**Instance:** `socialai-db` (D1), id `6295841e-e5f7-4355-b0e0-c5f22e58d99d`

**Current schema version:** v24

### Migration process
```bash
cd workers/api
wrangler d1 execute socialai-db --remote --file=schema_vN.sql
```
New migrations go in `workers/api/schema_vN.sql`. Always use `IF NOT EXISTS` / `IF NOT EXISTS` guards and `ADD COLUMN IF NOT EXISTS` for safety.

### Key tables
| Table | Purpose |
|-------|---------|
| `users` | Clerk users — profile, subscription, denylist (`profile` JSON) |
| `clients` | Agency-managed clients — profile JSON, `on_hold` flag |
| `posts` | Scheduled/published posts — content, image_url, critique score |
| `social_tokens` | FB/IG OAuth tokens per user+client |
| `client_facts` | Engagement history scraped from FB — powers virality scorer |
| `campaigns` | Marketing campaigns with date ranges |
| `posters` | AI poster metadata + R2 key |
| `activations` | Account activation codes |
| `portals` | White-label portal configs |
| `shopify_stores` | Installed Shopify shops — offline access token, scopes, install/uninstall timestamps |
| `shopify_oauth_state` | Short-lived OAuth state nonces (10-min TTL, GC'd opportunistically) |
| `shopify_webhooks_log` | Inbound Shopify webhook audit trail (GDPR + app/uninstalled) |
| `shopify_products` | Cached product catalog per shop (populated in Phase 2) |
| `shopify_billing_events` | Audit log of every `app_subscriptions/update` transition + reconciliation cron decisions |
| `shopify_admin_audit` | Owner-side admin actions on Shopify shops (force-cancel, force-reconcile, manual plan override) |
| `shopify_posters` | Shop-scoped AI-poster gallery (schema_v23). R2 key prefix `shopify-posters/<id>.png`. |
| `shopify_campaigns` | Shop-scoped marketing campaigns (schema_v24). Active campaign feeds into autopilot compose context. |
| `shopify_facts` | Per-shop scrape of connected FB Page (about/posts/photos, schema_v24). Powers Autopilot "N facts ready" indicator. |

---

## Deploying

### Worker (manual — required after any `workers/api/src/` change)
```bash
cd workers/api
npx wrangler deploy --config wrangler.toml   # --config flag required — avoids Pages detection bug
```
> The global `wrangler` (v4) detects the repo root `functions/` dir and thinks it's a Pages project. Always use `npx wrangler` (v3) with `--config wrangler.toml`.

### Frontend (auto via GitHub → Cloudflare Pages)
Push to `main` → Pages auto-deploys. Check status at Cloudflare Dashboard → Pages → `socialaistudio-au`.

Manual build:
```bash
npm run build    # outputs to dist/
```

### Secrets (worker)
```bash
wrangler secret put SECRET_NAME   # from workers/api/
```
Key secrets: `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, `FAL_API_KEY`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `RESEND_API_KEY`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`

Shopify-specific vars (set in `wrangler.toml [vars]`, not secrets): `SHOPIFY_APP_URL`, `SHOPIFY_APP_SCOPES`. See `SHOPIFY_SETUP.md` for the full embedded-app setup flow.

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
import { generateImageWithBrandRefs } from '../lib/image-gen';
const result = await generateImageWithBrandRefs(env, userId, clientId, { prompt }, { caption });
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

- **`wrangler deploy` fails without `--config`** — the `functions/` dir at repo root makes wrangler think it's a Pages project. Always use `npx wrangler deploy --config wrangler.toml` from `workers/api/`.
- **Seamus (Hugheseys Que) is on hold** — `clients.on_hold = 1`. Cron skips automatically. Do not remove the flag without checking with Steve.
- **Facebook `scheduled_publish_time` is banned** — creates uncancellable FB orphans. DB is the source of truth; the `publish-missed` cron publishes at the right time.
- **CORS list in `index.ts`** — when adding a new white-label domain, add it to the `allowed` array at the top of `index.ts`.
- **`tech-saas-agency` archetype** — image examples are bright daylight desk/notebook scenes. Never revert to dark UI/server rack shots.
- **`functions/` directory** — legacy CF Pages Functions, mostly superseded by the worker. `functions/api/late-proxy.js` is dead code (Late.dev removed Apr 2026).

---

## Keeping this file updated

A `PostToolUse` hook (`.claude/settings.json`) fires after every `Write` call and reminds Claude to update this file when a new module lands in a tracked directory.

**Update CLAUDE.md when:**
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
