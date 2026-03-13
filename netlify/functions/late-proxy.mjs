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

    // ── Publish a post ──────────────────────────────────────────────────
    if (action === 'post' && event.httpMethod === 'POST') {
      const { profileId, platforms, text, mediaUrls, scheduleDate } = JSON.parse(event.body || '{}');
      if (!profileId || !platforms || !text) return { statusCode: 400, headers, body: JSON.stringify({ error: 'profileId, platforms, and text required' }) };
      // Normalise platform names — try both lowercase and capitalised (Late docs unclear)
      const normalisedPlatforms = platforms.map((p) => p.toLowerCase());
      const body = { profileId, platforms: normalisedPlatforms, content: text, ...(mediaUrls?.length ? { mediaUrls } : {}), ...(scheduleDate ? { scheduleDate } : {}) };
      console.log('[late-proxy] POST /posts payload:', JSON.stringify(body));
      const res = await fetch(`${LATE_BASE}/posts`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(body),
      });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); } catch { data = { error: rawText || `Late API returned HTTP ${res.status}` }; }
      // Surface full Late error for debugging
      if (!res.ok) {
        const errMsg = data?.message || data?.error || data?.detail || rawText || `Late API HTTP ${res.status}`;
        return { statusCode: res.status, headers, body: JSON.stringify({ error: errMsg, lateStatus: res.status, lateBody: data }) };
      }
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

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
