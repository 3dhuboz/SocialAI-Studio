// Facebook platform-required endpoints (audit P0-7, 2026-05-22).
//
// Meta's "Login for Business" and "Data Deletion Request Callback URL"
// platform requirements: every app that uses Facebook Login needs both
// of these endpoints set in the FB App Dashboard before the app can be
// flipped from Development to Live mode. Without them, no new customer
// can complete the FB OAuth flow at scale.
//
// Both endpoints receive a POST with `signed_request` — a Facebook-
// specific base64url(payload).base64url(HMAC-SHA-256(payload, app_secret))
// envelope. We verify the HMAC, parse the payload, take the documented
// action, and reply with the documented shape.
//
//   /api/fb/deauthorize           — user revoked the app's permissions.
//                                   We invalidate their FB social_tokens
//                                   so the cron stops trying to publish.
//   /api/fb/data-deletion         — user requested data deletion via
//                                   FB. Returns {url, confirmation_code}
//                                   that FB shows to the user with our
//                                   tracking URL.
//
// References:
//   https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
//   https://developers.facebook.com/docs/facebook-login/security#deauthorize-callback

import type { Hono } from 'hono';
import type { Env } from '../env';

const uuid = () => crypto.randomUUID();

/**
 * Verify and parse a Facebook signed_request payload.
 * Returns null on any signature/format mismatch — never throws.
 */
async function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): Promise<Record<string, unknown> | null> {
  const parts = signedRequest.split('.');
  if (parts.length !== 2) return null;
  const [encodedSig, payload] = parts;
  try {
    // FB uses base64url (no padding) for both parts.
    const sigBytes = Uint8Array.from(atob(encodedSig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(appSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
    if (!ok) return null;

    // Decode the payload as UTF-8 JSON. atob → binary string → bytes → TextDecoder.
    const binStr = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    const jsonStr = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function registerFbPlatformRoutes(app: Hono<{ Bindings: Env }>): void {
  /**
   * Deauthorize callback. FB POSTs here when a user revokes the app's
   * permissions on their FB account (Settings → Business Integrations →
   * SocialAI Studio → Remove). The payload contains `user_id` (FB's
   * scoped numeric user id, not our Clerk uid) so we can't directly
   * resolve a users row. Instead we invalidate every social_tokens row
   * whose stored facebookUserId matches — typically zero or one rows
   * (most workspaces are 1:1 with a FB user).
   *
   * No body required in the response — FB just needs 200.
   */
  app.post('/api/fb/deauthorize', async (c) => {
    const appSecret = c.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      console.error('[fb-deauth] FACEBOOK_APP_SECRET secret missing — cannot verify signed_request');
      return c.json({ error: 'Server misconfigured' }, 500);
    }
    let signedRequest: string | undefined;
    try {
      const form = await c.req.formData();
      signedRequest = form.get('signed_request')?.toString();
    } catch {
      // Some FB callers send JSON; try that as fallback.
      const body = await c.req.json<{ signed_request?: string }>().catch(() => null);
      signedRequest = body?.signed_request;
    }
    if (!signedRequest) return c.json({ error: 'signed_request required' }, 400);

    const payload = await parseSignedRequest(signedRequest, appSecret);
    if (!payload) {
      console.warn('[fb-deauth] signed_request verification failed');
      return c.json({ error: 'invalid signed_request' }, 400);
    }
    const fbUserId = String(payload.user_id ?? '');
    if (!fbUserId) {
      console.warn('[fb-deauth] signed_request missing user_id');
      return c.json({ error: 'user_id required' }, 400);
    }

    // Best-effort invalidate any social_tokens JSON whose facebookUserId
    // field matches. The token is stored as a TEXT blob; SQLite's LIKE
    // on a json_extract is the simplest portable filter without adding a
    // dedicated fb_user_id column (P1 follow-up). Conservative pattern —
    // wrapped in quotes so we don't match partial substrings.
    try {
      const likePattern = `%"facebookUserId":"${fbUserId}"%`;
      await c.env.DB.prepare(
        `UPDATE users SET social_tokens = '{}' WHERE social_tokens LIKE ?`
      ).bind(likePattern).run();
      await c.env.DB.prepare(
        `UPDATE clients SET social_tokens = '{}' WHERE social_tokens LIKE ?`
      ).bind(likePattern).run();
      console.log(`[fb-deauth] invalidated tokens for FB user_id=${fbUserId}`);
    } catch (e: any) {
      console.error(`[fb-deauth] token invalidation failed: ${e?.message || e}`);
      // Don't surface the error to FB — they retry on non-200, and a
      // future cron token-refresh will fail and route the user to
      // reconnect anyway.
    }
    return c.json({ ok: true });
  });

  /**
   * Data Deletion Request Callback. FB POSTs here when the user requests
   * data deletion through FB's interface. We must:
   *   1. Verify the signed_request HMAC.
   *   2. Schedule deletion of the user's data.
   *   3. Return { url, confirmation_code } that FB shows the user.
   * The URL is a status page they can poll; confirmation_code is our
   * tracking id.
   *
   * For now we synchronously invalidate FB tokens (same as deauth) +
   * queue a fb_data_deletion_request row for Steve to process. Full
   * D1+R2 purge in a cron, not synchronously (FB's 5s timeout).
   */
  app.post('/api/fb/data-deletion', async (c) => {
    const appSecret = c.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      console.error('[fb-data-deletion] FACEBOOK_APP_SECRET secret missing');
      return c.json({ error: 'Server misconfigured' }, 500);
    }
    let signedRequest: string | undefined;
    try {
      const form = await c.req.formData();
      signedRequest = form.get('signed_request')?.toString();
    } catch {
      const body = await c.req.json<{ signed_request?: string }>().catch(() => null);
      signedRequest = body?.signed_request;
    }
    if (!signedRequest) return c.json({ error: 'signed_request required' }, 400);

    const payload = await parseSignedRequest(signedRequest, appSecret);
    if (!payload) return c.json({ error: 'invalid signed_request' }, 400);
    const fbUserId = String(payload.user_id ?? '');
    if (!fbUserId) return c.json({ error: 'user_id required' }, 400);

    const confirmationCode = `del_${uuid().replace(/-/g, '').slice(0, 24)}`;

    // Invalidate tokens immediately so no further publishing happens.
    try {
      const likePattern = `%"facebookUserId":"${fbUserId}"%`;
      await c.env.DB.prepare(
        `UPDATE users SET social_tokens = '{}' WHERE social_tokens LIKE ?`
      ).bind(likePattern).run();
      await c.env.DB.prepare(
        `UPDATE clients SET social_tokens = '{}' WHERE social_tokens LIKE ?`
      ).bind(likePattern).run();
    } catch (e: any) {
      console.error(`[fb-data-deletion] token invalidation failed: ${e?.message || e}`);
    }

    // Queue the request for async processing. The fb_data_deletion_requests
    // table is created on-demand here (D1 doesn't need explicit schema).
    // A future cron walks the queue and runs the user-delete cascade
    // (or notifies Steve if it can't auto-resolve the FB user_id to a
    // users row).
    try {
      await c.env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS fb_data_deletion_requests (
           confirmation_code TEXT PRIMARY KEY,
           fb_user_id TEXT NOT NULL,
           created_at TEXT NOT NULL,
           processed_at TEXT,
           status TEXT NOT NULL DEFAULT 'pending'
         )`
      ).run();
      await c.env.DB.prepare(
        `INSERT INTO fb_data_deletion_requests (confirmation_code, fb_user_id, created_at, status)
         VALUES (?, ?, ?, 'pending')`
      ).bind(confirmationCode, fbUserId, new Date().toISOString()).run();
    } catch (e: any) {
      console.error(`[fb-data-deletion] failed to queue request: ${e?.message || e}`);
      // Still return success to FB — token invalidation already happened.
    }

    // The URL FB shows to the user. Should be a public status page;
    // for now a static placeholder. Long-term: a real status lookup.
    const statusUrl = `https://socialaistudio.au/data-deletion-status?code=${confirmationCode}`;
    return c.json({ url: statusUrl, confirmation_code: confirmationCode });
  });
}
