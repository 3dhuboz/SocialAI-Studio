# SocialAI Studio — Shopify embedded app

Phase 1 skeleton. The shell loads inside Shopify Admin, calls `GET /api/shopify/me`
on the worker with a fresh App Bridge session token, and renders the shop record
we persisted during install.

## Stack

- React 19 + TypeScript + Vite
- `@shopify/polaris` for UI (mandatory — App Store reviewers reject non-Polaris embedded apps)
- `@shopify/app-bridge-react` for the embedded-app runtime
- Hosted on Cloudflare Pages (separate project from the main `socialaistudio.au` deploy)

## Local dev

```bash
cd shopify-app
cp .env.example .env
# Fill in VITE_SHOPIFY_API_KEY from Partners dashboard
npm install
npm run dev
```

Open the Shopify CLI in another shell to tunnel HTTPS to `localhost:5180`:

```bash
shopify app dev --client-id=<your-client-id>
```

The CLI's tunnel URL goes into `application_url` in `/shopify.app.toml` and the
worker's `SHOPIFY_APP_URL` secret during development.

## Build & deploy

The build **requires** `VITE_SHOPIFY_API_KEY` at build time. The Vite config
fails fast if it's unset — a missing key would otherwise ship the literal
`%VITE_SHOPIFY_API_KEY%` placeholder into `dist/index.html`, App Bridge
can't initialise, and every merchant hangs on "Connecting to your shop…"
forever (the 2026-05-21 outage). Pass it inline or via `.env.local`:

```bash
# Inline (recommended for one-off / CI deploys):
VITE_SHOPIFY_API_KEY=<client-id-from-shopify.app.toml> npm run build

# Or copy .env.example → .env.local, fill the value, then:
npm run build           # outputs dist/
```

A post-build script (`scripts/verify-build.mjs`) double-checks the
generated `dist/index.html` for any unresolved `%VITE_*%` placeholders
and fails the build if it finds any — belt-and-braces against silently
shipping a misconfigured bundle.

Deploy `dist/` to a new Cloudflare Pages project (e.g. `socialai-shopify`) on
the custom domain that matches `application_url` in `/shopify.app.toml`. The
recommended subdomain is `shopify.socialaistudio.au`.

## Architecture

```
Merchant admin (Shopify iframe)
        │
        │  Loads index.html with <meta name="shopify-api-key">
        │  App Bridge CDN script attaches window.shopify
        │
        ▼
This React app
        │
        │  apiFetch('/api/shopify/me')
        │   → fetches window.shopify.idToken() (JWT, HS256, 1-min TTL)
        │   → Authorization: Bearer <token>
        │
        ▼
socialai-api worker (workers/api)
        │
        │  routes/shopify-oauth.ts → verifySessionToken()
        │   → JWT verified, shop domain extracted from dest claim
        │   → returns shopify_stores row
        │
        ▼
Cloudflare D1 (socialai-db, shopify_stores table)
```

## What's NOT here yet (Phase 2+)

- Product sync from Shopify Admin API
- AI post generator UI (will reuse worker `lib/image-gen.ts`)
- Facebook/Instagram connect flow
- Calendar / scheduling view
- Billing (Shopify Billing API)
- Webhook handlers for `products/*` to keep the cache fresh
