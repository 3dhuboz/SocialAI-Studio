/**
 * Unit tests for lib/shopify-auth.ts — the cryptographic primitives that
 * gate the entire Shopify install loop. These are the highest-stakes
 * functions in Phase 1: a bug here means either we reject legit traffic
 * (false negatives → broken installs) or we accept spoofed requests
 * (false positives → security incident, App Store rejection).
 *
 * Run from repo root: `npm test`. Vitest picks up *.test.ts globally.
 *
 * All crypto is done with Web Crypto API (crypto.subtle.*), which is
 * available globally in Node 18+ and in vitest's default environment.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeShopDomain,
  timingSafeEqual,
  randomToken,
  verifyOauthHmac,
  verifyWebhookHmac,
  verifySessionToken,
} from '../shopify-auth';

// ── Test fixtures ─────────────────────────────────────────────────────────

const TEST_SECRET = 'hush_test_secret_42';
const TEST_API_KEY = 'test_api_key_abc123';
const TEST_SHOP = 'test-shop.myshopify.com';

async function hmacB64(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  const bytes = new Uint8Array(sig);
  let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  const bytes = new Uint8Array(sig);
  let hex = ''; for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function base64url(input: string | object): string {
  const s = typeof input === 'string' ? input : JSON.stringify(input);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url(payload);
  const signingInput = `${header}.${body}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  const bytes = new Uint8Array(sig);
  let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const sigB64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${signingInput}.${sigB64}`;
}

function validSessionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `https://${TEST_SHOP}/admin`,
    dest: `https://${TEST_SHOP}`,
    aud: TEST_API_KEY,
    sub: '12345',
    exp: now + 60,
    nbf: now - 5,
    iat: now,
    jti: 'jti-test',
    sid: 'sid-test',
    ...overrides,
  };
}

// ── sanitizeShopDomain ────────────────────────────────────────────────────

describe('sanitizeShopDomain', () => {
  const valid: Array<[string, string]> = [
    ['acme-co.myshopify.com', 'acme-co.myshopify.com'],
    ['ACME-CO.MYSHOPIFY.COM', 'acme-co.myshopify.com'],
    ['  acme-co.myshopify.com  ', 'acme-co.myshopify.com'],
    ['shop123.myshopify.com', 'shop123.myshopify.com'],
  ];
  it.each(valid)('accepts valid shop %s', (input: string, expected: string) => {
    expect(sanitizeShopDomain(input)).toBe(expected);
  });

  const invalid: Array<[string | null | undefined]> = [
    [''],
    [null],
    [undefined],
    ['acme-co'],                          // missing suffix
    ['acme-co.shopify.com'],              // wrong tld
    ['acme-co.myshopify.com.evil.com'],   // suffix-spoof
    ['evil.com/acme-co.myshopify.com'],   // path injection
    ['-acme.myshopify.com'],              // leading hyphen
    ['acme..myshopify.com'],              // double dot
    ['ac me.myshopify.com'],              // space
    ['acme.myshopify.co'],                // tld typo
    ['javascript:alert.myshopify.com'],   // colon
  ];
  it.each(invalid)('rejects invalid input %s', (input: string | null | undefined) => {
    expect(sanitizeShopDomain(input)).toBeNull();
  });

  it('rejects subdomain longer than 60 chars (pathological length)', () => {
    // 80 chars in subdomain — well beyond Shopify's spec, would also be a
    // useful surface for DoS / pathological regex inputs. The regex caps at
    // 60 (1 + 59).
    const longSub = 'a'.repeat(80);
    expect(sanitizeShopDomain(`${longSub}.myshopify.com`)).toBeNull();
  });

  it('accepts subdomain at the 60-char boundary', () => {
    const sub60 = 'a'.repeat(60);
    expect(sanitizeShopDomain(`${sub60}.myshopify.com`)).toBe(`${sub60}.myshopify.com`);
  });
});

// ── timingSafeEqual ───────────────────────────────────────────────────────

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('hello', 'hello')).toBe(true);
  });
  it('returns false for different strings of equal length', () => {
    expect(timingSafeEqual('hello', 'world')).toBe(false);
  });
  it('returns false for strings of different length', () => {
    expect(timingSafeEqual('hello', 'helloo')).toBe(false);
  });
  it('returns true for two empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

// ── randomToken ───────────────────────────────────────────────────────────

describe('randomToken', () => {
  it('produces URL-safe characters only', () => {
    const t = randomToken(24);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('produces distinct values across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(randomToken(24));
    expect(seen.size).toBe(50);
  });
  it('respects byte length (24 bytes → 32 chars b64url)', () => {
    expect(randomToken(24).length).toBe(32);
  });
});

// ── verifyOauthHmac ───────────────────────────────────────────────────────

describe('verifyOauthHmac', () => {
  // Helper: given a set of raw `k=v` pairs (already-encoded as they would
  // appear on the wire), build the canonical signed string, sign it, and
  // return the full query string with the hmac appended.
  async function signRawPairs(pairs: string[], secret: string): Promise<string> {
    const sorted = [...pairs].sort();
    const message = sorted.join('&');
    const hmac = await hmacHex(secret, message);
    return [...pairs, `hmac=${hmac}`].join('&');
  }

  it('accepts a valid HMAC over a sorted query string', async () => {
    const pairs = [
      `shop=${TEST_SHOP}`,
      'code=authcode123',
      'state=abc',
      'timestamp=1700000000',
    ];
    const search = await signRawPairs(pairs, TEST_SECRET);
    expect(await verifyOauthHmac(search, TEST_SECRET)).toBe(true);
  });

  it('rejects when hmac is missing', async () => {
    const search = `shop=${TEST_SHOP}`;
    expect(await verifyOauthHmac(search, TEST_SECRET)).toBe(false);
  });

  it('rejects when hmac is tampered (one char changed)', async () => {
    const pairs = [`shop=${TEST_SHOP}`, 'code=authcode123'];
    const search = await signRawPairs(pairs, TEST_SECRET);
    // Flip the last hex char of the hmac value.
    const last = search.slice(-1);
    const flipped = last === '0' ? '1' : '0';
    const tampered = search.slice(0, -1) + flipped;
    expect(await verifyOauthHmac(tampered, TEST_SECRET)).toBe(false);
  });

  it('rejects when wrong secret is used', async () => {
    const pairs = [`shop=${TEST_SHOP}`];
    const message = pairs.join('&');
    const hmac = await hmacHex('wrong_secret', message);
    const search = `${pairs.join('&')}&hmac=${hmac}`;
    expect(await verifyOauthHmac(search, TEST_SECRET)).toBe(false);
  });

  it('excludes hmac and signature from the signed payload', async () => {
    // The signed message must not include the hmac param itself or the
    // legacy `signature` param. Build a message WITHOUT them, sign, then
    // confirm including a different `signature` value still verifies.
    const pairs = [`shop=${TEST_SHOP}`, 'code=authcode'];
    const search = await signRawPairs(pairs, TEST_SECRET) + '&signature=arbitrary_legacy_value';
    expect(await verifyOauthHmac(search, TEST_SECRET)).toBe(true);
  });

  it('accepts value containing `+` (URL-encoded as %2B)', async () => {
    // `+` in the raw query is meaningful — URLSearchParams.entries() would
    // decode it to a space, breaking the signature roundtrip. With the raw-
    // string canonicalization we sign the literal `%2B` bytes.
    const pairs = ['shop=ac%2Bme.myshopify.com', 'code=foo'];
    const search = await signRawPairs(pairs, TEST_SECRET);
    expect(await verifyOauthHmac(search, TEST_SECRET)).toBe(true);
  });

  it('accepts value containing literal space encoded as %20', async () => {
    // `%20` (literal space) and `+` (space-in-query) are encoded differently
    // on the wire — both must roundtrip through HMAC verification untouched.
    const pairs = ['shop=test.myshopify.com', 'state=abc%20def'];
    const search = await signRawPairs(pairs, TEST_SECRET);
    expect(await verifyOauthHmac(search, TEST_SECRET)).toBe(true);
  });

  it('accepts Unicode value (percent-encoded UTF-8)', async () => {
    // `café` → UTF-8 bytes 63 61 66 c3 a9 → percent-encoded as caf%C3%A9.
    // The signature is over the raw encoded bytes; the verifier must NOT
    // decode and re-encode (which can change case of hex digits).
    const pairs = ['shop=test.myshopify.com', 'state=caf%C3%A9'];
    const search = await signRawPairs(pairs, TEST_SECRET);
    expect(await verifyOauthHmac(search, TEST_SECRET)).toBe(true);
  });

  it('rejects tampered signed message when one query param value is altered', async () => {
    // Sign a message, then mutate one of the signed values (not the hmac).
    // The hmac must no longer verify.
    const pairs = [`shop=${TEST_SHOP}`, 'code=authcode123', 'state=original'];
    const search = await signRawPairs(pairs, TEST_SECRET);
    const tampered = search.replace('state=original', 'state=altered');
    expect(await verifyOauthHmac(tampered, TEST_SECRET)).toBe(false);
  });
});

// ── verifyWebhookHmac ─────────────────────────────────────────────────────

describe('verifyWebhookHmac', () => {
  it('accepts a valid base64 HMAC over the raw body', async () => {
    const body = '{"id":12345,"shop_domain":"test-shop.myshopify.com"}';
    const hmac = await hmacB64(TEST_SECRET, body);
    expect(await verifyWebhookHmac(body, hmac, TEST_SECRET)).toBe(true);
  });

  it('rejects when header is null', async () => {
    expect(await verifyWebhookHmac('any body', null, TEST_SECRET)).toBe(false);
  });

  it('rejects when body has been tampered with', async () => {
    const original = '{"id":12345}';
    const tampered = '{"id":99999}';
    const hmac = await hmacB64(TEST_SECRET, original);
    expect(await verifyWebhookHmac(tampered, hmac, TEST_SECRET)).toBe(false);
  });

  it('rejects when signed with a different secret', async () => {
    const body = '{"id":1}';
    const hmac = await hmacB64('other_secret', body);
    expect(await verifyWebhookHmac(body, hmac, TEST_SECRET)).toBe(false);
  });
});

// ── verifySessionToken ────────────────────────────────────────────────────

describe('verifySessionToken', () => {
  it('accepts a freshly-minted, well-formed token', async () => {
    const jwt = await makeJwt(validSessionPayload(), TEST_SECRET);
    const result = await verifySessionToken(jwt, TEST_API_KEY, TEST_SECRET);
    expect(result).not.toBeNull();
    expect(result?.shopDomain).toBe(TEST_SHOP);
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const jwt = await makeJwt(validSessionPayload({ exp: past, iat: past - 60, nbf: past - 60 }), TEST_SECRET);
    expect(await verifySessionToken(jwt, TEST_API_KEY, TEST_SECRET)).toBeNull();
  });

  it('rejects a not-yet-valid (nbf in future) token', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const jwt = await makeJwt(validSessionPayload({ nbf: future }), TEST_SECRET);
    expect(await verifySessionToken(jwt, TEST_API_KEY, TEST_SECRET)).toBeNull();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const jwt = await makeJwt(validSessionPayload(), 'attacker_secret');
    expect(await verifySessionToken(jwt, TEST_API_KEY, TEST_SECRET)).toBeNull();
  });

  it('rejects a token with mismatched audience', async () => {
    const jwt = await makeJwt(validSessionPayload({ aud: 'different_app_key' }), TEST_SECRET);
    expect(await verifySessionToken(jwt, TEST_API_KEY, TEST_SECRET)).toBeNull();
  });

  it('rejects a token with iss host different from dest host (spoof guard)', async () => {
    const jwt = await makeJwt(
      validSessionPayload({
        iss: 'https://attacker.myshopify.com/admin',
        dest: `https://${TEST_SHOP}`,
      }),
      TEST_SECRET,
    );
    expect(await verifySessionToken(jwt, TEST_API_KEY, TEST_SECRET)).toBeNull();
  });

  it('rejects a token whose dest is not a *.myshopify.com host', async () => {
    const jwt = await makeJwt(
      validSessionPayload({
        iss: 'https://evil.com/admin',
        dest: 'https://evil.com',
      }),
      TEST_SECRET,
    );
    expect(await verifySessionToken(jwt, TEST_API_KEY, TEST_SECRET)).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifySessionToken('', TEST_API_KEY, TEST_SECRET)).toBeNull();
    expect(await verifySessionToken('not.a.jwt.extra', TEST_API_KEY, TEST_SECRET)).toBeNull();
    expect(await verifySessionToken('only.two', TEST_API_KEY, TEST_SECRET)).toBeNull();
    expect(await verifySessionToken('a.b.c', TEST_API_KEY, TEST_SECRET)).toBeNull();
  });

  it('rejects a token whose dest uses http:// (must be https)', async () => {
    // Defense against `http://evil.myshopify.com` claims — Shopify always
    // issues https URLs in iss/dest. An http claim would otherwise pass the
    // hostname-equality check and the sanitize check (which only looks at
    // the hostname, not the protocol).
    const jwt = await makeJwt(
      validSessionPayload({
        iss: `http://${TEST_SHOP}/admin`,
        dest: `http://${TEST_SHOP}`,
      }),
      TEST_SECRET,
    );
    expect(await verifySessionToken(jwt, TEST_API_KEY, TEST_SECRET)).toBeNull();
  });

  it('rejects a token with alg = none (algorithm-confusion guard)', async () => {
    // Build a token whose header claims alg=none. Our verifier must reject
    // anything that isn't HS256, regardless of whether the signature would
    // theoretically verify.
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const body = base64url(validSessionPayload());
    const jwt = `${header}.${body}.`;
    expect(await verifySessionToken(jwt, TEST_API_KEY, TEST_SECRET)).toBeNull();
  });
});
