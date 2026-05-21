/**
 * Webhook HMAC tests — the App Store reviewer's first test target.
 *
 * Shopify reviewers actively attempt to bypass webhook HMAC during App
 * Store review. A single accepted-without-verification payload to any of
 * the GDPR endpoints (customers/data_request, customers/redact,
 * shop/redact) is an automatic rejection.
 *
 * These tests exercise verifyWebhookHmac directly against bodies built
 * with our shared `buildWebhookHeaders` fixture. We don't integration-
 * test the full route handler here (that needs D1 — the dedup-lookup
 * and webhook-log writes both go through env.DB) — that's covered by
 * the integration suite. The scope here is the higher-level concern:
 * "given headers a real Shopify webhook would send, do we accept/reject
 * the right ones?"
 *
 * Some overlap with shopify-auth.test.ts is intentional — these are
 * grouped by the route they protect, not by the primitive.
 */
import { describe, it, expect } from 'vitest';
import { verifyWebhookHmac } from '../../lib/shopify-auth';
import { buildWebhookHeaders, hmacB64 } from '../../__tests__/fixtures/shopify';

const SECRET = 'shopify_webhook_secret_test';
const SHOP = 'test-shop.myshopify.com';

// Realistic-shape payloads — exact shape doesn't matter for HMAC (it
// signs raw bytes), but using a representative payload makes the test
// easier to read.
const APP_UNINSTALLED_BODY = JSON.stringify({
  id: 654321,
  name: 'Test Shop',
  shop_domain: SHOP,
  domain: SHOP,
  myshopify_domain: SHOP,
});

const GDPR_DATA_REQUEST_BODY = JSON.stringify({
  shop_id: 654321,
  shop_domain: SHOP,
  orders_requested: [1, 2, 3],
  customer: { id: 191167021, email: 'customer@example.com' },
  data_request: { id: 9999 },
});

describe('shopify-oauth webhook HMAC verification', () => {
  it('accepts a webhook with a valid HMAC built by the fixture', async () => {
    const headers = await buildWebhookHeaders({
      shop: SHOP,
      body: APP_UNINSTALLED_BODY,
      secret: SECRET,
      topic: 'app/uninstalled',
      webhookId: 'wh-1',
    });
    const hmac = headers.get('X-Shopify-Hmac-Sha256');
    expect(await verifyWebhookHmac(APP_UNINSTALLED_BODY, hmac, SECRET)).toBe(true);
  });

  it('rejects when the body has been tampered with after signing', async () => {
    // Attacker scenario: caller intercepts a real Shopify webhook, swaps
    // shop_id (or any byte) for their target's, and replays. HMAC over
    // the new bytes must not match the original signature.
    const original = GDPR_DATA_REQUEST_BODY;
    const tampered = original.replace('"shop_id":654321', '"shop_id":999999');
    expect(original).not.toBe(tampered); // sanity — the replace fired
    const headers = await buildWebhookHeaders({
      shop: SHOP,
      body: original,
      secret: SECRET,
      topic: 'customers/data_request',
    });
    const hmac = headers.get('X-Shopify-Hmac-Sha256');
    expect(await verifyWebhookHmac(tampered, hmac, SECRET)).toBe(false);
  });

  it('rejects when X-Shopify-Hmac-Sha256 header is missing', async () => {
    // Build a Headers WITHOUT the HMAC. Simulates a forgotten/dropped
    // header by an upstream proxy — must NEVER fall through to 200.
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Shopify-Shop-Domain': SHOP,
      'X-Shopify-Topic': 'app/uninstalled',
      'X-Shopify-Webhook-Id': 'wh-2',
    });
    const hmac = headers.get('X-Shopify-Hmac-Sha256');
    expect(hmac).toBeNull();
    expect(await verifyWebhookHmac(APP_UNINSTALLED_BODY, hmac, SECRET)).toBe(false);
  });

  it('rejects a webhook signed with the wrong secret', async () => {
    // Different attacker secret, same body. The verifier uses OUR secret
    // and must fail to match.
    const headers = await buildWebhookHeaders({
      shop: SHOP,
      body: APP_UNINSTALLED_BODY,
      secret: 'attacker_guessed_secret',
      topic: 'app/uninstalled',
    });
    const hmac = headers.get('X-Shopify-Hmac-Sha256');
    expect(await verifyWebhookHmac(APP_UNINSTALLED_BODY, hmac, SECRET)).toBe(false);
  });

  it('rejects when the HMAC header is malformed (truncated base64)', async () => {
    const valid = await hmacB64(SECRET, APP_UNINSTALLED_BODY);
    const truncated = valid.slice(0, valid.length - 4);
    expect(await verifyWebhookHmac(APP_UNINSTALLED_BODY, truncated, SECRET)).toBe(false);
  });

  it('rejects when body is byte-shifted by one character (whitespace injection)', async () => {
    // Subtle attack: prepend a single space to the body. Many lax HMAC
    // implementations trim whitespace; ours signs the literal bytes, so
    // a one-byte prefix must break the signature.
    const headers = await buildWebhookHeaders({
      shop: SHOP,
      body: APP_UNINSTALLED_BODY,
      secret: SECRET,
    });
    const hmac = headers.get('X-Shopify-Hmac-Sha256');
    const shifted = ' ' + APP_UNINSTALLED_BODY;
    expect(await verifyWebhookHmac(shifted, hmac, SECRET)).toBe(false);
  });
});

// ── buildWebhookHeaders self-test ─────────────────────────────────────────
// Sanity check that the fixture itself produces the headers downstream
// route handlers expect to find — if this regresses, every webhook test
// becomes a false negative.
describe('buildWebhookHeaders fixture', () => {
  it('populates all Shopify webhook headers with the expected names', async () => {
    const headers = await buildWebhookHeaders({
      shop: SHOP,
      body: '{}',
      secret: SECRET,
      topic: 'customers/redact',
      webhookId: 'wh-explicit',
    });
    expect(headers.get('X-Shopify-Hmac-Sha256')).toBeTruthy();
    expect(headers.get('X-Shopify-Shop-Domain')).toBe(SHOP);
    expect(headers.get('X-Shopify-Topic')).toBe('customers/redact');
    expect(headers.get('X-Shopify-Webhook-Id')).toBe('wh-explicit');
  });

  it('auto-generates a webhook id when not provided', async () => {
    const a = await buildWebhookHeaders({ shop: SHOP, body: '{}', secret: SECRET });
    const b = await buildWebhookHeaders({ shop: SHOP, body: '{}', secret: SECRET });
    expect(a.get('X-Shopify-Webhook-Id')).toBeTruthy();
    expect(a.get('X-Shopify-Webhook-Id')).not.toBe(b.get('X-Shopify-Webhook-Id'));
  });
});
