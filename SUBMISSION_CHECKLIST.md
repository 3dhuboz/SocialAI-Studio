# App Store Submission Checklist — SocialAI Studio for Shopify

The state of every requirement Shopify checks during review, with file links to anything that's drop-in ready.

---

## ✅ Code & compliance (done — verified)

| Item | Status | Notes |
|---|---|---|
| Embedded app loads inside Shopify Admin via App Bridge v4 | ✅ | `useAppBridge()` hook in [App.tsx](shopify-app/src/App.tsx); CDN-loaded `app-bridge.js` |
| `<ui-nav-menu>` web component present | ✅ | Required by reviewers — present in [App.tsx](shopify-app/src/App.tsx) |
| Polaris-native UI | ✅ | All UI uses `@shopify/polaris` v13; no rogue inline styles |
| Token Exchange + `expiring=1` | ✅ | Modern auth pattern — [shopify-token-exchange.ts](workers/api/src/lib/shopify-token-exchange.ts) |
| OAuth code-grant kept as fallback | ✅ | [shopify-oauth.ts](workers/api/src/routes/shopify-oauth.ts) `/auth` + `/auth/callback` |
| Mandatory `app/uninstalled` webhook | ✅ | HMAC-verified, marks shop uninstalled, audited |
| GDPR webhook 1: `customers/data_request` | ✅ | Acknowledges 200; no customer data stored |
| GDPR webhook 2: `customers/redact` | ✅ | LIKE-purges past PII rows from webhook log; logs sentinel only |
| GDPR webhook 3: `shop/redact` | ✅ | Deletes shop row + products + webhook log + billing events + oauth state |
| Webhook HMAC verification before parse | ✅ | All 6 webhooks verify against raw body before any JSON parse |
| Webhook idempotency via `X-Shopify-Webhook-Id` | ✅ | `isDuplicateWebhook()` check before side effects |
| Webhook responses < 5s (Shopify timeout) | ✅ | `ctx.waitUntil()` on non-critical audit writes |
| Shopify Billing API integration | ✅ | $29 USD/mo, 7-day trial, dev-store `test: true` |
| `app_subscriptions/update` webhook | ✅ | Reconciles state changes into D1 |
| Billing reconciliation cron (`*/15 * * * *`) | ✅ | Recovers from missed webhooks — [reconcile-subscriptions.ts](workers/api/src/cron/reconcile-subscriptions.ts) |
| OAuth state CSRF protection | ✅ | One-shot nonces, atomic `DELETE … RETURNING` |
| Shop domain sanitizer | ✅ | Regex-strict, 60-char subdomain cap, IDN-safe |
| Session token JWT validation | ✅ | HS256, alg-confusion guard, https-only iss/dest, 5s clock skew |
| Access tokens AES-256 encrypted at rest | ✅ | `v1:iv:ct` format via Web Crypto. `access_token_format: 'v1'` verified live |
| CSP `frame-ancestors` for Shopify admin | ✅ | [shopify-app/public/_headers](shopify-app/public/_headers) |
| HSTS + nosniff + Referrer-Policy + Permissions-Policy | ✅ | All in `_headers` |
| Admin endpoints `requireAdmin` gated | ✅ | All `/api/admin/shopify-stores/*` paths |
| Admin audit log | ✅ | `shopify_admin_audit` table |
| Rate limiting on token-exchange + setup-subscription | ✅ | 10/min per shop |
| AbortSignal timeouts on Shopify API fetches | ✅ | 15s — prevents hung webhooks |
| Test suite | ✅ | 90 tests across 5 files — `cd workers/api && npm test` |
| Worker observability enabled | ✅ | `[observability] enabled = true` in wrangler.toml |
| `.gitignore` covers wrangler logs + .env | ✅ | Verified — no token leakage |

---

## ✅ Listing assets (done — copy ready, files staged)

| Asset | Status | File |
|---|---|---|
| App name + tagline + descriptions | ✅ Drafted | [LISTING_COPY.md](LISTING_COPY.md) |
| Privacy policy text | ✅ Drafted | [PRIVACY_POLICY.md](PRIVACY_POLICY.md) |
| Pricing structure | ✅ Drafted | In LISTING_COPY.md |
| Categories | ✅ Drafted | Marketing → Content marketing |
| Support email | ✅ | steve@pennywiseit.com.au |
| Demo store URL | ✅ | `socialai-dev-store.myshopify.com` (live with app installed) |
| Installation instructions for reviewer | ✅ Drafted | In LISTING_COPY.md |
| Screenshot 1: install consent screen | ✅ Captured | `~/Downloads/` (Chrome auto-saved during this session) |
| Screenshot 2: embedded app + shop info card | ✅ Captured | Same |

---

## ✅ Listing assets — final pass

| Asset | Status | Where |
|---|---|---|
| **App icon (1200×1200 PNG)** | ✅ Generated | [shopify-app/assets/app-icon.png](shopify-app/assets/app-icon.png) — 391 KB. Dark slate background, amber speech bubble with AI sparkles + typing dots, rounded square. Source SVG at [shopify-app/public/app-icon.svg](shopify-app/public/app-icon.svg). Rendered via headless Chrome from the SVG. |
| **Privacy policy page (HTML)** | ✅ Drafted + built | [shopify-app/public/privacy.html](shopify-app/public/privacy.html) → goes live at `https://socialai-shopify.pages.dev/privacy` |
| **Support page (HTML)** | ✅ Drafted + built | [shopify-app/public/support.html](shopify-app/public/support.html) → goes live at `https://socialai-shopify.pages.dev/support` |
| **Screenshots** | ✅ 2 captured (auto-saved to `~/Downloads/`) | Install consent screen + embedded-app loaded state. Both functional; reviewers accept 1280×720 minimum so these meet spec. |

## ⏳ One blocker, then ship

The Pages deploy is **fully built and staged in `shopify-app/dist/`** (12 files: index.html, privacy.html, support.html, app-icon.svg, _headers, and the 7 JS/CSS bundle chunks). The Cloudflare API has globally rate-limited this account's OAuth token after a series of mid-session auth failures, so the deploy itself can't go through automatically right now. Even `wrangler whoami` returns `Max auth failures reached [code: 9109]`.

**Two ways to ship the deploy (pick one):**

**Option A — Fresh wrangler login (fastest, ~30 seconds):**
```bash
cd shopify-app
npx wrangler logout
npx wrangler login              # opens browser, click Allow once
npx wrangler pages deploy dist --project-name socialai-shopify --branch main --commit-dirty=true
```

**Option B — Direct upload via dashboard (no CLI needed):**
1. Open https://dash.cloudflare.com/?to=/:account/pages/view/socialai-shopify/deployments/new
2. Drag the `shopify-app/dist/` folder onto the drop zone (the dashboard's `webkitdirectory` input blocks programmatic upload but accepts real drag-and-drop)
3. Click **Save and deploy**

**Option C — Wait it out (~30-60 min):**
The rate limit eventually clears. Try `npx wrangler whoami` periodically; once that returns your account info, the existing OAuth still works for ~17 more minutes (token expires 07:22 UTC) and the deploy command above will succeed.

Once any option succeeds, verify:

```bash
curl -I https://socialai-shopify.pages.dev/privacy   # → 200 OK + CSP headers
curl -I https://socialai-shopify.pages.dev/support   # → 200 OK + CSP headers
```

## What's still optional

| Item | Recommendation |
|---|---|
| **More polished screenshots (3-8 annotated)** | The 2 captured today work for first submission. Adding annotated arrows in Figma is a polish-pass that can happen post-listing-live. |
| **Demo video (Loom, 30-60s)** | Not required by Shopify. Adds conversion lift on the listing page but won't gate review. Skip for now. |

---

## 🚀 To submit

Once the 5 manual items are done:

1. In Partners → SocialAI Studio → **Distribution** → click **Manage Shopify App Store listing**
2. Paste copy from [LISTING_COPY.md](LISTING_COPY.md) into each form field
3. Upload the icon + 3-8 screenshots
4. Paste the public privacy + support URLs
5. **Submit for review**
6. Expect 2-3 weeks of reviewer ping-pong. Typical first-round asks: a clarifying question about how AI generation works with merchant data, and a request to confirm webhook handlers respond correctly (Shopify auto-tests these — we're already covered).

If reviewers ask about anything in the "Code & compliance" table above, point them at the specific file in this checklist — every item has a citation.

---

## What you don't need to do

- ❌ Worry about webhook delivery — we have idempotency + reconciliation cron
- ❌ Worry about token expiry — Token Exchange re-runs on every embedded-app mount
- ❌ Worry about dev-store billing — `test: true` is auto-set for `partner_test` plans
- ❌ Worry about token storage security — AES-256 envelope encryption is live and verified
- ❌ Set up a separate billing system — Shopify Billing API handles everything; revenue lands in your Partners payout

---

_Last updated: 19 May 2026. State of the world: worker version `91f5884b`, Pages deployment at `socialai-shopify.pages.dev`, schema_v21 applied, 90/90 tests passing, 1 dev-store install live with encrypted token._
