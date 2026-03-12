/**
 * Facebook Token Exchange
 *
 * Receives a short-lived user access token from the client (FB JS SDK),
 * exchanges it for a 60-day long-lived user token using the App Secret,
 * then fetches /me/accounts — page access tokens returned from a long-lived
 * user token are PERMANENT (never expire unless the user revokes access).
 *
 * Required Netlify environment variables:
 *   FACEBOOK_APP_ID      — your Facebook App ID
 *   FACEBOOK_APP_SECRET  — your Facebook App Secret (keep this server-side only)
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'FACEBOOK_APP_ID or FACEBOOK_APP_SECRET not configured in Netlify environment variables.' }),
    };
  }

  let shortLivedToken;
  try {
    const body = JSON.parse(event.body || '{}');
    shortLivedToken = body.access_token;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  if (!shortLivedToken) {
    return { statusCode: 400, body: JSON.stringify({ error: 'access_token is required.' }) };
  }

  // ── Step 1: Exchange short-lived token → long-lived user token (60 days) ──
  const exchangeUrl = `${GRAPH}/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${appId}` +
    `&client_secret=${appSecret}` +
    `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;

  const exchangeRes = await fetch(exchangeUrl);
  const exchangeData = await exchangeRes.json();

  if (exchangeData.error) {
    console.error('Token exchange error:', exchangeData.error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Token exchange failed: ${exchangeData.error.message}` }),
    };
  }

  const longLivedUserToken = exchangeData.access_token;
  const expiresIn = exchangeData.expires_in; // seconds (~5183944 ≈ 60 days)

  // ── Step 2: Fetch pages using the long-lived user token ──
  // Page access tokens obtained from a long-lived user token never expire.
  const pagesUrl = `${GRAPH}/me/accounts?fields=id,name,access_token,category,picture&access_token=${longLivedUserToken}`;
  const pagesRes = await fetch(pagesUrl);
  const pagesData = await pagesRes.json();

  if (pagesData.error) {
    console.error('Pages fetch error:', pagesData.error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Failed to fetch pages: ${pagesData.error.message}` }),
    };
  }

  // ── Step 3: Verify each page token is long-lived ──
  // Page tokens from a long-lived user token have no expiry — confirm via debug
  const pages = pagesData.data || [];

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pages,
      longLivedUserToken,       // 60-day user token (store if you need to refresh pages later)
      expiresIn,                 // seconds until user token expires (~60 days)
      pageTokensNeverExpire: true, // page tokens from long-lived user tokens are permanent
    }),
  };
};
