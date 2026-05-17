// PennyBuilder ↔ SocialAI Studio embed-token HMAC handshake.
//
// PennyBuilder's iframe in the Builder loads SocialAI Studio's /embed
// endpoint with a short-lived (5-minute) HMAC-signed token in the query
// string. We verify the token, mint a Clerk sign-in ticket for the
// claimed user, and 302 the iframe at /sign-in so the parent frame
// signs them in transparently.
//
// Token format: `base64url(payload).base64url(HMAC-SHA256(payload))`
// where payload is a JSON object with sub / exp / iat / aud / iss fields.
//
// This file is the SocialAI side of the contract. The signing side
// currently lives in PennyBuilder's `pennybuilder/src/api/lib/socialai.ts`
// (`buildEmbedUrl`). A reasonable follow-up is to publish `mintEmbedToken`
// as the shared shape PB imports too, so both repos can't drift in
// base64url padding / HMAC encoding / exp-unit assumptions.
//
// A regression in any of: base64url padding, HMAC encoding, or exp
// comparison means either an attacker can mint tokens the verifier
// accepts (impersonation) — or legit tokens fail (production breakage).
// See workers/api/src/lib/__tests__/embed-token.test.ts.

export type EmbedClaims = {
  sub: string;
  email?: string;
  name?: string;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
};

/**
 * Compute HMAC-SHA256(message) under `secret` and return the result
 * base64url-encoded (RFC 4648 §5) WITHOUT trailing `=` padding.
 *
 * Both sides of the handshake must use the same encoding — the token
 * format is a literal `.`-separated concat of base64url payload and
 * base64url signature, so trailing `=` would put a stray char into the
 * `split('.')` parse.
 */
export async function hmacB64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64url-encode a JSON-serialisable object the same way the PB side
 * does it: UTF-8 JSON → bytes → base64 → `+/=` → `-_` strip.
 */
function b64urlEncodeJSON(payload: unknown): string {
  const json = JSON.stringify(payload);
  // btoa() takes a binary string, so feed it the UTF-8 bytes one char at a time.
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mint an embed token. Counterpart of `verifyEmbedToken` below — given the
 * same `secret`, the produced token will roundtrip back to the input claims.
 *
 * This lives in the SocialAI repo (the verifier side) for two reasons:
 *  1. It lets the verifier roundtrip-test itself against its own minter,
 *     catching base64url / HMAC / encoding drift the moment it happens.
 *  2. It defines a single canonical contract shape both sides can refer to —
 *     PennyBuilder's `pennybuilder/src/api/lib/socialai.ts:buildEmbedUrl`
 *     should import from this module in a follow-up so the two repos can
 *     never drift independently.
 */
export async function mintEmbedToken(secret: string, claims: EmbedClaims): Promise<string> {
  const payload = b64urlEncodeJSON(claims);
  const sig = await hmacB64(secret, payload);
  return `${payload}.${sig}`;
}

/**
 * Verify an embed token. Returns the claims on success, `null` on any
 * tamper / expiry / encoding error. Side-effect free.
 *
 * `null` covers: missing or extra `.` separator, signature mismatch
 * (timing-safe), payload not valid base64url or not valid JSON,
 * exp missing or not a number, exp in the past.
 */
export async function verifyEmbedToken(secret: string, token: string): Promise<EmbedClaims | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = await hmacB64(secret, payload);
  // Timing-safe compare so we don't leak signature byte-by-byte via
  // response timing. Lengths first to short-circuit the obviously-bad case.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const raw = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(raw) as EmbedClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
