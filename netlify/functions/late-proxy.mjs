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
    // Late API requires: { content, publishNow|scheduledFor, platforms: [{ platform, accountId }] }
    if (action === 'post' && event.httpMethod === 'POST') {
      const { profileId, platforms, text, mediaUrls, scheduleDate, mediaItems } = JSON.parse(event.body || '{}');
      if (!platforms?.length || !text) return { statusCode: 400, headers, body: JSON.stringify({ error: 'platforms and text are required' }) };

      // ── Fetch connected accounts scoped to THIS profile ──────────────
      // IMPORTANT: /accounts returns ALL accounts across ALL profiles.
      // We MUST scope to the profile so each workspace posts to its own page.
      let allAccounts = [];
      if (profileId) {
        // Try profile-specific endpoint first
        const profAccRes = await fetch(`${LATE_BASE}/profiles/${profileId}/accounts`, { headers: authHeader });
        if (profAccRes.ok) {
          const profAccData = await profAccRes.json();
          allAccounts = profAccData.accounts || profAccData || [];
          console.log(`[late-proxy] profile ${profileId} accounts:`, JSON.stringify(allAccounts.map(a => ({ id: a._id, platform: a.platform, name: a.name }))));
        }
        // If profile-specific didn't work, try filtering global accounts by profileId
        if (allAccounts.length === 0) {
          const accRes = await fetch(`${LATE_BASE}/accounts`, { headers: authHeader });
          const accData = await accRes.json();
          const global = accData.accounts || accData || [];
          // Filter to only accounts belonging to this profile
          allAccounts = global.filter(a => a.profileId === profileId || a.profile === profileId || a.profile_id === profileId);
          console.log(`[late-proxy] filtered global accounts for profile ${profileId}:`, JSON.stringify(allAccounts.map(a => ({ id: a._id, platform: a.platform, profileId: a.profileId || a.profile }))));
          // Last resort: if no accounts match the profile filter, use all (legacy behavior)
          if (allAccounts.length === 0 && global.length > 0) {
            console.warn(`[late-proxy] WARNING: could not filter accounts by profileId ${profileId}, using all ${global.length} accounts`);
            allAccounts = global;
          }
        }
      } else {
        // No profileId — fall back to global (legacy)
        const accRes = await fetch(`${LATE_BASE}/accounts`, { headers: authHeader });
        const accData = await accRes.json();
        allAccounts = accData.accounts || accData || [];
      }

      // Map requested platform strings → { platform, accountId } objects
      const requestedPlatforms = platforms.map(p => p.toLowerCase());
      const platformObjs = requestedPlatforms.map(p => {
        const acc = allAccounts.find(a => (a.platform || '').toLowerCase() === p);
        return acc ? { platform: acc.platform, accountId: acc._id } : null;
      }).filter(Boolean);

      if (platformObjs.length === 0) {
        const available = allAccounts.map(a => `${a.platform}(${a.name || a._id})`).join(', ') || 'none';
        return { statusCode: 422, headers, body: JSON.stringify({ error: `No connected accounts found for [${requestedPlatforms.join(', ')}] on this workspace's profile. Available: ${available}. Please reconnect in Settings → Social Media Connection.` }) };
      }

      const body = {
        content: text,
        platforms: platformObjs,
        ...(scheduleDate ? { scheduledFor: scheduleDate, timezone: 'UTC' } : { publishNow: true }),
        ...(mediaItems?.length ? { mediaItems } : mediaUrls?.length ? { mediaUrls } : {}),
      };
      console.log('[late-proxy] POST /posts payload:', JSON.stringify(body));

      const res = await fetch(`${LATE_BASE}/posts`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(body),
      });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); } catch { data = { error: rawText || `Late API HTTP ${res.status}` }; }
      if (!res.ok) {
        const errMsg = data?.message || data?.error || data?.detail || rawText || `Late API HTTP ${res.status}`;
        console.log('[late-proxy] POST /posts error:', errMsg, JSON.stringify(data));
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
