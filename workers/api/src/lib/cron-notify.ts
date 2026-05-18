// Shared owner-failure notifier for the publish-missed + poll-pending-reels
// crons. Both crons need to email the workspace owner when a scheduled post
// or reel fails to publish, with the same throttle + lookup + send shape —
// previously each cron had its own ~60-line near-duplicate (the poll-reels
// file even admitted "Mirror of publish-missed.ts's notifier — duplicated
// here to avoid a circular import"). The "circular import" was imagined;
// neither cron imports from the other, so a shared lib module works fine.
//
// Throttle: one alert per workspace per hour, keyed via a synthetic
// cron_runs row of type `alert:fb_failure:<wsKey>`. This is the same KV-on-D1
// trick used elsewhere in the codebase and is shared across both crons —
// a reel failure shortly after a post failure for the same workspace
// correctly suppresses, since the owner already knows there's a problem.

import type { Env } from '../env';
import { sendResendEmail } from './email';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export type CronNotifyKind = 'post' | 'reel';

/**
 * Email the workspace owner that a scheduled post/reel failed to publish.
 *
 * Throttled to one email per workspace per hour (keyed on cron_runs.cron_type).
 * Silently no-ops when RESEND_API_KEY is unset or the workspace has no email
 * on file. Never throws — alert plumbing must never break the publish path.
 */
export async function notifyOwnerOnFailure(
  env: Env,
  post: { id: string; user_id?: string | null; client_id?: string | null },
  reason: string,
  kind: CronNotifyKind,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    const wsKey = post.client_id ? `client:${post.client_id}` : `user:${post.user_id ?? 'unknown'}`;
    const cronType = `alert:fb_failure:${wsKey}`.slice(0, 80);

    const recent = await env.DB.prepare(
      `SELECT 1 FROM cron_runs WHERE cron_type = ? AND run_at > datetime('now','-1 hour') LIMIT 1`,
    ).bind(cronType).first();
    if (recent) return;

    let email: string | null = null;
    let workspaceName = 'your workspace';
    if (post.client_id) {
      const row = await env.DB.prepare(
        `SELECT u.email as email, c.name as name FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
      ).bind(post.client_id).first<{ email: string | null; name: string | null }>();
      email = row?.email ?? null;
      if (row?.name) workspaceName = row.name;
    } else if (post.user_id) {
      const row = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
        .bind(post.user_id).first<{ email: string | null }>();
      email = row?.email ?? null;
    }
    if (!email) return;

    const noun = kind === 'reel' ? 'reel' : 'post';
    const isTokenIssue = /token|expired|reconnect|permission|forbidden|connect facebook|page not found|manage_pages/i.test(reason);
    const fixCta = isTokenIssue
      ? `<a href="https://socialaistudio.au/admin" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;">Reconnect Facebook</a>`
      : `<a href="https://socialaistudio.au" style="display:inline-block;background:#f59e0b;color:#000;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;">Open Calendar</a>`;
    const retryHint = isTokenIssue
      ? `This usually means your Facebook page connection has expired. It takes 30 seconds to reconnect — click below.`
      : kind === 'reel'
        ? `Open your calendar to retry — it'll fall back to an image post if needed.`
        : `Open your calendar to retry the post or check what went wrong.`;

    await sendResendEmail(env, {
      to: email,
      subject: `Heads up — a scheduled ${noun} couldn't publish to Facebook`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
        <h2 style="margin:0 0 8px;color:#dc2626;">A scheduled ${noun} didn't go out</h2>
        <p style="margin:0 0 16px;color:#374151;">A ${noun} for <strong>${escapeHtml(workspaceName)}</strong> was scheduled but couldn't be published to Facebook.</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
          <strong>Reason:</strong><br/><span style="color:#374151;">${escapeHtml(reason)}</span>
        </div>
        <p style="margin:0 0 16px;color:#374151;">${retryHint}</p>
        <p>${fixCta}</p>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">We only send one of these per workspace per hour, so you won't get spammed if multiple posts queue up.</p>
      </div>`,
    });

    await env.DB.prepare(
      `INSERT INTO cron_runs (cron_type, success, posts_processed, error, duration_ms) VALUES (?,1,0,?,0)`,
    ).bind(cronType, reason.slice(0, 200)).run();
    console.log(`[CRON] Sent ${noun}-failure alert to ${email} for post ${post.id}`);
  } catch (e: any) {
    // Never let alert plumbing kill the publish path — log and move on.
    console.error(`[CRON] notifyOwnerOnFailure(${kind}) error: ${e?.message || e}`);
  }
}
