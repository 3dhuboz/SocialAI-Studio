# SocialAI Studio for Shopify — App Store Listing Copy

This document holds every piece of copy that goes into the Shopify App Store listing form. Drop-in ready, but please review tone + adjust to your voice before submitting.

---

## App name (max 30 chars)

> **SocialAI Studio**

(15 / 30 chars used)

## Tagline (max 70 chars)

> **AI social posts for your products. Scheduled to FB & Instagram.**

(63 / 70 chars used)

## Short description (max 100 chars — shown in App Store grid)

> **Generate on-brand social posts featuring your real products. Auto-schedule to Facebook & Instagram.**

(99 / 100 chars used)

## Full description (Markdown, ~500-2000 words)

> ### Stop staring at a blank social calendar
>
> Most Shopify merchants know they should be posting to Facebook and Instagram every day. Almost none of them do — because writing posts that actually feature your products, capturing on-brand visuals, and remembering to schedule them is more work than running the store.
>
> SocialAI Studio for Shopify closes that gap inside your admin panel.
>
> ### What it does
>
> - **Pulls your product catalog** the moment you install. No upload, no copy-paste.
> - **Generates social media post drafts** that talk about real products from your store — not generic e-commerce filler. Each post mentions specific items, real prices, and your brand voice.
> - **Builds the visuals** using AI image generation, optionally referencing your product photography for on-brand consistency.
> - **Schedules to Facebook and Instagram** once you connect your business pages. Posts go live at the times your audience is actually online.
> - **Critiques every post** for fabricated stats, generic AI tropes, and tone before it ships. You stay in control.
>
> ### How merchants use it
>
> - **Daily promo posts** featuring this week's bestsellers
> - **Product launch announcements** generated from a single product handle
> - **Seasonal campaigns** scheduled weeks in advance
> - **Re-engagement posts** when a product drops in price or comes back in stock
>
> ### What you control
>
> Every generated post is editable before publishing. You set the schedule, the platform mix, the tone, and the brand keywords. The AI proposes; you approve.
>
> ### Pricing
>
> $29 USD / month after a 7-day free trial. No setup fees, no per-post costs, no extra charges for AI generation. Cancel anytime from Shopify Admin → Settings → Billing.
>
> ### Privacy & security
>
> We request `read_products` only. We don't see your customers, orders, or storefront visitors. OAuth access tokens are AES-256 encrypted at rest. Full privacy policy: https://socialai-shopify.pages.dev/privacy
>
> ### Built for Shopify merchants
>
> Embedded directly in your admin, designed in Polaris, works on every Shopify plan including Basic. No external dashboards to log into. No surprises on your phone bill.

## Key benefits (3-5 bullets, max 100 chars each)

1. **Generate product-specific social posts in seconds, not hours**
2. **Auto-schedule to Facebook & Instagram without leaving Shopify admin**
3. **AI visuals trained on your brand, not stock photo libraries**
4. **7-day free trial, $29/mo after. Cancel anytime.**
5. **Read-only access — we never see your customers or orders**

## Categories

Primary: **Marketing → Content marketing**
Secondary: **Sales channels → Social media**

## Pricing structure (Shopify form)

- **Plan name**: SocialAI Studio Monthly
- **Price**: $29.00 USD
- **Billing interval**: Every 30 days
- **Trial**: 7 days, free
- **Available on**: All Shopify plans

## Search keywords (max 10, 30 chars each)

1. AI social media
2. Facebook scheduler
3. Instagram automation
4. Product social posts
5. AI content generation
6. Social media calendar
7. Auto-post Shopify
8. AI captions
9. Product marketing
10. Social automation

## Support details

- **Support email**: steve@pennywiseit.com.au
- **Support URL**: https://socialai-shopify.pages.dev/support
- **Privacy policy URL**: https://socialai-shopify.pages.dev/privacy
- **Developer name**: Penny Wise I.T

## Demo store URL (if applicable)

_(TODO: spin up a dev store with seeded products + the app pre-installed, so reviewers can click-through. Use `socialai-dev-store.myshopify.com` if it's still around with the app installed.)_

## Installation instructions for reviewer

> 1. **Install** the app from this listing. The Token Exchange / Managed Install flow lands you straight in the embedded admin — no OAuth popup.
> 2. **Activate billing**: from the Home page, click "Start free trial" in the info banner. On a development store this uses Shopify's test-mode billing — no real charge.
> 3. **Sync your products** (Products tab in the embedded nav): click "Sync now" to pull your Shopify catalog into the app. Up to 500 products are cached, newest-first.
> 4. **(Optional) Connect Facebook** (Settings tab): a real Facebook Business Page is required to actually publish. If you don't want to connect a Page, skip this step — Compose / Calendar / Autopilot all work fine for the review without it; posts just stay as Drafts.
> 5. **Compose your first post** (Products tab → pick a product → "Compose post"): AI generates a caption + image. Edit if you like. Click "Save as Draft" or "Schedule" — both work without Facebook connected.
> 6. **Calendar** (Calendar tab): view scheduled and draft posts on a month grid. Drag posts between days to reschedule, or use the list view for full controls.
> 7. **(Optional) Autopilot** (Autopilot tab): bulk-generate up to 14 days of posts at once. Preview-then-accept flow — no posts are saved until you click "Accept all".
> 8. **Insights** (Insights tab): shows your post queue + (if FB connected) Page reach, engagement, and follower stats.

## Test credentials for reviewer (if anything beyond install)

> **No credentials required for the core flow** — Token Exchange + Managed Install means the reviewer just clicks Install and is signed in via Shopify session.
>
> **Facebook step is optional**: it requires a real Facebook Business Page admin account. If you don't have one handy, skip step 4 above — every other feature is testable end-to-end without it. Compose-and-save flows produce Draft posts which the Calendar surfaces; cron-based publishing is the only branch that requires a connected Page.
>
> **Test billing**: development stores automatically get `test: true` on the Shopify Billing API call — Shopify simulates the entire approval flow with no money moving. You'll see the trial activate and the embedded app become fully functional.

---

## Asset checklist

| Asset | Required | Where it lives |
|---|---|---|
| App icon — 1200×1200 PNG, ≤1 MB, with safe area | Required | `shopify-app/assets/app-icon.png` |
| 3-8 screenshots — 1600×900 or 1280×800, JPEG/PNG | Required | TODO — blocked on populated dev store |
| Demo video — 30-60s MP4 (recommended) | Recommended | TODO — optional, can submit without |
| Privacy policy URL | Required | https://socialai-shopify.pages.dev/privacy |
| Support URL | Required | https://socialai-shopify.pages.dev/support |
| Pricing structure | Required (above) | Done — see "Pricing structure" |
| Developer name + business address | Required | Penny Wise I.T, Australia |
| App store description copy | Required | Done — see above |
| Categories | Required | Marketing → Content marketing |

---

_Drop the values from this doc into the corresponding fields in Partners → Apps → SocialAI Studio → App Store listing._
