// Facebook Page Insights scraper — pulls REAL ground-truth data into client_facts.
//
// One workspace = one user OR one (user, client) tuple. Hits the connected
// Facebook Page's about / posts / comments / photos / events endpoints and
// upserts into client_facts so the AI writes from verified data instead of
// inventing testimonials and stats.
//
// Five fact_types emitted:
//   - about      : page description / hours / location / fan_count (1 row)
//   - own_post   : last 50 posts with engagement scores
//   - comment    : up to 20 comments from top-5 engagement posts (real voice)
//   - photo      : last 30 uploaded photos (URLs only, for image-gen refs)
//   - event      : upcoming events (often missing permission — best-effort)
//
// Wipes existing rows for the workspace first to drop stale facts, then
// INSERT OR IGNORE for de-dup safety on the UNIQUE(user_id, client_id, fb_id)
// constraint. Each fetch is wrapped in try/catch so one failed Graph endpoint
// doesn't kill the whole refresh.
//
// Extracted from src/index.ts as Phase B step 11 of the route-module split.
// Shared by: refresh-facts HTTP routes (own + per-client), admin bootstrap
// endpoint, and the daily refresh-facts cron.

export async function refreshFactsForWorkspace(
  db: D1Database,
  uid: string,
  clientId: string | null,
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  // Get tokens
  const tokenRow = clientId
    ? await db.prepare('SELECT social_tokens FROM clients WHERE id = ? AND user_id = ?').bind(clientId, uid).first<{ social_tokens: string | null }>()
    : await db.prepare('SELECT social_tokens FROM users WHERE id = ?').bind(uid).first<{ social_tokens: string | null }>();
  const tokens = tokenRow?.social_tokens ? JSON.parse(tokenRow.social_tokens) : null;
  const pageId = tokens?.facebookPageId;
  const pageToken = tokens?.facebookPageAccessToken;
  if (!pageId || !pageToken) {
    return { inserted: 0, errors: ['No Facebook page connected for this workspace.'] };
  }

  const base = 'https://graph.facebook.com/v21.0';
  const inserts: Array<{ type: string; content: string; meta: any; fb_id: string; eng: number }> = [];

  // 1. Page about/description/products/hours (1 row)
  try {
    const r = await fetch(`${base}/${pageId}?fields=about,description,category,founded,mission,products,phone,hours,website,location,fan_count&access_token=${pageToken}`);
    const d: any = await r.json();
    if (d && !d.error) {
      const blob = [
        d.about && `About: ${d.about}`,
        d.description && `Description: ${d.description}`,
        d.category && `Category: ${d.category}`,
        d.products && `Products: ${d.products}`,
        d.mission && `Mission: ${d.mission}`,
        d.hours && `Hours: ${JSON.stringify(d.hours)}`,
        d.location && `Location: ${[d.location.street, d.location.city, d.location.state, d.location.country].filter(Boolean).join(', ')}`,
        d.website && `Website: ${d.website}`,
      ].filter(Boolean).join('\n');
      if (blob) inserts.push({ type: 'about', content: blob, meta: { fan_count: d.fan_count }, fb_id: pageId, eng: 0 });
    } else if (d?.error) errors.push(`about: ${d.error.message}`);
  } catch (e: any) { errors.push(`about: ${e.message}`); }

  // 2. Last 50 posts with engagement
  let topPostIds: string[] = [];
  try {
    const r = await fetch(`${base}/${pageId}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares&limit=50&access_token=${pageToken}`);
    const d: any = await r.json();
    if (d?.error) errors.push(`posts: ${d.error.message}`);
    const posts = d?.data || [];
    for (const p of posts) {
      if (!p.message || p.message.length < 20) continue;
      const eng = (p.likes?.summary?.total_count || 0) + ((p.comments?.summary?.total_count || 0) * 3) + ((p.shares?.count || 0) * 5);
      inserts.push({
        type: 'own_post',
        content: p.message,
        meta: { likes: p.likes?.summary?.total_count, comments: p.comments?.summary?.total_count, shares: p.shares?.count, created: p.created_time },
        fb_id: p.id,
        eng,
      });
    }
    // Pick top 5 posts by engagement to mine for comments
    topPostIds = posts
      .filter((p: any) => p.message)
      .sort((a: any, b: any) => ((b.likes?.summary?.total_count || 0) + (b.comments?.summary?.total_count || 0)) - ((a.likes?.summary?.total_count || 0) + (a.comments?.summary?.total_count || 0)))
      .slice(0, 5)
      .map((p: any) => p.id);
  } catch (e: any) { errors.push(`posts: ${e.message}`); }

  // 3. Comments on top-engagement posts (real customer voice)
  for (const pid of topPostIds) {
    try {
      const r = await fetch(`${base}/${pid}/comments?fields=id,message,from,like_count&limit=20&access_token=${pageToken}`);
      const d: any = await r.json();
      if (d?.error) continue;
      for (const c of d?.data || []) {
        if (!c.message || c.message.length < 8 || c.message.length > 500) continue;
        // Skip comments from the page itself (replies)
        if (c.from?.id === pageId) continue;
        inserts.push({
          type: 'comment',
          content: c.message,
          meta: { like_count: c.like_count, from: c.from?.name },
          fb_id: c.id,
          eng: c.like_count || 0,
        });
      }
    } catch { /* skip this post */ }
  }

  // 4. Recent photos (URLs only — for AI to reference real imagery)
  try {
    const r = await fetch(`${base}/${pageId}/photos?type=uploaded&fields=id,images,name&limit=30&access_token=${pageToken}`);
    const d: any = await r.json();
    if (d?.error) errors.push(`photos: ${d.error.message}`);
    for (const ph of d?.data || []) {
      const url = ph.images?.[0]?.source;
      if (!url) continue;
      inserts.push({
        type: 'photo',
        content: ph.name || 'Untitled photo',
        meta: { url },
        fb_id: ph.id,
        eng: 0,
      });
    }
  } catch (e: any) { errors.push(`photos: ${e.message}`); }

  // 5. Upcoming events (real future dates AI can reference)
  try {
    const r = await fetch(`${base}/${pageId}/events?fields=id,name,description,start_time,place&time_filter=upcoming&access_token=${pageToken}`);
    const d: any = await r.json();
    if (!d?.error) {
      for (const ev of d?.data || []) {
        inserts.push({
          type: 'event',
          content: `${ev.name}${ev.description ? ' — ' + ev.description.substring(0, 200) : ''}`,
          meta: { start_time: ev.start_time, place: ev.place?.name },
          fb_id: ev.id,
          eng: 0,
        });
      }
    }
    // events permission often missing — silently skip
  } catch { /* skip */ }

  // Wipe old rows for this workspace + replace (UNIQUE constraint covers de-dup
  // but a fresh wipe ensures stale facts are removed)
  await db.prepare('DELETE FROM client_facts WHERE user_id = ? AND COALESCE(client_id, \'\') = ?').bind(uid, clientId || '').run();

  let inserted = 0;
  for (const f of inserts) {
    try {
      await db.prepare(
        `INSERT OR IGNORE INTO client_facts (user_id, client_id, fact_type, content, metadata, fb_id, engagement_score)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(uid, clientId, f.type, f.content, JSON.stringify(f.meta || {}), f.fb_id, f.eng).run();
      inserted++;
    } catch { /* duplicate or constraint — skip */ }
  }

  return { inserted, errors };
}
