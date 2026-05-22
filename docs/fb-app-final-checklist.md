# Facebook App Submission — Final Checklist

Status: **Ready to submit pending Privacy Policy URL going live + screencast.** Audit P0 — required before new customers can complete FB OAuth at scale.

## What's blocking submission

| Item | Status | Who | Notes |
| --- | --- | --- | --- |
| Privacy Policy URL live + linked | ✅ Shipped + verified 2026-05-22 (PR #160). `curl https://socialaistudio.au/privacy` → HTTP 200, deployed chunk `PrivacyPolicy-CxFDE2qa.js` contains "Penny Wise I.T (ABN 16 477 079 626)". **Caveat:** content renders client-side from the JS bundle — the raw HTML response is the SPA shell. Meta's reviewer opens URLs in a real browser so this is expected to pass, but if they run a JS-disabled crawler the page will look empty. If review bounces on this, prerender legal routes at build time (~30 min of work). | — | — |
| Data Deletion URL endpoint | ✅ Done — `POST /api/fb/deauthorize` + `POST /api/fb/data-deletion` shipped in PR #158, deployed `7edeb8bc`. Re-verified 2026-05-22: both return `HTTP 400 {"error":"signed_request required"}` on empty POST. | — | See "Endpoint URLs to paste" below |
| Deauthorize Callback URL | ✅ Done + verified — same PR, same smoke check | — | |
| Token encryption at rest | ✅ Shipped 2026-05-22 in this audit | — | FB Platform Terms compliance |
| App icon (1024×1024 PNG) | 🟡 Per `LISTING_COPY.md` checklist — verify with Steve | Steve | |
| App category set | 🟡 Verify in App Dashboard → Settings → Basic | Steve | "Business and Pages" |
| Demo video / screencast | 🟡 Script at `docs/fb-app-review/screencast-script.md` | Steve | Record + upload via App Review form |
| Permission justifications | 🟡 Drafted in `docs/fb-app-review/` package | Steve | Submit alongside screencast |
| Test users have run the flow | 🟡 At least 2 test users completed signup → connect FB → publish without errors | Steve | |

## Endpoint URLs to paste in FB App Dashboard

After verifying the worker is deployed (current version: `7edeb8bc-6909-4cf7-8222-1d13e3493a1b`):

**App Dashboard → Settings → Basic:**

| Field | Value |
| --- | --- |
| Privacy Policy URL | `https://socialaistudio.au/privacy` |
| Terms of Service URL | `https://socialaistudio.au/terms` |
| Data Deletion Instructions URL | `https://socialaistudio.au/data-deletion` (static instructions page) |
| User Data Deletion → Callback URL | `https://socialai-api.steve-700.workers.dev/api/fb/data-deletion` |
| App Domains | `socialaistudio.au` (+ whitelabel domains as needed) |

**App Dashboard → Facebook Login for Business → Settings:**

| Field | Value |
| --- | --- |
| Valid OAuth Redirect URIs | `https://socialaistudio.au/auth/facebook/callback` (+ any whitelabel callbacks) |
| Deauthorize Callback URL | `https://socialai-api.steve-700.workers.dev/api/fb/deauthorize` |

## Pre-submit smoke test

1. `curl https://socialaistudio.au/privacy` returns HTML with the words "Privacy Policy" — not the SPA shell. (Pages auto-deploys legal pages; if you get the shell, the React Router config needs adjustment.)
2. `curl -X POST https://socialai-api.steve-700.workers.dev/api/fb/deauthorize` returns 400 with `"signed_request required"` — confirms the route is wired (it should reject without a signed payload).
3. Same for `/api/fb/data-deletion`.
4. In a clean browser, sign in as a fresh test user → connect FB → see at least one post publish successfully.
5. As a test user, navigate FB → Settings → Business Integrations → SocialAI Studio → Remove. Within a minute, your `workers/api` logs (via `wrangler tail`) should show `[fb-deauth] invalidated tokens for FB user_id=…`.

## Once those check out

Submit via App Dashboard → App Review → Permissions and Features. Expect 5–7 business days. Meta may ask for additional clarification — keep `docs/fb-app-review/screencast-script.md` open for fast reference.

## Related

- Audit Compliance P0 #3 (deauth + data-deletion URLs) — closed
- Audit Compliance P0 #4 (FB App in Development Mode) — gated on this submission
- Audit Compliance P0 #2 (plaintext tokens) — closed this audit
