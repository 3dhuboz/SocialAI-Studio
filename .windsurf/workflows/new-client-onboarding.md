---
description: Full checklist for onboarding a new social media management client
---

## New Client Onboarding Checklist

Complete these steps in order when signing up a new client.

### Phase 1: Setup (you do this — ~15 min)

#### 1. Create client config file
```
cp src/client.configs/picklenick.ts src/client.configs/CLIENTNAME.ts
```
Edit the new file — key fields:
- `appName`: e.g. `'Pickle Nick Social'`
- `defaultBusinessName`: client's business name
- `defaultBusinessType`: e.g. `'food truck'`
- `defaultLocation`: e.g. `'Brisbane, Australia'`
- `accentColor`: brand colour hex
- `autoLoginEmail`: e.g. `'client@socialaistudio.au'`
- `autoLoginPassword`: strong auto-generated password
- `clientMode: true`

#### 2. Create Cloudflare Pages project
Follow `/deploy-client-portal` workflow — Step 2 onwards.
Build command: `cp src/client.configs/CLIENTNAME.ts src/client.config.ts && npm run build`

#### 3. Add custom domain in Cloudflare Pages
Add `social.CLIENTDOMAIN.com.au` as custom domain.

#### 4. Create Firebase auto-login user
- Firebase Console → Authentication → Add user
- Use the `autoLoginEmail` + `autoLoginPassword` from the config

#### 5. Commit and push the new config
```
git add src/client.configs/CLIENTNAME.ts
git commit -m "feat: add CLIENTNAME client config"
git push origin main
```
CF Pages auto-builds the new portal.

---

### Phase 2: Agency backend setup (~5 min)

#### 6. Log into socialaistudio.au as agency admin

#### 7. Create client workspace
- Clients tab → Add Client
- Set business name, type, location, tone, description

#### 8. Connect Facebook for client workspace
- Switch to client workspace
- Settings → Connect Facebook → select the client's Facebook page
- Verify "Facebook Connected" badge appears

---

### Phase 3: Hand off to client (~5 min)

#### 9. Give client their portal URL
`https://social.CLIENTDOMAIN.com.au`

#### 10. Give client their login (if they need direct access)
- Email: `autoLoginEmail`
- Password: `autoLoginPassword`
- Note: portal auto-logs in, so they just open the URL

#### 11. Set client's API key in their portal
- Client logs in → Settings → paste their Claude or Gemini API key

---

### Services used (no extra cost per client)
- **Cloudflare Pages**: free tier, 100k function calls/day shared
- **Firebase Auth**: free Spark plan supports unlimited users
- **Firestore**: free tier (1GB storage, 50k reads/day)
- **Late.dev**: one account covers all profiles (check plan limit)
