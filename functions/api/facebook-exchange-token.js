/**
 * Cloudflare Pages Function — Facebook token exchange
 * Available at: /api/facebook-exchange-token
 *
 * Required env vars: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    return new Response(JSON.stringify({ error: 'FACEBOOK_APP_ID or FACEBOOK_APP_SECRET not configured.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  let shortLivedToken;
  try {
    const body = await request.json();
    shortLivedToken = body.access_token;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!shortLivedToken) {
    return new Response(JSON.stringify({ error: 'access_token is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const exchangeUrl = `${GRAPH}/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${appId}` +
    `&client_secret=${appSecret}` +
    `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;

  const exchangeRes = await fetch(exchangeUrl);
  const exchangeData = await exchangeRes.json();

  if (exchangeData.error) {
    return new Response(JSON.stringify({ error: `Token exchange failed: ${exchangeData.error.message}` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const longLivedUserToken = exchangeData.access_token;
  const expiresIn = exchangeData.expires_in;

  const pagesUrl = `${GRAPH}/me/accounts?fields=id,name,access_token,category,picture&access_token=${longLivedUserToken}`;
  const pagesRes = await fetch(pagesUrl);
  const pagesData = await pagesRes.json();

  if (pagesData.error) {
    return new Response(JSON.stringify({ error: `Failed to fetch pages: ${pagesData.error.message}` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    pages: pagesData.data || [],
    longLivedUserToken,
    expiresIn,
    pageTokensNeverExpire: true,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
