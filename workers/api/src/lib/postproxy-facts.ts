// Postproxy-flavoured client_facts refresher.
//
// Parallel to lib/facebook-facts.ts but for workspaces that have migrated
// to Postproxy (use_postproxy = 1). Legacy FB Page tokens are gone for
// those workspaces — Postproxy holds them internally — so we have to read
// engagement via Postproxy's stats endpoints instead of FB Graph directly.
//
// Three fact_types emitted (matching the legacy schema):
//   - own_post : captions pulled from our `posts` table where the matching
//                postproxy_post_id has a stats record. Engagement formula
//                differs (Postproxy returns impressions/clicks/likes, not
//                shares/comments), so we use likes*1 + clicks*2 +
//                impressions/100 as a normalised proxy.
//   - comment  : up to 20 comments from top-5 engagement posts via
//                listPostComments. Filtered the same way as legacy:
//                ≥8 chars, ≤500 chars, skip the page's own replies.
//   - about    : minimal — fan_count from getProfileWithLatestStats's
//                summary_stats, plus cached fb_page_name. Postproxy doesn't
//                expose Page description/hours/category, so onboarding-magic
//                seeded `about` rows are preserved instead of being wiped.
//
// Photo + event fact_types are NOT emitted on the Postproxy path:
//   - photo: Postproxy doesn't expose Page photos; legacy cron skipped them
//     too (line 176 of facebook-facts.ts). Onboarding-magic-seeded rows
//     survive the wipe via the fact_type filter.
//   - event: Postproxy doesn't expose Page events.
//
// Wipe-and-replace differs from legacy: we DELETE only fact_types we'll
// re-emit (own_post + comment + about), so onboarding-seeded photo rows
// stay live. On empty-stats ticks (new workspace, <23h since first publish,
// Postproxy hasn't polled yet) we skip the DELETE entirely so existing rows
// don't get wiped to zero — virality scorer keeps working with slightly
// stale data instead of silent zeros.

import type { Env } from '../env';
import {
  getPostStats,
  getProfileWithLatestStats,
  listPostComments,
  type PostproxyComment,
} from './postproxy';

interface PostproxyMappingRow {
  postproxy_profile_id: string | null;
  postproxy_placement_id: string | null;
  fb_page_name: string | null;
  profile_status: string | null;
}

interface OurPostRow {
  id: string;
  content: string | null;
  hashtags: string | null;
  postproxy_post_id: string;
}

interface FactInsert {
  type: 'own_post' | 'comment' | 'about';
  content: string;
  meta: Record<string, unknown>;
  fb_id: string;
  eng: number;
}

/** Normalised engagement score for the Postproxy path. Legacy FB used
 *  `likes + comments*3 + shares*5` — Postproxy returns
 *  `impressions/clicks/likes` (not comments/shares per docs §2175), so we
 *  build a different proxy that ranks the same posts in roughly the same
 *  order: clicks are the strongest signal of audience action, likes are
 *  the cheapest engagement, impressions divided by 100 keeps the
 *  reach-vs-engagement scale balanced so a viral-impressions post doesn't
 *  drown out a small-but-engaged post. */
function engagementFromFbStats(stats: Record<string, number | string>): number {
  const impressions = Number(stats.impressions) || 0;
  const likes = Number(stats.likes) || 0;
  const clicks = Number(stats.clicks) || 0;
  return likes + clicks * 2 + impressions / 100;
}

export async function refreshFactsViaPostproxy(
  env: Env,
  uid: string,
  clientId: string | null,
): Promise<{ inserted: number; errors: string[]; skipped?: boolean }> {
  const errors: string[] = [];

  // 1. Load the workspace's Postproxy mapping.
  const mapping = clientId
    ? await env.DB.prepare(
      `SELECT postproxy_profile_id, postproxy_placement_id, fb_page_name, profile_status
       FROM postproxy_profiles
       WHERE user_id = ? AND client_id = ?`
    ).bind(uid, clientId).first<PostproxyMappingRow>()
    : await env.DB.prepare(
      `SELECT postproxy_profile_id, postproxy_placement_id, fb_page_name, profile_status
       FROM postproxy_profiles
       WHERE user_id = ? AND client_id IS NULL`
    ).bind(uid).first<PostproxyMappingRow>();

  if (!mapping?.postproxy_profile_id || !mapping?.postproxy_placement_id) {
    return { inserted: 0, errors: ['No Postproxy profile/placement mapped for this workspace.'] };
  }
  if (mapping.profile_status && mapping.profile_status !== 'active') {
    return { inserted: 0, errors: [`Postproxy profile not active (status=${mapping.profile_status})`] };
  }
  const profileId = mapping.postproxy_profile_id;
  const fbPageName = mapping.fb_page_name || '';

  // 2. Pull last 50 own posts that Postproxy actually published (have a
  //    postproxy_post_id) and reached the 'Posted' state. Caption comes
  //    from our DB — Postproxy's /posts/stats response omits the body.
  const ourPostsRes = await env.DB.prepare(
    `SELECT id, content, hashtags, postproxy_post_id
     FROM posts
     WHERE user_id = ? AND COALESCE(client_id,'') = ?
       AND postproxy_post_id IS NOT NULL
       AND status = 'Posted'
     ORDER BY scheduled_for DESC
     LIMIT 50`
  ).bind(uid, clientId || '').all<OurPostRow>();
  const ourPosts = (ourPostsRes.results || []).filter((p) => p.postproxy_post_id);

  const inserts: FactInsert[] = [];
  const engByPpId = new Map<string, { eng: number; meta: Record<string, unknown> }>();

  // 3. Fetch stats in chunks of 50 (single chunk in practice — we already
  //    capped the SELECT at 50). For each post, pick the most-recent FB
  //    record and compute the normalised engagement score.
  if (ourPosts.length > 0) {
    try {
      const stats = await getPostStats(env, ourPosts.map((p) => p.postproxy_post_id), { profiles: profileId });
      for (const post of ourPosts) {
        const platforms = stats.data?.[post.postproxy_post_id]?.platforms || [];
        // Prefer Facebook stats (most legacy callers); fall back to the
        // first platform if FB isn't there (e.g. IG-only workspace once
        // ig-wire lands).
        const fb = platforms.find((p) => p.platform === 'facebook') || platforms[0];
        const latest = fb?.records?.[fb.records.length - 1];
        if (!latest) continue;
        const eng = engagementFromFbStats(latest.stats);
        const caption = ((post.content || '') + (post.hashtags ? ` ${post.hashtags}` : '')).trim();
        if (caption.length < 20) continue;
        engByPpId.set(post.postproxy_post_id, {
          eng,
          meta: {
            impressions: Number(latest.stats.impressions) || 0,
            likes: Number(latest.stats.likes) || 0,
            clicks: Number(latest.stats.clicks) || 0,
            recorded_at: latest.recorded_at,
            source: 'postproxy',
          },
        });
        inserts.push({
          type: 'own_post',
          content: caption,
          meta: {
            impressions: Number(latest.stats.impressions) || 0,
            likes: Number(latest.stats.likes) || 0,
            clicks: Number(latest.stats.clicks) || 0,
            recorded_at: latest.recorded_at,
            source: 'postproxy',
          },
          fb_id: post.postproxy_post_id,
          eng,
        });
      }
    } catch (e: any) {
      errors.push(`postproxy stats: ${e?.message || 'unknown'}`);
    }
  }

  // 4. Empty-stats fallback: if we got nothing, leave existing facts in
  //    place. This protects new migrations (<23h since first publish) and
  //    Postproxy stats-pipeline outages.
  if (inserts.length === 0) {
    return {
      inserted: 0,
      errors: errors.length > 0 ? errors : ['Postproxy stats empty — keeping prior facts'],
      skipped: true,
    };
  }

  // 5. Top-5 by engagement → comment mining.
  const top5 = [...engByPpId.entries()]
    .sort((a, b) => b[1].eng - a[1].eng)
    .slice(0, 5)
    .map(([ppId]) => ppId);
  for (const ppId of top5) {
    try {
      const comments = await listPostComments(env, ppId, profileId, { perPage: 20 });
      for (const c of comments.data || []) {
        const body = (c.body || '').trim();
        if (body.length < 8 || body.length > 500) continue;
        // Skip the page's own replies — best-effort match on username.
        if (c.author_username && fbPageName && c.author_username.toLowerCase() === fbPageName.toLowerCase()) continue;
        inserts.push({
          type: 'comment',
          content: body,
          meta: { like_count: c.like_count || 0, from: c.author_username || null },
          fb_id: c.id,
          eng: c.like_count || 0,
        });
      }
    } catch (e: any) {
      errors.push(`comments[${ppId}]: ${e?.message || 'unknown'}`);
    }
  }

  // 6. Profile-level about row. fan_count drives the AI's "you have N
  //    followers" framing; the rest of the blob preserves the legacy
  //    line-by-line format.
  try {
    const profile = await getProfileWithLatestStats(env, profileId);
    const summary = profile.summary_stats?.stats || {};
    const blob = [
      fbPageName && `Page: ${fbPageName}`,
      summary.fan_count != null && `Followers: ${summary.fan_count}`,
      summary.page_impressions != null && `Impressions (last 24h): ${summary.page_impressions}`,
    ].filter(Boolean).join('\n');
    if (blob) {
      inserts.push({
        type: 'about',
        content: blob,
        meta: { source: 'postproxy', fan_count: summary.fan_count, recorded_at: profile.summary_stats?.recorded_at },
        fb_id: profileId,
        eng: 0,
      });
    }
  } catch (e: any) {
    errors.push(`about: ${e?.message || 'unknown'}`);
  }

  // 7. Wipe only the fact_types we're about to repopulate. Photos (and
  //    legacy events) seeded during onboarding-magic survive.
  await env.DB.prepare(
    `DELETE FROM client_facts
     WHERE user_id = ? AND COALESCE(client_id,'') = ?
       AND fact_type IN ('own_post','comment','about')`
  ).bind(uid, clientId || '').run();

  let inserted = 0;
  for (const f of inserts) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO client_facts (user_id, client_id, fact_type, content, metadata, fb_id, engagement_score)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(uid, clientId, f.type, f.content, JSON.stringify(f.meta || {}), f.fb_id, f.eng).run();
      inserted++;
    } catch { /* duplicate or constraint — skip */ }
  }
  return { inserted, errors };
}

// Re-export for tests that want to assert the engagement formula in isolation.
export const __test = { engagementFromFbStats };

// Suppress unused-import warning when no comments come back.
void (null as unknown as PostproxyComment);
