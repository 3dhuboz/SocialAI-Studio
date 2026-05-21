// Shopify auth primitives — HMAC verification + session token (JWT) validation.
//
// Why this lives in lib/ instead of routes/shopify-oauth.ts:
// the route file is the thin glue layer; the cryptographic primitives are
// what we'll want to unit-test against vectors. Keep them pure (no Env, no
// D1) so the tests don't need to fake bindings.
//
// Shopify's three HMAC surfaces, all SHA-256 with the API secret as the key:
//   1. OAuth callback     — query-string HMAC (hex-encoded), excludes `hmac`+`signature` params
//   2. Inbound webhooks   — body HMAC (base64-encoded), header X-Shopify-Hmac-Sha256
//   3. Session tokens     — JWT signed HS256 with the API secret
//
// All comparisons are timing-safe. All decode failures return false/null
// rather than throwing — the route handlers convert that into a 401/400.

// ── Web Crypto helpers ─────────────────────────────────────────────────────

async function hmacSha256(secret: string, message: string | Uint8Array): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = typeof message === 'string' ? enc.encode(message) : message;
  return crypto.subtle.sign('HMAC', key, data);
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64UrlDecode(s: string): string {
  // URL-safe base64 → standard base64 + padding, then atob.
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return atob(padded);
}

// Timing-safe string comparison — short-circuit-free, equal-length check up
// front. Used for HMAC + JWT signature checks. Strings only (we encode the
// expected value to the same shape as the received value before calling).
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Shop domain sanitizer ──────────────────────────────────────────────────
// Every Shopify request is parameterized by a `shop` field. We must validate
// it before using it anywhere — both because Shopify's review process tests
// for this AND because we use the value to construct outbound API URLs.
//
// Valid shapes:
//   acme-co.myshopify.com        → returned as-is
//   acme-co                      → not accepted (must include the suffix)
//   ACME-CO.MYSHOPIFY.COM        → lower-cased, returned
// Anything else returns null. The route handler converts null into a 400.
// Subdomain length is capped at 60 chars to align with Shopify's spec and
// reject pathological-length inputs (DNS allows 63, Shopify enforces shorter).
const SHOP_DOMAIN_REGEX = /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/;

export function sanitizeShopDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!SHOP_DOMAIN_REGEX.test(trimmed)) return null;
  return trimmed;
}

// ── OAuth callback HMAC ────────────────────────────────────────────────────
// Shopify signs the redirect URL by HMAC-SHA256'ing the alphabetically-sorted
// query string (with `hmac` and `signature` removed). The expected encoding
// is hex.
//
// CRITICAL: We MUST sign the RAW query string bytes — never the decoded
// values re-emitted from URLSearchParams. URLSearchParams.entries() returns
// decoded values, and re-encoding them is lossy: `+` vs `%20`, Unicode
// escapes, and percent-encoded characters all roundtrip in non-identity
// ways. Shopify signs the exact bytes that appeared in the redirect URL,
// so we must canonicalize off those exact bytes too.
//
// The caller passes the raw query string with the leading `?` stripped
// (e.g. `new URL(c.req.url).search.slice(1)`). We split on `&`, drop the
// pairs starting with `hmac=` or `signature=`, lexically sort the remaining
// raw `k=v` strings, join with `&`, HMAC, and hex-compare to the value of
// the `hmac` param.
export async function verifyOauthHmac(
  searchString: string,
  secret: string,
): Promise<boolean> {
  if (!searchString) return false;

  // Split on `&`. Each segment is a raw `k=v` (or just `k`) — DO NOT decode.
  const segments = searchString.split('&');

  // Find the received hmac (we need the decoded value of just this param to
  // compare against our hex digest). Use the FIRST occurrence — duplicates
  // would be a malformed signed message anyway.
  let received: string | null = null;
  for (const seg of segments) {
    if (seg.startsWith('hmac=')) {
      try {
        received = decodeURIComponent(seg.slice(5));
      } catch {
        return false;
      }
      break;
    }
  }
  if (!received) return false;

  // Drop hmac + legacy signature from the canonical message. Keep every
  // other segment exactly as it appeared on the wire.
  const signedPairs = segments.filter(
    (seg) => !seg.startsWith('hmac=') && !seg.startsWith('signature='),
  );

  // Sort the raw `k=v` strings lexically (as strings, not by key). Shopify's
  // documented behaviour is "sort the parameters alphabetically"; sorting the
  // raw string yields the same order as sorting by key for well-formed
  // queries, and is the safe choice when keys repeat or contain `=`.
  signedPairs.sort();

  const message = signedPairs.join('&');
  const sig = await hmacSha256(secret, message);
  const expectedHex = bufferToHex(sig);
  return timingSafeEqual(received.toLowerCase(), expectedHex.toLowerCase());
}

// ── Webhook body HMAC ──────────────────────────────────────────────────────
// Inbound webhooks ship the HMAC in the X-Shopify-Hmac-Sha256 header,
// base64-encoded. The signed payload is the raw request body bytes — NOT
// the parsed JSON. The route handler MUST read the body as text/ArrayBuffer
// and pass those bytes here.
export async function verifyWebhookHmac(
  rawBody: string | Uint8Array,
  headerHmac: string | null,
  secret: string,
): Promise<boolean> {
  if (!headerHmac) return false;
  const sig = await hmacSha256(secret, rawBody);
  const expectedB64 = bufferToBase64(sig);
  return timingSafeEqual(headerHmac, expectedB64);
}

// ── Session token (JWT) validation ─────────────────────────────────────────
// App Bridge mints session tokens — JWTs signed HS256 with the app's API
// secret. Every request from the embedded app carries one in the
// Authorization: Bearer <token> header. Validation per Shopify docs:
//   * signature: HS256 with API secret
//   * aud: must equal SHOPIFY_API_KEY
//   * iss / dest: must be the same Shopify shop URL
//   * exp: not expired (with small clock skew tolerance)
//   * nbf: not-before satisfied
// The shop domain we return comes from `dest`, e.g. https://acme.myshopify.com
// → we extract the hostname.

export interface SessionTokenPayload {
  iss: string;        // shop admin URL, e.g. https://acme.myshopify.com/admin
  dest: string;       // shop URL, e.g. https://acme.myshopify.com
  aud: string;        // app's API key
  sub: string;        // shop user id (numeric)
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid: string;
}

export interface VerifiedSession {
  payload: SessionTokenPayload;
  shopDomain: string; // sanitized, e.g. "acme.myshopify.com"
}

const CLOCK_SKEW_SECONDS = 5;

export async function verifySessionToken(
  token: string,
  apiKey: string,
  secret: string,
): Promise<VerifiedSession | null> {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  // Verify header alg is HS256 (defense-in-depth — Shopify always uses HS256).
  let header: { alg?: string; typ?: string };
  try { header = JSON.parse(base64UrlDecode(headerB64)); } catch { return null; }
  if (header.alg !== 'HS256') return null;

  // Verify signature.
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await hmacSha256(secret, signingInput);
  const expectedSigB64Url = bufferToBase64(sig)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (!timingSafeEqual(sigB64, expectedSigB64Url)) return null;

  // Decode + validate payload claims.
  let payload: SessionTokenPayload;
  try { payload = JSON.parse(base64UrlDecode(payloadB64)); } catch { return null; }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || now > payload.exp + CLOCK_SKEW_SECONDS) return null;
  if (typeof payload.nbf !== 'number' || now < payload.nbf - CLOCK_SKEW_SECONDS) return null;
  if (payload.aud !== apiKey) return null;
  if (typeof payload.dest !== 'string' || typeof payload.iss !== 'string') return null;

  // iss and dest must share the same hostname (Shopify's anti-spoofing check).
  let destUrl: URL, issUrl: URL;
  try { destUrl = new URL(payload.dest); issUrl = new URL(payload.iss); } catch { return null; }
  if (destUrl.hostname !== issUrl.hostname) return null;
  // Both claims MUST be https — defense against `http://evil.myshopify.com`
  // payloads (which would otherwise pass the host check). Shopify always
  // issues https URLs in iss/dest.
  if (destUrl.protocol !== 'https:' || issUrl.protocol !== 'https:') return null;

  const shopDomain = sanitizeShopDomain(destUrl.hostname);
  if (!shopDomain) return null;

  return { payload, shopDomain };
}

// ── Random helpers ────────────────────────────────────────────────────────
// Cryptographically random URL-safe token — used for OAuth state and any
// other one-shot nonces we generate.
export function randomToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
