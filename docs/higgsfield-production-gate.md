# Higgsfield Production Gate

Status: investigated, not enabled in production.

Higgsfield is available on Steve's machine through the `higgsfield` CLI, and the local account currently has credits. That is useful for manual experiments, but it is not enough for SocialAI Studio production image generation because the Cloudflare Worker cannot safely depend on a desktop OAuth session.

## Production Rule

Higgsfield may only be added to `generateImageWithGuardrails` when all of these are true:

1. We have a stable server-to-server API base URL from Higgsfield.
2. We have deploy-safe credentials, not a copied CLI/browser access token.
3. The provider runs behind the existing SocialAI guardrail chain.
4. Low-scoring output still goes through critique and retry before a customer sees it.
5. fal.ai remains the fallback provider until Higgsfield has passed live QA.

## Expected Worker Configuration

Set these as Cloudflare Worker secrets/vars only after the API contract is confirmed:

```text
HIGGSFIELD_API_BASE_URL
HIGGSFIELD_API_KEY
HIGGSFIELD_API_SECRET
HIGGSFIELD_IMAGE_MODEL
```

Recommended starting model from the current CLI catalog:

```text
gpt_image_2
```

The CLI also lists `nano_banana_2`, `flux_2`, `seedream_v4_5`, and Marketing Studio image models, but production should start with one model behind a feature flag and compare critique scores against the current fal path.

## Non-Negotiable Acceptance Test

Before enabling this for customers, run a test batch for:

1. Hugheseys Que brisket/BBQ posts.
2. SocialAI Studio/Penny Wise I.T SaaS posts.
3. A non-food local service client.

Every generated image must match the caption, avoid surreal anatomy, pass the permanent critique threshold, and fall back cleanly if Higgsfield errors or times out.
