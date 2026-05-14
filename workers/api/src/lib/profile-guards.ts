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
 * Tokenise the owner-typed denylist string into a clean lowercase array.
 * Accepts commas, semicolons, or newlines as separators.
 *
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

/**
 * Look up the owner's forbiddenSubjects denylist from D1. Reads users.profile
 * (JSON column) and parses out the forbiddenSubjects field.
 *
 * Returns [] when:
 *   - The user row doesn't exist (e.g. portal-only account)
 *   - profile is unset / not JSON
 *   - forbiddenSubjects field is unset or empty
 *
 * Errors are swallowed and logged — failing closed here would block the
 * publish cron entirely, which is worse than the original Seamus failure
 * mode (better to publish unguarded than to halt the platform).
 */
export async function loadForbiddenSubjects(env: Env, userId: string): Promise<string[]> {
  try {
    const row = await env.DB
      .prepare('SELECT profile FROM users WHERE id = ?')
      .bind(userId)
      .first<{ profile: string | null }>();
    if (!row?.profile) return [];
    let parsed: any;
    try { parsed = JSON.parse(row.profile); } catch { return []; }
    return parseForbiddenSubjects(parsed?.forbiddenSubjects);
  } catch (err) {
    console.warn(`[profile-guards] loadForbiddenSubjects failed for user ${userId}:`, err);
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
