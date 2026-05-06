---
description: Onboarding paths for SocialAI Studio — self-serve SaaS vs agency whitelabel portals
---

## Two onboarding paths — pick the right one

SocialAI Studio has two distinct customer types and two onboarding flows.

| Customer type | Onboarding | Steve's manual work |
|---------------|------------|---------------------|
| **Direct SaaS subscriber** (signs up at socialaistudio.au) | **Fully automated** — Clerk signup → PayPal → OnboardingWizard | None |
| **Agency-managed whitelabel client** (Steve onboards them under his Agency plan) | Semi-manual — separate CF Pages portal per client | ~15 min per portal |

---

## Path 1 — Direct SaaS Subscriber (fully automated)

**No Steve action required.** A new customer signs up, pays, and starts
generating posts without any manual provisioning.

The flow:

1. Customer visits `https://socialaistudio.au` → `LandingPage`
2. Clicks Get Started → Clerk open signup (anyone can sign up)
3. Picks plan in `PricingTable` → PayPal subscription checkout
4. `/api/paypal-verify` (worker) verifies subscription with PayPal,
   inserts a `pending_activations` row in D1
5. PayPal webhook `/api/paypal-webhook` (Pages Function) does the same
   server-side as defence-in-depth, plus sends a Resend welcome email
6. Activation auto-consumes on next user load
   (`db.getActivation(user.email)` in `App.tsx`), flips `setupStatus`
   to `live`, sets the plan, and auto-shows OnboardingWizard
7. OnboardingWizard walks them through: business info → Facebook
   OAuth (real `pages_show_list / pages_manage_posts` flow) → done
8. Customer is using the product

### Required config (already in place)

**Main CF Pages env vars:**
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`
- `PAYPAL_PLAN_STARTER / _GROWTH / _PRO / _AGENCY` (and `_*_YEARLY`)
- `RESEND_API_KEY` (welcome / cancellation emails — optional)

**Worker secrets:**
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`

If a customer hits a snag the entry points are everywhere — `Get Started`
and `Choose a Plan` CTAs all route to PricingTable, and they can re-trigger
checkout or open the wizard from Settings.

---

## Path 2 — Agency Whitelabel Client (semi-manual)

This is for Steve's agency-managed clients who get their own branded
portal at e.g. `social.clientdomain.com.au`. These clients don't pay
SocialAI Studio directly — Steve invoices them under his Agency plan.

> **Roadmap:** see `phase-b-portal-automation.md` for the plan to make
> this fully self-serve too. Requires CF API token + GitHub PAT.

### Phase 1 — Setup (~15 min)

#### 1. Create client config file
```
cp src/client.configs/picklenick.ts src/client.configs/CLIENTNAME.ts
```
Edit:
- `clientId`, `appName`, `defaultBusinessName`, `defaultBusinessType`,
  `defaultLocation`, `defaultTone`, `defaultDescription`
- `accentColor` (use a brand hex — both light and dark text variants
  auto-derive from this via HSL math in `main.tsx`)
- `clientMode: true`

#### 2. Create Cloudflare Pages project
Follow `/deploy-client-portal` from Step 2.
Build command: `cp src/client.configs/CLIENTNAME.ts src/client.config.ts && npm run build`

#### 3. Add custom domain
`social.CLIENTDOMAIN.com.au` in CF Pages → Custom domains.

#### 4. Create Clerk auto-login user
Clerk dashboard → Users → Create user with `autoLoginEmail` +
`autoLoginPassword` from the config.

#### 5. Set portal env vars
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_AI_WORKER_URL` = `https://socialai-api.steve-700.workers.dev`
- `VITE_AUTO_LOGIN_EMAIL`, `VITE_AUTO_LOGIN_PASSWORD`
- `VITE_PORTAL_SECRET` (must match the per-client secret in D1)
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`

#### 6. Commit and push the new config
```
git add src/client.configs/CLIENTNAME.ts
git commit -m "feat: add CLIENTNAME client config"
git push origin main
```
CF Pages auto-builds the new portal.

### Phase 2 — Backend (~5 min)

#### 7. Log into socialaistudio.au as agency admin

#### 8. Create the client workspace
Clients tab → Add Client → fill business details.

#### 9. Connect the client's Facebook Page
Switch to the client workspace → Settings → Connect Facebook → pick
the client's page.

### Phase 3 — Hand-off

The portal auto-logs in via the dedicated Clerk user, so the client
just opens the URL.
