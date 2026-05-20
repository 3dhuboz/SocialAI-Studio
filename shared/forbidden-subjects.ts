// Single source of truth for parsing the owner-declared "forbiddenSubjects"
// denylist. This defends THE Seamus failure mode: a brisket-only smokehouse
// whose owner declared "pork, chicken" as forbidden subjects, but the
// platform shipped a "pulled pork ribs" post because the denylist parser had
// a bug. Multiple enforcement layers (gen-time prompt injection, archetype
// guardrails, vision critique, regex post-scan) all depend on this parser
// returning the right tokens — drift here silently no-ops one of those
// layers without any compiler error.
//
// Imported by:
//   - src/services/gemini.ts                       (frontend)
//   - workers/api/src/lib/profile-guards.ts        (worker)
//
// Both tsconfigs already include the shared/ directory (see the FLUX
// prompts extraction).

/**
 * Tokenises an owner-declared denylist into a lowercase array of trimmed
 * subjects. Accepts two input shapes:
 *
 *   - STRING: comma/semicolon/newline-separated. Legacy main-app shape
 *     (users.profile.forbiddenSubjects has been stored this way since the
 *     2026-04 denylist ship).
 *     "pork, chicken\nLamb;  FISH " → ["pork", "chicken", "lamb", "fish"]
 *
 *   - ARRAY of strings. Shape used by the Shopify denylist UI
 *     (shopify_stores.profile.forbiddenSubjects, schema_v25_shopify_foundation).
 *     JSON arrays are a more natural fit for a token list than comma-joined
 *     strings; the array IS the tokenised form, so we DO NOT also split each
 *     entry on commas (would silently merge multiple chips if a merchant
 *     accidentally pasted "a, b" into a single chip slot — better to drop).
 *
 * Defensive against the brisket-incident shape — accepts mixed delimiters
 * because real owner input is sloppy. Empty/null/wrong-type → []. Each token
 * sanity-capped at 60 chars to catch a paste-mistake where the entire
 * profile description ends up in this field.
 */
export function parseForbiddenSubjects(raw?: unknown): string[] {
  if (raw == null) return [];

  // String form — legacy main-app callers + tests.
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

  // Array form — preferred for new writes (Shopify denylist UI).
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
