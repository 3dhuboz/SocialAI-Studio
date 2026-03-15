/**
 * Netlify serverless function — Late API proxy
 * Keeps LATE_API_KEY off the client. All Late API calls route through here.
 *
 * Supported actions (passed as ?action= query param or in POST body):
 *   create-profile    POST  { title }
 *   connect-url       GET   ?profileId=&platform=&redirectUrl=
 *   list-pages        GET   ?connectToken=
 *   select-page       POST  { connectToken, pageId }
 *   post              POST  { profileId, platforms[], text, mediaUrls[], scheduleDate? }
 *   delete-post       DELETE { profileId, postId }
 *   analytics         GET   ?profileId=
 *   profile-info      GET   ?profileId=
 */

const LATE_BASE = 'https://getlate.dev/api/v1';

export const handler = async (event) => {
  const API_KEY = process.env.LATE_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'LATE_API_KEY not configured in Netlify environment variables.' }) };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const qs = event.queryStringParameters || {};
  const action = qs.action;
  const authHeader = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

  try {
    // ── Create a new Late profile for a client ──────────────────────────
    if (action === 'create-profile' && event.httpMethod === 'POST') {
      const { title } = JSON.parse(event.body || '{}');
      const res = await fetch(`${LATE_BASE}/profiles`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ name: title || 'SocialAI Client' }),
      });
      const data = await res.json();
      // Normalise response — Late returns profile._id, expose as id for the client
      if (data.profile) data.id = data.profile._id;
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── List existing profiles (to reuse instead of hitting plan limit) ──
    if (action === 'list-profiles' && event.httpMethod === 'GET') {
      const res = await fetch(`${LATE_BASE}/profiles`, { headers: authHeader });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── Get OAuth connect URL for a platform (standard mode — Late hosts UI) ─
    if (action === 'connect-url' && event.httpMethod === 'GET') {
      const { profileId, platform = 'facebook', redirectUrl } = qs;
      if (!profileId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'profileId required' }) };
      // Standard mode: Late handles page/account selection UI itself
      const params = new URLSearchParams({ profileId, redirect_url: redirectUrl || '' });
      const res = await fetch(`${LATE_BASE}/connect/${platform}?${params}`, { headers: authHeader });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── List Facebook pages after OAuth (headless) ──────────────────────
    if (action === 'list-pages' && event.httpMethod === 'GET') {
      const { connectToken } = qs;
      if (!connectToken) return { statusCode: 400, headers, body: JSON.stringify({ error: 'connectToken required' }) };
      const res = await fetch(`${LATE_BASE}/connect/facebook/pages`, {
        headers: { ...authHeader, 'X-Connect-Token': connectToken },
      });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── Select a Facebook page (headless) ───────────────────────────────
    if (action === 'select-page' && event.httpMethod === 'POST') {
      const { connectToken, pageId } = JSON.parse(event.body || '{}');
      if (!connectToken || !pageId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'connectToken and pageId required' }) };
      const res = await fetch(`${LATE_BASE}/connect/facebook/select-page`, {
        method: 'POST',
        headers: { ...authHeader, 'X-Connect-Token': connectToken },
        body: JSON.stringify({ pageId }),
      });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── Get presigned upload URL for media (image/video) ────────────────
    if (action === 'media-presign' && event.httpMethod === 'POST') {
      const { fileName, fileType } = JSON.parse(event.body || '{}');
      if (!fileName || !fileType) return { statusCode: 400, headers, body: JSON.stringify({ error: 'fileName and fileType required' }) };
      const res = await fetch(`${LATE_BASE}/media/presign`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ fileName, fileType }),
      });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── List connected accounts (returns { accounts: [{ _id, platform }] }) ──
    if (action === 'list-accounts' && event.httpMethod === 'GET') {
      const res = await fetch(`${LATE_BASE}/accounts`, { headers: authHeader });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── Publish a post ──────────────────────────────────────────────────
    // The client resolves accountIds from getProfileInfo BEFORE calling this.
    // The proxy uses them directly — no global account lookup (which picks wrong accounts).
    if (action === 'post' && event.httpMethod === 'POST') {
      const { profileId, platforms, text, mediaUrls, scheduleDate, mediaItems, accountIds } = JSON.parse(event.body || '{}');
      if (!platforms?.length || !text) return { statusCode: 400, headers, body: JSON.stringify({ error: 'platforms and text are required' }) };

      const requestedPlatforms = platforms.map(p => p.toLowerCase());
      let platformObjs = [];

      // ── Use pre-resolved accountIds from the client ──
      if (accountIds && typeof accountIds === 'object') {
        platformObjs = requestedPlatforms
          .filter(p => accountIds[p])
          .map(p => ({ platform: p, accountId: accountIds[p] }));
        console.log('[late-proxy] Using client-provided accountIds:', JSON.stringify(platformObjs));
      }

      // ── Fallback 1: GET /accounts?profileId=X (filter by profile) ──
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
              if (platformObjs.length > 0) {
                console.log('[late-proxy] Resolved from filtered accounts:', JSON.stringify(platformObjs));
              }
            }
          }
        } catch (e) {
          console.warn('[late-proxy] Filtered accounts lookup failed:', e.message);
        }
      }

      // ── Fallback 2: GET /accounts (all) — find by profile field on account ──
      if (platformObjs.length === 0 && profileId) {
        try {
          const allRes = await fetch(`${LATE_BASE}/accounts`, { headers: authHeader });
          if (allRes.ok) {
            const allData = await allRes.json();
            const allAccounts = allData.accounts || allData || [];
            // DIAGNOSTIC: log EVERY field of EVERY account so we can find the profile link
            console.log(`[late-proxy] ALL ${allAccounts.length} raw accounts:`, JSON.stringify(allAccounts).substring(0, 2000));
            // Try every possible profile field name
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

      // ── SAFETY: if we STILL can't resolve accounts, refuse to post ──
      // This prevents posting to the wrong Facebook page.
      if (platformObjs.length === 0) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Could not determine which Facebook page to post to for this workspace. Please disconnect and reconnect Facebook in Settings.' }) };
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
        return { statusCode: res.status, headers, body: JSON.stringify({ error: errMsg }) };
      }
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── List published posts for a profile ───────────────────────────────
    if (action === 'list-posts' && event.httpMethod === 'GET') {
      const { profileId, limit = '30' } = qs;
      if (!profileId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'profileId required' }) };
      // Try Late's posts endpoint (published/scheduled posts)
      const res = await fetch(`${LATE_BASE}/profiles/${profileId}/posts?limit=${limit}&status=published`, { headers: authHeader });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── Get analytics for a profile ─────────────────────────────────────
    if (action === 'analytics' && event.httpMethod === 'GET') {
      const { profileId } = qs;
      if (!profileId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'profileId required' }) };
      const res = await fetch(`${LATE_BASE}/analytics?profileId=${profileId}`, { headers: authHeader });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── Get profile info / connected accounts ───────────────────────────
    if (action === 'profile-info' && event.httpMethod === 'GET') {
      const { profileId } = qs;
      if (!profileId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'profileId required' }) };
      const res = await fetch(`${LATE_BASE}/profiles/${profileId}`, { headers: authHeader });
      const data = await res.json();
      return { statusCode: res.status, headers, body: JSON.stringify(data) };
    }

    // ── Get Late.dev account / credit info ───────────────────────────────
    if (action === 'get-credits' && event.httpMethod === 'GET') {
      const res = await fetch(`${LATE_BASE}/user/me`, { headers: authHeader });
      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify({ error: data?.message || `HTTP ${res.status}` }) };
      const credits = data?.credits ?? data?.balance ?? data?.quota ?? data?.postsRemaining ?? null;
      const plan = data?.plan ?? data?.subscription?.plan ?? null;
      return { statusCode: 200, headers, body: JSON.stringify({ credits, plan, raw: data }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
