# Whitelabel Migration Punch List

Foundation landed in PR `[whitelabel] brands table foundation + paypal
proof-of-pattern`. This file enumerates every remaining hardcoded brand
string in `workers/api/` that should migrate to `loadBrandForUser(env,
userId)` (or `loadDefaultBrand(env)` when no user context exists).

Pattern:
```ts
import { loadBrandForUser } from '../lib/brand';
const brand = await loadBrandForUser(c.env, userId);
// Then use brand.appName, brand.accentColor, brand.fromEmail, etc.
```

See `src/lib/paypal.ts:welcomeEmailHtml` / `cancellationEmailHtml` and
`src/routes/paypal.ts` for the worked example.

---

## Outgoing emails (user-visible — highest priority)

These send to end-customers under the platform brand. Whitelabel resellers
should be sending under their own brand instead.

- [ ] `src/cron/check-fal-credits.ts:31` — `from: 'SocialAI Studio <noreply@socialaistudio.au>'` (fal credit alert email). User context: this is platform-ops only; should use `loadDefaultBrand(env)` and resolve `brand.fromEmail`.
- [ ] `src/cron/refresh-tokens.ts:73` — `from: 'SocialAI Studio <noreply@socialaistudio.au>'` (FB token-refresh failure alert). Per-user: load brand by `user_id` from the loop.
- [ ] `src/cron/weekly-review.ts:105-106` — dashboard URL hardcoded to `https://socialaistudio.au`. Per-user (loop body has `ws.client_id` / `ws.user_id`).
- [ ] `src/cron/weekly-review.ts:131` — `<p>...SocialAI Studio · <a href="${dashboardUrl}/settings"...>` footer. Per-user.
- [ ] `src/cron/weekly-review.ts:138` — `from: 'SocialAI Studio <hello@socialaistudio.au>'`. Per-user.
- [ ] `src/cron/publish-missed.ts:92-93` — `<a href="https://socialaistudio.au/admin" style="background:#f59e0b...">Reconnect Facebook</a>` button HTML. Per-user.
- [ ] `src/lib/email.ts:26` — `from: 'Social AI Studio <noreply@socialaistudio.au>'` (the generic Resend wrapper). Tricky: this is the shared sender called by everything above; the cleanest migration is to change `sendResendEmail` to accept an optional `from` and have each callsite pass `brand.fromEmail`.
- [ ] `src/routes/proxies.ts:181` — `from: 'SocialAI Studio <noreply@socialaistudio.au>'` (likely the admin contact-form proxy). Audit the route to confirm whose user_id applies.

## Admin-notify emails (less urgent, internal-only)

These go to the platform ops inbox. Replace `ADMIN_NOTIFY_EMAIL` (kept
exported in `lib/paypal.ts` for legacy callers) with `brand.adminNotifyEmail`.

- [ ] `src/lib/paypal.ts:30` — `ADMIN_NOTIFY_EMAIL` constant. Now only re-exported; no remaining importers in the worker after this PR. Safe to delete in the follow-up.

## Dashboard / sign-in URLs

Hardcoded jumps to `https://socialaistudio.au/*` that should pivot to the
brand's domain (e.g. `acme.example.com`).

- [ ] `src/index.ts:45,48,60` — CORS allow-origin defaults. Either resolve per-request via `Origin` header lookup or read from a runtime allowlist; not user-scoped so loadBrandForUser doesn't apply. Defer until the brand registry exposes a domain-allowlist query.
- [ ] `src/routes/pennybuilder.ts:219` — Clerk sign-in redirect URL. Has user context (Clerk ticket flow).
- [ ] `src/routes/pennybuilder.ts:265` — Sign-in fallback URL. Same.

## OpenRouter `HTTP-Referer` / `X-Title` headers

These are sent on every LLM call as the API client identifier. PayPal /
abuse-detection on OpenRouter side sees them. Not user-visible but the
platform-identity signal leaks to the LLM vendor.

- [ ] `src/lib/anthropic.ts:176-177` — `HTTP-Referer` + `X-Title`.
- [ ] `src/lib/archetypes.ts:164-165` — same pair.
- [ ] `src/lib/backfill.ts:281-282` — same pair.
- [ ] `src/lib/campaign-research.ts:170-171` — same pair.
- [ ] `src/lib/critique.ts:169-170` — same pair.
- [ ] `src/routes/ai.ts:164` — `X-Title` only.
- [ ] `src/routes/posters.ts:559-560` — same pair.

Migration note: these calls happen deep in helper functions that mostly
don't have `Env` + `userId` plumbed through. Cheapest fix is to add a
`brand?: Brand` arg to each LLM-call helper and have the topmost caller
(the route) pass it down.

## User-agent + bot UA

- [ ] `src/lib/web-fetch.ts:23` — `Mozilla/5.0 (compatible; SocialAIStudioBot/1.0; +https://socialaistudio.au/bot)`. Per-brand bot identity; needs `brand.appName` + `brand.domain`.

## R2 / wrangler config

- [ ] `src/env.ts:60` — JSDoc reference to `reels.socialaistudio.au`. Documentation only — no behavior change needed, just refresh the example.
- [ ] `wrangler.toml:31` — comment referencing `reels.socialaistudio.au`. Documentation only.

## Health / diagnostic strings

- [ ] `src/routes/health.ts:81,97,104` — Resend domain probe looks for `socialaistudio.au`. Per-brand: probe each `brand.domain` from the brands table. Defer until multiple brands exist (single-brand today makes the hardcode acceptable).
- [ ] `src/routes/paypal.ts:410` — error message in `/api/admin/paypal-diagnose` mentions `socialaistudio.au`. Admin-only diagnostic text.
- [ ] `src/auth.ts:73` — comment-only reference, not code path.

## PennyBuilder bridge (cross-platform — needs design)

- [ ] `src/routes/pennybuilder.ts:24,275` — CSP `frame-ancestors` allows `*.pennywiseit.com.au`. This is the *parent* platform's domain for the iframe-embed flow, not the reseller's. Defer until the bridge supports per-reseller embed origins.

## Schema / SQL files (no behavior change)

These are historical migration files that mention "SocialAI Studio" in
their header comments. No action needed — historical record.

- `schema.sql`, `schema_v2..v16.sql` — header comments.

## Code-comment-only references

Refer to the brand by name in JSDoc/explanatory comments. Cosmetic; do
not migrate unless the surrounding code is also being rewritten.

- `src/index.ts:1`, `src/lib/image-gen.ts:43`, `src/lib/image-safety.ts:70,268`,
  `src/cron/prewarm-images.ts:66`, `src/routes/posters.ts:3`,
  `src/routes/pennybuilder.ts:1,4`.

---

## Rollout order (suggested)

1. **Outgoing emails section first** — this is what end-customers see.
   Migrate `lib/email.ts` to accept `from` per-call, then update each
   cron + route to pass `brand.fromEmail`.
2. **Admin-notify section** — quick win, mostly delete the constant.
3. **Dashboard URLs** — easy per-route migration.
4. **OpenRouter headers** — high churn (many files); defer until UI
   actually surfaces the value (when does an LLM-vendor identifier
   matter for whitelabel customers?).
5. **Everything else** — opportunistic.
