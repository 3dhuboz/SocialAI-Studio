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

## What's already scaffolded (Phase B-Lite)

The DB-side of portal provisioning is now atomic. Re-using the existing
`clients` and `portal` tables (no new schema needed):

* **`POST /api/admin/portals/provision`** (worker) — gated by
  `FACTS_BOOTSTRAP_SECRET`. Atomically creates the `clients` row + the
  `portal` row, generates the per-portal shared secret + portal token,
  and returns the full env-var block + remaining manual steps.

* **`scripts/provision-portal.mjs`** — CLI wrapper that calls the
  endpoint with one flag per input. Auto-generates a strong
  `autoLoginPassword`, prints it once for copying. Example:

  ```
  FACTS_BOOTSTRAP_SECRET=<secret> \
  OWNER_USER_ID=<your-clerk-user-id> \
  node scripts/provision-portal.mjs \
    --slug newclient \
    --businessName "New Client" \
    --businessType florist \
    --autoLoginEmail client@socialaistudio.au \
    --customDomain social.newclient.com.au
  ```

This cuts the DB side of provisioning from "click around the Clients
tab + run wrangler queries" to one CLI command. The CF Pages, Clerk,
and GitHub steps are still manual — see "Manual steps remaining" below
for what each of them needs.

### Manual steps remaining after the CLI runs

The CLI's output prints these too — keeping them here as a reference:

1. Create CF Pages project in the dashboard, build cmd points at
   `src/client.configs/<slug>.ts`
2. Set the printed env vars on the new project
3. Add the custom domain in CF Pages → Custom domains
4. Create the Clerk auto-login user (use the printed email + password)
5. Create `src/client.configs/<slug>.ts` (copy `picklenick.ts` as
   template), commit, push — CF Pages auto-builds

### Next slices to layer on (need credentials per the table above)

* **CF Pages API**: replace step 1 + 2 + 3 with API calls. Needs
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.
* **Clerk admin API**: replace step 4. Needs the existing
  `CLERK_SECRET_KEY` to have `users:create` (it already does).
* **GitHub Contents API**: replace step 5. Needs `GITHUB_PAT`.

Each of these is independent — wire them in one at a time, the CLI
stops printing the corresponding manual step as each gets automated.
