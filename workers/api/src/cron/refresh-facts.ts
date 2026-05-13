// Daily — refresh client_facts for every workspace with a connected FB Page.
//
// Keeps the AI's ground-truth data current without the user clicking Refresh.
// Skips on_hold clients (Hugheseys-style accounts that have asked for a
// posting pause). Logs per-workspace failures but never throws — one bad
// token shouldn't take down the whole nightly refresh.
//
// Extracted from src/index.ts as Phase B step 11 of the route-module split.
// Delegates the actual scrape to lib/facebook-facts → refreshFactsForWorkspace.

import type { Env } from '../env';
import { refreshFactsForWorkspace } from '../lib/facebook-facts';

export async function cronRefreshFacts(env: Env): Promise<{ posts_processed: number }> {
  const users = await env.DB.prepare(
    `SELECT id FROM users WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL`
  ).all();
  const clients = await env.DB.prepare(
    `SELECT id, user_id FROM clients WHERE social_tokens IS NOT NULL AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL AND COALESCE(status,'active') != 'on_hold'`
  ).all();
  let processed = 0;
  for (const u of (users.results || [])) {
    try { await refreshFactsForWorkspace(env.DB, (u as any).id, null); processed++; }
    catch (e: any) { console.warn(`[CRON facts] user ${(u as any).id}: ${e.message}`); }
  }
  for (const cl of (clients.results || [])) {
    try { await refreshFactsForWorkspace(env.DB, (cl as any).user_id, (cl as any).id); processed++; }
    catch (e: any) { console.warn(`[CRON facts] client ${(cl as any).id}: ${e.message}`); }
  }
  console.log(`[CRON facts] refreshed ${processed} workspaces`);
  return { posts_processed: processed };
}
