# Shopify Embedded App — Setup Guide (Phase 1)

The Shopify integration is a **separate deployment** from the main
`socialaistudio.au` app. Same worker (`socialai-api`) is reused for the API
surface; the embedded React app is its own static bundle on a new Pages
project.

Everything in this guide is one-time setup. Once it's done, the dev loop is
`shopify app dev` → make changes → push → automatic Pages deploy.

---

## 0. Quick map of what was scaffolded

| Path | Purpose |
|------|---------|
| `workers/api/schema_v17.sql` | New D1 tables (`shopify_stores`, `shopify_oauth_state`, `shopify_webhooks_log`, `shopify_products`) |
| `workers/api/src/env.ts` | Added `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SHOPIFY_APP_URL` / `SHOPIFY_APP_SCOPES` |
| `workers/api/src/lib/shopify-auth.ts` | HMAC verifier, session-token JWT verifier, shop-domain sanitizer |
| `workers/api/src/routes/shopify-oauth.ts` | `/auth`, `/auth/callback`, `/me`, 4 webhook handlers |
| `workers/api/src/index.ts` | Routes registered + Shopify origins added to CORS |
| `shopify-app/` | Embedded React app (Vite + Polaris + App Bridge) |
| `shopify.app.toml` | App manifest, read by `shopify app deploy` |

---

## 1. Shopify Partners account + app

1. Sign up at https://partners.shopify.com (free).
2. Partners dashboard → **Apps** → **Create app** → **Create app manually**.
   - Name: `SocialAI Studio` (or whatever the public name will be).
   - App URL: `https://app.socialaistudio.au` (Shopify rejects URLs
     containing "shopify" in the hostname, so the public origin can't
     reference the Pages project name `socialai-shopify`).
   - Allowed redirection URL: `https://socialai-api.steve-700.workers.dev/api/shopify/auth/callback`.
3. After creation, grab two values from **Configuration → API credentials**:
   - **Client ID** (also called API key) — public, goes in two places.
   - **Client secret** — secret, goes in one place.

## 2. Create a development store

Partners dashboard → **Stores** → **Add store** → **Development store**.

Pick "Create a store to test and build" + "Start with test data". This gives
you a fake shop with seed products to develop against — no Shopify plan
required.

## 3. Apply the schema migration

```bash
cd workers/api
npx wrangler d1 execute socialai-db --remote --file=schema_v17.sql
```

Verify the tables exist:

```bash
npx wrangler d1 execute socialai-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'shopify_%'"
```

You should see all four tables.

## 4. Set worker secrets

```bash
cd workers/api
npx wrangler secret put SHOPIFY_API_KEY        # paste the Client ID from step 1
npx wrangler secret put SHOPIFY_API_SECRET     # paste the Client secret
```

For the public-ish URL + scopes, edit `wrangler.toml` and add to the `[vars]`
block (these aren't secrets — they appear in URLs):

```toml
[vars]
SHOPIFY_APP_URL = "https://app.socialaistudio.au"
SHOPIFY_APP_SCOPES = "read_products"
```

Then deploy the worker:

```bash
npx wrangler deploy --config wrangler.toml
```

> ⚠️ The `--config wrangler.toml` flag is required — see `CLAUDE.md`
> "Known quirks" for why.

## 5. Update `shopify.app.toml`

In the repo root, edit `shopify.app.toml` and replace
`REPLACE_WITH_SHOPIFY_CLIENT_ID` with your Client ID.

If `application_url` differs from `https://app.socialaistudio.au` (e.g.
you're using a tunnel during dev), update it here too. The CLI syncs this
file with Partners on every `shopify app deploy`.

## 6. Install Shopify CLI

```bash
npm install -g @shopify/cli @shopify/app
shopify version   # confirm install
```

## 7. Build + deploy the embedded app

### Local dev (with tunnel)

```bash
cd shopify-app
cp .env.example .env
# Fill in VITE_SHOPIFY_API_KEY with the Client ID
npm install
shopify app dev --client-id=<CLIENT_ID>
```

The CLI will:
- start `vite dev` on port 5180
- open a tunnel (e.g. `https://abc-123.trycloudflare.com`)
- update the Partners app's `application_url` + redirect URL to point at the tunnel
- print an install link you can open in your dev store

For dev with the tunnel URL, also temporarily override
`SHOPIFY_APP_URL` in the worker (`wrangler secret put SHOPIFY_APP_URL`) so
the post-install redirect lands on the tunnel, not the prod Pages domain.

### Production deploy

1. Create a new Cloudflare Pages project:
   - Pages dashboard → **Create project** → **Direct upload** (or connect to repo)
   - Name: `socialai-shopify`
2. Build settings (if using repo integration):
   - Build command: `cd shopify-app && npm install && npm run build`
   - Output directory: `shopify-app/dist`
   - Environment variables:
     - `VITE_SHOPIFY_API_KEY` = (Client ID)
     - `VITE_API_BASE_URL` = `https://socialai-api.steve-700.workers.dev`
3. Add custom domain `app.socialaistudio.au` under **Custom domains**.
   (Shopify Partners rejects URLs containing "shopify" in the hostname.)
4. Once live, push the manifest to Shopify:
   ```bash
   shopify app deploy --client-id=<CLIENT_ID>
   ```
   This registers the webhook URIs + access scopes from `shopify.app.toml`
   with Partners.

## 8. Test the install loop (Token Exchange + Managed Install)

Fresh installs now use **Token Exchange** (no `/auth/callback` round-trip).
Shopify Managed Install handles the consent screen + scope grant; the
embedded app comes up cold with a session token and swaps it for an
offline access token server-side.

1. In Partners dashboard, open the app → **Test on development store** → choose your dev store.
2. Shopify performs Managed Install (consent screen + scope grant) entirely
   on Shopify's side and drops the merchant straight into the embedded app
   at `https://app.socialaistudio.au?shop=<dev-store>&host=<host>&embedded=1`.
3. The embedded React app boots, calls `shopify.idToken()` to grab a fresh
   session token, and POSTs it to `/api/shopify/token-exchange`. The worker
   verifies the JWT, exchanges it for an offline access token via Shopify's
   token-exchange endpoint, and upserts the `shopify_stores` row.
4. The app then calls `GET /api/shopify/me` with the session token as a
   bearer. The worker returns `{ shop, plan, billingStatus }`.
5. If `billingStatus !== 'ACTIVE'`, the app calls `POST /api/shopify/billing/subscribe`
   to create an `appSubscriptionCreate` mutation and redirects the merchant
   to Shopify's approval screen. On approval, Shopify fires
   `app_subscriptions/update` → the webhook flips the row to `ACTIVE`.
6. The embedded app re-fetches `/api/shopify/me`, sees `ACTIVE`, and
   renders the main UI.

If any step fails, `npx wrangler tail` from `workers/api/` will tell you
exactly which check rejected the request.

### Billing reconciliation cron

The `app_subscriptions/update` webhook is the source of truth for plan
state, but webhooks can be missed (network blips, queue retries, etc.).
A `*/15 * * * *` cron (`workers/api/src/cron/reconcile-subscriptions.ts`)
sweeps every `shopify_stores` row whose `billing_status` hasn't been
verified in the last 30 minutes:

1. For each row, GraphQL-fetch the current `appInstallation.activeSubscriptions`.
2. If state differs from the DB, update the row + write a
   `shopify_billing_events` audit row with `source = 'cron-reconcile'`.
3. If no active subscription exists and the shop was previously ACTIVE,
   downgrade to `LAPSED` and flip the embedded-app gate.

This means a stuck webhook only delays plan-state by at most 15 minutes,
not indefinitely.

## 9. Verify webhooks (required before App Store submission)

Shopify provides a webhook tester at Partners → your app → **API access** →
**Webhook test events**. Send a test `app/uninstalled` event to your
production webhook URL. The worker should:
- return `200` (no body required)
- log a row in `shopify_webhooks_log`
- set `shopify_stores.uninstalled_at` for the test shop

Repeat for `customers/data_request`, `customers/redact`, `shop/redact`. All
must return 200; the GDPR ones don't need to mutate state (we don't store
customer data in Phase 1) but the audit log row must appear.

---

## What's deliberately NOT in Phase 1

These all land in subsequent phases — listed here so you know what's
pending before App Store submission:

- **Product sync** — `shopify_products` table exists but isn't populated.
  Phase 2 adds a `/api/shopify/sync-products` route + `products/create`,
  `products/update`, `products/delete` webhooks.
- **App listing assets** — icon (1024×1024), 4–8 screenshots, demo video,
  long/short descriptions, support URL, privacy policy URL. Phase 4.
- **Privacy policy + data handling docs** — public URL. Phase 4.

---

## Troubleshooting

**"Shopify app not configured" 500 on any /api/shopify/\* route**
→ One of `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SHOPIFY_APP_URL` is
missing. `npx wrangler secret list` to check.

**HMAC verification failed on callback**
→ Either the Client Secret in the worker doesn't match Partners, or you
   redirected to the wrong app's callback URL. Re-paste the secret with
   `npx wrangler secret put SHOPIFY_API_SECRET`.

**`shopify.idToken()` returns undefined in the embedded app**
→ The `<meta name="shopify-api-key">` tag in `shopify-app/index.html`
   wasn't templated correctly. Confirm `VITE_SHOPIFY_API_KEY` is set in
   the build environment and rebuild.

**Embedded app loads but `/api/shopify/me` returns 404**
→ The shop's row in `shopify_stores` is missing or has `uninstalled_at`
   set. Reinstall the app — the row gets refreshed via the upsert in the
   callback handler.

**CORS error on `/api/shopify/me` from the embedded iframe**
→ The origin (`https://admin.shopify.com` or `<shop>.myshopify.com`)
   isn't in the worker's CORS allowlist. Verify `workers/api/src/index.ts`
   includes the Shopify branches in the `origin` resolver.

**"Tunneled URL changes on every `shopify app dev` restart"**
→ Expected — the Cloudflare tunnel is ephemeral. Use a stable Pages
   subdomain for production and just accept that dev URLs rotate. The
   CLI auto-updates Partners with the new URL each time.
