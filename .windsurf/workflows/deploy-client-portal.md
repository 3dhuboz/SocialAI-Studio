---
description: Deploy a client portal (white-label site) to Cloudflare Pages
---

## Deploy a Client Portal

Client portals are white-label builds of the same repo with a different `client.config.ts`.
Each portal is a separate Cloudflare Pages project with a custom build command.

### Existing portals

| Domain | CF Project | Config file |
|--------|-----------|-------------|
| social.picklenick.au | picklenick-social | src/client.configs/picklenick.ts |
| social.streetmeatzbbq.com.au | streetmeats-social | src/client.configs/streetmeats.ts |
| social.hugheseysque.au | hugheseysque-social | src/client.configs/hughesq.ts |
| hugheseysque.au | hugheseysque | src/client.configs/hughesq.ts |

### Deploying an update to all portals

Portal sites auto-deploy when you push to `main` — no extra steps needed.
Each CF Pages project runs its own build command which swaps the config before building.

### Creating a NEW client portal

#### Step 1: Create the client config file
Copy an existing config as a template:
```
cp src/client.configs/picklenick.ts src/client.configs/newclient.ts
```
Edit `src/client.configs/newclient.ts` — update:
- `appName`, `defaultBusinessName`, `defaultBusinessType`
- `autoLoginEmail`, `autoLoginPassword` (clientMode credentials)
- `accentColor`, `poweredBy`, `poweredByUrl`
- `clientMode: true`

#### Step 2: Create a new Cloudflare Pages project
1. Go to https://dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git
2. Select the SocialAI-Studio GitHub repo
3. Set build settings:
   - **Build command**: `cp src/client.configs/newclient.ts src/client.config.ts && npm run build`
   - **Build output directory**: `dist`
   - **Branch**: `main`
4. Add environment variable: `LATE_API_KEY` = your Late.dev API key
5. Deploy

#### Step 3: Add custom domain
- In CF Pages project → Custom domains → Add domain
- If domain is on Cloudflare DNS, it auto-configures
- Otherwise update CNAME at registrar to point to `<project>.pages.dev`

#### Step 4: Set up Clerk auto-login user
In Clerk Dashboard → Users → Create user:
- Email: the `autoLoginEmail` from the client config
- Password: the `autoLoginPassword` from the client config

This user gets auto-signed-in when clients visit their branded portal URL.

#### Step 5: Set env vars in the CF Pages project
- `VITE_CLERK_PUBLISHABLE_KEY` — same Clerk publishable key as main site
- `VITE_AI_WORKER_URL` — `https://socialai-api.steve-700.workers.dev`
- `VITE_AUTO_LOGIN_EMAIL` — the client's auto-login email
- `VITE_AUTO_LOGIN_PASSWORD` — the client's auto-login password
- `LATE_API_KEY` — Late.dev API key
- `FACEBOOK_APP_ID` — Facebook App ID
- `FACEBOOK_APP_SECRET` — Facebook App Secret

#### Step 6: Set up client workspace in agency backend
- Log into socialaistudio.au as agency admin
- Go to Clients tab — verify the client appears (it was seeded in D1 directly)
- Switch to that client workspace and connect their Facebook Page
