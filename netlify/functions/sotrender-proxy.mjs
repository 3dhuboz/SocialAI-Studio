/**
 * Netlify serverless function — Sotrender API proxy
 * Keeps SOTRENDER_API_KEY off the client.
 *
 * Actions (POST body { action, ... }):
 *   search-profile   { query }                  → search for a FB page
 *   add-profile      { facebookPageId }          → assign page to account
 *   get-posts        { pageId, since?, until? }  → posts + reactions/comments/shares
 *   get-daily        { pageId, since?, until? }  → daily follower/engagement stats
 *   get-hourly       { pageId, since?, until? }  → hourly engagement breakdown
 *   get-weekdaily    { pageId, since?, until? }  → best-day breakdown
 */

const SOTRENDER_BASE = 'https://api.sotrender.com';

export const handler = async (event) => {
  const API_KEY = process.env.SOTRENDER_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'SOTRENDER_API_KEY not configured in Netlify environment variables.' }),
    };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action } = body;

  const sotrenderFetch = async (path, options = {}) => {
    const res = await fetch(`${SOTRENDER_BASE}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  };

  try {
    if (action === 'search-profile') {
      const { query } = body;
      const { ok, data } = await sotrenderFetch(`/v2/search/facebook?q=${encodeURIComponent(query)}&limit=5`);
      if (!ok) return { statusCode: 400, headers, body: JSON.stringify({ error: data?.message || 'Search failed' }) };
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === 'add-profile') {
      const { facebookPageId } = body;
      const res = await fetch(`${SOTRENDER_BASE}/v2/profiles`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `profile_id=${encodeURIComponent(facebookPageId)}&channel=facebook`,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!res.ok && res.status !== 409) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: data?.message || 'Add profile failed' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    if (action === 'get-posts') {
      const { pageId, since, until, limit = 30 } = body;
      let url = `/v2/facebook/${pageId}/posts?sort=-published_at&limit=${limit}&author=page`;
      if (since) url += `&since=${since}`;
      if (until) url += `&until=${until}`;
      const { ok, data } = await sotrenderFetch(url);
      if (!ok) return { statusCode: 400, headers, body: JSON.stringify({ error: data?.message || 'Get posts failed' }) };
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === 'get-daily') {
      const { pageId, since, until } = body;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      let url = `/v2/facebook/${pageId}/daily?since=${since || thirtyDaysAgo}&until=${until || today}`;
      const { ok, data } = await sotrenderFetch(url);
      if (!ok) return { statusCode: 400, headers, body: JSON.stringify({ error: data?.message || 'Get daily stats failed' }) };
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === 'get-hourly') {
      const { pageId, since, until } = body;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      let url = `/v2/facebook/${pageId}/hourly?since=${since || thirtyDaysAgo}&until=${until || today}`;
      const { ok, data } = await sotrenderFetch(url);
      if (!ok) return { statusCode: 400, headers, body: JSON.stringify({ error: data?.message || 'Get hourly stats failed' }) };
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === 'get-weekdaily') {
      const { pageId, since, until } = body;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      let url = `/v2/facebook/${pageId}/weekdaily?since=${since || thirtyDaysAgo}&until=${until || today}`;
      const { ok, data } = await sotrenderFetch(url);
      if (!ok) return { statusCode: 400, headers, body: JSON.stringify({ error: data?.message || 'Get weekdaily stats failed' }) };
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    console.error('sotrender-proxy error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
