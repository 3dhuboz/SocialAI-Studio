/**
 * PennyBuilder ↔ SocialAI embed-token HMAC handshake tests.
 *
 * The token format is `base64url(payload).base64url(HMAC-SHA256(payload))`.
 * A regression in any of: base64url padding, HMAC encoding, or exp
 * comparison means EITHER:
 *   - an attacker can mint tokens the verifier accepts (impersonation), OR
 *   - legit PennyBuilder tokens fail verification (production breakage).
 *
 * Run with: `npm test`. Cross-repo parity with PennyBuilder's
 * `pennybuilder/src/api/lib/socialai.ts:buildEmbedUrl` is a follow-up —
 * see lib/embed-token.ts for the canonical contract shape.
 */
import { describe, it, expect } from 'vitest';
import {
  mintEmbedToken,
  verifyEmbedToken,
  type EmbedClaims,
} from '../embed-token';

const SECRET = 'test-pennybuilder-provision-secret-' + 'x'.repeat(32);
const WRONG_SECRET = 'test-pennybuilder-provision-secret-' + 'y'.repeat(32);

function freshClaims(overrides: Partial<EmbedClaims> = {}): EmbedClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'user_2abc123def456',
    email: 'buyer@example.com',
    name: 'Alex Buyer',
    aud: 'socialai-studio',
    iss: 'pennybuilder',
    iat: now,
    exp: now + 300, // 5 minutes — the production TTL
    ...overrides,
  };
}

describe('verifyEmbedToken — roundtrip', () => {
  it('mintEmbedToken → verifyEmbedToken returns the original claims', async () => {
    const claims = freshClaims();
    const token = await mintEmbedToken(SECRET, claims);

    // Token shape sanity — `payload.sig` with both base64url segments.
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token.split('.')).toHaveLength(2);

    const verified = await verifyEmbedToken(SECRET, token);
    expect(verified).not.toBeNull();
    expect(verified).toEqual(claims);
  });

  it('roundtrips claims with omitted optional fields', async () => {
    // PB tokens can ship without `email`/`name` (e.g. for a one-shot
    // service-account sub). The verifier must roundtrip the JSON-stringified
    // shape exactly — undefined fields drop, others survive.
    const claims = freshClaims({ email: undefined, name: undefined });
    const token = await mintEmbedToken(SECRET, claims);
    const verified = await verifyEmbedToken(SECRET, token);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe(claims.sub);
    expect(verified?.exp).toBe(claims.exp);
    expect(verified?.email).toBeUndefined();
    expect(verified?.name).toBeUndefined();
  });
});

describe('verifyEmbedToken — rejection cases', () => {
  it('returns null for a tampered signature (one char flipped)', async () => {
    const token = await mintEmbedToken(SECRET, freshClaims());
    const [payload, sig] = token.split('.');
    // Flip one char of the sig — pick a char NOT in the original alphabet
    // position so it actually differs. base64url uses A-Za-z0-9_-; pick a
    // char and replace it with a guaranteed different one.
    const flipped =
      (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(flipped).not.toBe(sig);
    const tampered = `${payload}.${flipped}`;

    const verified = await verifyEmbedToken(SECRET, tampered);
    expect(verified).toBeNull();
  });

  it('returns null for a tampered payload (sig no longer matches)', async () => {
    // If an attacker swaps the payload (e.g. to change `sub` to a victim's
    // user id), the HMAC over the new payload won't match the old sig.
    const goodToken = await mintEmbedToken(SECRET, freshClaims({ sub: 'user_attacker' }));
    const evilToken = await mintEmbedToken(SECRET, freshClaims({ sub: 'user_victim' }));
    const [evilPayload] = evilToken.split('.');
    const [, goodSig] = goodToken.split('.');
    const forged = `${evilPayload}.${goodSig}`;

    const verified = await verifyEmbedToken(SECRET, forged);
    expect(verified).toBeNull();
  });

  it('returns null for an expired token (exp in the past)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mintEmbedToken(SECRET, freshClaims({ exp: now - 1 }));
    const verified = await verifyEmbedToken(SECRET, token);
    expect(verified).toBeNull();
  });

  it('returns null when verified under the wrong secret', async () => {
    const token = await mintEmbedToken(SECRET, freshClaims());
    const verified = await verifyEmbedToken(WRONG_SECRET, token);
    expect(verified).toBeNull();
  });

  it('returns null for a malformed token (missing `.` separator)', async () => {
    expect(await verifyEmbedToken(SECRET, 'no-dot-anywhere')).toBeNull();
    expect(await verifyEmbedToken(SECRET, '')).toBeNull();
    expect(await verifyEmbedToken(SECRET, '.')).toBeNull();
    expect(await verifyEmbedToken(SECRET, 'onlypayload.')).toBeNull();
    expect(await verifyEmbedToken(SECRET, '.onlysig')).toBeNull();
  });

  it('returns null when the payload section is not valid base64 / JSON', async () => {
    // Compute a real signature over the garbage payload so we get past
    // the HMAC check and exercise the JSON.parse catch branch.
    const badPayload = '!!!not-base64!!!';
    // Use the same hmacB64 indirectly via mintEmbedToken — we can't import
    // the private helper, but we can sign by re-using mintEmbedToken on
    // a payload we know will base64-decode to garbage. Instead, build the
    // token manually using the public mint as a known-good signer.
    //
    // Cheat: take a real token, then replace the payload with `xxx` and
    // re-sign the new payload. We do this by re-using verifyEmbedToken's
    // logic that only proceeds past sig check if hmac matches.
    //
    // Simpler approach: mint a real token, then swap in a payload that
    // base64-decodes to a non-JSON string. We need the sig to match, so
    // mint two tokens with payloads of the same length and splice.
    // Easier: directly construct via the lib.
    const { mintEmbedToken: mint, verifyEmbedToken: verify } = await import('../embed-token');
    // Mint a fresh token, then replace the payload portion with one that
    // decodes to non-JSON. We re-sign by minting a *garbage claims object*
    // and using its signed token — but we want to test the JSON-parse
    // failure, so just attempt verify with a known-mismatched payload —
    // even though sig check will fail first, that already returns null,
    // which is what we want for malformed payloads (covered above).
    //
    // Specific JSON-parse coverage: craft a payload that DOES base64-decode
    // (so atob() succeeds) but to a non-JSON string. Compute the real
    // HMAC over that payload using mint().
    void mint; void verify; // satisfy unused-import linter

    // Build a payload that base64url-decodes to the literal string 'NOT JSON'.
    const rawBytes = new TextEncoder().encode('NOT JSON');
    let bin = '';
    for (let i = 0; i < rawBytes.byteLength; i++) bin += String.fromCharCode(rawBytes[i]);
    const payload = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // To get a real signature over this payload, we'd need access to hmacB64.
    // It's not exported (private to lib), so re-derive it using crypto.subtle
    // the same way the lib does. This couples the test to the implementation
    // slightly, but the point of this test is exactly to exercise the
    // JSON.parse-fail branch — which requires bypassing the sig check.
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const sigBytes = new Uint8Array(sigBuf);
    let sigBin = '';
    for (let i = 0; i < sigBytes.byteLength; i++) sigBin += String.fromCharCode(sigBytes[i]);
    const sig = btoa(sigBin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const token = `${payload}.${sig}`;
    expect(await verifyEmbedToken(SECRET, token)).toBeNull();

    // Sanity: also test a payload that is not even valid base64 — covered
    // above by the sig-mismatch path, but assert directly that the lib
    // doesn't throw and just returns null.
    expect(await verifyEmbedToken(SECRET, `${badPayload}.${sig}`)).toBeNull();
  });

  it('returns null when exp is not a number (string, undefined, NaN)', async () => {
    // Mint via the lib's normal path but with claims that have non-numeric
    // exp. TypeScript will complain unless we cast — the runtime check is
    // what we're testing.
    const baseClaims = freshClaims();

    // exp as string
    const tokenStringExp = await mintEmbedToken(
      SECRET,
      { ...baseClaims, exp: '9999999999' as unknown as number },
    );
    expect(await verifyEmbedToken(SECRET, tokenStringExp)).toBeNull();

    // exp missing entirely
    const { exp: _omitExp, ...claimsNoExp } = baseClaims;
    void _omitExp;
    const tokenNoExp = await mintEmbedToken(
      SECRET,
      claimsNoExp as unknown as EmbedClaims,
    );
    expect(await verifyEmbedToken(SECRET, tokenNoExp)).toBeNull();

    // exp as null
    const tokenNullExp = await mintEmbedToken(
      SECRET,
      { ...baseClaims, exp: null as unknown as number },
    );
    expect(await verifyEmbedToken(SECRET, tokenNullExp)).toBeNull();
  });
});
