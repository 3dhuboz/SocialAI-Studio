# Shopify review resubmission packet

App: SocialAI Studio
Reference: 116333
Status from Shopify email: Paused

## Fix summary for Partner Dashboard

We fixed the paused-review items reported by Shopify:

1. Facebook connection is limited to the Facebook Page permissions used by the Shopify listing:
   `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`.
2. The Facebook Page lookup no longer requests Instagram fields during the Shopify embedded-app flow.
3. Billing approval can now be reopened when the shop is stuck in `PENDING`, so reviewers can recover if the first billing tab is closed.
4. Compose now shows a recoverable billing approval banner instead of a critical generation error when the Billing API charge has not been approved.

## Test credentials to paste into Partner Dashboard

Do not commit a real password here. Paste the live credentials only into Shopify's secure Partner Dashboard testing-instructions field.

```text
SocialAI Studio Shopify App Review credentials

Shopify development store:
socialai-dev-store.myshopify.com

Facebook test account for OAuth popup:
Email: [PASTE REAL FACEBOOK TEST ACCOUNT EMAIL]
Password: [PASTE REAL FACEBOOK TEST ACCOUNT PASSWORD]

Facebook Page available to that account:
Page name: [PASTE PAGE NAME]
Page URL: [PASTE PAGE URL]
Role: Admin or full-access Page manager

Important reviewer notes:
- Please install SocialAI Studio on the Shopify development store.
- On Home, approve the 7-day Shopify Billing API trial. No charge is taken today.
- Go to Products and sync products.
- Click Compose post on any product to generate a Facebook-ready post.
- Go to Settings and click Connect Facebook Page.
- Log in with the Facebook credentials above, grant the requested Facebook Page permissions, and select the listed Page.
- Save a draft or schedule it in Calendar. Publish Now requires the Facebook Page connection.

If billing shows "Waiting for billing approval", click "Reopen approval flow" or "Open billing approval" to open a fresh Shopify approval URL.
```

## Screencast URL

Use this URL after deployment:

https://app.socialaistudio.au/socialai-studio-reviewer-screencast.mp4

The screencast should demonstrate:

1. Install/open embedded app.
2. Approve Shopify Billing API trial.
3. Sync products.
4. Generate a product-aware Facebook post.
5. Connect Facebook Page from Settings.
6. Schedule/review the post in Calendar.
7. Confirm no off-platform billing is used.

