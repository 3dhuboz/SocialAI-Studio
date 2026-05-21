# Stripe Tax (GST / VAT) — Outstanding

Status: **Not configured.** Audit P0 — required before paid customer traffic from AU (above A$75k turnover threshold) or EU (any volume).

## Context

SocialAI Studio does not use Stripe directly. Stripe collects payments via the **PennyBuilder add-on path** — provisioning lands on this codebase via `POST /api/pennybuilder/provision` with a shared Bearer secret (`PENNYBUILDER_PROVISION_SECRET`). Stripe Checkout, Stripe-Signature webhook verification, and tax configuration all live in the PennyBuilder codebase, not here.

PayPal is the primary payment surface on socialaistudio.au and handles GST collection itself when configured at the PayPal merchant level.

## What needs to happen

### PennyBuilder side (Steve — outside this repo)

1. **Enable Stripe Tax** on the Stripe account that PennyBuilder uses to provision SocialAI subscriptions:
   - Stripe Dashboard → Tax → Get started → register tax IDs for AU and EU.
2. **Update Checkout sessions** to include:
   ```js
   stripe.checkout.sessions.create({
     // ... existing options ...
     automatic_tax: { enabled: true },
     customer_update: { address: 'auto', name: 'auto' },
   });
   ```
3. **Collect tax IDs** at checkout for B2B (`tax_id_collection: { enabled: true }`) so business customers can supply their VAT / ABN.
4. **Test**: place test orders from AU + EU addresses; verify the tax line appears on the invoice and the customer receives a compliant tax invoice (PDF) by email.

### SocialAI Studio side (this repo)

- **No code change required** — we only consume the provisioning event after Stripe has captured payment.
- **One copy update**: the Refunds page (`src/pages/Refunds.tsx`, shipped 2026-05-22) mentions "no refunds on partial months". When tax is enabled, also note "tax inclusive of GST / VAT where applicable" — non-blocking, can land alongside the next pricing copy refresh.

## Verification gate before paying customers

- [ ] PennyBuilder Stripe account has Tax enabled
- [ ] An AU test customer receives an invoice with GST line + ABN  
- [ ] An EU test customer receives an invoice with VAT line + VAT ID  
- [ ] PennyBuilder's compliance person has signed off on the tax setup (or Steve has)

## Related

- Audit Compliance P0 #5 (no GST/VAT)
- `workers/api/src/routes/pennybuilder.ts` — provisioning handler (no Stripe-side concern)
