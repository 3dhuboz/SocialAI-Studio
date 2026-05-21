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
import { parseForbiddenSubjects } from '../../../../shared/forbidden-subjects';

// Re-exported so existing callers keep working. Implementation lives in
// shared/forbidden-subjects.ts so the frontend (src/services/gemini.ts) and
// worker can never drift on what counts as a forbidden subject.
export { parseForbiddenSubjects };

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
 * Look up the workspace's businessType from D1. Two-tier resolution mirrors
 * loadForbiddenSubjects:
 *
 *   - Client-level: clients.business_type (the dedicated column populated by
 *     POST /api/clients onboarding). Falls back to clients.profile JSON's
 *     `businessType` / `business_type` key for older rows that pre-date the
 *     dedicated column.
 *
 *   - User-level: users.profile JSON's `businessType` / `business_type` key.
 *     This is the only path for non-agency workspaces (clientId is null).
 *
 * Returns 'small business' (the canonical default used by campaigns.ts +
 * post-quality.ts) when nothing is set anywhere. Callers that want to
 * fail-closed when the result is generic should compare with
 * isGenericBusinessType from shared/flux-prompts.
 *
 * Errors are swallowed + logged with the same rationale as
 * loadForbiddenSubjects: failing closed at the lookup would halt the cron
 * publish path entirely, which is worse than falling through to the default
 * and letting downstream gates (buildSafeImagePrompt's generic-businessType
 * gate, archetype guardrails) make the safety call.
 */
export async function resolveBusinessType(
  env: Env,
  userId: string,
  clientId?: string | null,
): Promise<string> {
  const DEFAULT = 'small business';
  if (clientId) {
    try {
      const row = await env.DB
        .prepare('SELECT business_type, profile FROM clients WHERE id = ? AND user_id = ?')
        .bind(clientId, userId)
        .first<{ business_type: string | null; profile: string | null }>();
      if (row?.business_type) return row.business_type;
      if (row?.profile) {
        try {
          const p = JSON.parse(row.profile);
          if (p?.businessType) return String(p.businessType);
          if (p?.business_type) return String(p.business_type);
        } catch { /* malformed JSON — fall through to user tier */ }
      }
    } catch (err) {
      console.warn(`[profile-guards] resolveBusinessType client lookup failed for ${clientId}:`, err);
    }
  }
  try {
    const row = await env.DB
      .prepare('SELECT profile FROM users WHERE id = ?')
      .bind(userId)
      .first<{ profile: string | null }>();
    if (row?.profile) {
      try {
        const p = JSON.parse(row.profile);
        if (p?.businessType) return String(p.businessType);
        if (p?.business_type) return String(p.business_type);
      } catch { /* malformed user JSON — return default */ }
    }
  } catch (err) {
    console.warn(`[profile-guards] resolveBusinessType user lookup failed for ${userId}:`, err);
  }
  return DEFAULT;
}

/**
 * Shopify-shop variant of loadForbiddenSubjects. Reads from
 * `shopify_stores.profile` (JSON column added by the shopify_stores
 * migration) and tokenises the same way as the user/client tiers.
 *
 * Why a separate function instead of unioning into loadForbiddenSubjects:
 * shop posts use the schema_v22 tenant abstraction (owner_kind='shop',
 * user_id=<shop_domain> as a sentinel — no real users row, no clients row).
 * The Clerk-tenant loader would do a wasted lookup against users(id=<shop>)
 * which returns the empty sentinel. Calling this loader directly is faster
 * and makes the intent obvious at the call site.
 *
 * Storage shape: `shopify_stores.profile.forbiddenSubjects` is a JSON
 * array of strings (the embedded-app Settings → Brand safety card writes
 * arrays directly because they're cleaner than comma-joined strings for
 * JSON storage). The shared parseForbiddenSubjects only accepts strings,
 * so we tokenise the array locally here.
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
    let parsed: any;
    try { parsed = JSON.parse(row.profile); } catch { return []; }
    const raw = parsed?.forbiddenSubjects;
    // Accept either array (preferred new format) or string (legacy / future
    // string-based field). Same trim/lowercase/dedupe/length rules.
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
    if (typeof raw === 'string') {
      return parseForbiddenSubjects(raw);
    }
    return [];
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
