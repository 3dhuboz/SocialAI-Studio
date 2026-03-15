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
- `LATE_API_KEY` — Late.dev API key (from https://app.getlate.dev)
- Any Firebase keys are embedded in the build (public, safe to include)
