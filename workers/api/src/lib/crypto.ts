// Envelope encryption for D1-stored OAuth tokens. AES-GCM-256 via Web Crypto.
//
// Why this exists:
//   Shopify offline access_tokens (and any future OAuth refresh tokens) sit in
//   D1 alongside ordinary application data. If a D1 export, backup snapshot,
//   or read-only debug query ever leaks, plaintext tokens would let an
//   attacker mint API calls against every connected merchant. Encrypting the
//   tokens at rest closes that gap — the leak now also needs the master key,
//   which is held in worker secrets (a different blast radius).
//
// Master key:
//   A 32-byte (256-bit) value stored as a hex secret named
//   MASTER_ENCRYPTION_KEY in worker secrets. Generate with:
//     node -e "console.log(crypto.randomBytes(32).toString('hex'))"
//   Then:
//     npx wrangler secret put MASTER_ENCRYPTION_KEY
//
// Output format:
//   "v1:<iv_b64>:<ciphertext_b64>"
//     v1         = version tag (so we can rotate the wrapping algorithm later
//                  by introducing a v2 prefix and a key-id index)
//     iv         = 12 random bytes (96-bit nonce — AES-GCM requirement)
//     ciphertext = AES-GCM output, includes the 16-byte auth tag
//
// Plaintext-or-encrypted detector:
//   isEncrypted() checks the "v1:" prefix. decryptToken() applies the same
//   check internally and returns the input unchanged when the prefix is
//   absent — legacy plaintext tokens decrypt to themselves and are
//   re-encrypted on the next write. This keeps the rollout zero-downtime.
//
// Rotation considerations (future work):
//   1. Algorithm rotation — bump the version prefix to "v2:" and gate on it.
//      Old v1 ciphertexts can still be decrypted; new writes use v2.
//   2. Key rotation — add a key-id segment, e.g. "v1:k2:<iv>:<ct>", and ship
//      a map of key-id → hex secret. A re-encrypt cron can lazily migrate
//      v1:k1 rows to v1:k2 on read.
//   3. The current format intentionally embeds the IV (not a key-id), so the
//      smallest possible rotation step is the version-prefix bump.

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('MASTER_ENCRYPTION_KEY must be a hex string of even length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('MASTER_ENCRYPTION_KEY contains non-hex characters');
    }
    out[i] = byte;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importMasterKey(masterKeyHex: string): Promise<CryptoKey> {
  const raw = hexToBytes(masterKeyHex);
  // AES-256 requires a 32-byte raw key. Anything else and Web Crypto will
  // throw an inscrutable DataError — surface a clearer message up front.
  if (raw.length !== 32) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length}). Generate with: node -e "console.log(crypto.randomBytes(32).toString('hex'))"`,
    );
  }
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Returns true iff the value looks like one of our envelope-encrypted blobs
 * (currently: starts with "v1:"). Used by callers that want to make routing
 * decisions before/without invoking decryptToken.
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith('v1:');
}

/**
 * Encrypt `plaintext` with the master key. Output is always "v1:<iv_b64>:<ct_b64>".
 *
 * The IV is freshly random for every call (96 bits via crypto.getRandomValues),
 * so repeated encryptions of the same plaintext yield different ciphertexts —
 * essential for any token that might be re-encrypted on rotation.
 */
export async function encryptToken(masterKeyHex: string, plaintext: string): Promise<string> {
  const key = await importMasterKey(masterKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipherBuf))}`;
}

/**
 * Decrypt a "v1:..." envelope back to plaintext.
 *
 * Transparency for legacy plaintext: if `ciphertext` does NOT start with
 * "v1:", we treat it as a legacy plaintext token and return it as-is. The
 * caller can then proceed normally; the value gets upgraded to ciphertext on
 * the next write path. This is what makes the rollout zero-downtime.
 *
 * Throws if the input HAS the "v1:" prefix but is malformed or fails the
 * AES-GCM auth tag check — that indicates corruption or wrong master key,
 * and silently returning garbage would mask a serious problem.
 */
export async function decryptToken(masterKeyHex: string, ciphertext: string): Promise<string> {
  if (!isEncrypted(ciphertext)) {
    // Legacy plaintext — return unchanged. Re-encryption happens on next write.
    return ciphertext;
  }
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('decryptToken: malformed envelope (expected 3 segments)');
  }
  const [, ivB64, ctB64] = parts;
  const iv = base64ToBytes(ivB64);
  const ct = base64ToBytes(ctB64);
  if (iv.length !== 12) {
    throw new Error(`decryptToken: invalid IV length (expected 12 bytes, got ${iv.length})`);
  }
  const key = await importMasterKey(masterKeyHex);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plainBuf);
}
