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
 * Tokenises a comma/semicolon/newline-separated denylist string into a
 * lowercase array of trimmed subjects.
 *
 * Defensive against the brisket-incident shape — accepts mixed delimiters
 * because real owner input ("pork, chicken\nLamb;  FISH ") is sloppy:
 *   "pork, chicken\nLamb;  FISH " → ["pork", "chicken", "lamb", "fish"]
 *
 * Empty / null / non-string input → []. Each token is sanity-capped at 60
 * chars to catch a paste-mistake where the entire profile description ends
 * up in this field.
 */
export function parseForbiddenSubjects(raw?: string | null): string[] {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[,\n;]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.length < 60);
}
