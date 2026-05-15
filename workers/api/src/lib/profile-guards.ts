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
