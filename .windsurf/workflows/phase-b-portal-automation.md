---
description: Roadmap to make agency whitelabel portal provisioning fully self-serve
---

## Phase B — Portal Automation Roadmap

The customer-facing SaaS flow at `socialaistudio.au` is fully self-serve
(see `new-client-onboarding.md` Path 1). What remains manual is **agency
whitelabel portal provisioning** — when Steve onboards a client under his
Agency plan and that client gets their own branded portal at e.g.
`social.clientdomain.com.au`.

This doc describes what's needed to make that path self-serve too.

---

## Current pain points

Per `new-client-onboarding.md` Path 2, each new whitelabel portal needs:

1. New `src/client.configs/CLIENTNAME.ts` file, hand-edited
2. New Cloudflare Pages project, hand-created
3. ~8 env vars set on the Pages project
4. Clerk auto-login user, hand-created
5. Custom domain attached
6. DNS CNAME (or Cloudflare DNS auto-config)
7. Agency workspace row in D1, hand-created via Clients tab
8. Facebook OAuth connect, hand-done by Steve

That's ~15 minutes per client and a non-trivial cognitive load.

---

## Two architectural options

### Option A — Runtime tenant config (recommended long-term)

Stop creating a separate CF Pages project per portal. Serve all
whitelabel portals from a **single CF Pages deployment** that loads
tenant config at runtime based on `Host:` header.

**Required changes:**

1. **D1 schema** — add `tenants` table:
   ```sql
   CREATE TABLE tenants (
     id TEXT PRIMARY KEY,             -- slug e.g. 'picklenick'
     host TEXT UNIQUE NOT NULL,       -- 'social.picklenick.au'
     config_json TEXT NOT NULL,       -- the CLIENT object as JSON
     clerk_user_id TEXT,              -- auto-login Clerk user
     portal_secret TEXT NOT NULL,     -- per-tenant API secret
     status TEXT DEFAULT 'active',    -- active | suspended | provisioning
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   ```

2. **Worker endpoint** `/api/tenants/lookup?host=...` — public, returns
   tenant config given a hostname. Cached at the edge for 5 min.

3. **Frontend bootstrap** — modify `src/client.config.ts`:
   ```ts
   // At top-of-app, before App renders:
   if (window.location.host !== 'socialaistudio.au') {
     const cfg = await fetch(`/api/tenants/lookup?host=${location.host}`);
     Object.assign(CLIENT, await cfg.json());
   }
   ```
   This means the bundle is the same for every portal — config is the
   only thing that varies. CSS variables (accent colour) are already
   set at runtime in `main.tsx`, so the visual swap is fine.

4. **Custom domain attachment** — the single CF Pages project has all
   whitelabel domains as additional Custom Domains. Adding a new portal
   = one CF API call to add a domain. No new project needed.

**Pros:**
- One CF Pages project = one build, one set of env vars to maintain
- New portal in <60 seconds via API call
- No GitHub commits per portal — config is in D1, not the repo

**Cons:**
- Bigger refactor (migrate existing 5 portals to runtime config)
- Per-tenant builds (currently `cp ... && npm run build`) go away,
  which means per-tenant build hooks (e.g. analytics injection at
  build time) need to move to runtime
- Single point of failure — if the lookup endpoint is down, no
  portals load

### Option B — Programmatic provisioning of separate CF Pages projects

Keep the current per-portal CF Pages model, but automate the eight
manual steps via a single API endpoint.

**Required changes:**

1. **Worker endpoint** `/api/admin/portals/create` (Clerk-admin auth):
   - Accepts `{ slug, businessName, businessType, location, tone, accentColor, ... }`
   - Generates a `client.configs/<slug>.ts` file content
   - Commits it to GitHub via the GitHub REST API (push to `main`
     using a PAT or GitHub App token)
   - Calls Cloudflare API to create a new Pages project pointing
     at the same repo with `cp src/client.configs/<slug>.ts ...` build cmd
   - Calls Cloudflare API to set env vars on the new project
   - Calls Cloudflare API to add the custom domain
   - Calls Clerk admin API to create the auto-login user
   - Inserts a `clients` row in D1
   - Returns success

**Pros:**
- No frontend refactor — existing portals keep working
- Each portal still has its own build pipeline + env vars

**Cons:**
- More moving pieces (GitHub + CF + Clerk APIs)
- Each portal still costs a CF Pages build slot
- Provisioning time bound by CF Pages build (3-5 min)
- Still polluting the repo with one config file per portal

---

## Recommendation

**Start with Option B-Lite** for the next 6 months — it preserves the
working architecture and ships incremental value. Re-evaluate Option A
once you have 20+ portals and the build maintenance burden becomes
real.

---

## Credentials Steve needs to provide for Option B

Set these as **worker secrets** via `npx wrangler secret put NAME`:

1. **`CLOUDFLARE_API_TOKEN`** — Cloudflare API token with these
   permissions:
   - Account → Cloudflare Pages → Edit
   - Account → Workers Scripts → Edit (only if managing workers too)
   - Zone → DNS → Edit (for adding the CNAME for custom domains)

   Create at: https://dash.cloudflare.com/profile/api-tokens
   Use the "Custom token" template.

2. **`CLOUDFLARE_ACCOUNT_ID`** — your account ID (visible in any
   Workers/Pages page URL).

3. **`GITHUB_PAT`** — fine-grained GitHub PAT scoped to the
   `3dhuboz/SocialAI-Studio` repo with:
   - Contents: Read & Write
   - Metadata: Read

   Create at: https://github.com/settings/personal-access-tokens/new
   Set expiration to ~1 year — rotate annually.

   Alternative: install a GitHub App on the repo and use its
   installation token. More setup, more secure.

4. **`CLERK_SECRET_KEY`** — already set, but verify the key has
   `users:create` permission (it does on the standard Clerk plan).

5. **`PAGES_PROJECT_TEMPLATE_ID`** (optional, if cloning project
   settings) — the project ID of an existing portal whose env vars
   should be copied as defaults.

---

## What's already scaffolded

Nothing yet for Option B — this doc is the design. The Phase A commit
in this branch makes the **direct SaaS** flow self-serve, which was
the highest-value piece. Whitelabel portal automation can be built
in a follow-up session once Steve provides the credentials above.

---

## Suggested first PR for Option B

A small, safe starting point:

1. Add `tenants` table migration to `workers/api/schema.sql` (or a
   new `migrations/0001_tenants.sql` if migrations are introduced).
2. Add `/api/admin/portals/create` worker endpoint that ONLY does
   step 1 of provisioning (insert tenant row + return config). All
   external API calls (GitHub, CF, Clerk) deferred to later PRs.
3. Add a `scripts/provision-portal.mjs` CLI that calls the endpoint
   and prints the remaining manual steps. Once external APIs are
   wired in later PRs, the CLI just stops printing those steps as
   they get automated.

Ship that, validate, then layer in CF / GitHub / Clerk API calls one
at a time.
