// Daily Facebook token refresh cron (3am UTC).
//
// Long-lived FB user tokens expire after 60 days. The cron exchanges each
// workspace's existing token for a fresh one and re-fetches the matched
// page's access_token + linked Instagram business account. If any refresh
// fails it emails Steve via Resend so we don't ship a silent token-expiry
// bug.
//
// Extracted from src/index.ts as Phase B step 8 of the route-module split
// (see WORKER_SPLIT_PLAN.md). Self-contained — no shared state with other
// crons, single caller (the scheduled() handler).

import type { Env } from '../env';

export async function cronRefreshTokens(env: Env) {
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    // Loud failure: a missing FB app secret means every workspace's long-lived
    // token will silently age out and start failing publish ~60 days later.
    // Treat the missing-secret branch the same way check-fal-credits.ts treats
    // low credits — console.error so the line shows up in wrangler tail with
    // an error level, plus a Resend email so Steve hears about it the same
    // day. Behaviour is unchanged otherwise (still a no-op return).
    const missing = [!appId && 'FACEBOOK_APP_ID', !appSecret && 'FACEBOOK_APP_SECRET']
      .filter(Boolean).join(', ');
    console.error(`[CRON] Token refresh SKIPPED — missing secret(s): ${missing}. Every workspace's FB token will silently expire ~60 days from its last refresh.`);
    if (env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'SocialAI Studio <noreply@socialaistudio.au>',
            to: 'steve@3dhub.au',
            subject: `Token refresh cron SKIPPED — missing ${missing}`,
            html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:20px;"><h2 style="color:#ef4444;">FB Token Refresh Disabled</h2><p>The daily token-refresh cron just ran and silently no-op'd because the following secret(s) are not set on the worker:</p><pre style="background:#f3f4f6;padding:10px;border-radius:6px;">${missing}</pre><p>Every workspace's long-lived Facebook token will expire ~60 days from its last successful refresh, after which scheduled posts will start failing with <code>invalid_token</code>.</p><p>Fix: <code>npx wrangler secret put FACEBOOK_APP_ID</code> and <code>FACEBOOK_APP_SECRET</code>, then redeploy.</p></div>`,
          }),
        });
      } catch (e: any) {
        console.error('[CRON] Failed to send refresh-skip alert email:', e?.message);
      }
    }
    return;
  }

  // Collect all workspaces (users + clients) that have a longLivedUserToken
  const users = await env.DB.prepare('SELECT id, social_tokens FROM users WHERE social_tokens IS NOT NULL').all();
  const clients = await env.DB.prepare('SELECT id, social_tokens FROM clients WHERE social_tokens IS NOT NULL').all();
  const workspaces = [...(users.results ?? []).map((r: any) => ({ id: r.id, table: 'users', tokens: r.social_tokens })),
                       ...(clients.results ?? []).map((r: any) => ({ id: r.id, table: 'clients', tokens: r.social_tokens }))];

  let refreshed = 0, failed = 0;
  for (const ws of workspaces) {
    try {
      const tokens = JSON.parse(ws.tokens as string);
      if (!tokens.longLivedUserToken) continue;

      // Exchange for a fresh long-lived token
      const exchangeUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokens.longLivedUserToken}`;
      const res = await fetch(exchangeUrl);
      const data = await res.json() as any;
      if (!data.access_token) { failed++; continue; }

      // Get fresh page tokens
      const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${data.access_token}`);
      const pagesData = await pagesRes.json() as any;
      const pages = pagesData.data || [];

      // Find the matching page
      const page = pages.find((p: any) => p.id === tokens.facebookPageId) || pages[0];
      if (!page) { failed++; continue; }

      const updated = {
        ...tokens,
        longLivedUserToken: data.access_token,
        facebookPageAccessToken: page.access_token,
        facebookPageId: page.id,
        facebookPageName: page.name,
        instagramBusinessAccountId: page.instagram_business_account?.id || tokens.instagramBusinessAccountId || '',
        instagramConnected: !!(page.instagram_business_account?.id || tokens.instagramBusinessAccountId),
      };

      const col = ws.table === 'users' ? 'users' : 'clients';
      await env.DB.prepare(`UPDATE ${col} SET social_tokens = ? WHERE id = ?`).bind(JSON.stringify(updated), ws.id).run();
      refreshed++;
    } catch (e: any) {
      console.error(`[CRON] Token refresh failed for ${ws.table}/${ws.id}:`, e.message);
      failed++;
    }
  }
  console.log(`[CRON] Token refresh complete: ${refreshed} refreshed, ${failed} failed`);

  // Alert if any failures
  if (failed > 0 && env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'SocialAI Studio <noreply@socialaistudio.au>',
        to: 'steve@3dhub.au',
        subject: `Token refresh: ${failed} workspace(s) failed`,
        html: `<p>${refreshed} tokens refreshed, ${failed} failed. Check worker logs.</p>`,
      }),
    });
  }
}
