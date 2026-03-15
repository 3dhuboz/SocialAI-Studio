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
    if (action === 'post' && event.httpMethod === 'POST') {
      const { profileId, platforms, text, mediaUrls, scheduleDate, mediaItems, accountIds } = JSON.parse(event.body || '{}');
      if (!platforms?.length || !text) return { statusCode: 400, headers, body: JSON.stringify({ error: 'platforms and text are required' }) };

      const requestedPlatforms = platforms.map(p => p.toLowerCase());

      // ── FAST PATH: If caller provides pre-resolved accountIds, skip all lookup ──
      if (accountIds && typeof accountIds === 'object' && Object.keys(accountIds).length > 0) {
        const platformObjs = requestedPlatforms
          .filter(p => accountIds[p])
          .map(p => ({ platform: p, accountId: accountIds[p] }));
        if (platformObjs.length > 0) {
          const postBody = {
            content: text,
            platforms: platformObjs,
            ...(profileId ? { profileId } : {}),
            ...(scheduleDate ? { scheduledFor: scheduleDate, timezone: 'UTC' } : { publishNow: true }),
            ...(mediaItems?.length ? { mediaItems } : mediaUrls?.length ? { mediaUrls } : {}),
          };
          console.log('[late-proxy] FAST PATH with pre-resolved accountIds:', JSON.stringify(postBody));
          const res = await fetch(`${LATE_BASE}/posts`, {
            method: 'POST', headers: authHeader, body: JSON.stringify(postBody),
          });
          const rawText = await res.text();
          let data;
          try { data = JSON.parse(rawText); } catch { data = { error: rawText || `Late API HTTP ${res.status}` }; }
          if (!res.ok) {
            const errMsg = data?.message || data?.error || data?.detail || rawText || `Late API HTTP ${res.status}`;
            console.log('[late-proxy] FAST PATH error:', errMsg);
            return { statusCode: res.status, headers, body: JSON.stringify({ error: errMsg }) };
          }
          return { statusCode: res.status, headers, body: JSON.stringify(data) };
        }
      }

      // ── Strategy 1: Get profile details → extract its connected accounts ──
      let profileAccounts = [];
      if (profileId) {
        try {
          const profRes = await fetch(`${LATE_BASE}/profiles/${profileId}`, { headers: authHeader });
          if (profRes.ok) {
            const profData = await profRes.json();
            const prof = profData.profile || profData;
            // Late profiles may store connected accounts under various keys
            const accs = prof.accounts || prof.connections || prof.socialAccounts || prof.connectedAccounts || [];
            profileAccounts = Array.isArray(accs) ? accs : [];
            console.log(`[late-proxy] profile ${profileId} details:`, JSON.stringify({ name: prof.name, accountCount: profileAccounts.length, accounts: profileAccounts.map(a => ({ id: a._id || a.id, platform: a.platform, name: a.name })) }));
          }
        } catch (e) {
          console.warn('[late-proxy] failed to get profile details:', e.message);
        }
      }

      // ── Strategy 2: If profile has accounts, use them directly ─────────
      let platformObjs = [];
      if (profileAccounts.length > 0) {
        platformObjs = requestedPlatforms.map(p => {
          const acc = profileAccounts.find(a => (a.platform || '').toLowerCase() === p);
          const accId = acc?._id || acc?.id || acc?.accountId;
          return acc && accId ? { platform: acc.platform || p, accountId: accId } : null;
        }).filter(Boolean);
        console.log(`[late-proxy] resolved from profile accounts:`, JSON.stringify(platformObjs));
      }

      // ── Strategy 3: Fall back to global /accounts (original approach) ──
      if (platformObjs.length === 0) {
        const accRes = await fetch(`${LATE_BASE}/accounts`, { headers: authHeader });
        const accData = await accRes.json();
        const allAccounts = accData.accounts || accData || [];
        console.log('[late-proxy] ALL global accounts:', JSON.stringify(allAccounts.map(a => ({ id: a._id, platform: a.platform, name: a.name, profileId: a.profileId || a.profile || '?' }))));

        // Try to filter by profileId if the accounts have that field
        let filtered = profileId
          ? allAccounts.filter(a => [a.profileId, a.profile, a.profile_id, a.profileid].includes(profileId))
          : [];
        const pool = filtered.length > 0 ? filtered : allAccounts;
        if (filtered.length === 0 && profileId) {
          console.warn(`[late-proxy] WARNING: cannot filter accounts by profileId ${profileId}. Using all ${allAccounts.length} accounts.`);
        }

        platformObjs = requestedPlatforms.map(p => {
          const acc = pool.find(a => (a.platform || '').toLowerCase() === p);
          return acc ? { platform: acc.platform, accountId: acc._id } : null;
        }).filter(Boolean);
      }

      if (platformObjs.length === 0) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: `No connected accounts found for [${requestedPlatforms.join(', ')}]. Please reconnect in Settings.` }) };
      }

      // ── Try posting via profile-specific endpoint first ────────────────
      const postBody = {
        content: text,
        platforms: platformObjs,
        ...(profileId ? { profileId } : {}),
        ...(scheduleDate ? { scheduledFor: scheduleDate, timezone: 'UTC' } : { publishNow: true }),
        ...(mediaItems?.length ? { mediaItems } : mediaUrls?.length ? { mediaUrls } : {}),
      };

      // Attempt 1: POST /profiles/{id}/posts (profile-scoped)
      if (profileId) {
        console.log(`[late-proxy] Attempt 1: POST /profiles/${profileId}/posts`, JSON.stringify(postBody));
        const res1 = await fetch(`${LATE_BASE}/profiles/${profileId}/posts`, {
          method: 'POST', headers: authHeader, body: JSON.stringify(postBody),
        });
        if (res1.ok) {
          const data = await res1.json();
          console.log('[late-proxy] profile-scoped post SUCCESS');
          return { statusCode: res1.status, headers, body: JSON.stringify(data) };
        }
        const err1 = await res1.text();
        console.log(`[late-proxy] profile-scoped post failed (${res1.status}):`, err1.substring(0, 200));
      }

      // Attempt 2: POST /posts (global, with profileId in body)
      console.log('[late-proxy] Attempt 2: POST /posts', JSON.stringify(postBody));
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
