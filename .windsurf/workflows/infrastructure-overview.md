---
description: Overview of all infrastructure, subscriptions, and services used across SocialAI Studio
---

## Infrastructure Overview

### Hosting & Functions — Cloudflare (FREE)

| Project | Domain | CF Pages Project | Build Command |
|---------|--------|-----------------|---------------|
| Main agency app | socialaistudio.au | socialai-studio | `npm run build` |
| Pickle Nick portal | social.picklenick.au | picklenick-social | `cp src/client.configs/picklenick.ts src/client.config.ts && npm run build` |
| Street Meats portal | social.streetmeatzbbq.com.au | streetmeats-social | `cp src/client.configs/streetmeats.ts src/client.config.ts && npm run build` |
| Hugheseysque main | hugheseysque.au | hugheseysque | `cp src/client.configs/hughesq.ts src/client.config.ts && npm run build` |
| Hugheseysque portal | social.hugheseysque.au | hugheseysque-social | `cp src/client.configs/hughesq.ts src/client.config.ts && npm run build` |

All use:
- Branch: `main` (auto-deploys on every push)
- Output: `dist`
- Env var: `LATE_API_KEY`

---

### Database & Auth — Firebase (FREE Spark plan)

- **Firestore**: User data, posts, client workspaces, stats
- **Auth**: Email/password login for agency + all portal auto-login users
- Dashboard: https://console.firebase.google.com
- Cost: $0 (stays free under normal usage — 1GB storage, 50k reads/day)

---

### Social Media API — Late.dev (PAID)

- One API key covers all profiles (Penny Wise, Pickle Nick, Street Meats, etc.)
- Used for: connecting Facebook pages, publishing posts, scheduling
- Dashboard: https://app.getlate.dev
- Key stored as: `LATE_API_KEY` in Cloudflare Pages env vars

---

### AI Generation — User-provided keys (NO PLATFORM COST)

- **Claude API**: User pastes key in Settings → stored in browser localStorage
- **Gemini API**: Same — user-provided
- **fal.ai**: User pastes key in Settings — pay per video generation

---

### DNS — Cloudflare (FREE)

All `.au` domains managed in Cloudflare DNS.
CNAME each domain to its corresponding `<project>.pages.dev` URL.

---

### Code — GitHub (FREE)

- Repo: https://github.com/3dhuboz/SocialAI-Studio
- Single `main` branch — all client builds use the same branch with different build commands

---

### Cancelled / Migrated Away

- ~~**Netlify**~~ — exceeded free tier credit limit, migrated to Cloudflare Pages

---

### Monthly Cost Summary

| Service | Cost |
|---------|------|
| Cloudflare Pages + Workers | $0 |
| Firebase | $0 |
| GitHub | $0 |
| Late.dev | check plan |
| fal.ai | pay per use |
| **Total platform cost** | **~$0 + Late.dev plan** |
