/**
 * Shared test fixtures for Shopify-related tests.
 *
 * All crypto here goes through Web Crypto (crypto.subtle.*) so the fixtures
 * are byte-for-byte identical to what shopify-auth.ts produces in
 * production — there's no second implementation to drift.
 *
 * Importable from any test file under workers/api/src.
 *
 * Note: `makeJwt` is duplicated in shopify-auth.test.ts (another agent's
 * file). When that file is next refactored, drop its local copy and import
 * this one instead.
 */

/** Base64 (standard, padded) HMAC-SHA256. Matches the wire format for
 *  Shopify webhook X-Shopify-Hmac-Sha256 header. */
export async function hmacB64(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Lowercase hex HMAC-SHA256. Matches Shopify's OAuth callback HMAC
 *  encoding (query-string `hmac=` param). */
export async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export interface WebhookHeadersInput {
  shop: string;
  body: string;
  secret: string;
  webhookId?: string;
  topic?: string;
}

/**
 * Build the standard set of Shopify webhook headers for `body`, signed with
 * `secret`. Returns a real Headers object so it drops straight into a
 * `new Request(url, { headers })` call.
 *
 * X-Shopify-Hmac-Sha256 is base64(HMAC-SHA256(body, secret)) — the exact
 * shape verifyWebhookHmac() expects from the request.
 */
export async function buildWebhookHeaders(input: WebhookHeadersInput): Promise<Headers> {
  const hmac = await hmacB64(input.secret, input.body);
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Shopify-Hmac-Sha256': hmac,
    'X-Shopify-Shop-Domain': input.shop,
    'X-Shopify-Webhook-Id': input.webhookId ?? `wh-${Math.random().toString(36).slice(2)}`,
    'X-Shopify-Topic': input.topic ?? 'app/uninstalled',
  });
  return headers;
}

// ── JWT helpers (HS256, for Shopify session tokens) ───────────────────────
//
// Shopify session tokens are HS256 JWTs signed with the app's API secret.
// `makeJwt` produces a token whose signature verifySessionToken() will
// accept, so tests can mint valid (and deliberately invalid) tokens
// without depending on App Bridge.

function base64url(input: string | object): string {
  const s = typeof input === 'string' ? input : JSON.stringify(input);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function makeJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url(payload);
  const signingInput = `${header}.${body}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const sigB64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${signingInput}.${sigB64}`;
}
