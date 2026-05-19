/**
 * Unit tests for lib/shopify-billing.ts — the recurring app subscription
 * client.
 *
 * Why this matters: the billing module is the single point of failure
 * between "merchant approved scopes" and "we charge their card". A bug
 * here means either we double-bill, fail to start a trial, or hard-crash
 * on a Shopify GraphQL response that doesn't quite match the spec.
 *
 * The original panel bug this guards against: Shopify SOMETIMES returns
 * `body.errors` as a STRING (when their reverse proxy intercepts the
 * request — e.g. wrong scopes, missing auth) instead of an array. The
 * previous implementation called `body.errors.map(...)` and crashed,
 * which surfaced to the merchant as a generic 500 instead of the actual
 * Shopify error message.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isTestStore,
  PLAN_INFO,
  createAppSubscription,
} from '../shopify-billing';

// ── isTestStore ─────────────────────────────────────────────────────────────

describe('isTestStore', () => {
  it('returns true for partner_test', () => {
    expect(isTestStore('partner_test')).toBe(true);
  });

  it('returns true for affiliate', () => {
    expect(isTestStore('affiliate')).toBe(true);
  });

  it('returns true for staff_business', () => {
    expect(isTestStore('staff_business')).toBe(true);
  });

  it('returns true regardless of case', () => {
    expect(isTestStore('PARTNER_TEST')).toBe(true);
    expect(isTestStore('Affiliate')).toBe(true);
  });

  it('returns false for real merchant plans', () => {
    expect(isTestStore('basic')).toBe(false);
    expect(isTestStore('shopify')).toBe(false);
    expect(isTestStore('advanced')).toBe(false);
    expect(isTestStore('shopify_plus')).toBe(false);
  });

  it('returns false for null/undefined/empty plan names', () => {
    expect(isTestStore(null)).toBe(false);
    expect(isTestStore(undefined)).toBe(false);
    expect(isTestStore('')).toBe(false);
  });

  it('returns false for unknown plan names (fail-safe — never bill-bypass)', () => {
    // If Shopify ever ships a new dev-store sentinel, we want isTestStore
    // to return false (so we attempt a real charge, the merchant sees a
    // clear "this store cannot be charged" error, and we update the
    // allowlist) — NOT silently treat random plans as free.
    expect(isTestStore('mystery_plan')).toBe(false);
  });
});

// ── PLAN_INFO shape ─────────────────────────────────────────────────────────

describe('PLAN_INFO', () => {
  it('has a positive USD price', () => {
    expect(PLAN_INFO.price).toBeGreaterThan(0);
    expect(PLAN_INFO.currency).toBe('USD');
  });

  it('has a 14-day trial', () => {
    expect(PLAN_INFO.trialDays).toBe(14);
  });

  it('has a non-empty name and monthly interval', () => {
    expect(typeof PLAN_INFO.name).toBe('string');
    expect(PLAN_INFO.name.length).toBeGreaterThan(0);
    expect(PLAN_INFO.interval).toBe('EVERY_30_DAYS');
  });
});

// ── createAppSubscription ───────────────────────────────────────────────────

const SHOP = 'test-shop.myshopify.com';
const TOKEN = 'shpat_testtoken';
const RETURN_URL = 'https://example.com/return';

describe('createAppSubscription', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset fetch between tests so each test owns its mock response.
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns ok=true with subscriptionId + confirmationUrl on success', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appSubscriptionCreate: {
          appSubscription: { id: 'gid://shopify/AppSubscription/777', status: 'PENDING' },
          confirmationUrl: 'https://test-shop.myshopify.com/admin/charges/confirm/777',
          userErrors: [],
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await createAppSubscription(SHOP, TOKEN, RETURN_URL, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subscriptionId).toBe('gid://shopify/AppSubscription/777');
      expect(result.confirmationUrl).toContain('/admin/charges/confirm/');
      expect(result.isTest).toBe(true);
    }
  });

  it('passes shop domain into the request URL and access token in header', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appSubscriptionCreate: {
          appSubscription: { id: 'gid://shopify/AppSubscription/1', status: 'PENDING' },
          confirmationUrl: 'https://test-shop.myshopify.com/admin/charges/confirm/1',
          userErrors: [],
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await createAppSubscription(SHOP, TOKEN, RETURN_URL, false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`https://${SHOP}/admin/api/`);
    expect(url).toContain('/graphql.json');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Shopify-Access-Token']).toBe(TOKEN);
  });

  it('coerces body.errors STRING (Shopify reverse-proxy variant) into a usable message — the original panel bug', async () => {
    // Reproduces the bug where Shopify (or its edge proxy) returns
    // `errors` as a single string instead of an array. The old impl
    // called .map() on it and crashed. The fix wraps in [errors] when
    // it's not already an array.
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      errors: 'Invalid API key or access token (unrecognized login or wrong password).',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await createAppSubscription(SHOP, TOKEN, RETURN_URL, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('graphql');
      expect(result.message).toContain('Invalid API key');
    }
  });

  it('coerces body.errors single OBJECT (non-array spec variant) into a usable message', async () => {
    // Same defensive coercion — sometimes Shopify returns a single
    // error object instead of an array of error objects.
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      errors: { message: 'Throttled. Please retry.' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await createAppSubscription(SHOP, TOKEN, RETURN_URL, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('graphql');
      expect(result.message).toContain('Throttled');
    }
  });

  it('returns ok=false with stage=graphql when userErrors is populated', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appSubscriptionCreate: {
          appSubscription: null,
          confirmationUrl: null,
          userErrors: [{ field: ['lineItems', '0', 'plan'], message: 'Price must be positive' }],
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await createAppSubscription(SHOP, TOKEN, RETURN_URL, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('graphql');
      expect(result.message).toContain('Price must be positive');
    }
  });

  it('returns ok=false with stage=network when fetch throws', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await createAppSubscription(SHOP, TOKEN, RETURN_URL, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('network');
      expect(result.message).toContain('Failed to fetch');
    }
  });

  it('returns ok=false with stage=response on non-JSON body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('<!doctype html><h1>502</h1>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    }));

    const result = await createAppSubscription(SHOP, TOKEN, RETURN_URL, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('response');
    }
  });
});
