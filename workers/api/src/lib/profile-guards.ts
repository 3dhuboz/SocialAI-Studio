// Profile-level safety guards — owner-declared "never depict, never mention"
// subjects, defended at four layers across the publish pipeline.
//
// Background: a real-world incident with the hugheseysque (Seamus) account
// shipped images of pork and chicken on a brisket-only BBQ. He asked us to
// disable the system. He's been on_hold ever since. This module is the
// shared backbone that ensures it can't happen again — the gen prompts
// (client-side) and the cron pre-publish path (this side) both pull from
// the same canonical list parser so the rule can't drift.
//
// See src/types.ts BusinessProfile.forbiddenSubjects for the user-facing
// docs + Settings UI input.

import type { Env } from '../env';

/**
 * Tokenise the owner-typed denylist into a clean lowercase array.
 *
 * Accepts two input shapes so the same parser handles both legacy and
 * forward-looking storage formats:
 *
 *   - STRING: "pork, chicken\nLamb;  FISH " → ["pork", "chicken", "lamb", "fish"]
 *     Comma, semicolon, or newline separators. This is how the main-app
 *     users.profile / clients.profile column has stored the value since
 *     2026-04 when the denylist shipped.
 *
 *   - ARRAY:  ["Pork", " chicken ", "lamb"] → ["pork", "chicken", "lamb"]
 *     This is the shape the new Shopify denylist UI writes
 *     (shopify_stores.profile.forbiddenSubjects, schema_v25) — JSON arrays
 *     are a more natural fit for a token list than comma-joined strings.
 *
 * Either way: trim, lowercase, dedupe, drop empties, cap each token at 60
 * chars to catch the paste-mistake-into-wrong-field case.
 *
 * Anything else (null, undefined, number, object, mixed-type array) → [].
 */
export function parseForbiddenSubjects(raw?: unknown): string[] {
  if (raw == null) return [];

  // String form — legacy main-app callers + tests still pass this.
  if (typeof raw === 'string') {
    return [
      ...new Set(
        raw
          .split(/[,\n;]/)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0 && s.length < 60),
      ),
    ];
  }

  // Array form — preferred for new writes. We deliberately do NOT also
  // split each entry on commas: the array is already the tokenised form,
  // and re-splitting would silently merge multiple chips if a merchant
  // accidentally pasted "a, b" into a single chip slot. Better to drop
  // such items than to mis-tokenise them.
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .filter((v): v is string => typeof v === 'string')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0 && s.length < 60),
      ),
    ];
  }

  return [];
}

/**
 * Look up the forbiddenSubjects denylist from D1. Two-tier resolution:
 *
 *   - User-level (users.profile.forbiddenSubjects): the owner's default
 *     across every workspace they run. Steve typing "porn, gambling" into
 *     his account-level settings means every client he manages inherits
 *     that exclusion.
 *
 *   - Client-level (clients.profile.forbiddenSubjects): per-workspace
 *     additions captured at onboarding. The hugheseysque (Seamus) failure
 *     mode was exactly this: brisket-only BBQ that the agency owner doesn't
 *     personally need to denylist at user level, but the client absolutely
 *     does. Pre-2026-05 this column was ignored entirely so the denylist
 *     silently no-opped for every agency-managed client.
 *
 * The two lists are UNION-ed (deduplicated) so a client inherits the owner's
 * default AND layers their own additions on top. Returns [] only when both
 * tiers are empty / missing / malformed.
 *
 * Errors are swallowed and logged — failing closed here would block the
 * publish cron entirely, which is worse than the original Seamus failure
 * mode (better to publish unguarded than to halt the platform).
 */
export async function loadForbiddenSubjects(
  env: Env,
  userId: string,
  clientId?: string | null,
): Promise<string[]> {
  const out = new Set<string>();
  try {
    const userRow = await env.DB
      .prepare('SELECT profile FROM users WHERE id = ?')
      .bind(userId)
      .first<{ profile: string | null }>();
    if (userRow?.profile) {
      try {
        const parsed = JSON.parse(userRow.profile);
        for (const s of parseForbiddenSubjects(parsed?.forbiddenSubjects)) out.add(s);
      } catch { /* malformed user profile JSON — ignore, fall through to client tier */ }
    }
  } catch (err) {
    console.warn(`[profile-guards] loadForbiddenSubjects user lookup failed for user ${userId}:`, err);
  }

  if (clientId) {
    try {
      const clientRow = await env.DB
        .prepare('SELECT profile FROM clients WHERE id = ? AND user_id = ?')
        .bind(clientId, userId)
        .first<{ profile: string | null }>();
      if (clientRow?.profile) {
        try {
          const parsed = JSON.parse(clientRow.profile);
          for (const s of parseForbiddenSubjects(parsed?.forbiddenSubjects)) out.add(s);
        } catch { /* malformed client profile JSON — ignore */ }
      }
    } catch (err) {
      console.warn(`[profile-guards] loadForbiddenSubjects client lookup failed for client ${clientId}:`, err);
    }
  }

  return [...out];
}

/**
 * Shopify-shop variant of loadForbiddenSubjects. Reads from
 * `shopify_stores.profile` (added in schema_v25) and tokenises the same way.
 *
 * Why a separate function instead of unioning into loadForbiddenSubjects:
 * shop posts use the schema_v22 tenant abstraction (owner_kind='shop',
 * user_id=<shop_domain> as a sentinel — no real users row, no clients row).
 * The Clerk-tenant loader would do a wasted lookup against users(id=<shop>)
 * which returns the empty sentinel. Calling this loader directly is faster
 * and makes the intent obvious at the call site.
 *
 * Wire this into every shop-side pipeline path that the main app applies
 * loadForbiddenSubjects to:
 *   - routes/shopify-compose.ts  (image prompt + caption gen)
 *   - routes/shopify-post-quality.ts (critique HARD-RULES gate)
 *   - routes/shopify-posters.ts (poster image gen)
 *   - cron/publish-missed.ts (pre-publish scan of caption + image_prompt)
 *
 * Same fail-open posture as the Clerk version: errors are logged and we
 * return []. Halting the platform is worse than publishing unguarded.
 */
export async function loadForbiddenSubjectsForShop(
  env: Env,
  shopDomain: string,
): Promise<string[]> {
  try {
    const row = await env.DB
      .prepare('SELECT profile FROM shopify_stores WHERE shop_domain = ?')
      .bind(shopDomain)
      .first<{ profile: string | null }>();
    if (!row?.profile) return [];
    try {
      const parsed = JSON.parse(row.profile);
      return parseForbiddenSubjects(parsed?.forbiddenSubjects);
    } catch {
      return [];
    }
  } catch (err) {
    console.warn(`[profile-guards] loadForbiddenSubjectsForShop lookup failed for ${shopDomain}:`, err);
    return [];
  }
}

/**
 * Scan a block of text for the first occurrence of any denylisted subject.
 * Returns the matched subject (lowercase) so the caller can log/persist a
 * specific reason, or null if no match.
 *
 * Uses case-insensitive substring matching — "Pork shoulder" hits the
 * "pork" entry, "porkbelly" also hits. Word-boundary matching was
 * considered but rejected: the goal is to NEVER let the subject through,
 * even buried in a compound word the owner didn't anticipate.
 *
 * Pre-publish call sites should scan BOTH the caption and the
 * image_prompt before any auto-publish — owner-declared exclusions need
 * to bite at every surface.
 */
export function scanForForbidden(text: string | null | undefined, denylist: string[]): string | null {
  if (!text || denylist.length === 0) return null;
  const lower = text.toLowerCase();
  for (const banned of denylist) {
    if (lower.includes(banned)) return banned;
  }
  return null;
}
