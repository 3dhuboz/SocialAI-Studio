// Daily — refresh client_facts for every workspace with a connected publisher.
//
// Two paths since the Postproxy migration (schema_v22):
//   1. Legacy path  — workspaces still on FB Page tokens directly
//      (use_postproxy = 0). Uses lib/facebook-facts.ts → FB Graph
//      scraping. Same behaviour as pre-Postproxy.
//   2. Postproxy path — workspaces with a mapped postproxy_profile + an
//      active placement (use_postproxy = 1). Uses lib/postproxy-facts.ts
//      → Postproxy `/posts/stats` + `/profiles/:id` + `/posts/:id/comments`.
//      Engagement formula and emitted fact_types differ slightly (see
//      postproxy-facts.ts header).
//
// Keeps the AI's ground-truth data current without the user clicking Refresh.
// Skips on_hold clients (Hugheseys-style accounts that have asked for a
// posting pause). Logs per-workspace failures but never throws — one bad
// token shouldn't take down the whole nightly refresh.
//
// Extracted from src/index.ts as Phase B step 11 of the route-module split.

import type { Env } from '../env';
import { refreshFactsForWorkspace, refreshFactsForShop } from '../lib/facebook-facts';
import { refreshFactsViaPostproxy } from '../lib/postproxy-facts';

export async function cronRefreshFacts(env: Env): Promise<{ posts_processed: number }> {
  // ── Legacy FB-token workspaces ─────────────────────────────────────────
  // Filter out use_postproxy=1 so a migrated workspace doesn't get
  // double-refreshed (the Postproxy path below handles it instead).
  const legacyUsers = await env.DB.prepare(
    `SELECT id FROM users
     WHERE social_tokens IS NOT NULL
       AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL
       AND COALESCE(use_postproxy, 0) = 0`
  ).all();
  const legacyClients = await env.DB.prepare(
    `SELECT id, user_id FROM clients
     WHERE social_tokens IS NOT NULL
       AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL
       AND COALESCE(status,'active') != 'on_hold'
       AND COALESCE(use_postproxy, 0) = 0`
  ).all();

  // ── Postproxy-migrated workspaces ─────────────────────────────────────
  // Use postproxy_profiles existence + active status as the signal — a
  // workspace can have use_postproxy=1 with a still-pending OAuth (no
  // placement saved yet), in which case the new path returns a no-op
  // skip rather than throwing.
  const ppUsers = await env.DB.prepare(
    `SELECT u.id FROM users u
     JOIN postproxy_profiles pp ON pp.user_id = u.id AND pp.client_id IS NULL
     WHERE COALESCE(u.use_postproxy, 0) = 1
       AND pp.profile_status = 'active'
       AND pp.postproxy_placement_id IS NOT NULL`
  ).all();
  const ppClients = await env.DB.prepare(
    `SELECT c.id, c.user_id FROM clients c
     JOIN postproxy_profiles pp ON pp.user_id = c.user_id AND pp.client_id = c.id
     WHERE COALESCE(c.use_postproxy, 0) = 1
       AND COALESCE(c.status,'active') != 'on_hold'
       AND pp.profile_status = 'active'
       AND pp.postproxy_placement_id IS NOT NULL`
  ).all();

  // Shopify shops (Phase 2+). Same scrape shape but scoped by shop_domain
  // into shopify_facts. Skips uninstalled shops via the IS NULL guard.
  const shops = await env.DB.prepare(
    `SELECT shop_domain, social_tokens FROM shopify_stores
     WHERE social_tokens IS NOT NULL
       AND json_extract(social_tokens, '$.facebookPageAccessToken') IS NOT NULL
       AND uninstalled_at IS NULL`
  ).all<{ shop_domain: string; social_tokens: string }>();

  let processed = 0;
  for (const u of (legacyUsers.results || [])) {
    try { await refreshFactsForWorkspace(env.DB, (u as any).id, null); processed++; }
    catch (e: any) { console.warn(`[CRON facts] legacy user ${(u as any).id}: ${e.message}`); }
  }
  for (const cl of (legacyClients.results || [])) {
    try { await refreshFactsForWorkspace(env.DB, (cl as any).user_id, (cl as any).id); processed++; }
    catch (e: any) { console.warn(`[CRON facts] legacy client ${(cl as any).id}: ${e.message}`); }
  }
  for (const u of (ppUsers.results || [])) {
    try { await refreshFactsViaPostproxy(env, (u as any).id, null); processed++; }
    catch (e: any) { console.warn(`[CRON facts] pp user ${(u as any).id}: ${e.message}`); }
  }
  for (const cl of (ppClients.results || [])) {
    try { await refreshFactsViaPostproxy(env, (cl as any).user_id, (cl as any).id); processed++; }
    catch (e: any) { console.warn(`[CRON facts] pp client ${(cl as any).id}: ${e.message}`); }
  }
  for (const sh of (shops.results || [])) {
    try {
      const tokens = JSON.parse(sh.social_tokens);
      const pageId = tokens?.facebookPageId;
      const pageToken = tokens?.facebookPageAccessToken;
      if (!pageId || !pageToken) continue;
      await refreshFactsForShop(env, sh.shop_domain, pageId, pageToken);
      processed++;
    } catch (e: any) {
      console.warn(`[CRON facts] shop ${sh.shop_domain}: ${e.message}`);
    }
  }
  const legacyCount = (legacyUsers.results || []).length + (legacyClients.results || []).length;
  const ppCount = (ppUsers.results || []).length + (ppClients.results || []).length;
  const shopCount = (shops.results || []).length;
  console.log(`[CRON facts] refreshed ${processed} workspaces (${legacyCount} legacy + ${ppCount} postproxy + ${shopCount} shops)`);
  return { posts_processed: processed };
}
