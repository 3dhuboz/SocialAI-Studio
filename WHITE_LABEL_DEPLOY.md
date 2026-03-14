# White-Label Deployment Guide

This repo supports multiple branded deployments from a single codebase.
Each client gets their own Netlify site + custom domain pointing to their branded instance.

---

## How It Works

`vite.config.ts` reads the `VITE_CLIENT_ID` environment variable at **build time**.
If set, it redirects the `client.config` import to the matching file in `src/client.configs/`.
If not set, it uses the default `src/client.config.ts` (socialaistudio.au).

```
VITE_CLIENT_ID=streetmeats  →  src/client.configs/streetmeats.ts
VITE_CLIENT_ID=picklenick   →  src/client.configs/picklenick.ts
VITE_CLIENT_ID=hughesq      →  src/client.configs/hughesq.ts
(not set)                   →  src/client.config.ts  (SocialAI Studio default)
```

---

## Deploying a New Client Instance

### 1. Create a new Netlify site

1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**
2. Connect to GitHub → select `3dhuboz/SocialAI-Studio`
3. Set the **branch** to `main`
4. Set the **build command** to: `vite build`
5. Set the **publish directory** to: `dist`
6. Under **Environment variables**, add:
   ```
   VITE_CLIENT_ID = streetmeats    (or picklenick / hughesq)
   ```
7. Deploy the site

### 2. Add Netlify environment variables (also required)

These must be set per-site in Netlify → Site settings → Environment variables:

| Variable | Value |
|---|---|
| `VITE_CLIENT_ID` | `streetmeats` / `picklenick` / `hughesq` |
| `LATE_API_KEY` | Your Late.dev API key |

### 3. Set a custom domain

In Netlify → Domain management → Add custom domain:

| Client | Domain |
|---|---|
| Street Meats Barbeque | `social.streetmeatsbarbeque.com.au` |
| Pickle Nick | `social.picklenick.au` |
| Hughes Q | `social.hughesq.au` |

Add a CNAME record in your DNS provider pointing to the Netlify subdomain.

---

## Branded Config Files

Each file in `src/client.configs/` controls the full branding for that deployment:

| File | Client | Accent Colour |
|---|---|---|
| `src/client.config.ts` | SocialAI Studio (default) | `#f59e0b` amber |
| `src/client.configs/streetmeats.ts` | Street Meats Barbeque | `#b91c1c` red |
| `src/client.configs/picklenick.ts` | Pickle Nick | `#16a34a` green |
| `src/client.configs/hughesq.ts` | Hughes Q / Uzi's Q | `#d97706` amber |

To add a new client, copy any existing config file and update:
- `appName`, `tagline`, `defaultBusinessName`, `defaultBusinessType`
- `defaultLocation`, `defaultTone`, `defaultDescription`
- `accentColor`
- `adminEmails`
- `stripePublishableKey`, `stripePricingTableId` (if selling plans separately)
- `setupFee` (set to `0` if managed via Agency plan on socialaistudio.au)

---

## FoodTruc-App Integration

The `FoodTruc-App` (Street Meats, Pickle Nick) embeds the Social AI Studio via iframe
in the admin dashboard's **Social & AI** tab.

The iframe URL is stored in Firestore settings under `socialAiStudioUrl`.
Default: `https://social.streetmeatsbarbeque.com.au`

To change it per deployment, update `constants.ts` → `INITIAL_SETTINGS.socialAiStudioUrl`
or update the value directly in Firestore: `settings/general.socialAiStudioUrl`.

The bridge component is at `pages/admin/SocialAIBridge.tsx`.

---

## Agency Management

You (Steve) manage all clients from **socialaistudio.au** using the **Agency plan**.

1. Log in to `socialaistudio.au`
2. Click the client switcher (top bar) → **Add client workspace**
3. Enter the client's business name (Street Meats, Pickle Nick, Hughes Q)
4. Switch into their workspace to generate content, manage their calendar, view analytics

This is separate from the embedded branded instances — the Agency panel is your
management view, while the branded subdomains are what the client sees in their app.

---

## Hughes Q Integration

Hughes Q (`hughesysque` repo) uses a different stack (Express + MongoDB + JWT auth).
Since it doesn't share Firebase, users need a separate Social AI Studio login.

Integration approach: add a button/link in the Hughes Q admin dashboard that opens
`https://social.hughesq.au` in a new tab, or embed it as an iframe in the admin nav.

The branded instance at `social.hughesq.au` handles its own auth independently.
