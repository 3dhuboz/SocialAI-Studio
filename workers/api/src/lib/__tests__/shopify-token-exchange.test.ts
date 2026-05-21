/**
 * Unit tests for lib/shopify-token-exchange.ts — the App Bridge session
 * token → expiring offline access token exchange.
 *
 * Why this matters: as of late 2025, Shopify rejects the legacy
 * "non-expiring" offline tokens from every Admin API call. The only way
 * to get a token that actually works is to hit /admin/oauth/access_token
 * with the `expiring=1` query flag AND `client_secret` in the body. Get
 * either wrong and we still get a 200 + valid-looking token, but the
 * token immediately 401s on the next Admin API call. The bug surfaces as
 * "OAuth succeeded but the app is completely broken".
 *
 * These tests pin both invariants directly against the request shape.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exchangeSessionToken } from '../shopify-token-exchange';

const SHOP = 'test-shop.myshopify.com';
const SESSION_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.fake.session';
const CLIENT_ID = 'shopify_client_id_abc';
const CLIENT_SECRET = 'shopify_client_secret_xyz';

describe('exchangeSessionToken', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('includes expiring=1 in the URL — without this Shopify returns legacy non-functional tokens', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'shpat_offline_token',
      scope: 'read_products',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await exchangeSessionToken(SHOP, SESSION_TOKEN, CLIENT_ID, CLIENT_SECRET);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`https://${SHOP}/admin/oauth/access_token`);
    expect(url).toContain('expiring=1');
  });

  it('POSTs client_secret in the JSON body — never as a query string parameter', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'shpat_offline_token',
      scope: 'read_products',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await exchangeSessionToken(SHOP, SESSION_TOKEN, CLIENT_ID, CLIENT_SECRET);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

    // Secret MUST NOT appear in the URL (would log into CF + Shopify edge).
    expect(url).not.toContain(CLIENT_SECRET);

    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.client_id).toBe(CLIENT_ID);
    expect(body.client_secret).toBe(CLIENT_SECRET);
    expect(body.subject_token).toBe(SESSION_TOKEN);
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body.subject_token_type).toBe('urn:ietf:params:oauth:token-type:id_token');
    expect(body.requested_token_type).toBe('urn:shopify:params:oauth:token-type:offline-access-token');
  });

  it('requests the online-access-token type when kind="online"', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'shpat_online_token',
      scope: 'read_products',
      expires_in: 86400,
      associated_user: { id: 1 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await exchangeSessionToken(SHOP, SESSION_TOKEN, CLIENT_ID, CLIENT_SECRET, 'online');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.requested_token_type).toBe('urn:shopify:params:oauth:token-type:online-access-token');
  });

  it('returns {ok: true, accessToken, scope} on a 200 success response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'shpat_offline_token_123',
      scope: 'read_products,write_orders',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await exchangeSessionToken(SHOP, SESSION_TOKEN, CLIENT_ID, CLIENT_SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessToken).toBe('shpat_offline_token_123');
      expect(result.scope).toBe('read_products,write_orders');
    }
  });

  it('returns {ok: false, stage: "shopify"} on a 4xx with an error body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'invalid_subject_token',
      error_description: 'The session token has expired',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }));

    const result = await exchangeSessionToken(SHOP, SESSION_TOKEN, CLIENT_ID, CLIENT_SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('shopify');
      expect(result.status).toBe(401);
      expect(result.message).toBe('The session token has expired');
    }
  });

  it('returns {ok: false, stage: "shopify"} on 4xx falling back to body.error when description is absent', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'unauthorized_client',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

    const result = await exchangeSessionToken(SHOP, SESSION_TOKEN, CLIENT_ID, CLIENT_SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('shopify');
      expect(result.message).toBe('unauthorized_client');
    }
  });

  it('returns {ok: false, stage: "network"} when fetch throws', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Connection refused'));

    const result = await exchangeSessionToken(SHOP, SESSION_TOKEN, CLIENT_ID, CLIENT_SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('network');
      expect(result.message).toContain('Connection refused');
    }
  });

  it('returns {ok: false, stage: "response"} on missing access_token in 200 body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      scope: 'read_products',
      // access_token missing — Shopify would never do this, but guard anyway.
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await exchangeSessionToken(SHOP, SESSION_TOKEN, CLIENT_ID, CLIENT_SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('response');
    }
  });
});
