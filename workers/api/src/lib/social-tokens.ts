// At-rest encryption helpers for users.social_tokens / clients.social_tokens.
//
// Why this exists:
//   The social_tokens column stores the merchant's Facebook Page access
//   token (and the long-lived user token that mints it). If a D1 export,
//   backup snapshot, or read-only debug query ever leaks, plaintext tokens
//   would let an attacker publish to every connected Page until each
//   merchant reconnects. The Shopify side already encrypts its OAuth
//   tokens via lib/crypto.ts; this module brings the main-app tokens to
//   parity. FB Platform Terms requires this for shipping the embedded
//   app review.
//
// Format:
//   Stored values are either:
//     - empty / NULL                — no tokens connected
//     - '{}'                        — empty object sentinel, never encrypted
//     - '{...}' plaintext JSON      — legacy rows pre-migration
//     - 'v1:<iv_b64>:<ct_b64>'      — AES-GCM envelope from lib/crypto.ts
//   The detector lives in lib/crypto.ts (isEncrypted); this module just
//   plumbs it through with parse/stringify.
//
// Rollout posture (mirrors the Shopify side):
//   - MASTER_ENCRYPTION_KEY absent? log a one-line warning and store/read
//     plaintext. The worker MUST keep running — refusing to serve traffic
//     because of a missing secret would be worse than the leak risk we're
//     mitigating.
//   - Legacy plaintext reads succeed transparently (decryptToken returns
//     them unchanged when no v1 prefix). When the caller supplies an
//     ExecutionContext, we schedule a fire-and-forget re-write so the
//     row becomes encrypted on the next pass. This keeps the migration
//     lazy — no big-bang backfill required.
//
// Why not just lift the Shopify helpers?
//   - The Shopify side encrypts the access_token COLUMN (a raw bearer
//     string). We encrypt a JSON BLOB that callers immediately parse —
//     so the natural API is "give me the parsed object" not "give me
//     the decrypted string". Splitting the helpers keeps the call sites
//     terse: `await decryptSocialTokensJson(env, row.social_tokens)` is
//     a drop-in replacement for `JSON.parse(row.social_tokens)`.

import type { Env } from '../env';
import { encryptToken, decryptToken, isEncrypted } from './crypto';

// Hono / Workers runtime — we only call .waitUntil; the exact type lives
// in @cloudflare/workers-types as ExecutionContext.
type WaitUntilCtx = { waitUntil(promise: Promise<unknown>): void };

/** Which table the row lives in. Used by scheduleSocialTokensReencrypt to
 *  build the UPDATE statement. */
export type SocialTokensScope = 'users' | 'clients';

/** Identity of a social_tokens row — table + primary key. For the users
 *  table, `id` is the Clerk uid. For clients, it's the clients.id UUID. */
export interface SocialTokensRowRef {
  scope: SocialTokensScope;
  id: string;
}

// ── Parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a possibly-encrypted social_tokens column value into a plain
 * object. Returns null for empty / unparseable / unrecoverable values so
 * the caller's existing "no tokens connected" branch handles them — no
 * single bad row should crash a batch loader.
 *
 * Behaviour:
 *   - null / empty string / '{}'         → null (caller treats as missing)
 *   - 'v1:...' + key set                  → decrypt, JSON.parse, return obj
 *   - 'v1:...' + key NOT set              → null + console.error (we have
 *                                           ciphertext but lost the key)
 *   - plaintext JSON                      → JSON.parse, return obj
 *   - malformed (decrypt throws or JSON.parse throws) → null
 *
 * No side effects. To trigger the lazy re-encrypt write-back, the caller
 * passes the SAME raw value to scheduleSocialTokensReencrypt with a row
 * ref + ExecutionContext.
 */
export async function decryptSocialTokensJson<T = Record<string, unknown>>(
  env: Env,
  raw: string | null | undefined,
): Promise<T | null> {
  if (!raw) return null;
  // '{}' is the deauth sentinel (fb-platform.ts wipes tokens to this on FB
  // deauthorize). Treat as "no tokens" without invoking the cipher.
  if (raw === '{}') return null;

  const key = env.MASTER_ENCRYPTION_KEY;

  // Encrypted path
  if (isEncrypted(raw)) {
    if (!key) {
      // Misconfiguration: ciphertext on disk but no key in env. This is
      // serious — we can't recover the token without the key — but
      // returning null is still the safest behaviour for the worker
      // (caller surfaces "reconnect Facebook" instead of crashing the
      // request). The error in logs gives Steve a way to spot it.
      console.error(
        '[social-tokens] Encrypted row but MASTER_ENCRYPTION_KEY not set — returning null. ' +
          'Restore the secret or the workspace will need to reconnect FB.',
      );
      return null;
    }
    try {
      const plaintext = await decryptToken(key, raw);
      return JSON.parse(plaintext) as T;
    } catch (e: any) {
      console.error('[social-tokens] decrypt failed:', e?.message || e);
      return null;
    }
  }

  // Plaintext path (legacy rows or no-key-configured installs)
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Same defensive behaviour as the previous inline JSON.parse — one
    // bad row shouldn't crash the whole batch loader.
    return null;
  }
}

// ── Serialisation for writes ──────────────────────────────────────────────

/**
 * Prepare a tokens object for storage. When MASTER_ENCRYPTION_KEY is set,
 * stringifies + AES-GCM-encrypts to the v1 envelope. When it's NOT set
 * (local dev, misconfigured deploy), logs a warning and returns the
 * plaintext JSON string — the same posture as the Shopify side.
 *
 * Edge cases:
 *   - empty object → returns '{}' WITHOUT encrypting. The fb-platform
 *     deauthorize path uses '{}' as a sentinel to wipe tokens; encrypting
 *     it would break the LIKE-based invalidation that scans the column
 *     for matching facebookUserId values.
 *   - encryption throws → falls back to plaintext + logs the error. We'd
 *     rather complete the user's write than leave them in a half-saved
 *     state. The error surfaces in logs for follow-up.
 */
export async function encryptSocialTokensJson(
  env: Env,
  obj: Record<string, unknown> | null | undefined,
): Promise<string> {
  // null / empty → store '{}' sentinel without invoking the cipher.
  if (!obj || Object.keys(obj).length === 0) {
    return '{}';
  }
  const json = JSON.stringify(obj);
  const key = env.MASTER_ENCRYPTION_KEY;
  if (!key) {
    console.warn(
      '[social-tokens] MASTER_ENCRYPTION_KEY not set — storing social_tokens in plaintext',
    );
    return json;
  }
  try {
    return await encryptToken(key, json);
  } catch (e: any) {
    console.error(
      '[social-tokens] encryptToken failed, falling back to plaintext:',
      e?.message || e,
    );
    return json;
  }
}

// ── Lazy re-encryption (fire-and-forget) ──────────────────────────────────

/**
 * If `raw` is a plaintext payload AND MASTER_ENCRYPTION_KEY is configured,
 * schedule a background re-write of the row as v1 ciphertext.
 *
 * Caller pattern:
 *   const tokens = await decryptSocialTokensJson(env, row.social_tokens);
 *   scheduleSocialTokensReencrypt(env, ctx, { scope: 'users', id: uid }, row.social_tokens);
 *
 * Why not bundle into decryptSocialTokensJson?
 *   - The cron crons (refresh-tokens, refresh-facts) don't have an
 *     ExecutionContext — they're invoked from the scheduled() handler
 *     which provides `event` not `ctx`. They'd pass `undefined` and
 *     the call would be a no-op, which is fine, but separating the
 *     side-effect into its own function makes that explicit.
 *   - In the unit tests we want a pure decryptSocialTokensJson with
 *     no side effects on the DB mock.
 *
 * `ctx` may be undefined — the call no-ops in that case (logged once at
 * debug). The lazy migration just waits for the next request path that
 * does have a ctx (the read routes all do).
 */
export function scheduleSocialTokensReencrypt(
  env: Env,
  ctx: WaitUntilCtx | undefined,
  row: SocialTokensRowRef,
  raw: string | null | undefined,
): void {
  if (!ctx) return;
  if (!raw || raw === '{}') return;
  if (isEncrypted(raw)) return; // already migrated — nothing to do
  if (!env.MASTER_ENCRYPTION_KEY) return; // no key → would re-write plaintext, pointless

  // Parse defensively — if the row is corrupt, don't re-encrypt garbage.
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  ctx.waitUntil(
    (async () => {
      try {
        const enc = await encryptSocialTokensJson(env, parsed);
        // Only write back if we actually got ciphertext — the fallback
        // path returns plaintext, in which case re-writing buys us
        // nothing and risks racing with a real write.
        if (!isEncrypted(enc)) return;
        if (row.scope === 'users') {
          await env.DB.prepare('UPDATE users SET social_tokens = ? WHERE id = ?')
            .bind(enc, row.id).run();
        } else {
          await env.DB.prepare('UPDATE clients SET social_tokens = ? WHERE id = ?')
            .bind(enc, row.id).run();
        }
      } catch (e: any) {
        // Background task — never throw. Log so Steve can spot any
        // systemic re-encrypt failures via wrangler tail.
        console.warn(
          `[social-tokens] background re-encrypt failed for ${row.scope}/${row.id}:`,
          e?.message || e,
        );
      }
    })(),
  );
}
