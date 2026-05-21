// Workspace-level FB/IG connection check — single source of truth for
// "can this workspace publish to <platform>?". Used by the post-create
// route (routes/posts.ts) to block scheduling for unconnected workspaces
// so the publish cron doesn't keep marking posts Missed with reasons the
// user can't actionably fix from the calendar.
//
// Without this gate: Smart Schedule fires Promise.all for a workspace
// that's never connected FB, posts land with status='Scheduled', the
// publish cron tries them, all 14 fail with "No Facebook page connected",
// metrics dashboard shows a 30%+ miss rate, owner has no way to recover
// from the calendar (the toast is unactionable). With this gate: the
// schedule action returns 409 NOT_CONNECTED and the frontend surfaces
// "Connect Facebook first" as a real CTA before scheduling.
//
// Two-path readiness: checks both publish paths in parallel —
//   1. Postproxy: postproxy_profiles row with profile_status='active'
//      and (for FB) a placement_id set. Mirrors the readiness check
//      done by cron/publish-missed.ts:365 in the Postproxy branch.
//   2. Legacy Graph: social_tokens.facebookPageId + access_token on
//      the owning workspace (users.social_tokens for own-workspace,
//      clients.social_tokens for agency-managed).
//
// Returns true if EITHER path is ready — the cron picks the path at
// publish-time from use_postproxy. Both paths being viable means
// "any reasonable scheduling decision will work for this workspace."
//
// IG-only support requires Postproxy — the legacy Graph publish path
// in cron/publish-missed.ts:451+ is FB-only. An IG post for a
// workspace without a Postproxy IG profile is therefore not publishable
// and returns false here.

import type { Env } from '../env';
import { decryptSocialTokensJson } from './social-tokens';

export type Platform = 'facebook' | 'instagram';

/**
 * @returns true iff the workspace has a publishable channel for `platform`.
 * Never throws — DB errors are treated as "not connected" so a flaky D1
 * read can't bypass the gate.
 */
export async function isWorkspaceConnected(
  env: Env,
  userId: string,
  clientId: string | null | undefined,
  platform: Platform,
): Promise<boolean> {
  try {
    // ── Postproxy readiness ──────────────────────────────────────────────
    const ppRow = clientId
      ? await env.DB.prepare(
          `SELECT postproxy_profile_id, postproxy_placement_id
           FROM postproxy_profiles
           WHERE user_id = ? AND client_id = ? AND platform = ?
             AND profile_status = 'active'`
        ).bind(userId, clientId, platform).first<{
          postproxy_profile_id: string | null;
          postproxy_placement_id: string | null;
        }>()
      : await env.DB.prepare(
          `SELECT postproxy_profile_id, postproxy_placement_id
           FROM postproxy_profiles
           WHERE user_id = ? AND client_id IS NULL AND platform = ?
             AND profile_status = 'active'`
        ).bind(userId, platform).first<{
          postproxy_profile_id: string | null;
          postproxy_placement_id: string | null;
        }>();
    if (ppRow?.postproxy_profile_id) {
      // FB needs a placement; IG does not (mirror publish-missed.ts:365).
      if (platform === 'instagram') return true;
      if (ppRow.postproxy_placement_id) return true;
    }

    // ── Legacy Graph fallback (FB only) ──────────────────────────────────
    // Legacy publish path handles FB only — IG was never wired through
    // social_tokens. An IG schedule with no Postproxy → not publishable.
    if (platform === 'instagram') return false;

    const tokensRow = clientId
      ? await env.DB.prepare('SELECT social_tokens FROM clients WHERE id = ?')
          .bind(clientId).first<{ social_tokens: string | null }>()
      : await env.DB.prepare('SELECT social_tokens FROM users WHERE id = ?')
          .bind(userId).first<{ social_tokens: string | null }>();
    if (!tokensRow?.social_tokens) return false;
    const t = await decryptSocialTokensJson<{
      facebookPageId?: string;
      facebookPageAccessToken?: string;
    }>(env, tokensRow.social_tokens);
    return !!(t?.facebookPageId && t?.facebookPageAccessToken);
  } catch (e: any) {
    // Defensive: a transient D1 error shouldn't open the gate. Log and
    // return false so the user sees "not connected" rather than getting
    // a ghost-Missed post in their calendar.
    console.warn(`[connection-check] DB error for ${userId}/${clientId ?? 'own'}/${platform}: ${e?.message || e}`);
    return false;
  }
}

/** Normalise a posts.platform string ('Facebook', 'Instagram', 'instagram',
 *  undefined) to the lowercase token the rest of the worker uses. */
export function normalizePlatform(raw: string | null | undefined): Platform {
  const s = (raw || '').toLowerCase();
  if (s === 'instagram' || s === 'ig') return 'instagram';
  return 'facebook';
}
