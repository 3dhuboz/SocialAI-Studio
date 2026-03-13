/**
 * Netlify serverless function — Facebook Page ID lookup
 * Uses FACEBOOK_APP_ID + FACEBOOK_APP_SECRET to get an App Access Token,
 * then queries the Graph API for the page's numeric ID.
 */

const FB_BASE = 'https://graph.facebook.com/v19.0';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const APP_ID = process.env.FACEBOOK_APP_ID;
  const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

  if (!APP_ID || !APP_SECRET) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'FACEBOOK_APP_ID / FACEBOOK_APP_SECRET not configured in Netlify env vars.' }),
    };
  }

  let username;
  try {
    const body = JSON.parse(event.body || '{}');
    username = (body.username || '').trim().replace(/^@/, '').replace(/\/$/, '');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!username) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'username is required' }) };
  }

  try {
    // 1. Get App Access Token
    const tokenRes = await fetch(
      `${FB_BASE}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&grant_type=client_credentials`,
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not obtain Facebook App Access Token' }) };
    }

    // 2. Look up the page
    const pageRes = await fetch(
      `${FB_BASE}/${encodeURIComponent(username)}?fields=id,name&access_token=${tokenData.access_token}`,
    );
    const pageData = await pageRes.json();

    if (pageData.error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: pageData.error.message || 'Page not found' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ pageId: pageData.id, pageName: pageData.name }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Lookup failed' }) };
  }
};
