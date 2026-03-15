/**
 * Cloudflare Pages Function — Late API proxy
 * Keeps LATE_API_KEY off the client. All Late API calls route through here.
 * Available at: /api/late-proxy
 *
 * Supported actions (passed as ?action= query param):
 *   create-profile    POST  { title }
 *   list-profiles     GET
 *   connect-url       GET   ?profileId=&platform=&redirectUrl=
 *   list-pages        GET   ?connectToken=
 *   select-page       POST  { connectToken, pageId }
 *   media-presign     POST  { fileName, fileType }
 *   list-accounts     GET
 *   get-accounts      GET
 *   post              POST  { profileId, platforms[], text, mediaUrls[], scheduleDate?, accountIds? }
 *   list-posts        GET   ?profileId=
 *   analytics         GET   ?profileId=
 *   profile-info      GET   ?profileId=
 *   get-credits       GET
 */

const LATE_BASE = 'https://getlate.dev/api/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export async function onRequest(context) {
  const { request, env } = context;
  const API_KEY = env.LATE_API_KEY;

  if (!API_KEY) {
    return json({ error: 'LATE_API_KEY not configured in Cloudflare environment variables.' }, 500);
  }

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const qs = url.searchParams;
  const action = qs.get('action');
  const authHeader = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

  const getBody = async () => {
    try { return await request.json(); } catch { return {}; }
  };

  try {
    // ── Create a new Late profile ──────────────────────────────────────
    if (action === 'create-profile' && request.method === 'POST') {
      const { title } = await getBody();
      const res = await fetch(`${LATE_BASE}/profiles`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ name: title || 'SocialAI Client' }),
      });
      const data = await res.json();
      if (data.profile) data.id = data.profile._id;
      return json(data, res.status);
    }

    // ── List existing profiles ─────────────────────────────────────────
    if (action === 'list-profiles' && request.method === 'GET') {
      const res = await fetch(`${LATE_BASE}/profiles`, { headers: authHeader });
      return json(await res.json(), res.status);
    }

    // ── Get OAuth connect URL ──────────────────────────────────────────
    if (action === 'connect-url' && request.method === 'GET') {
      const profileId = qs.get('profileId');
      const platform = qs.get('platform') || 'facebook';
      const redirectUrl = qs.get('redirectUrl') || '';
      if (!profileId) return json({ error: 'profileId required' }, 400);
      const params = new URLSearchParams({ profileId, redirect_url: redirectUrl });
      const res = await fetch(`${LATE_BASE}/connect/${platform}?${params}`, { headers: authHeader });
      return json(await res.json(), res.status);
    }

    // ── List Facebook pages after OAuth (headless) ─────────────────────
    if (action === 'list-pages' && request.method === 'GET') {
      const connectToken = qs.get('connectToken');
      if (!connectToken) return json({ error: 'connectToken required' }, 400);
      const res = await fetch(`${LATE_BASE}/connect/facebook/pages`, {
        headers: { ...authHeader, 'X-Connect-Token': connectToken },
      });
      return json(await res.json(), res.status);
    }

    // ── Select a Facebook page (headless) ──────────────────────────────
    if (action === 'select-page' && request.method === 'POST') {
      const { connectToken, pageId } = await getBody();
      if (!connectToken || !pageId) return json({ error: 'connectToken and pageId required' }, 400);
      const res = await fetch(`${LATE_BASE}/connect/facebook/select-page`, {
        method: 'POST',
        headers: { ...authHeader, 'X-Connect-Token': connectToken },
        body: JSON.stringify({ pageId }),
      });
      return json(await res.json(), res.status);
    }

    // ── Get presigned upload URL for media ─────────────────────────────
    if (action === 'media-presign' && request.method === 'POST') {
      const { fileName, fileType } = await getBody();
      if (!fileName || !fileType) return json({ error: 'fileName and fileType required' }, 400);
      const res = await fetch(`${LATE_BASE}/media/presign`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ fileName, fileType }),
      });
      return json(await res.json(), res.status);
    }

    // ── List / get connected accounts ──────────────────────────────────
    if ((action === 'list-accounts' || action === 'get-accounts') && request.method === 'GET') {
      const res = await fetch(`${LATE_BASE}/accounts`, { headers: authHeader });
      return json(await res.json(), res.status);
    }

    // ── Publish a post ─────────────────────────────────────────────────
    if (action === 'post' && request.method === 'POST') {
      const { profileId, platforms, text, mediaUrls, scheduleDate, mediaItems, accountIds } = await getBody();
      if (!platforms?.length || !text) return json({ error: 'platforms and text are required' }, 400);

      const requestedPlatforms = platforms.map(p => p.toLowerCase());
      let platformObjs = [];

      // ── Use pre-resolved accountIds from the client ──
      if (accountIds && typeof accountIds === 'object') {
        platformObjs = requestedPlatforms
          .filter(p => accountIds[p])
          .map(p => ({ platform: p, accountId: accountIds[p] }));
        console.log('[late-proxy] Using client-provided accountIds:', JSON.stringify(platformObjs));
      }

      // ── Fallback 1: GET /accounts?profileId=X ──
      if (platformObjs.length === 0 && profileId) {
        try {
          const filteredRes = await fetch(`${LATE_BASE}/accounts?profileId=${profileId}`, { headers: authHeader });
          if (filteredRes.ok) {
            const filteredData = await filteredRes.json();
            const filteredAccounts = filteredData.accounts || filteredData || [];
            console.log(`[late-proxy] GET /accounts?profileId=${profileId} returned ${filteredAccounts.length} accounts:`, JSON.stringify(filteredAccounts));
            if (Array.isArray(filteredAccounts) && filteredAccounts.length > 0) {
              platformObjs = requestedPlatforms.map(p => {
                const acc = filteredAccounts.find(a => (a.platform || '').toLowerCase() === p);
                const accId = acc?._id || acc?.id || acc?.accountId;
                return acc && accId ? { platform: p, accountId: accId } : null;
              }).filter(Boolean);
            }
          }
        } catch (e) {
          console.warn('[late-proxy] Filtered accounts lookup failed:', e.message);
        }
      }

      // ── Fallback 2: GET /accounts (all) — match by profile field ──
      if (platformObjs.length === 0 && profileId) {
        try {
          const allRes = await fetch(`${LATE_BASE}/accounts`, { headers: authHeader });
          if (allRes.ok) {
            const allData = await allRes.json();
            const allAccounts = allData.accounts || allData || [];
            console.log(`[late-proxy] ALL ${allAccounts.length} raw accounts:`, JSON.stringify(allAccounts).substring(0, 2000));
            const matched = allAccounts.filter(a => {
              const p = a.profile || a.profileId || a.profile_id || a.profileid || a.owner || a.profileRef || '';
              const pStr = typeof p === 'object' ? (p._id || p.id || JSON.stringify(p)) : String(p);
              return pStr === profileId;
            });
            console.log(`[late-proxy] Matched ${matched.length} accounts for profile ${profileId}`);
            if (matched.length > 0) {
              platformObjs = requestedPlatforms.map(p => {
                const acc = matched.find(a => (a.platform || '').toLowerCase() === p);
                const accId = acc?._id || acc?.id || acc?.accountId;
                return acc && accId ? { platform: p, accountId: accId } : null;
              }).filter(Boolean);
            }
          }
        } catch (e) {
          console.warn('[late-proxy] All accounts lookup failed:', e.message);
        }
      }

      // ── SAFETY: refuse to post if we can't determine the correct page ──
      if (platformObjs.length === 0) {
        return json({ error: 'Could not determine which Facebook page to post to for this workspace. Please disconnect and reconnect Facebook in Settings.' }, 422);
      }

      const postBody = {
        content: text,
        platforms: platformObjs,
        ...(profileId ? { profileId } : {}),
        ...(scheduleDate ? { scheduledFor: scheduleDate, timezone: 'UTC' } : { publishNow: true }),
        ...(mediaItems?.length ? { mediaItems } : mediaUrls?.length ? { mediaUrls } : {}),
      };
      console.log('[late-proxy] POST /posts payload:', JSON.stringify(postBody));

      const res = await fetch(`${LATE_BASE}/posts`, {
        method: 'POST', headers: authHeader, body: JSON.stringify(postBody),
      });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); } catch { data = { error: rawText || `Late API HTTP ${res.status}` }; }
      if (!res.ok) {
        const errMsg = data?.message || data?.error || data?.detail || rawText || `Late API HTTP ${res.status}`;
        console.log('[late-proxy] POST /posts error:', errMsg);
        return json({ error: errMsg }, res.status);
      }
      return json(data, res.status);
    }

    // ── List published posts for a profile ────────────────────────────
    if (action === 'list-posts' && request.method === 'GET') {
      const profileId = qs.get('profileId');
      const limit = qs.get('limit') || '30';
      if (!profileId) return json({ error: 'profileId required' }, 400);
      const res = await fetch(`${LATE_BASE}/profiles/${profileId}/posts?limit=${limit}&status=published`, { headers: authHeader });
      return json(await res.json(), res.status);
    }

    // ── Get analytics for a profile ───────────────────────────────────
    if (action === 'analytics' && request.method === 'GET') {
      const profileId = qs.get('profileId');
      if (!profileId) return json({ error: 'profileId required' }, 400);
      const res = await fetch(`${LATE_BASE}/analytics?profileId=${profileId}`, { headers: authHeader });
      return json(await res.json(), res.status);
    }

    // ── Get profile info ──────────────────────────────────────────────
    if (action === 'profile-info' && request.method === 'GET') {
      const profileId = qs.get('profileId');
      if (!profileId) return json({ error: 'profileId required' }, 400);
      const res = await fetch(`${LATE_BASE}/profiles/${profileId}`, { headers: authHeader });
      return json(await res.json(), res.status);
    }

    // ── Get Late.dev account / credit info ────────────────────────────
    if (action === 'get-credits' && request.method === 'GET') {
      const res = await fetch(`${LATE_BASE}/user/me`, { headers: authHeader });
      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) return json({ error: data?.message || `HTTP ${res.status}` }, res.status);
      const credits = data?.credits ?? data?.balance ?? data?.quota ?? data?.postsRemaining ?? null;
      const plan = data?.plan ?? data?.subscription?.plan ?? null;
      return json({ credits, plan, raw: data });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
}
