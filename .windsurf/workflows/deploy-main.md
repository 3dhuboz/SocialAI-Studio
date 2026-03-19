---
description: Deploy main SocialAI Studio site to Cloudflare Pages
---

## Deploy Main Site (socialaistudio.au)

This deploys the main agency SocialAI Studio app. No config swap needed — `src/client.config.ts` is the agency config by default.

### 1. Ensure you're on main branch and up to date
```
git checkout main
git pull origin main
```

### 2. Build locally to verify no errors
```
npm run build
```

### 3. Commit and push — Cloudflare Pages auto-deploys on push
```
git add -A
git commit -m "deploy: <description of change>"
git push origin main
```

### 4. Monitor build in Cloudflare dashboard
- Go to https://dash.cloudflare.com → Workers & Pages → socialai-studio
- Check Deployments tab — build takes ~2 minutes
- View build logs if it fails

### 5. Verify live at
- https://socialaistudio.au
- https://socialaistudio.pages.dev (CF default URL)

### Environment variables required in CF Pages project settings:
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key (pk_live_...)
- `VITE_AI_WORKER_URL` — Worker URL: `https://socialai-api.steve-700.workers.dev`
- `OPENROUTER_API_KEY` — OpenRouter API key (for /api/ai/generate Pages Function)
- `LATE_API_KEY` — Late.dev API key (from https://app.getlate.dev)
- `FACEBOOK_APP_ID` — Facebook App ID (for token exchange Pages function)
- `FACEBOOK_APP_SECRET` — Facebook App Secret (never exposed to client, server-side only)
- `PAYPAL_CLIENT_ID` — PayPal Client ID (for subscription verification)
- `PAYPAL_CLIENT_SECRET` — PayPal Client Secret (for subscription verification)
- `PAYPAL_WEBHOOK_ID` — PayPal Webhook ID (for webhook signature verification)
- `PAYPAL_PLAN_STARTER`, `PAYPAL_PLAN_GROWTH`, `PAYPAL_PLAN_PRO`, `PAYPAL_PLAN_AGENCY` — PayPal plan IDs
- `RESEND_API_KEY` — Resend API key (optional, for activation/cancellation emails)

Note: Clerk secret key (`CLERK_SECRET_KEY`) is set in the **Worker** secrets, NOT in Pages.
