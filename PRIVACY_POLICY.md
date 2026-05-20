# Privacy Policy — SocialAI Studio for Shopify

_Last updated: 19 May 2026_

This privacy policy describes how SocialAI Studio ("the App", "we", "us") collects, uses, retains, and protects information from merchants and shop data when our App is installed on a Shopify store.

The App is published by **Penny Wise I.T** (Australia). Questions about this policy: **steve@pennywiseit.com.au**.

---

## 1. Information we access from your shop

When you install the App, we request the following permissions from Shopify:

| Scope | Why we need it |
|---|---|
| `read_products` | Read your product catalog (title, description, images, price, handle, vendor, tags) so the App can generate AI-written social media posts featuring your products. |

We do **not** request `read_customers`, `read_orders`, or any other customer-data scope. We never see customer names, email addresses, phone numbers, shipping addresses, order history, or payment information.

## 2. Information we store

For each installed shop, we store:

- **Shop identity** — `shop_domain` (e.g. `your-shop.myshopify.com`), shop name, shop email (the merchant contact email from Shopify's `shop.json`), country code, currency, and Shopify plan name.
- **Authorization** — a Shopify-issued offline access token (AES-GCM-256 encrypted at rest), the OAuth scopes you granted, and timestamps for install / uninstall.
- **Subscription state** — the App subscription ID, status (PENDING / ACTIVE / CANCELLED / etc.), trial end date, and current period end. All billing is handled by Shopify's Billing API; we do not see or store payment-card information.
- **Product catalog cache** (Phase 2 — not yet active) — a cached copy of your product catalog so we can compose posts. Refreshed via Shopify's product webhooks.

We never store:

- Customer personal data of any kind (names, emails, phone, addresses, payment info)
- Order data
- Storefront visitor analytics
- Payment-card details

## 3. How we use the information

- Generate AI-written social media post drafts about your products
- Display your shop's subscription status inside the App
- Send Shopify-side billing requests for your subscription
- Maintain an audit log of webhook deliveries and admin actions for security and compliance

## 4. How we protect the information

- **Encryption at rest** — Shopify offline access tokens are AES-GCM-256 encrypted before storage in Cloudflare D1. Encryption keys are stored as Cloudflare Workers Secrets, separate from the database.
- **Encryption in transit** — all traffic uses TLS 1.2+. HSTS is enforced with a 2-year max-age.
- **Authentication** — App Bridge session tokens (HS256 JWT) authenticate every API call from the embedded app. Webhooks are HMAC-SHA256 verified against the raw payload before any processing.
- **Access control** — only authorized administrators can view aggregate merchant data. Every admin action is logged to `shopify_admin_audit`.
- **Iframe security** — the embedded app's CSP `frame-ancestors` directive restricts loading to `*.myshopify.com` and `admin.shopify.com`. We set `X-Content-Type-Options: nosniff` and `Permissions-Policy` to lock down camera, microphone, geolocation, and payment APIs.

## 5. Data retention

- **While installed** — we retain shop data, authorization tokens, and subscription state.
- **On uninstall** (`app/uninstalled` webhook) — we mark the shop as uninstalled and stop using the data. The access token remains until the GDPR deletion window closes.
- **48 hours after uninstall** (`shop/redact` webhook from Shopify) — we permanently delete the shop row, all cached products, all OAuth state, all webhook log entries (which may contain Shopify-issued payloads), and all billing event records. Only the audit-log row showing we honored the redact remains.
- **Webhook logs** — capped at 64 KB per row and retained for ongoing operational needs; purged on `shop/redact`.

## 6. GDPR mandatory webhooks

Per Shopify's App Store policy, we implement the three GDPR-compliance webhooks:

- **`customers/data_request`** — acknowledged with 200. We do not store any customer-keyed data, so there is nothing to export.
- **`customers/redact`** — acknowledged with 200. We additionally purge any logged webhook payloads that match the customer identifier in the request, as defense-in-depth.
- **`shop/redact`** — purges all shop data as described in Section 5.

## 7. Sub-processors

We use the following sub-processors to provide the service:

- **Cloudflare, Inc.** — Workers (compute), D1 (database), Pages (static hosting for the embedded app), R2 (object storage for AI-generated media). Cloudflare's privacy practices: https://www.cloudflare.com/privacypolicy/
- **Shopify, Inc.** — App platform, OAuth, Billing API, webhook delivery. Shopify's privacy practices: https://www.shopify.com/legal/privacy
- **Anthropic / OpenRouter** — AI model inference for caption generation. No customer or order data is sent — only product titles + descriptions you've granted us via `read_products`.
- **fal.ai** — AI image generation. No customer data is sent.
- **Meta Platforms, Inc. (Facebook / Instagram)** — only if you connect a Facebook Page in Settings. We use the Facebook Graph API to publish your scheduled posts to your connected Page (and linked Instagram Business account, if any) and to read Page-level engagement stats for the Insights view. We never request access to your customers, ad accounts, or messages. We store a Page access token and Page ID; both are erased when you click "Disconnect" in Settings or when the app is uninstalled. Meta's privacy practices: https://www.facebook.com/privacy/policy/

## 8. Your rights

If you are a merchant whose shop has installed the App, you may at any time:

- **Uninstall the App** from your Shopify admin → Apps menu. This triggers the deletion timeline described in Section 5.
- **Request immediate deletion** by emailing **steve@pennywiseit.com.au** with your shop domain. We will action this within 48 hours.
- **Export your data** — email us; we will return a JSON export of the shop's stored data within 30 days.

## 9. Changes to this policy

We will update this document if our data practices change. The "Last updated" date at the top reflects the current version. Material changes that affect the data we collect will be communicated to active merchants via the embedded app interface before they take effect.

## 10. Contact

**Email**: steve@pennywiseit.com.au
**Business**: Penny Wise I.T (Australia)
**App on Shopify App Store**: SocialAI Studio
