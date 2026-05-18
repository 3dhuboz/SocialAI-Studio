// Constant-time string comparison — avoids leaking the secret one byte at
// a time through response-time differences. Both strings are read fully
// before the result is returned, so an attacker can't bisect on timing.
//
// Used wherever a request-supplied secret is compared against a stored one
// (Bearer tokens, HMAC signatures, activation codes, embed-token sigs).
// Three inline copies of this loop existed across routes/activations.ts,
// routes/pennybuilder.ts, and lib/embed-token.ts before this shared module.

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
